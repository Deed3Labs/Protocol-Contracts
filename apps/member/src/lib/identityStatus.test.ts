import { describe, expect, test } from 'bun:test';
import { toIdentityStatus, openWhileWaiting } from './identityStatus';

describe('one identity state, from Lithic', () => {
  test('the integration being off is not the member’s failure', () => {
    // "Not verified" would read as something they had neglected to do.
    expect(toIdentityStatus({ configured: false, provisioned: false }).state).toBe('unavailable');
    expect(toIdentityStatus(null).label).toBe('—');
    expect(toIdentityStatus(null).actionable).toBe(false);
  });

  test('unprovisioned reads as not started, which is everyone today', () => {
    const s = toIdentityStatus({ configured: true, provisioned: false });
    expect(s.state).toBe('unverified');
    expect(s.action).toBe('Verify');
  });

  test('each Lithic status maps to one member-facing state', () => {
    const map: Record<string, string> = {
      ACCEPTED: 'verified',
      PENDING_REVIEW: 'in_review',
      PENDING_DOCUMENT: 'needs_document',
      PENDING_RESUBMIT: 'needs_resubmit',
      REJECTED: 'rejected',
    };
    for (const [status, expected] of Object.entries(map)) {
      expect(toIdentityStatus({ configured: true, provisioned: true, status }).state).toBe(expected);
    }
  });

  test('an unknown status waits rather than claiming verified', () => {
    // Guessing wrong this way tells a member to wait; the other way tells them they can borrow
    // when nobody has said so.
    expect(toIdentityStatus({ configured: true, provisioned: true, status: 'SOMETHING_NEW' }).state).toBe('in_review');
  });

  test('a rejection offers no button, because re-sending the same details changes nothing', () => {
    const s = toIdentityStatus({ configured: true, provisioned: true, status: 'REJECTED' });
    expect(s.actionable).toBe(false);
    expect(s.action).toBeUndefined();
  });

  test('needing a photo and needing a correction are different asks', () => {
    const doc = toIdentityStatus({ configured: true, provisioned: true, status: 'PENDING_DOCUMENT' });
    const fix = toIdentityStatus({ configured: true, provisioned: true, status: 'PENDING_RESUBMIT' });
    expect(doc.action).not.toBe(fix.action);
  });

  test('waiting says what still works', () => {
    // A member who just handed over an SSN assumes everything is frozen.
    expect(openWhileWaiting('in_review').open).toEqual(['Savings', 'Earn']);
    expect(openWhileWaiting('in_review').waiting).toEqual(['Credit', 'Card']);
    expect(openWhileWaiting('verified').open).toEqual([]);
  });
});
