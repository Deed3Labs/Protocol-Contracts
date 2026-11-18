import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { lithicBank, mockBank, bankAccountsFromEnv, transferClassFromEnv, type LithicLike } from './bank';
import { cardCreditBetween, readCardCredit } from './cardCredit';
import { matchPayout, type OffRampPayout } from './offRamp';
import { bridgeOffRamp, drainState, drainToPayout, liquidationAddressRequest, usdcUnits } from './offRampBridge';
import { mockOffRamp } from './offRampMock';
import { computePoolTierPrincipal, poolFundedTierKinds } from './principal';
import { coverage, zonedInstant, type CutoffSchedule } from './schedule';

const U = 1_000_000n;

describe('the Bridge off-ramp', () => {
  test('drain states: processed is arrived; returned, refunded, undeliverable, canceled are failed; the rest in flight', () => {
    expect(drainState('payment_processed')).toBe('arrived');
    for (const s of ['returned', 'refunded', 'refund_failed', 'undeliverable', 'canceled']) expect(drainState(s)).toBe('failed');
    for (const s of ['funds_received', 'payment_submitted', 'in_review', undefined]) expect(drainState(s)).toBe('in-flight');
  });

  test('amounts are exact base units', () => {
    expect(usdcUnits('1300.5')).toBe(1_300_500_000n);
    expect(usdcUnits('0.000001')).toBe(1n);
    expect(usdcUnits(12)).toBe(12n * U);
    expect(usdcUnits('nonsense')).toBe(0n);
  });

  test('reads the liquidation address\'s drains through the Bridge client, newest first, from `since`', async () => {
    const calls: string[] = [];
    const ramp = bridgeOffRamp({
      customerId: 'cust_1',
      liquidationAddressId: 'la_1',
      address: '0x7000000000000000000000000000000000000007',
      rail: 'wire',
      fetch: (async (path: string) => {
        calls.push(path);
        return {
          ok: true,
          status: 200,
          data: {
            data: [
              { id: 'dr_2', amount: '1300.00', state: 'payment_processed', created_at: '2026-11-17T16:00:00Z', updated_at: '2026-11-17T18:00:00Z', deposit_tx_hash: '0xabc' },
              { id: 'dr_1', amount: '50', state: 'funds_received', created_at: '2026-11-10T16:00:00Z' },
            ],
          },
        };
      }) as never,
    });
    const since = Date.parse('2026-11-17T00:00:00Z') / 1000;
    const p = await ramp.payouts(since);
    expect(calls).toEqual(['/customers/cust_1/liquidation_addresses/la_1/drains?limit=100']);
    expect(p).toEqual([{ id: 'dr_2', amount: 1_300n * U, state: 'arrived', depositTx: '0xabc', createdAt: since + 16 * 3600, arrivedAt: since + 18 * 3600, detail: 'payment_processed' }]);
    expect(ramp.rail).toBe('wire');
  });

  test('a Bridge error is an error, never "nothing paid"', async () => {
    const ramp = bridgeOffRamp({ customerId: 'c', liquidationAddressId: 'l', address: '0x0', rail: 'wire', fetch: (async () => ({ ok: false, status: 401, message: 'bad key' })) as never });
    await expect(ramp.payouts(0)).rejects.toThrow('Bridge drains could not be read (401): bad key');
  });

  test('the one-time setup request: Base USDC to the CSA by the rail, failures back to CL Operating', () => {
    expect(liquidationAddressRequest({ csaExternalAccountId: 'ea_csa', rail: 'wire', returnAddress: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65' })).toEqual({
      chain: 'base',
      currency: 'usdc',
      external_account_id: 'ea_csa',
      destination_payment_rail: 'wire',
      destination_currency: 'usd',
      return_address: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
    });
    expect(drainToPayout({ id: 'x', amount: '1', state: 'returned', created_at: '2026-11-17T00:00:00Z' }).state).toBe('failed');
  });
});

describe('matching a forwarded deposit to its payout', () => {
  const p = (over: Partial<OffRampPayout>): OffRampPayout => ({ id: 'p', amount: 5n, state: 'in-flight', depositTx: null, createdAt: 1_000, arrivedAt: null, detail: '', ...over });
  test('by the deposit transaction when the provider reports it', () => {
    const got = matchPayout({ forwardTx: '0xAB', amount: 5n, forwardedAt: 1_000 }, [p({ id: 'a', depositTx: '0xcd' }), p({ id: 'b', depositTx: '0xab' })]);
    expect(got?.id).toBe('b');
  });
  test('else the oldest of exactly that amount, after it was forwarded, not already taken', () => {
    const list = [p({ id: 'old', createdAt: 100 }), p({ id: 'x', createdAt: 1_200 }), p({ id: 'y', createdAt: 1_100 }), p({ id: 'other', amount: 6n, createdAt: 1_050 })];
    expect(matchPayout({ forwardTx: null, amount: 5n, forwardedAt: 1_000 }, list)?.id).toBe('y');
    expect(matchPayout({ forwardTx: null, amount: 5n, forwardedAt: 1_000 }, list, new Set(['y']))?.id).toBe('x');
    expect(matchPayout({ forwardTx: null, amount: 7n, forwardedAt: 1_000 }, list)).toBe(null);
  });
});

describe('the mock off-ramp (Base Sepolia)', () => {
  test('a deposit arrives after the configured latency', async () => {
    let now = 1_000;
    const ramp = mockOffRamp({ address: '0x0', latencyMinutes: 60, now: () => now, deposits: async () => [{ forwardTx: '0x1', amount: 9n, forwardedAt: 1_000 }] });
    expect((await ramp.payouts(0))[0]).toMatchObject({ state: 'in-flight', arrivedAt: null });
    now = 1_000 + 3_600;
    expect((await ramp.payouts(0))[0]).toMatchObject({ state: 'arrived', arrivedAt: 4_600, depositTx: '0x1' });
    expect(ramp.name).toBe('mock');
  });
});

describe('the bank', () => {
  function fakeLithic() {
    const calls: Array<{ what: string; body: Record<string, unknown>; key?: string }> = [];
    const lithic: LithicLike = {
      financialAccounts: { balances: { list: (token: string) => (async function* () { if (token === 'fa_csa') yield { available_amount: 123_456 }; })() } },
      bookTransfers: {
        create: async (body, o) => (calls.push({ what: 'book', body, key: o?.idempotencyKey }), { status: 'SETTLED' }),
        retrieve: async (t) => (t === 'missing' ? Promise.reject(Object.assign(new Error('nf'), { status: 404 })) : { status: 'PENDING' }),
      },
      payments: {
        create: async (body, o) => (calls.push({ what: 'payment', body, key: o?.idempotencyKey }), { status: 'PENDING' }),
        retrieve: async () => ({ status: 'RETURNED' }),
      },
    };
    return { lithic, calls };
  }

  test('Lithic balances are cents, read as base units; an unknown account is null, never zero', async () => {
    const { lithic } = fakeLithic();
    const bank = lithicBank(lithic, { csa: 'fa_csa', collection: 'fa_other', margin: null, onRampExternalBankAccount: null }, { category: 'PROGRAM_FUNDING', type: 'TRANSFER', subtype: 'SUB' });
    expect(await bank.balance('fa_csa')).toBe(1_234_560_000n);
    expect(await bank.balance('fa_other')).toBe(null);
    expect(await bank.balance(null)).toBe(null);
  });

  test('a book transfer and a same-day ACH carry the move\'s token as their idempotency key, in whole cents', async () => {
    const { lithic, calls } = fakeLithic();
    const bank = lithicBank(lithic, bankAccountsFromEnv({}), { category: 'PROGRAM_FUNDING', type: 'TRANSFER', subtype: 'SUB' });
    expect(await bank.bookTransfer({ token: 't1', from: 'a', to: 'b', amount: 1_300_500_000n, memo: 'm' })).toBe('settled');
    expect(await bank.payment({ token: 't2', from: 'a', externalBankAccount: 'eb', amount: 5n * U, memo: 'm' })).toBe('pending');
    expect(calls[0]).toMatchObject({ what: 'book', key: 't1', body: { token: 't1', amount: 130_050, from_financial_account_token: 'a', to_financial_account_token: 'b', subtype: 'SUB' } });
    expect(calls[1]).toMatchObject({ what: 'payment', key: 't2', body: { type: 'PAYMENT', method: 'ACH_SAME_DAY', amount: 500, external_bank_account_token: 'eb' } });
    expect(await bank.status('missing', 'book')).toBe(null);
    expect(await bank.status('x', 'book')).toBe('pending');
    expect(await bank.status('x', 'payment')).toBe('failed');
  });

  test('no book transfer without the program\'s subtype', async () => {
    const { lithic } = fakeLithic();
    const bank = lithicBank(lithic, bankAccountsFromEnv({}), transferClassFromEnv({}));
    await expect(bank.bookTransfer({ token: 't', from: 'a', to: 'b', amount: 1n, memo: '' })).rejects.toThrow('SETTLEMENT_BOOK_TRANSFER_SUBTYPE');
  });

  test('the Collection Account defaults to automatic clearing\'s settlement account', () => {
    expect(bankAccountsFromEnv({ LITHIC_AUTO_CLEAR_SETTLEMENT_ACCOUNT_TOKEN: 'fa_coll' }).collection).toBe('fa_coll');
    expect(bankAccountsFromEnv({ LITHIC_AUTO_CLEAR_SETTLEMENT_ACCOUNT_TOKEN: 'fa_coll', SETTLEMENT_COLLECTION_FINANCIAL_ACCOUNT_TOKEN: 'fa_c2' }).collection).toBe('fa_c2');
    expect(bankAccountsFromEnv({}).csa).toBe(null);
  });

  test('the mock bank: idempotent on the token, refuses an overdraft', async () => {
    const bank = mockBank({ balances: { 'mock-csa': 10n, 'mock-collection': 5n } });
    expect(await bank.bookTransfer({ token: 'k', from: 'mock-collection', to: 'mock-csa', amount: 5n, memo: '' })).toBe('settled');
    expect(await bank.bookTransfer({ token: 'k', from: 'mock-collection', to: 'mock-csa', amount: 5n, memo: '' })).toBe('settled');
    expect(bank.balances.get('mock-csa')).toBe(15n);
    expect(await bank.bookTransfer({ token: 'k2', from: 'mock-collection', to: 'mock-csa', amount: 1n, memo: '' })).toBe('failed');
  });
});

describe('the credit portions, from lithic_auth_decisions', () => {
  const NY: CutoffSchedule = { timeZone: 'America/New_York', cutoffMinutes: 14 * 60, businessDays: [1, 2, 3, 4, 5], holidays: [], lagDays: 0 };
  const ny = (date: string, hh: number) => zonedInstant(date, hh * 60, 'America/New_York');

  async function payDb() {
    const pg = new PGlite();
    // The columns authStore and cardSettlementService create (no settled_at: the reader adds it).
    await pg.exec(`CREATE TABLE lithic_auth_decisions (
      transaction_token TEXT PRIMARY KEY, card_token TEXT NOT NULL, wallet TEXT, amount_cents BIGINT NOT NULL, request_status TEXT,
      result TEXT NOT NULL, draws JSONB NOT NULL DEFAULT '[]'::jsonb, credit_cents BIGINT NOT NULL DEFAULT 0, decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      net_cents BIGINT, status TEXT, unfunded_cents BIGINT NOT NULL DEFAULT 0, reconciled_at TIMESTAMPTZ)`);
    const db = { query: async <T>(text: string, params?: unknown[]) => ({ rows: (await pg.query<T>(text, params as never[])).rows }) };
    const add = async (token: string, credit: number, status: string | null, decided: number, settled: number | null, result = 'APPROVED') =>
      pg.query(`INSERT INTO lithic_auth_decisions (transaction_token, card_token, amount_cents, result, credit_cents, status, decided_at, reconciled_at) VALUES ($1, 'c', $2, $3, $2, $4, $5, $6)`, [
        token, credit, result, status, new Date(decided * 1000).toISOString(), settled === null ? null : new Date(settled * 1000).toISOString(),
      ]);
    return { db, add, pg };
  }

  test('due at the next cut-off: settled since the last one; authorized and not settled apart; declines never', async () => {
    const { db, add, pg } = await payDb();
    await add('a', 10_000, 'SETTLED', ny('2026-11-16', 15), ny('2026-11-16', 16)); // after Monday's cut-off: due Tuesday
    await add('b', 5_000, 'SETTLED', ny('2026-11-17', 9), ny('2026-11-17', 10)); // due Tuesday
    await add('c', 7_000, 'SETTLED', ny('2026-11-16', 9), ny('2026-11-16', 10)); // before Monday's cut-off: already debited
    await add('d', 3_000, 'PENDING', ny('2026-11-17', 10), null); // authorized, not settled
    await add('e', 2_000, null, ny('2026-11-17', 10), null); // never reported: still pending
    await add('f', 9_999, 'VOIDED', ny('2026-11-17', 10), ny('2026-11-17', 10));
    await add('g', 4_000, 'SETTLED', ny('2026-11-17', 10), ny('2026-11-17', 10), 'INSUFFICIENT_FUNDS');
    const now = ny('2026-11-17', 11);
    const cov = coverage(now, NY);
    const r = await readCardCredit(db, { now, coverage: cov, schedule: NY, velocityDays: 7 });
    expect(r.dueSettled).toBe(150n * U);
    expect(r.byCutoff[cov.next]).toBe(150n * U);
    expect(r.pendingCredit).toBe(50n * U);
    expect(r.recentSettled).toBe(220n * U);
    // settled_at, once authStore stamps it, wins over reconciled_at.
    await pg.query(`UPDATE lithic_auth_decisions SET settled_at = $1 WHERE transaction_token = 'c'`, [new Date(ny('2026-11-16', 15) * 1000).toISOString()]);
    expect((await readCardCredit(db, { now, coverage: cov, schedule: NY, velocityDays: 7 })).dueSettled).toBe(220n * U);
    const day = await cardCreditBetween(db, new Date(ny('2026-11-16', 0) * 1000), new Date(ny('2026-11-17', 0) * 1000));
    expect(day).toEqual({ authorized: 170n * U, settled: 170n * U });
  });

  test('no Pay database, or no table yet: zeros', async () => {
    const now = ny('2026-11-17', 11);
    expect((await readCardCredit(null, { now, coverage: coverage(now, NY), schedule: NY, velocityDays: 7 })).dueSettled).toBe(0n);
    const pg = new PGlite();
    const db = { query: async <T>(text: string, params?: unknown[]) => ({ rows: (await pg.query<T>(text, params as never[])).rows }) };
    expect((await readCardCredit(db, { now, coverage: coverage(now, NY), schedule: NY, velocityDays: 7 })).pendingCredit).toBe(0n);
  });
});

describe('the Pool Tier principal', () => {
  test('POOL_FUNDED_TIER_KINDS defaults to savings-backed, income-backed and Boost', () => {
    expect(poolFundedTierKinds({})).toEqual(['SAVINGS', 'INCOME', 'BOOST']);
    expect(poolFundedTierKinds({ POOL_FUNDED_TIER_KINDS: 'savings, income' })).toEqual(['SAVINGS', 'INCOME']);
  });

  test('the pool-funded tiers including savings-backed, open term plans and Margin Advances; asset-backed stays out', () => {
    const p = computePoolTierPrincipal(
      {
        tiers: [{ id: 0, kind: 'SAVINGS' }, { id: 1, kind: 'BOND' }, { id: 2, kind: 'POOL_SHARE' }, { id: 3, kind: 'INCOME' }, { id: 4, kind: 'BOOST' }, { id: 5, kind: 'WORKOUT' }],
        principals: [
          { member: '0xA', tierId: 0, principal: 100n * U },
          { member: '0xB', tierId: 0, principal: 50n * U },
          { member: '0xA', tierId: 1, principal: 900n * U },
          { member: '0xA', tierId: 2, principal: 800n * U },
          { member: '0xB', tierId: 3, principal: 30n * U },
          { member: '0xB', tierId: 4, principal: 20n * U },
          { member: '0xC', tierId: 5, principal: 70n * U },
        ],
        termPlans: [{ id: 0, outstanding: 400n * U, closed: false }, { id: 1, outstanding: 99n * U, closed: true }],
        marginAdvances: 25n * U,
        posted: { value: 500n * U, postedAt: 1 },
        deployedBalance: 480n * U,
        headroom: 100n * U,
      },
      poolFundedTierKinds({}),
    );
    expect(p.total).toBe(625n * U);
    expect(p.tiers).toEqual([{ kind: 'SAVINGS', principal: 150n * U, members: 2 }, { kind: 'INCOME', principal: 30n * U, members: 1 }, { kind: 'BOOST', principal: 20n * U, members: 1 }]);
    expect(p.term).toEqual({ principal: 400n * U, plans: 1 });
    expect(p.difference).toBe(125n * U);
    expect(p.laneCeiling).toBe(600n * U);
  });
});
