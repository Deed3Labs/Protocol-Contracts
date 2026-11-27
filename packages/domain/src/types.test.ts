import { describe, expect, it } from 'bun:test';
import {
  canAddRole,
  canAuthoriseRefund,
  canChangePayoutAccount,
  canChangeTerms,
  canInitiatePayout,
  canManageStaff,
  seesMoney,
} from './types';

describe('three roles, and what a mistake costs', () => {
  it('lets a manager run the shop but not redirect its money', () => {
    expect(seesMoney('manager')).toBe(true);
    expect(canManageStaff('manager')).toBe(true);
    expect(canInitiatePayout('manager')).toBe(true);
    // The two with no ceiling and no way back.
    expect(canChangePayoutAccount('manager')).toBe(false);
    expect(canChangeTerms('manager')).toBe(false);
  });

  it('keeps a counter writer away from money entirely', () => {
    for (const can of [seesMoney, canManageStaff, canInitiatePayout, canChangePayoutAccount]) {
      expect(can('counter')).toBe(false);
    }
  });

  it('will not let anyone add an owner from inside the app', () => {
    expect(canAddRole('owner', 'owner')).toBe(false);
    expect(canAddRole('owner', 'manager')).toBe(true);
    expect(canAddRole('manager', 'counter')).toBe(true);
    expect(canAddRole('counter', 'counter')).toBe(false);
  });

  it('makes the refund threshold mean one thing for everyone below the owner', () => {
    const limit = 50_000; // $500
    expect(canAuthoriseRefund('manager', 25_000, limit)).toBe(true);
    expect(canAuthoriseRefund('manager', 75_000, limit)).toBe(false);
    // An owner is never bounded by their own ceiling.
    expect(canAuthoriseRefund('owner', 75_000, limit)).toBe(true);
    // Off means off: every refund waits for the owner.
    expect(canAuthoriseRefund('manager', 100, 0)).toBe(false);
    expect(canAuthoriseRefund('counter', 100, limit)).toBe(false);
  });
});
