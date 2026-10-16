import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const STORE = readFileSync(new URL('./profileStore.ts', import.meta.url), 'utf8');
const READER = readFileSync(new URL('../chain/payoutReader.ts', import.meta.url), 'utf8');

/**
 * What a shop is owed, and what a shop owes, both come from the ledger.
 *
 * This used to sum approved charge rows and subtract settled refund rows. Two bookkeeping systems
 * for one fact, and they disagreed the moment credits were minted by any route other than a charge
 * — the demo shop held 92.50 on chain while this screen showed nothing, which then capped every
 * withdrawal at zero for a reason no log would have named.
 *
 * `PayoutPool` states the rule it broke: a merchant's positive StableCredit balance IS the payables
 * ledger, with no parallel record to reconcile against.
 */
describe('what a merchant is owed comes from the ledger', () => {
  test('the figure is the chain balance, not a sum of charge rows', () => {
    expect(STORE).toContain('const owedCents = chainPosition === null ? 0 : microsToCents(chainPosition.redeemableMicros)');
    expect(STORE).not.toContain("SUM(payout_cents)");
  });

  test('one read answers both what they are owed and what can be freed today', () => {
    // Two reads would be two figures from two moments, and the second would quietly contradict the
    // first on a busy pool.
    const position = STORE.slice(STORE.indexOf('async payoutPosition'));
    expect(position.match(/merchantPayoutPosition\(/g)?.length).toBe(1);
  });
});

/**
 * A refund can outrun what a merchant is currently owed — they were already paid for the sale being
 * given back. `Math.max(0, owed - clawback)` swallowed that difference and the co-op absorbed it
 * with no record anywhere. It is carried instead, and the ledger is what carries it.
 */
describe('a clawback bigger than the balance is carried, not dropped', () => {
  test('the overdraw is the merchant’s own obligation on the ledger', () => {
    expect(READER).toContain('creditBalanceOf');
    expect(STORE).toContain('microsToCents(chainPosition.owedByMicros)');
  });

  test('it is reported beside what is owed', () => {
    expect(STORE).toContain('clawbackOwedCents,');
  });

  test('the empty-database shape carries it too, so a caller never reads undefined', () => {
    const fallback = STORE.slice(STORE.indexOf('if (!pool) {'), STORE.indexOf('const m = normalize'));
    expect(fallback).toContain('clawbackOwedCents: 0');
  });

  test('a payout itself still cannot go negative', () => {
    // The ledger keeps one signed number: a merchant carrying credit of their own has it netted
    // against what they hold, so `redeemableOf` is a positive balance or nothing at all.
    expect(READER).toContain('redeemableOf');
    expect(STORE).toContain('const net = owedCents;');
  });
});

/**
 * A withdrawal the pool can't pay on the spot moves the credits to the pool as a claim, due when the
 * shop's terms run out. It left `redeemable` and vanished from Payouts, and the net-30 card never
 * counted down because the only date it knew was a scheduled payout row net-30 never writes.
 */
describe('a queued withdrawal stays on the screen and is what net-30 counts down to', () => {
  test('the shop’s unpaid claims are read from the pool, oldest due first', () => {
    expect(READER).toContain("'function claimsOwnedBy(address merchant) view returns (uint256[])'");
    expect(READER).toContain('.filter((c) => !c[4])');
    expect(READER).toContain('.sort((a, b) => a.dueBy - b.dueBy)');
  });

  test('queued money is counted as still arriving, and its due day is returned', () => {
    expect(STORE).toContain('const scheduled = (releasedReady === null ? net : Math.max(0, net - releasedReady)) + queuedCents;');
    expect(STORE).toContain('const releasesOn = chainPosition?.queued[0] ? new Date(chainPosition.queued[0].dueBy * 1000).toISOString() : null;');
    // What can be redeemed again stays the ledger balance: a queued claim can't be withdrawn twice.
    expect(STORE).toContain('owedCents: net,');
  });
});
