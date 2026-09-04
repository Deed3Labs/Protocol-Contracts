import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const SETTLE = readFileSync(new URL('./refundSettlement.ts', import.meta.url), 'utf8');
const STORE = readFileSync(new URL('./merchant/refundStore.ts', import.meta.url), 'utf8');
const ROUTES = readFileSync(new URL('../routes/merchant.ts', import.meta.url), 'utf8');

/**
 * A refund settled the merchant's books and nothing else: the member's term plan stayed open, so
 * the app kept showing an obligation for a purchase that had been given back, and nobody told them.
 */
describe('a refund reaches the member', () => {
  test('the plan is closed before anything else', () => {
    const order = SETTLE.slice(SETTLE.indexOf('export async function settleRefund'));
    expect(order.indexOf('closePlan(')).toBeLessThan(order.indexOf('markRefunded'));
    expect(order.indexOf('markRefunded')).toBeLessThan(order.indexOf('notifyMember'));
  });

  test('a failed close stops the whole thing', () => {
    expect(SETTLE).toContain('if (!closed.ok) return closed;');
  });

  test('the member is told in-app and on the channel the charge alert uses', () => {
    expect(SETTLE).toContain("kind: 'received'");
    expect(SETTLE).toContain('sendRefundAlert');
  });

  test('telling them twice is not possible', () => {
    expect(SETTLE).toContain('dedupeKey: `refund:${charge.code}`');
  });

  test('a charge that never became a plan still refunds', () => {
    expect(SETTLE).toContain('if (charge.planId == null)');
  });
});

/**
 * Flagging the charge is what claws the payout back, so it cannot happen on the strength of a
 * decision alone — only once the member's plan is really closed.
 */
describe('the two halves cannot come apart', () => {
  test('approving no longer flags the charge by itself', () => {
    const approve = STORE.slice(STORE.indexOf('async approve('), STORE.indexOf('async reopen('));
    expect(approve).not.toContain('markRefunded');
  });

  test('a settlement that fails puts the refund back to waiting', () => {
    expect(STORE).toContain('async reopen(');
    expect(ROUTES).toContain('await refundStore.reopen(refund.id);');
  });

  test('both approval paths settle — the owner code and the owner device', () => {
    expect(ROUTES.split('settleApproved(result.refund').length - 1).toBe(2);
  });

  test('declining settles nothing', () => {
    expect(ROUTES).toContain("decision !== 'decline' && !(await settleApproved");
    expect(ROUTES).toContain("req.body?.decision !== 'decline' && !(await settleApproved");
  });
});
