import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/*
 * The card credit fee end to end (decision 55): the swipe, the on-chain authorization, settlement,
 * refunds, a void, a waiver and a credit back, against a real Postgres (PGlite standing in for the Pay
 * pool) and a stand-in RevolvingIssuer that keeps the contract's rules: one settlement per ref, never
 * past the authorization, a fee only within `maxCardCreditFee`, the fee returned on the reversal that
 * brings a purchase to zero. Run on its own (module mocks leak between files in one bun process).
 */

const pg = new PGlite();
const pool = {
  query: async (text: string, params?: unknown[]) => {
    if (!params?.length) {
      const results = await pg.exec(text);
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: last?.affectedRows ?? 0 };
    }
    const r = await pg.query(text, params as any[]);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
  connect: async () => ({ query: pool.query, release: () => undefined }),
};

const ZERO = '0x0000000000000000000000000000000000000000';
const revert = () => Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION', shortMessage: 'missing revert data' });

/** The chain, as far as card settlement can see it. */
const chain = {
  upgraded: true,
  maxFee: 300_000n,
  auths: new Map<string, { member: string; amount: bigint }>(),
  settled: new Map<string, { member: string; amount: bigint }>(),
  fees: new Map<string, { fee: bigint; returned: bigint }>(),
  calls: [] as string[],
  reset() {
    this.upgraded = true;
    this.maxFee = 300_000n;
    this.auths.clear();
    this.settled.clear();
    this.fees.clear();
    this.calls = [];
  },
};
let txn = 0;
const sent = (name: string) => {
  chain.calls.push(name);
  return { hash: `0x${(++txn).toString(16).padStart(64, '0')}`, wait: async () => ({}) };
};

class FakeIssuer {
  async cardAuthorizationOf(ref: string) {
    const a = chain.auths.get(ref);
    return [a?.member ?? ZERO, a?.amount ?? 0n];
  }
  async authorizeCardSpend(ref: string, member: string, amount: bigint) {
    if (chain.auths.has(ref)) throw revert();
    chain.auths.set(ref, { member, amount });
    return sent('authorizeCardSpend');
  }
  async cardSettlementOf(ref: string) {
    const s = chain.settled.get(ref);
    return [s?.member ?? ZERO, s?.amount ?? 0n];
  }
  async settleCardSpend(ref: string, member: string, amount: bigint) {
    const a = chain.auths.get(ref);
    if (chain.settled.has(ref) || !a || amount > a.amount) throw revert();
    chain.settled.set(ref, { member, amount });
    return sent('settleCardSpend');
  }
  async settleCardSpendWithFee(ref: string, member: string, amount: bigint, fee: bigint) {
    if (!chain.upgraded) throw revert();
    const a = chain.auths.get(ref);
    if (chain.settled.has(ref) || !a || amount + fee > a.amount || fee === 0n || fee > chain.maxFee) throw revert();
    chain.settled.set(ref, { member, amount });
    chain.fees.set(ref, { fee, returned: 0n });
    return sent('settleCardSpendWithFee');
  }
  async reverseCardSpend(ref: string, amount: bigint) {
    const s = chain.settled.get(ref);
    if (!s || amount > s.amount) throw revert();
    s.amount -= amount;
    const f = chain.fees.get(ref);
    if (s.amount === 0n && f) f.returned = f.fee; // the full-refund return: whatever is left
    return sent('reverseCardSpend');
  }
  async maxCardCreditFee() {
    if (!chain.upgraded) throw revert();
    return chain.maxFee;
  }
  async cardCreditFeeOf(ref: string) {
    if (!chain.upgraded) throw revert();
    const f = chain.fees.get(ref);
    return [f?.fee ?? 0n, f?.returned ?? 0n];
  }
  async returnCardCreditFee(ref: string, amount: bigint) {
    const f = chain.fees.get(ref);
    if (!f || amount === 0n || f.returned + amount > f.fee) throw revert();
    f.returned += amount;
    return sent('returnCardCreditFee');
  }
}

const realEthers = await import('ethers');
mock.module('ethers', () => ({
  ...realEthers,
  ethers: {
    ...realEthers.ethers,
    Contract: FakeIssuer,
    // Never a real key: the settler signs nothing here.
    Wallet: class {
      address = '0x00000000000000000000000000000000000000se';
    },
  },
}));
mock.module('../../config/postgres.js', () => ({ getPayPool: () => pool, getPostgresPool: () => pool, closePostgresPool: async () => {} }));
mock.module('../../config/contracts.js', () => ({ getContractAddress: () => '0x00000000000000000000000000000000000000c1' }));
mock.module('./provider.js', () => ({ chainProvider: () => ({}), writesAs: (s: unknown) => s }));
mock.module('./encumbranceSync.js', () => ({ syncClrusdEncumbrance: async () => 'current' }));
mock.module('../notificationStore.js', () => ({ notificationStore: { emit: async () => {} } }));
process.env.CARD_SETTLER_PRIVATE_KEY = 'placeholder-not-a-key';

const { authorize, reconcile, authStore } = await import('../lithic/authStore');
const settlement = await import('./cardSettlementService');
const { authorizeCardOnChain, syncCardSettlement, refOf, readMaxCardCreditFee, refreshCardCreditFeeCap, creditBackCardCreditFee } = settlement;
const { heldDrawsByTier, listCardTransactions, cardCreditFeeTotals } = await import('../lithic/cardTransactionsService');
const feeModule = await import('../lithic/cardCreditFee');
const { applyCardFeeCapAtCycleClose, allocateFeeCredit } = await import('./cardFeeCap');

const WALLET = '0x00000000000000000000000000000000000000a1';
const FEE = { cents: 30, tiers: ['savings', 'asset', 'income', 'boost'] as const, minPurchaseCents: 0 };
const OFF = { ...FEE, cents: 0 };
let n = 0;

async function freshCard(availability: Partial<Record<'cash' | 'savings' | 'asset' | 'income' | 'boost', number>> = { asset: 100_000 }) {
  const card = `card-${++n}`;
  await authStore.putSnapshot({
    cardToken: card,
    wallet: WALLET,
    cardPaused: false,
    cashCents: availability.cash ?? 0,
    savingsCents: availability.savings ?? 0,
    assetCents: availability.asset ?? 0,
    incomeCents: availability.income ?? 0,
    boostCents: availability.boost ?? 0,
  });
  return card;
}

async function swipe(card: string, amountCents: number, creditFee = FEE as unknown as typeof FEE) {
  const token = `tx-${++n}`;
  const outcome = await authorize({
    transactionToken: token,
    cardToken: card,
    amountCents,
    requestStatus: 'AUTHORIZATION',
    creditFee: creditFee as never,
  });
  return { token, outcome };
}

async function rowOf(token: string) {
  const { rows } = await pg.query<Record<string, unknown>>(`SELECT * FROM lithic_auth_decisions WHERE transaction_token = $1`, [token]);
  return rows[0];
}
async function ledger(token: string) {
  const { rows } = await pg.query<{ event_type: string; account: string; direction: string; amount_cents: number }>(
    `SELECT event_type, account, direction, amount_cents FROM lithic_ledger_entries WHERE entry_group = $1 ORDER BY id`,
    [token],
  );
  return rows;
}
/** What the member owes on a tier for one purchase, from the ledger. */
async function owedOn(token: string, account: string) {
  return (await ledger(token))
    .filter((e) => e.account === account)
    .reduce((sum, e) => sum + (e.direction === 'debit' ? Number(e.amount_cents) : -Number(e.amount_cents)), 0);
}
async function settle(token: string, cents: number) {
  await reconcile({ transactionToken: token, targetCents: cents, status: 'SETTLED' });
  return syncCardSettlement(token);
}

beforeEach(() => {
  chain.reset();
});

describe('the swipe', () => {
  test('a credit purchase holds its fee beside it: drawn off the snapshot, booked as its own lines', async () => {
    const card = await freshCard({ asset: 100_000 });
    const { token, outcome } = await swipe(card, 10_000);
    expect(outcome.decision).toMatchObject({ result: 'APPROVED', creditCents: 10_000, feeCents: 30 });
    expect((await authStore.getSnapshot(card))!.assetCents).toBe(100_000 - 10_030);
    const row = await rowOf(token);
    expect(row).toMatchObject({ credit_cents: 10_000, fee_cents: 30, fee_status: 'held' });
    expect(row.fee_draws).toEqual([{ source: 'asset', amountCents: 30 }]);
    const fee = (await ledger(token)).filter((e) => e.event_type === 'card_credit_fee');
    expect(fee.map((e) => [e.account, e.direction, Number(e.amount_cents)])).toEqual([
      ['member_credit_asset', 'debit', 30],
      ['coop_card_credit_fees', 'credit', 30],
    ]);
    // A replay returns the same verdict, fee included, and draws nothing more.
    const again = await authorize({ transactionToken: token, cardToken: card, amountCents: 10_000, requestStatus: 'AUTHORIZATION' });
    expect(again).toMatchObject({ replayed: true, decision: { feeCents: 30 } });
    expect((await authStore.getSnapshot(card))!.assetCents).toBe(100_000 - 10_030);
  });

  test('the on-chain authorization records the credit part plus the fee', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    expect(await authorizeCardOnChain(token)).toBe('authorized');
    expect(chain.auths.get(refOf(token))!.amount).toBe(10_030n * 10_000n);
  });

  test('a covered borrower (MB-04 §5.10) pays no fee, read from the snapshot', async () => {
    const card = await freshCard();
    await authStore.setCoveredBorrower(WALLET, true, 'test');
    try {
      const { outcome } = await swipe(card, 10_000);
      expect(outcome.decision.feeCents).toBe(0);
      expect((await authStore.getSnapshot(card))!.assetCents).toBe(90_000);
    } finally {
      await authStore.setCoveredBorrower(WALLET, null, 'test');
    }
    // A snapshot written afterwards carries the member's status too.
    const later = await freshCard();
    const { rows } = await pg.query<{ covered_borrower: boolean | null }>(`SELECT covered_borrower FROM lithic_tier_snapshots WHERE card_token = $1`, [later]);
    expect(rows[0].covered_borrower).toBeNull();
  });
});

describe('settlement', () => {
  test('settles with the fee, once: a retry and a lost record never charge it twice', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    await authorizeCardOnChain(token);
    expect((await heldDrawsByTier(WALLET)).asset).toBeGreaterThanOrEqual(10_030);
    const heldBefore = (await heldDrawsByTier(WALLET)).asset;

    expect((await settle(token, 10_000)).action).toBe('settled');
    expect(chain.calls.filter((c) => c === 'settleCardSpendWithFee')).toHaveLength(1);
    expect(chain.fees.get(refOf(token))).toEqual({ fee: 300_000n, returned: 0n });
    expect(await rowOf(token)).toMatchObject({ onchain_status: 'issued', onchain_cents: 10_000, fee_status: 'charged' });
    // Once the chain carries the purchase and its fee, neither is shown as pending any more.
    expect((await heldDrawsByTier(WALLET)).asset).toBe(heldBefore - 10_030);

    // Redelivered: nothing to do.
    expect((await syncCardSettlement(token)).action).toBe('none');
    // The record lost after the transaction landed: recovered from the chain, fee and all.
    await pg.query(`UPDATE lithic_auth_decisions SET onchain_status = NULL, onchain_cents = NULL, fee_status = 'held' WHERE transaction_token = $1`, [token]);
    expect((await syncCardSettlement(token)).action).toBe('recovered');
    expect(await rowOf(token)).toMatchObject({ onchain_status: 'issued', fee_status: 'charged' });
    expect(chain.calls.filter((c) => c.startsWith('settle'))).toHaveLength(1);

    const [listed] = (await listCardTransactions(WALLET, 200)).filter((t) => t.id === token);
    expect(listed).toMatchObject({ creditCents: 10_000, creditFeeCents: 30, creditFeeState: 'charged', creditFeeReturned: false });
  });

  test('fee off: settles with settleCardSpend exactly as before', async () => {
    const card = await freshCard();
    const { token, outcome } = await swipe(card, 10_000, OFF as never);
    expect(outcome.decision.feeCents).toBe(0);
    await authorizeCardOnChain(token);
    expect(chain.auths.get(refOf(token))!.amount).toBe(10_000n * 10_000n);
    expect((await settle(token, 10_000)).action).toBe('settled');
    expect(chain.calls).toContain('settleCardSpend');
    expect(chain.calls).not.toContain('settleCardSpendWithFee');
    expect((await rowOf(token)).fee_status).toBeNull();
    expect((await listCardTransactions(WALLET, 200)).find((t) => t.id === token)).toMatchObject({ creditFeeCents: 0, creditFeeState: null });
  });

  test('the chain no longer accepts the fee: the purchase settles without it, and the fee is waived', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    await authorizeCardOnChain(token);
    chain.maxFee = 0n; // lowered after the swipe
    expect((await settle(token, 10_000)).action).toBe('settled');
    expect(chain.calls).toContain('settleCardSpend');
    expect(chain.fees.has(refOf(token))).toBe(false);
    expect((await rowOf(token)).fee_status).toBe('waived');
    expect(await owedOn(token, 'member_credit_asset')).toBe(10_000);
    expect((await ledger(token)).some((e) => e.event_type === 'card_credit_fee_waived')).toBe(true);
    expect((await listCardTransactions(WALLET, 200)).find((t) => t.id === token)).toMatchObject({ creditFeeState: 'waived' });
  });

  test('a member who became a covered borrower after the swipe is not charged at settlement', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    await authorizeCardOnChain(token);
    await authStore.setCoveredBorrower(WALLET, true, 'test');
    try {
      expect((await settle(token, 10_000)).action).toBe('settled');
    } finally {
      await authStore.setCoveredBorrower(WALLET, null, 'test');
    }
    expect(chain.calls).not.toContain('settleCardSpendWithFee');
    expect((await rowOf(token)).fee_status).toBe('waived');
  });

  test('a clearing above the authorization keeps the one fee and goes to a person', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    await authorizeCardOnChain(token);
    expect((await settle(token, 10_500)).action).toBe('needs_review');
    const row = await rowOf(token);
    expect(row).toMatchObject({ fee_cents: 30, fee_status: 'held', onchain_status: 'needs_review' });
    expect(String(row.onchain_error)).toContain('card credit fee');
  });
});

describe('refunds and voids', () => {
  test('a full refund after settlement: the contract returns the fee, and the books follow', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    await authorizeCardOnChain(token);
    await settle(token, 10_000);
    await reconcile({ transactionToken: token, targetCents: 0, status: 'SETTLED' });
    expect((await syncCardSettlement(token)).action).toBe('reversed');
    expect(chain.fees.get(refOf(token))).toEqual({ fee: 300_000n, returned: 300_000n });
    expect(await rowOf(token)).toMatchObject({ fee_status: 'returned', fee_returned_cents: 30, onchain_cents: 0 });
    expect(await owedOn(token, 'member_credit_asset')).toBe(0);
    expect((await ledger(token)).some((e) => e.event_type === 'card_credit_fee_returned')).toBe(true);
    expect((await listCardTransactions(WALLET, 200)).find((t) => t.id === token)).toMatchObject({
      creditFeeCents: 30,
      creditFeeState: 'returned',
      creditFeeReturned: true,
      creditFeeReturnedCents: 30,
    });
  });

  test('a partial refund keeps the fee', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    await authorizeCardOnChain(token);
    await settle(token, 10_000);
    await reconcile({ transactionToken: token, targetCents: 4_000, status: 'SETTLED' });
    expect((await syncCardSettlement(token)).action).toBe('reversed');
    expect(chain.fees.get(refOf(token))).toEqual({ fee: 300_000n, returned: 0n });
    expect((await rowOf(token)).fee_status).toBe('charged');
    expect(await owedOn(token, 'member_credit_asset')).toBe(4_030);
  });

  test('a void before settlement never charges it: released, back on the snapshot, out of the books', async () => {
    const card = await freshCard({ asset: 50_000 });
    const { token } = await swipe(card, 10_000);
    await reconcile({ transactionToken: token, targetCents: 0, status: 'VOIDED' });
    expect((await authStore.getSnapshot(card))!.assetCents).toBe(50_000);
    expect((await rowOf(token)).fee_status).toBe('released');
    expect(await owedOn(token, 'member_credit_asset')).toBe(0);
    expect((await ledger(token)).some((e) => e.event_type === 'card_credit_fee_released')).toBe(true);
    expect(chain.calls).toEqual([]);
  });

  test('a cash purchase carries none, and a clearing that ends up all cash releases the fee', async () => {
    const card = await freshCard({ cash: 10_000, asset: 50_000 });
    const cashOnly = await swipe(card, 5_000);
    expect(cashOnly.outcome.decision.feeCents).toBe(0);
    // $80 on a card with $50 cash left: $30 of credit and the fee. It then clears at $40: all cash.
    const mixed = await swipe(card, 8_000);
    expect(mixed.outcome.decision).toMatchObject({ creditCents: 3_000, feeCents: 30 });
    await reconcile({ transactionToken: mixed.token, targetCents: 4_000, status: 'SETTLED' });
    expect((await rowOf(mixed.token)).fee_status).toBe('released');
  });
});

describe('crediting a fee back (returnCardCreditFee)', () => {
  test('part, then the rest: each credited once, the books per credit, idempotent on a repeat', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    await authorizeCardOnChain(token);
    await settle(token, 10_000);
    expect((await creditBackCardCreditFee(token, 10, 'test')).action).toBe('credited');
    expect(chain.fees.get(refOf(token))!.returned).toBe(100_000n);
    // Asking for the same total again sends nothing.
    expect((await creditBackCardCreditFee(token, 10, 'test')).action).toBe('none');
    expect(chain.calls.filter((c) => c === 'returnCardCreditFee')).toHaveLength(1);
    expect(await owedOn(token, 'member_credit_asset')).toBe(10_020);
    // A credit that landed but was not recorded is recovered, not sent again.
    chain.fees.get(refOf(token))!.returned = 200_000n;
    await pg.query(`UPDATE lithic_auth_decisions SET fee_return_target_cents = 20 WHERE transaction_token = $1`, [token]);
    expect((await settlement.syncCardCreditFeeReturn(token)).action).toBe('recovered');
    expect(await owedOn(token, 'member_credit_asset')).toBe(10_010);
    // A full refund afterwards returns only what is left, in the chain and in the books.
    await reconcile({ transactionToken: token, targetCents: 0, status: 'SETTLED' });
    await syncCardSettlement(token);
    expect(chain.fees.get(refOf(token))).toEqual({ fee: 300_000n, returned: 300_000n });
    expect(await owedOn(token, 'member_credit_asset')).toBe(0);
    expect((await rowOf(token)).fee_status).toBe('returned');
  });

  test('the CFL cap hook (MB-04 §5.4(f)) credits nothing until counsel settles the measure', async () => {
    const card = await freshCard();
    const { token } = await swipe(card, 10_000);
    await authorizeCardOnChain(token);
    await settle(token, 10_000);
    const outcome = await applyCardFeeCapAtCycleClose(WALLET, Date.now() + 1_000);
    expect(outcome).toMatchObject({ excessCents: 0, credited: [] });
    expect(chain.calls).not.toContain('returnCardCreditFee');
    expect(
      allocateFeeCredit(
        [
          { transactionToken: 'b', liveCents: 30, returnedCents: 0 },
          { transactionToken: 'a', liveCents: 20, returnedCents: 10 },
        ],
        40,
      ),
    ).toEqual([
      { transactionToken: 'b', cents: 30, totalCents: 30 },
      { transactionToken: 'a', cents: 10, totalCents: 20 },
    ]);
  });
});

describe('the chain bound and the statement totals', () => {
  test('maxCardCreditFee reverts on the contract before the upgrade: read as 0, so no fee', async () => {
    chain.upgraded = false;
    expect(await readMaxCardCreditFee(new FakeIssuer() as never)).toBe(0n);
    const before = process.env.CARD_CREDIT_FEE_CENTS;
    process.env.CARD_CREDIT_FEE_CENTS = '30';
    try {
      expect(await refreshCardCreditFeeCap()).toBe(0n);
      expect(feeModule.currentCreditFee().cents).toBe(0);
      chain.upgraded = true;
      expect(await refreshCardCreditFeeCap()).toBe(300_000n);
      expect(feeModule.currentCreditFee().cents).toBe(30);
    } finally {
      if (before === undefined) delete process.env.CARD_CREDIT_FEE_CENTS;
      else process.env.CARD_CREDIT_FEE_CENTS = before;
      feeModule.resetChainMaxCardCreditFee();
    }
  });

  test('fee totals for the cycle and the year to date, with what was given back beside them', async () => {
    const totals = await cardCreditFeeTotals(WALLET, Date.now() - 60_000);
    expect(totals.cycle!.chargedCents).toBeGreaterThan(0);
    expect(totals.yearToDate.chargedCents).toBeGreaterThanOrEqual(totals.cycle!.chargedCents);
    expect(totals.yearToDate.returnedCents).toBeGreaterThan(0);
    // Released and waived fees were never imposed, so they count nowhere.
    const { rows } = await pg.query<{ c: number }>(
      `SELECT COALESCE(SUM(fee_cents), 0)::int AS c FROM lithic_auth_decisions WHERE fee_status IN ('held', 'charged', 'returned')`,
    );
    expect(totals.yearToDate.chargedCents).toBe(rows[0].c);
    expect((await cardCreditFeeTotals(WALLET, null)).cycle).toBeNull();
  });
});

describe('where the fee can never come from', () => {
  test('only the card Auth Stream decides a fee: no Pay with Clear path reaches it', () => {
    const route = readFileSync(new URL('../../routes/lithicAuthStream.ts', import.meta.url), 'utf8');
    expect(route).toContain('await authorize({');
    // The decision that adds the fee (`decide`) is called only by authStore.authorize, and that only
    // by the card's Auth Stream. Pay with Clear (QR and merchant-app payments) never reaches either.
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const root = new URL('../../', import.meta.url).pathname;
    const sources = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const calling = (pattern: RegExp) => sources.filter((f) => pattern.test(readFileSync(root + f, 'utf8'))).sort();
    expect(calling(/(?<!function )\bdecide\(\{/)).toEqual(['services/lithic/authStore.ts']);
    expect(calling(/\bauthorize\(\{|authStore\.authorize\(/)).toEqual(['routes/lithicAuthStream.ts']);
    expect(calling(/settleCardSpendWithFee\(/)).toEqual(['services/chain/cardSettlementService.ts']);
  });

  test('the migration adds the columns where the ledger shares the database', async () => {
    const db = new PGlite();
    await db.exec(`CREATE TABLE lithic_auth_decisions (transaction_token TEXT PRIMARY KEY); CREATE TABLE lithic_tier_snapshots (card_token TEXT PRIMARY KEY);`);
    await db.exec(readFileSync(new URL('../../../migrations/0084_card_credit_fee.sql', import.meta.url), 'utf8'));
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name IN ('lithic_auth_decisions', 'lithic_tier_snapshots') ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(
      expect.arrayContaining(['fee_cents', 'fee_draws', 'fee_status', 'fee_at', 'fee_returned_cents', 'fee_return_target_cents', 'covered_borrower']),
    );
    const covered = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'lithic_covered_borrowers'`);
    expect(covered.rows).toHaveLength(1);
  });
});
