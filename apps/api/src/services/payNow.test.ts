import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
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
