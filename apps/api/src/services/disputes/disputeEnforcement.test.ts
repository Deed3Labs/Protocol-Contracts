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
  test('not yet on chain: it is not issued while the dispute is open', () => {
    expect(settle).toMatch(/if \(row\.dispute_token\) \{[\s\S]{0,200}status: 'held', cents: 0/);
  });

  test('on chain: taken off by exactly the unpaid part, never money already repaid', () => {
    expect(enforce).toContain('const reverse = Math.min(parkedTotal, Number(row.onchain_cents ?? 0));');
    expect(enforce).toContain('await reverseForDispute(dispute.subjectRef, reverse)');
    // Not reversed twice on a retry.
    expect(enforce).toContain("if (!already && row?.onchain_status === 'issued')");
  });

  test('the books stay whole: what is on chain for a purchase is counted whatever its status', () => {
    expect(settle).toContain('issued += onChainForRow;');
    expect(settle).toContain("if (row.dispute_token || row.onchain_status === 'waived' || row.onchain_status === 'held') continue;");
    expect(settle).toContain("account NOT LIKE 'member_credit_disputed_%'");
  });

  test('what was set aside is read back from the ledger, not trusted from the pass that did it', () => {
    expect(enforce).toContain('const parked = await parkedFor(dispute);');
  });

  test('a partner plan is unwound while disputed, and the merchant is not paid for it', () => {
    expect(enforce).toContain('await closePlan(charge, charge.amountCents)');
    expect(charges).toContain("SET status = 'disputed' WHERE code = $1 AND status = 'approved'");
  });
});

describe('"If it goes against you, it returns with the time added back"', () => {
  test('a card purchase is put back by exactly what came off, under a fresh ref, so carry starts from the decision', () => {
    expect(enforce).toContain('await reissueAfterDispute(dispute.subjectRef, reversed, `${dispute.subjectRef}:after-dispute:${dispute.token}`)');
    expect(settle).toContain('return ethers.id(onchainRef || transactionToken);');
    // Asks the chain first, so a retry cannot issue it twice.
    expect(settle.indexOf('await issuer.cardSettlementOf(ref)', settle.indexOf('export async function reissueAfterDispute'))).toBeGreaterThan(0);
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

describe('a decision’s money always finishes moving', () => {
  test('a paid-now release still moving is left releasing, not marked released', () => {
    expect(enforce).toContain("if (released) await disputeStore.setHold(token, 'released', null);");
  });

  test('and the sweep comes back to it until it is done', () => {
    expect(enforce).toContain("WHERE hold_state = 'releasing'");
    expect(enforce).toContain('await finishRelease(dispute)');
  });
});
