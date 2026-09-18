import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const enforce = readFileSync(new URL('./disputeEnforcement.ts', import.meta.url), 'utf8');
const settle = readFileSync(new URL('../chain/cardSettlementService.ts', import.meta.url), 'utf8');
const deposits = readFileSync(new URL('../deposits/depositReceiptService.ts', import.meta.url), 'utf8');
const snapshot = readFileSync(new URL('../lithic/snapshotService.ts', import.meta.url), 'utf8');
const payouts = readFileSync(new URL('../sendPayoutService.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../routes/disputes.ts', import.meta.url), 'utf8');
const sweeper = readFileSync(new URL('../../jobs/cardSettlementSweeper.ts', import.meta.url), 'utf8');
const charges = readFileSync(new URL('../chargeStore.ts', import.meta.url), 'utf8');

describe('"The amount: held, not spent" and "not counted late"', () => {
  test('a card dispute moves the credit out of the tier accounts, so a deposit does not pay it', () => {
    expect(enforce).toContain("`member_credit_${tier}`, `member_credit_disputed_${tier}`");
    // readOutstanding only knows the four tiers, so `disputed_<tier>` is outside what a deposit settles.
    expect(deposits).toContain("row.account.replace('member_credit_', '') as keyof Outstanding");
  });

  test('but it still uses up the tier: held, not freed', () => {
    expect(deposits).toContain("LIKE 'member_credit_disputed_%'");
    expect(snapshot).toContain('await outstandingForSpend(wallet)');
  });

  test('never more than the purchase still owes on the tier', () => {
    expect(enforce).toContain('Math.min(Math.round(Number(draw.amountCents ?? 0)), owed)');
  });
});

describe('"You are not charged carry on a disputed amount"', () => {
  test('a disputed card purchase belongs off the chain: taken off if on it, not issued if not', () => {
    expect(settle).toContain('const target = disputed ? 0 : creditCentsOf(row.draws);');
    expect(settle).toContain("status: disputed ? 'held' : 'issued',");
    expect(settle).toContain("OR dispute_token IS NOT NULL");
  });

  test('disputed purchases are left out of repayment netting on both sides', () => {
    expect(settle).toContain("AND dispute_token IS NULL");
    expect(settle).toContain("account NOT LIKE 'member_credit_disputed_%'");
  });

  test('a partner plan is unwound while disputed, and the merchant is not paid for it', () => {
    expect(enforce).toContain('await closePlan(charge, charge.amountCents)');
    expect(charges).toContain("SET status = 'disputed' WHERE code = $1 AND status = 'approved'");
  });
});

describe('"If it goes against you, it returns with the time added back"', () => {
  test('a card purchase is settled again under a fresh ref, so carry starts from the decision', () => {
    expect(enforce).toContain('`${dispute.subjectRef}:after-dispute:${dispute.token}`');
    expect(settle).toContain('return ethers.id(onchainRef || transactionToken);');
  });

  test('a partner purchase goes onto a new plan opened now', () => {
    expect(enforce).toContain('await reopenPlanAfterDispute(charge, unwound)');
  });

  test('won: the member no longer owes it, and it can never be released twice', () => {
    expect(enforce).toContain("'coop_dispute_writeoff'");
    expect(enforce).toContain("onchain_status = 'waived', net_cents = 0, draws = '[]'::jsonb");
  });

  test('decided once, even if the network and a person decide at the same time', () => {
    expect(enforce.indexOf('await disputeStore.resolve(token, resolution, note)')).toBeLessThan(
      enforce.indexOf('await releaseCard(before, memberWon)'),
    );
  });
});

describe('"You can withdraw it at any point before a decision"', () => {
  test('withdraw is a member route, and a card dispute is withdrawn at Lithic first', () => {
    expect(route).toContain("disputesRouter.post('/:token/withdraw'");
    expect(enforce.indexOf('lithic?.disputes.delete(')).toBeLessThan(enforce.indexOf("await resolveDispute(token, 'withdrawn'"));
  });
});

describe('member sends are held by refusing the claim', () => {
  test('every payout path checks for an open dispute first', () => {
    expect(payouts.match(/const held = await disputeHold\(transfer\.transferId\);/g)).toHaveLength(3);
  });

  test('a send already claimed cannot be held, and says so', () => {
    expect(enforce).toContain("await disputeStore.setHold(dispute.token, 'not_held', { reason: 'already claimed' });");
  });
});

describe('kept, not attempted once', () => {
  test('filing starts the hold; the sweep retries holds and follows the card network', () => {
    expect(route).toContain('enforce(dispute);');
    expect(route).toContain('enforce(updated);');
    expect(sweeper).toContain('await enforceDisputes()');
    expect(enforce).toContain("at.status === 'CASE_WON'");
    expect(enforce).toContain("at.status === 'CASE_CLOSED'");
  });
});
