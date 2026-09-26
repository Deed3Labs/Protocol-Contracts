import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';

/*
 * Paying a shop now: the hold, and what counts as the payment.
 *
 * The charge store against a real Postgres (PGlite standing in for the pool), because every guard
 * here is a WHERE clause; and the receipt check against receipts built by hand, because what matters
 * is which Transfer events it accepts.
 */

const pg = new PGlite();
const pool = {
  query: async (text: string, params?: unknown[]) => {
    if (!params?.length && text.includes(';')) {
      await pg.exec(text);
      return { rows: [], rowCount: 0 };
    }
    const r = await pg.query(text, params as any[]);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
};
mock.module('../config/postgres.js', () => ({ getPostgresPool: () => pool, getPayPool: () => pool, closePostgresPool: async () => {} }));

const { chargeStore } = await import('./chargeStore');
const { quotePaidNow, receiptPays } = await import('./payNowService');
const { closePlan } = await import('./refundSettlement');

const MEMBER = '0x1111111111111111111111111111111111111111';
const SHOP = '0x2222222222222222222222222222222222222222';
const CLEAR = '0x3333333333333333333333333333333333333333';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Base Sepolia, the default chain
const QUOTE = { payoutCents: 92_825, feeCents: 1_175, feeTo: CLEAR, holdSeconds: 900 };

async function raise(amountCents = 94_000) {
  const c = await chargeStore.create({ merchantAddress: SHOP, merchantName: 'Mike’s Tire', amountCents, payoutCents: 91_650, chainId: 84532, ttlSeconds: 86_400 });
  await chargeStore.attachMember(c!.code, MEMBER);
  return c!.code;
}

beforeAll(async () => {
  await chargeStore.get('WARMUP00'); // creates the table
});
beforeEach(async () => {
  await pg.exec('DELETE FROM charge_requests');
});

describe('the hold', () => {
  test('takes a pending charge out of reach of a plan, the shop and the plan reconciler', async () => {
    const code = await raise();
    const held = await chargeStore.holdForPayNow(code, MEMBER, QUOTE);
    expect(held?.status).toBe('resolving');
    expect(held?.payNow).toMatchObject({ payoutCents: 92_825, feeCents: 1_175, feeTo: CLEAR });

    expect(await chargeStore.holdForPayNow(code, MEMBER, QUOTE)).toBeNull();
    expect(await chargeStore.claimForResolution(code)).toBeNull();
    expect(await chargeStore.cancel(code, SHOP)).toBeNull();
    expect(await chargeStore.finish(code, { status: 'approved', splitInto: 4, planId: 9 })).toBeNull();
    await chargeStore.release(code);
    expect((await chargeStore.get(code))?.status).toBe('resolving');
    await pg.query(`UPDATE charge_requests SET created_at = now() - interval '1 hour' WHERE code = $1`, [code]);
    expect(await chargeStore.listStuck(120)).toHaveLength(0);
  });

  test('is only the member’s to take', async () => {
    const code = await raise();
    expect(await chargeStore.holdForPayNow(code, '0x9999999999999999999999999999999999999999', QUOTE)).toBeNull();
  });

  test('goes back to pending when the member goes back, and the charge can then go over time', async () => {
    const code = await raise();
    await chargeStore.holdForPayNow(code, MEMBER, QUOTE);
    const back = await chargeStore.releasePayNow(code);
    expect(back?.status).toBe('pending');
    expect(back?.payNow).toBeNull();
    expect(await chargeStore.claimForResolution(code)).not.toBeNull();
  });

  test('is never let go once a payment is reported, until the chain says it isn’t this one', async () => {
    const code = await raise();
    await chargeStore.holdForPayNow(code, MEMBER, QUOTE);
    await chargeStore.markSubmitted(code, '0xabc');
    expect(await chargeStore.releasePayNow(code)).toBeNull();
    await chargeStore.forgetPayNowTx(code, '0xabc');
    expect((await chargeStore.releasePayNow(code))?.status).toBe('pending');
  });

  test('a lapsed hold, or one with a payment reported, is for the pay-now reconciler', async () => {
    const lapsed = await raise();
    const live = await raise();
    const sent = await raise();
    await chargeStore.holdForPayNow(lapsed, MEMBER, QUOTE);
    await chargeStore.holdForPayNow(live, MEMBER, QUOTE);
    await chargeStore.holdForPayNow(sent, MEMBER, QUOTE);
    await chargeStore.markSubmitted(sent, '0xdef');
    await pg.query(`UPDATE charge_requests SET pay_now_until = now() - interval '1 minute' WHERE code = $1`, [lapsed]);
    expect((await chargeStore.listPayNowStuck()).map((c) => c.code).sort()).toEqual([lapsed, sent].sort());
    expect(await chargeStore.releasePayNow(live, { onlyIfLapsed: true })).toBeNull();
    expect((await chargeStore.releasePayNow(lapsed, { onlyIfLapsed: true }))?.status).toBe('pending');
  });
});

describe('paid', () => {
  test('approved, paid now, no plan, and the shop’s share is the paid-now one', async () => {
    const code = await raise();
    await chargeStore.holdForPayNow(code, MEMBER, QUOTE);
    const done = await chargeStore.finishPaidNow(code, '0xAAA');
    expect(done).toMatchObject({ status: 'approved', paidNow: true, payoutCents: 92_825, splitInto: null, planId: null, txHash: '0xaaa', payNow: null });
  });

  test('one payment pays one charge', async () => {
    const a = await raise();
    const b = await raise();
    await chargeStore.holdForPayNow(a, MEMBER, QUOTE);
    await chargeStore.holdForPayNow(b, MEMBER, QUOTE);
    expect(await chargeStore.finishPaidNow(a, '0xaaa')).not.toBeNull();
    expect(await chargeStore.finishPaidNow(b, '0xaaa')).toBeNull();
  });

  test('only a held charge is paid', async () => {
    const code = await raise();
    expect(await chargeStore.finishPaidNow(code, '0xaaa')).toBeNull();
  });

  test('a refund doesn’t pretend: there is no plan to close, and the money is in the shop’s wallet', async () => {
    const code = await raise();
    await chargeStore.holdForPayNow(code, MEMBER, QUOTE);
    const done = await chargeStore.finishPaidNow(code, '0xaaa');
    expect((await closePlan(done!, done!.amountCents)).ok).toBe(false);
  });
});

describe('the quote', () => {
  test('the paid-now rate, floored so rounding goes to the shop', () => {
    expect(quotePaidNow(94_000, 125)).toEqual({ payoutCents: 92_825, feeCents: 1_175 });
    expect(quotePaidNow(3_899, 150)).toEqual({ payoutCents: 3_841, feeCents: 58 });
    expect(quotePaidNow(50, 125)).toEqual({ payoutCents: 50, feeCents: 0 });
  });
});

describe('what counts as the payment', () => {
  const since = new Date('2026-09-26T12:00:00Z');
  const held = {
    code: 'X', memberWallet: MEMBER.toLowerCase(), merchantAddress: SHOP.toLowerCase(), chainId: 84532, amountCents: 94_000,
    payNow: { payoutCents: 92_825, feeCents: 1_175, feeTo: CLEAR.toLowerCase(), since: since.toISOString(), until: '' },
  } as any;
  const T = ethers.id('Transfer(address,address,uint256)');
  const pad = (a: string) => ethers.zeroPadValue(a, 32);
  const transfer = (from: string, to: string, cents: number, token = USDC) => ({
    address: token,
    topics: [T, pad(from), pad(to)],
    data: ethers.toBeHex(BigInt(cents) * 10_000n, 32),
  });
  const receipt = (logs: object[], status = 1) => ({ status, logs }) as any;
  const after = since.getTime() / 1000 + 30;

  test('both transfers, from the member, after the hold began', async () => {
    expect(await receiptPays(held, receipt([transfer(MEMBER, SHOP, 92_825), transfer(MEMBER, CLEAR, 1_175)]), after)).toBe(true);
  });

  test('not short, not from someone else, not another token, not a failed transaction', async () => {
    expect(await receiptPays(held, receipt([transfer(MEMBER, SHOP, 92_824), transfer(MEMBER, CLEAR, 1_175)]), after)).toBe(false);
    expect(await receiptPays(held, receipt([transfer(MEMBER, SHOP, 92_825)]), after)).toBe(false);
    expect(await receiptPays(held, receipt([transfer(CLEAR, SHOP, 92_825), transfer(MEMBER, CLEAR, 1_175)]), after)).toBe(false);
    const other = '0x4444444444444444444444444444444444444444';
    expect(await receiptPays(held, receipt([transfer(MEMBER, SHOP, 92_825, other), transfer(MEMBER, CLEAR, 1_175, other)]), after)).toBe(false);
    expect(await receiptPays(held, receipt([transfer(MEMBER, SHOP, 92_825), transfer(MEMBER, CLEAR, 1_175)], 0), after)).toBe(false);
  });

  test('not a payment made before the hold', async () => {
    const before = since.getTime() / 1000 - 3600;
    expect(await receiptPays(held, receipt([transfer(MEMBER, SHOP, 92_825), transfer(MEMBER, CLEAR, 1_175)]), before)).toBe(false);
  });

  test('a charge too small to carry a fee is one transfer', async () => {
    const small = { ...held, payNow: { ...held.payNow, payoutCents: 50, feeCents: 0 } };
    expect(await receiptPays(small, receipt([transfer(MEMBER, SHOP, 50)]), after)).toBe(true);
  });
});

describe('the routes', () => {
  const routes = readFileSync(new URL('../routes/charges.ts', import.meta.url), 'utf8');
  const reconciler = readFileSync(new URL('./chargeReconciler.ts', import.meta.url), 'utf8');
  test('paying now and approving a plan each take a fresh Face ID; the member’s own charge only', () => {
    expect(routes).toContain("chargesRouter.post('/:code/pay-now', requireAuth, requireStepUp, async");
    expect(routes).toContain("chargesRouter.post('/:code/approve', requireAuth, requireStepUp, async");
    expect(routes.match(/requireVerifiedWallet\(req, res, charge\.memberWallet, 'charge'\)/g)?.length).toBe(6);
  });
  test('held charges are settled by their own reconciliation', () => {
    expect(reconciler).toContain('await reconcilePayNow()');
  });
});

/*
 * Refunding a charge paid now: both halves back to the member, the shop's from its Clear cash and
 * Clear's fee from Clear's wallet; nothing moves unless both can; a retry never pays a half twice.
 */
describe('refunding a charge paid now', async () => {
  const { refundChain, settlePaidNowRefund, paidNowRefundLegs } = await import('./paidNowRefund');
  const SHOP_WALLET = SHOP as `0x${string}`;
  const CLEAR_WALLET = '0x5555555555555555555555555555555555555555';
  let sent: { from: string; units: bigint }[] = [];
  let balances: Record<string, bigint> = {};
  let receipts: Record<string, { status: number } | null> = {};
  let clearFails = false;
  let n = 0;
  const real = { ...refundChain };

  beforeEach(() => {
    sent = [];
    clearFails = false;
    balances = { [SHOP_WALLET.toLowerCase()]: 1_000_000_000n, [CLEAR_WALLET.toLowerCase()]: 1_000_000_000n };
    receipts = {};
    Object.assign(refundChain, {
      receipt: async (_c: number, h: string) => receipts[h] ?? null,
      known: async () => false,
      balance: async (_c: number, _t: string, who: string) => balances[who.toLowerCase()] ?? 0n,
      clearAddress: () => CLEAR_WALLET,
      sendFromClear: async (_c: number, _t: string, _to: string, units: bigint, onHash: (h: string) => Promise<void>) => {
        if (clearFails) throw new Error('rpc down');
        const h = `0xc${++n}`;
        await onHash(h);
        sent.push({ from: 'clear', units });
        receipts[h] = { status: 1 };
        return true;
      },
      shopWallet: async () => ({
        address: SHOP_WALLET,
        send: async () => {
          const h = `0xs${++n}`;
          sent.push({ from: 'shop', units: 928_250_000n });
          receipts[h] = { status: 1 };
          return h as `0x${string}`;
        },
      }),
    });
  });

  async function paid() {
    const code = await raise();
    await chargeStore.holdForPayNow(code, MEMBER, QUOTE);
    return (await chargeStore.finishPaidNow(code, `0xpay${++n}`))!;
  }

  test('the halves are what the shop received and Clear’s fee, adding up to the charge', () => {
    expect(paidNowRefundLegs({ amountCents: 94_000, payoutCents: 92_825 })).toEqual({ shopCents: 92_825, clearCents: 1_175 });
  });

  test('both go back, and the member is told the whole amount', async () => {
    const charge = await paid();
    const r = await settlePaidNowRefund(charge);
    expect(r).toMatchObject({ ok: true, returnedCents: 94_000, carryWithheldCents: 0 });
    expect(sent.map((s) => [s.from, s.units])).toEqual([
      ['shop', 928_250_000n],
      ['clear', 11_750_000n],
    ]);
    const legs = (await chargeStore.get(charge.code))!.refundLegs;
    expect(legs.shop).toMatch(/^0xs/);
    expect(legs.clear).toMatch(/^0xc/);
  });

  test('short in the shop’s cash: refused with the figures, and nothing moves', async () => {
    const charge = await paid();
    balances[SHOP_WALLET.toLowerCase()] = 500_000_000n;
    const r = await settlePaidNowRefund(charge);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Your Clear cash holds $500.00');
    expect(r.reason).toContain('$928.25');
    expect(sent).toHaveLength(0);
    expect((await chargeStore.get(charge.code))!.refundLegs).toEqual({ shop: null, clear: null });
  });

  test('Clear’s fee failing leaves the shop’s half done, and a retry sends only Clear’s', async () => {
    const charge = await paid();
    clearFails = true;
    const first = await settlePaidNowRefund(charge);
    expect(first.ok).toBe(false);
    expect(first.reason).toContain('Approve it again to finish');
    expect(sent.map((s) => s.from)).toEqual(['shop']);

    clearFails = false;
    const again = await settlePaidNowRefund((await chargeStore.get(charge.code))!);
    expect(again.ok).toBe(true);
    expect(sent.map((s) => s.from)).toEqual(['shop', 'clear']);
  });

  test('a half recorded as sending is never sent again blind', async () => {
    const charge = await paid();
    await chargeStore.setRefundLeg(charge.code, 'shop', 'sending', null);
    const r = await settlePaidNowRefund((await chargeStore.get(charge.code))!);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('needs a look');
    expect(sent).toHaveLength(0);
  });

  test('a recorded half that reverted on chain goes again', async () => {
    const charge = await paid();
    await chargeStore.setRefundLeg(charge.code, 'shop', '0xdead', null);
    receipts['0xdead'] = { status: 0 };
    const r = await settlePaidNowRefund((await chargeStore.get(charge.code))!);
    expect(r.ok).toBe(true);
    expect(sent.map((s) => s.from)).toEqual(['shop', 'clear']);
  });

  test('two settlements racing cannot both start the same half', async () => {
    const charge = await paid();
    expect(await chargeStore.setRefundLeg(charge.code, 'shop', 'sending', null)).toBe(true);
    expect(await chargeStore.setRefundLeg(charge.code, 'shop', 'sending', null)).toBe(false);
  });

  afterAll(() => {
    Object.assign(refundChain, real);
  });
});

/*
 * A dispute on a charge paid now: the shop's share is held from its Clear cash while it is open, and
 * goes to the member if they win, back to the shop if not.
 */
describe('disputing a charge paid now', async () => {
  const { refundChain } = await import('./paidNowRefund');
  const { holdPaidNow, releasePaidNow } = await import('./disputes/paidNowDispute');
  const { disputeStore } = await import('./disputes/disputeStore');
  const { decodeFunctionData, erc20Abi } = await import('viem');
  const CLEAR_WALLET = '0x5555555555555555555555555555555555555555';
  let moves: { from: string; to: string; units: bigint }[] = [];
  let holds: { state: string; detail: Record<string, unknown> | null }[] = [];
  let shopCash = 1_000_000_000n;
  let clearFails = 0;
  let receipts: Record<string, { status: number } | null> = {};
  let n = 0;
  const real = { ...refundChain };
  const realSetHold = disputeStore.setHold;

  beforeEach(() => {
    moves = [];
    holds = [];
    shopCash = 1_000_000_000n;
    clearFails = 0;
    receipts = {};
    disputeStore.setHold = async (_t, state, detail) => {
      holds.push({ state, detail: detail && JSON.parse(JSON.stringify(detail)) });
    };
    Object.assign(refundChain, {
      receipt: async (_c: number, h: string) => (h in receipts ? receipts[h] : { status: 1 }),
      known: async () => false,
      balance: async () => shopCash,
      clearAddress: () => CLEAR_WALLET,
      sendFromClear: async (_c: number, _t: string, to: string, units: bigint, onHash: (h: string) => Promise<void>) => {
        if (clearFails > 0) {
          clearFails -= 1;
          throw new Error('rpc down');
        }
        await onHash(`0xc${++n}`);
        moves.push({ from: 'clear', to: to.toLowerCase(), units });
        return true;
      },
      shopWallet: async () => ({
        address: SHOP,
        send: async (_token: string, data: `0x${string}`) => {
          const { args } = decodeFunctionData({ abi: erc20Abi, data });
          moves.push({ from: 'shop', to: String(args[0]).toLowerCase(), units: args[1] as bigint });
          return `0xs${++n}` as `0x${string}`;
        },
      }),
    });
  });
  afterAll(() => {
    Object.assign(refundChain, real);
    disputeStore.setHold = realSetHold;
  });

  async function paid() {
    const code = await raise();
    await chargeStore.holdForPayNow(code, MEMBER, QUOTE);
    await chargeStore.finishPaidNow(code, `0xpay${++n}`);
    await chargeStore.markDisputed(code);
    return (await chargeStore.get(code))!;
  }
  const dispute = (detail: Record<string, unknown> | null = null) =>
    ({ token: `d${++n}`, heldDetail: detail, holdState: detail ? 'held' : null }) as any;

  test('open: the shop’s share moves from its Clear cash into Clear’s hold', async () => {
    const charge = await paid();
    await holdPaidNow(dispute(), charge);
    expect(moves).toEqual([{ from: 'shop', to: CLEAR_WALLET, units: 928_250_000n }]);
    expect(holds.at(-1)).toMatchObject({ state: 'held', detail: { paidNow: true, heldCents: 92_825, pending: false } });
  });

  test('short in the shop’s cash: the hold waits, and nothing moves', async () => {
    const charge = await paid();
    shopCash = 100_000_000n;
    await holdPaidNow(dispute(), charge);
    expect(moves).toHaveLength(0);
    expect(holds.at(-1)?.detail).toMatchObject({ pending: true });
    expect(String(holds.at(-1)?.detail?.error)).toContain('$928.25 is needed');
  });

  test('a hold left mid-transfer is never sent again blind', async () => {
    const charge = await paid();
    await holdPaidNow(dispute({ paidNow: true, pending: true, holdTx: 'sending' }), charge);
    expect(moves).toHaveLength(0);
  });

  test('member wins: the whole amount back from Clear, and the charge is refunded', async () => {
    const charge = await paid();
    await releasePaidNow(dispute({ paidNow: true, heldCents: 92_825, holdTx: '0xhold' }), charge, true);
    expect(moves).toEqual([{ from: 'clear', to: MEMBER.toLowerCase(), units: 940_000_000n }]);
    expect((await chargeStore.get(charge.code))!.status).toBe('refunded');
  });

  test('member wins without a hold: the shop’s share from the shop, Clear’s fee from Clear', async () => {
    const charge = await paid();
    await releasePaidNow(dispute({ paidNow: true, pending: true, holdTx: null }), charge, true);
    expect(moves).toEqual([
      { from: 'shop', to: MEMBER.toLowerCase(), units: 928_250_000n },
      { from: 'clear', to: MEMBER.toLowerCase(), units: 11_750_000n },
    ]);
  });

  test('shop wins: the held share goes back to the shop, and the charge stands', async () => {
    const charge = await paid();
    await releasePaidNow(dispute({ paidNow: true, heldCents: 92_825, holdTx: '0xhold' }), charge, false);
    expect(moves).toEqual([{ from: 'clear', to: SHOP.toLowerCase(), units: 928_250_000n }]);
    expect((await chargeStore.get(charge.code))!.status).toBe('approved');
  });

  // The dispute as the sweep would read it next: whatever the last pass saved.
  const saved = (d: any) => ({ ...d, heldDetail: holds.at(-1)!.detail, holdState: holds.at(-1)!.state });

  test('a release that fails is left releasing, and the next pass finishes it without paying twice', async () => {
    const charge = await paid();
    const d = dispute({ paidNow: true, heldCents: 92_825, holdTx: '0xhold' });
    clearFails = 1;
    expect(await releasePaidNow(d, charge, true)).toBe(false);
    expect(holds.at(-1)).toMatchObject({ state: 'releasing', detail: { release: { outcome: 'member', error: 'rpc down' } } });
    expect(moves).toHaveLength(0);
    expect((await chargeStore.get(charge.code))!.status).toBe('disputed');

    expect(await releasePaidNow(saved(d), charge, true)).toBe(true);
    expect(moves).toEqual([{ from: 'clear', to: MEMBER.toLowerCase(), units: 940_000_000n }]);
    expect((await chargeStore.get(charge.code))!.status).toBe('refunded');

    // Run again: the recorded transfer landed, so nothing is sent a second time.
    expect(await releasePaidNow(saved(d), charge, true)).toBe(true);
    expect(moves).toHaveLength(1);
  });

  test('two transfers: the one that went is not sent again; only the one that failed is', async () => {
    const charge = await paid();
    const d = dispute({ paidNow: true, pending: true, holdTx: null });
    clearFails = 1;
    expect(await releasePaidNow(d, charge, true)).toBe(false);
    expect(moves.map((m) => m.from)).toEqual(['shop']);
    expect(await releasePaidNow(saved(d), charge, true)).toBe(true);
    expect(moves.map((m) => m.from)).toEqual(['shop', 'clear']);
  });

  test('a recorded transfer that reverted goes again', async () => {
    const charge = await paid();
    receipts['0xbad'] = { status: 0 };
    const d = dispute({ paidNow: true, heldCents: 92_825, holdTx: '0xhold', release: { outcome: 'shop', legs: { clear: '0xbad' } } });
    expect(await releasePaidNow(d, charge, false)).toBe(true);
    expect(moves).toEqual([{ from: 'clear', to: SHOP.toLowerCase(), units: 928_250_000n }]);
  });

  test('one that may have left with nothing to check it by waits for a person', async () => {
    const charge = await paid();
    const d = dispute({ paidNow: true, heldCents: 92_825, holdTx: '0xhold', release: { outcome: 'member', legs: { clear: 'sending' } } });
    expect(await releasePaidNow(d, charge, true)).toBe(false);
    expect(moves).toHaveLength(0);
    expect(String(holds.at(-1)!.detail!.release && (holds.at(-1)!.detail!.release as any).error)).toContain('Needs a person');
  });
});
