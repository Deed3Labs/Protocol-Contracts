import { describe, expect, it } from 'bun:test';
import {
  CHARGE_LABEL,
  CHARGE_TRANSITIONS,
  type ChargeState,
  canTransition,
  fromWire,
  isFinanced,
  isPending,
  isTerminal,
  toWire,
} from './charge';

const ALL = Object.keys(CHARGE_TRANSITIONS) as ChargeState[];

describe('the lifecycle both apps read', () => {
  it('a charge raised at the counter reaches the member and comes back', () => {
    expect(canTransition('draft', 'waiting')).toBe(true);
    expect(canTransition('waiting', 'resolving')).toBe(true);
    expect(canTransition('resolving', 'approved')).toBe(true);
  });

  it('a waiting charge can decline, expire, or be cancelled by the merchant', () => {
    for (const to of ['declined', 'expired', 'cancelled'] as const) {
      expect(canTransition('waiting', to)).toBe(true);
    }
  });

  it('an expired charge does not come back to life — resending raises a new one', () => {
    expect(isTerminal('expired')).toBe(true);
    expect(canTransition('expired', 'waiting')).toBe(false);
  });

  it('a declined charge is final; the merchant cannot retry it into approval', () => {
    expect(isTerminal('declined')).toBe(true);
    expect(canTransition('declined', 'approved')).toBe(false);
  });

  it('nothing can be approved without passing through the member', () => {
    for (const from of ALL) {
      if (from === 'resolving') continue;
      expect(canTransition(from, 'approved')).toBe(from === 'refund_requested' || from === 'refund_declined');
    }
  });

  it('a charge cannot be cancelled once the member has acted on it', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'cancelled')).toBe(from === 'waiting');
    }
  });

  it('every state is reachable from draft', () => {
    const seen = new Set<ChargeState>(['draft']);
    for (let i = 0; i < ALL.length; i++) {
      for (const s of [...seen]) for (const n of CHARGE_TRANSITIONS[s]) seen.add(n);
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });

  it('every target named in the table is itself a known state', () => {
    for (const from of ALL) for (const to of CHARGE_TRANSITIONS[from]) expect(ALL).toContain(to);
  });
});

describe('refunds move authority, and only from approved', () => {
  it('only a financed charge can begin a refund', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'refund_requested')).toBe(from === 'approved');
    }
  });

  it('the request waits — an owner may approve or decline it minutes later', () => {
    expect(isTerminal('refund_requested')).toBe(false);
    expect(canTransition('refund_requested', 'refunded')).toBe(true);
    expect(canTransition('refund_requested', 'refund_declined')).toBe(true);
  });

  it('the writer can withdraw the request before an owner rules on it', () => {
    expect(canTransition('refund_requested', 'approved')).toBe(true);
  });

  it('a declined refund leaves the charge standing', () => {
    expect(canTransition('refund_declined', 'approved')).toBe(true);
    expect(isFinanced('refund_declined')).toBe(true);
  });

  it('a settled refund is the end of it', () => {
    expect(isTerminal('refunded')).toBe(true);
  });

  it('the merchant is owed for a charge until it is actually refunded', () => {
    expect(isFinanced('approved')).toBe(true);
    expect(isFinanced('refund_requested')).toBe(true);
    expect(isFinanced('refunded')).toBe(false);
  });
});

describe('the wire, where the server named things first', () => {
  it('waiting is stored as the pending the column has always held', () => {
    expect(toWire('waiting')).toBe('pending');
    expect(fromWire('pending')).toBe('waiting');
  });

  it('every other state stores under its own name', () => {
    for (const s of ALL) if (s !== 'waiting') expect(toWire(s)).toBe(s);
  });

  it('round-trips', () => {
    for (const s of ALL) expect(fromWire(toWire(s))).toBe(s);
  });

  it('covers the states the server already persists', () => {
    for (const v of ['pending', 'resolving', 'approved', 'declined', 'expired']) {
      expect(ALL).toContain(fromWire(v));
    }
  });
});

describe('what a merchant is shown', () => {
  it('labels every state', () => {
    for (const s of ALL) expect(CHARGE_LABEL[s]?.length).toBeGreaterThan(0);
  });

  it('a decline says only that it was declined — never why', () => {
    expect(CHARGE_LABEL.declined).toBe('Declined');
  });

  it('resolving reads as confirming, not as a mechanism', () => {
    expect(CHARGE_LABEL.resolving).toBe('Confirming');
    expect(isPending('resolving')).toBe(true);
    expect(isPending('waiting')).toBe(true);
  });
});
