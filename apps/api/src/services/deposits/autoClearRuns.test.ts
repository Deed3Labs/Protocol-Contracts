import { describe, expect, test } from 'bun:test';
import {
  advanceRun,
  placeHold,
  refFor,
  termRefFor,
  tokenFor,
  uuidV5,
  holdExpiry,
  maxHoldMs,
  MAX_TRANSFER_ATTEMPTS,
  type AutoClearDeps,
  type AutoClearRun,
  type ChainSide,
  type SpendableMoves,
} from './autoClearRuns';

/*
 * Auto-clear moves the money as well as the line: what `repayForMember` applied leaves the member's
 * Spendable account in a Lithic book transfer, and nothing else does. Against a stand-in Lithic (a
 * member account with holds and book transfers) and a stand-in chain (the contract's own rules:
 * min(amount, owed), one application per ref for the line; `payPlan`, with no key, for a term plan).
 * No live Lithic, no keys.
 */

const WALLET = '0x00000000000000000000000000000000000000a1';
const MEMBER_FA = 'fa-member';
const SETTLEMENT_FA = 'fa-clear-settlement';

class FakeLithic implements SpendableMoves {
  available: number;
  holds = new Map<string, { amount: number; status: string; account: string; expiresAt?: string }>();
  transfers = new Map<string, { amount: number; status: string; from: string; to: string; holdToken?: string }>();
  creates = { holds: 0, transfers: 0, voids: 0 };
  /** Fail the next transfer call AFTER Lithic has accepted it (a timeout on the way back). */
  loseNextTransferResponse = false;
  /** Fail the next transfer call BEFORE it reaches Lithic. */
  failNextTransferRequest = false;
  /** Decline the next N transfers. */
  declineTransfers = 0;

  constructor(availableCents: number) {
    this.available = availableCents;
  }
  settlementAccount() {
    return SETTLEMENT_FA;
  }
  async cashAccountOf() {
    return MEMBER_FA;
  }
  async findHold(token: string) {
    const h = this.holds.get(token);
    return h ? { status: h.status } : null;
  }
  async createHold(account: string, input: { token: string; amountCents: number; expiresAt: string }) {
    const existing = this.holds.get(input.token);
    if (existing) return { status: existing.status };
    this.creates.holds += 1;
    const ok = this.available >= input.amountCents;
    if (ok) this.available -= input.amountCents;
    const hold = { amount: input.amountCents, status: ok ? 'PENDING' : 'DECLINED', account, expiresAt: input.expiresAt };
    this.holds.set(input.token, hold);
    return { status: hold.status, result: ok ? 'APPROVED' : 'DECLINED' };
  }
  async voidHold(token: string) {
    const h = this.holds.get(token);
    if (!h || h.status !== 'PENDING') throw new Error('only a pending hold can be voided');
    this.creates.voids += 1;
    h.status = 'VOIDED';
    this.available += h.amount;
  }
  async findTransfer(token: string) {
    const t = this.transfers.get(token);
    return t ? { status: t.status } : null;
  }
  async createTransfer(input: { token: string; amountCents: number; from: string; to: string; holdToken?: string }) {
    if (this.failNextTransferRequest) {
      this.failNextTransferRequest = false;
      throw new Error('ETIMEDOUT before Lithic');
    }
    const existing = this.transfers.get(input.token);
    if (existing) return { status: existing.status };
    this.creates.transfers += 1;
    let status = 'SETTLED';
    if (this.declineTransfers > 0) {
      this.declineTransfers -= 1;
      status = 'DECLINED';
    } else if (input.holdToken) {
      const h = this.holds.get(input.holdToken);
      if (!h || h.status !== 'PENDING' || h.amount !== input.amountCents) status = 'DECLINED';
      else h.status = 'SETTLED';
    } else if (this.available >= input.amountCents) {
      this.available -= input.amountCents;
    } else {
      status = 'DECLINED';
    }
    this.transfers.set(input.token, { amount: input.amountCents, status, from: input.from, to: input.to, holdToken: input.holdToken });
    if (this.loseNextTransferResponse) {
      this.loseNextTransferResponse = false;
      throw new Error('socket hang up after Lithic accepted it');
    }
    return { status };
  }
  /** Dollars that actually left the member's account. */
  moved(): number {
    return [...this.transfers.values()].filter((t) => t.status === 'SETTLED').reduce((a, t) => a + t.amount, 0);
  }
  settled() {
    return [...this.transfers.values()].filter((t) => t.status === 'SETTLED');
  }
}

class FakeChain implements ChainSide {
  on = true;
  paused = false;
  owed: number;
  /** The line (`repayForMember`, keyed by ref on chain) or a term plan (`payPlan`, no key). */
  keyed: boolean;
  /** The line's on-chain record: ref -> applied. */
  applied = new Map<string, number>();
  /** Every transaction sent: hash -> what it applied, and whether it has landed. */
  txs = new Map<string, { applied: number; mined: boolean }>();
  sends = 0;
  booked: string[] = [];
  /** The transaction lands, but the wait for its receipt fails (an RPC that dropped). */
  loseNextReceipt = false;
  /** Someone else repays this much between our read and our transaction. */
  repaidUnderUs = 0;
  /** The next call is refused in simulation (estimateGas), before anything is broadcast. */
  refuseNext: string | null = null;

  constructor(owedCents: number, keyed = true) {
    this.owed = owedCents;
    this.keyed = keyed;
  }
  async enabled() {
    return this.on;
  }
  async pausedForEveryone() {
    return this.paused;
  }
  async owedCents() {
    return this.owed;
  }
  waitsForDebt() {
    return this.keyed;
  }
  async appliedOf(run: AutoClearRun) {
    if (this.keyed) return this.applied.get(run.ref) ?? 0;
    if (!run.txHash) return null;
    const tx = this.txs.get(run.txHash);
    if (!tx) return null;
    return tx.mined ? tx.applied : ('pending' as const);
  }
  async settlerCannotPay() {
    return null;
  }
  /** Dollars the chain was paid in total, across every send. */
  paidOnChain(): number {
    return [...this.txs.values()].reduce((a, t) => a + t.applied, 0);
  }
  async submit(run: AutoClearRun, cents: number) {
    if (this.refuseNext) {
      const name_ = this.refuseNext;
      this.refuseNext = null;
      throw Object.assign(new Error('execution reverted (estimateGas)'), { name_ });
    }
    this.sends += 1;
    if (this.keyed && this.applied.has(run.ref)) {
      const error = Object.assign(new Error('reverted'), { name_: 'RevolvingIssuerAutoRepayAlreadyUsed' });
      throw error;
    }
    if (!this.on) throw Object.assign(new Error('reverted'), { name_: 'RevolvingIssuerAutoRepayNotEnabled' });
    this.owed -= this.repaidUnderUs;
    this.repaidUnderUs = 0;
    const applied = Math.min(cents, this.owed);
    if (applied === 0 && this.keyed) throw Object.assign(new Error('reverted'), { name_: 'RevolvingIssuerNothingToClear' });
    this.owed -= applied;
    if (this.keyed) this.applied.set(run.ref, applied);
    const hash = `0x${String(this.sends).padStart(64, '0')}`;
    this.txs.set(hash, { applied, mined: true });
    if (this.loseNextReceipt) {
      this.loseNextReceipt = false;
      return { hash, applied: Promise.reject(new Error('receipt wait timed out')) };
    }
    return { hash, applied: Promise.resolve(applied) };
  }
  async findClearingTx() {
    return null;
  }
  async book(run: AutoClearRun) {
    this.booked.push(run.txHash!);
  }
  errorName(error: unknown) {
    return (error as { name_?: string }).name_ ?? null;
  }
}

function setup(input: { depositCents: number; earmarkCents: number; owedCents: number; kind?: 'line' | 'term' }) {
  const kind = input.kind ?? 'line';
  const lithic = new FakeLithic(input.depositCents);
  const chain = new FakeChain(input.owedCents, kind === 'line');
  const alerts: string[] = [];
  const notices: string[] = [];
  const saved: AutoClearRun[] = [];
  /** What the deposit booked for a term plan and was booked back to the member's cash, per ref. */
  const unbooked = new Map<string, number>();
  const run: AutoClearRun = {
    ref: kind === 'line' ? refFor('lithic_ach', 'ach-1') : termRefFor('lithic_ach', 'ach-1', 4),
    kind,
    planId: kind === 'line' ? null : 4,
    wallet: WALLET,
    rail: 'lithic_ach',
    externalId: 'ach-1',
    earmarkCents: input.earmarkCents,
    state: 'earmarked',
    holdToken: null,
    holdSeq: 0,
    holdCents: 0,
    holdVoided: false,
    submittedCents: 0,
    txHash: null,
    submittedAt: null,
    appliedCents: 0,
    booked: false,
    transferToken: null,
    transferAttempt: 0,
    transferStatus: null,
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
  };
  const deps: AutoClearDeps = {
    store: { save: async (r) => void saved.push({ ...r }) },
    moves: lithic,
    chainFor: () => chain,
    unbook: async (r) => {
      // As pgUnbook: term clearings only, once per ref.
      if (r.kind !== 'term' || unbooked.has(r.ref)) return;
      const cents = Math.max(0, r.earmarkCents - r.appliedCents);
      if (cents > 0) unbooked.set(r.ref, cents);
    },
    alert: async (a) => void alerts.push(a.subject),
    notify: async (n) => void notices.push(n.body),
    now: () => Date.now(),
  };
  return { lithic, chain, run, deps, alerts, notices, saved, unbooked };
}

describe('the ref and the Lithic tokens', () => {
  test('are derived from the deposit receipt, so every retry carries the same ones', () => {
    expect(refFor('lithic_ach', 'ach-1')).toBe(refFor('lithic_ach', 'ach-1'));
    expect(refFor('lithic_ach', 'ach-1')).not.toBe(refFor('lithic_ach', 'ach-2'));
    expect(refFor('lithic_ach', 'ach-1')).toMatch(/^0x[0-9a-f]{64}$/);
    const t = tokenFor(refFor('lithic_ach', 'ach-1'), 'transfer:0');
    expect(t).toBe(tokenFor(refFor('lithic_ach', 'ach-1'), 'transfer:0'));
    expect(t).not.toBe(tokenFor(refFor('lithic_ach', 'ach-1'), 'transfer:1'));
    expect(t).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('the tokens are real UUIDv5s (Lithic idempotency keys must be valid UUIDs)', () => {
    // RFC 4122's own example: www.example.com in the DNS namespace.
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    for (const purpose of ['hold:0', 'hold:1', 'transfer:0']) {
      expect(tokenFor(refFor('lithic_ach', 'ach-1'), purpose)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  test('sent as the token and as the Idempotency-Key header, with the classification Lithic set up', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const src = readFileSync(new URL('./autoClearRuns.ts', import.meta.url), 'utf8');
    expect(src.match(/\{ idempotencyKey: input\.token \}/g)).toHaveLength(2);
    expect(src).toContain('...(input.holdToken ? { hold_token: input.holdToken } : {}),');
    expect(src).toContain('expiration_datetime: input.expiresAt,');
    // No guessed subtype: without the program's own, nothing is held or moved.
    expect(src).toContain("subtype: (process.env.LITHIC_AUTO_CLEAR_TRANSFER_SUBTYPE || '').trim(),");
    expect(src).toContain('if (!transferClass().subtype) return null;');
  });

  test('a term clearing is keyed by the receipt and the plan, apart from the line and other plans', () => {
    const line = refFor('lithic_ach', 'ach-1');
    expect(termRefFor('lithic_ach', 'ach-1', 4)).toBe(termRefFor('lithic_ach', 'ach-1', 4));
    expect(termRefFor('lithic_ach', 'ach-1', 4)).not.toBe(line);
    expect(termRefFor('lithic_ach', 'ach-1', 4)).not.toBe(termRefFor('lithic_ach', 'ach-1', 5));
    expect(termRefFor('lithic_ach', 'ach-1', null)).not.toBe(termRefFor('lithic_ach', 'ach-1', 4));
    expect(termRefFor('lithic_ach', 'ach-1', 4)).not.toBe(termRefFor('lithic_ach', 'ach-2', 4));
  });
});

describe('a clearing, end to end', () => {
  test('the book transfer is exactly what the chain applied, out of the member account into the settlement account', async () => {
    const { lithic, chain, run, deps, notices } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    const step = await advanceRun(run, deps);
    expect(step.action).toBe('repaid');
    expect(chain.applied.get(run.ref)).toBe(5_000);
    expect(lithic.settled()).toEqual([
      { amount: 5_000, status: 'SETTLED', from: MEMBER_FA, to: SETTLEMENT_FA, holdToken: run.holdToken! },
    ]);
    // The hold is settled by the transfer; the other $50 of the deposit was never touched.
    expect(lithic.available).toBe(5_000);
    expect(run.state).toBe('transferred');
    expect(chain.booked).toHaveLength(1);
    expect(notices).toEqual(['$50.00 cleared']);
  });

  test('the remainder stays spendable: what the chain will apply is read first, and only that is held', async () => {
    // $80 set aside from a $100 deposit, but only $30 is owed in the member's scope on chain.
    const { lithic, chain, run, deps, notices } = setup({ depositCents: 10_000, earmarkCents: 8_000, owedCents: 3_000 });
    const held = await placeHold(run, deps);
    expect(held).toMatchObject({ action: 'held', cents: 3_000 });
    // Held is exactly A = min(set aside, owed); the other $70 was never held.
    expect([...lithic.holds.values()].map((h) => h.amount)).toEqual([3_000]);
    expect(lithic.available).toBe(7_000);
    const step = await advanceRun(run, deps);
    expect(step).toMatchObject({ action: 'repaid', cents: 3_000, releasedCents: 5_000 });
    expect(chain.applied.get(run.ref)).toBe(3_000);
    expect(lithic.moved()).toBe(3_000);
    // No void anywhere: the transfer settled the hold.
    expect(lithic.creates.voids).toBe(0);
    expect(lithic.settled()[0].holdToken).toBe(run.holdToken!);
    expect(lithic.available).toBe(7_000);
    expect(notices).toEqual(['$30.00 cleared · $50.00 now spendable']);
  });

  test('the hold expires an hour after the release, so Lithic frees it if nothing voids it', async () => {
    const { lithic, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    await placeHold(run, deps);
    const hold = [...lithic.holds.values()][0];
    expect(hold.expiresAt).toBe(holdExpiry(run));
    expect(new Date(hold.expiresAt!).getTime()).toBe(run.createdAt + maxHoldMs() + 60 * 60 * 1000);
  });

  test('owed falls after the hold and before the send: re-held at the new amount, nothing sent twice', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    await placeHold(run, deps);
    chain.owed = 2_000; // the member repaid $30 themselves before the sweep
    const step = await advanceRun(run, deps);
    expect(step).toMatchObject({ action: 'repaid', cents: 2_000 });
    expect(chain.sends).toBe(1);
    expect(lithic.creates.voids).toBe(1); // before anything was sent
    expect(lithic.moved()).toBe(2_000);
    expect(lithic.settled()[0].holdToken).toBe(run.holdToken!);
    expect(lithic.available).toBe(8_000);
  });

  test('the exception: the chain applies less than was held -- void, transfer the applied amount, tell ops', async () => {
    const { lithic, chain, run, deps, alerts } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    chain.repaidUnderUs = 2_000; // the member repaid $20 themselves between the read and the transaction
    const step = await advanceRun(run, deps);
    expect(step).toMatchObject({ action: 'repaid', cents: 3_000 });
    expect(lithic.moved()).toBe(3_000);
    // Partial settlement of a hold is not documented, so it is not assumed.
    expect(lithic.settled()[0].holdToken).toBeUndefined();
    expect(lithic.creates.voids).toBe(1);
    expect(lithic.available).toBe(7_000);
    expect(alerts.some((a) => a.includes('applied less than was held'))).toBe(true);
  });

  test('the normal path never voids: the transfer settles the hold with hold_token', async () => {
    const { lithic, run, deps, alerts } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 9_000 });
    await advanceRun(run, deps);
    expect(lithic.creates.voids).toBe(0);
    expect(lithic.settled()).toHaveLength(1);
    expect(lithic.settled()[0].holdToken).toBe(run.holdToken!);
    expect([...lithic.holds.values()][0].status).toBe('SETTLED');
    expect(alerts).toEqual([]);
  });

  test('the hold comes first: a member who already spent the deposit is never cleared on chain', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 1_000, earmarkCents: 5_000, owedCents: 5_000 });
    const step = await advanceRun(run, deps);
    expect(step.action).toBe('waiting');
    expect(chain.sends).toBe(0);
    expect(lithic.moved()).toBe(0);
    expect(run.state).toBe('earmarked');
  });
});

describe('retries are idempotent', () => {
  test('a placed hold is found again, never placed twice', async () => {
    const { lithic, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    await placeHold(run, deps);
    const again = { ...run, state: 'earmarked' as const, holdToken: null };
    await placeHold(again, deps);
    expect(lithic.creates.holds).toBe(1);
    expect(lithic.available).toBe(5_000);
  });

  test('a transfer Lithic accepted but whose answer was lost is found by its token, not sent again', async () => {
    const { lithic, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    lithic.loseNextTransferResponse = true;
    expect((await advanceRun(run, deps)).action).toBe('failed');
    expect(run.state).toBe('applied');
    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(lithic.creates.transfers).toBe(1);
    expect(lithic.moved()).toBe(5_000);
  });

  test('a lost receipt is resolved from the chain by ref, never resent as a second application', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 9_000 });
    chain.loseNextReceipt = true;
    expect((await advanceRun(run, deps)).action).toBe('failed');
    expect(run.state).toBe('submitting');
    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(chain.sends).toBe(1);
    expect(chain.owed).toBe(4_000);
    expect(lithic.moved()).toBe(5_000);
  });
});

describe('a failure between the chain and the transfer reconciles without a double move', () => {
  test('the transfer request fails after the chain applied: retried with the same token, moved once', async () => {
    const { lithic, chain, run, deps, alerts } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    lithic.failNextTransferRequest = true;
    expect((await advanceRun(run, deps)).action).toBe('failed');
    expect(chain.applied.get(run.ref)).toBe(5_000);
    expect(lithic.moved()).toBe(0);
    // The money is still held, so the member cannot spend what the chain already cleared.
    expect(lithic.available).toBe(5_000);
    expect(alerts.some((a) => a.includes('retrying in "applied"'))).toBe(true);

    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(chain.sends).toBe(1);
    expect(lithic.moved()).toBe(5_000);
    expect(lithic.transfers.size).toBe(1);
    // A further pass does nothing.
    expect((await advanceRun(run, deps)).action).toBe('waiting');
    expect(lithic.moved()).toBe(5_000);
  });

  test('a declined transfer alerts ops and retries with a new token only once the last is known declined', async () => {
    const { lithic, chain, run, deps, alerts } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    lithic.declineTransfers = 1;
    expect((await advanceRun(run, deps)).action).toBe('failed');
    expect(run.state).toBe('transfer_declined');
    expect(alerts.some((a) => a.includes('declined'))).toBe(true);

    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(chain.sends).toBe(1);
    expect(lithic.transfers.size).toBe(2); // one declined, one settled
    expect(lithic.moved()).toBe(5_000);
  });

  test('after the last attempt a declined transfer waits for a person, and nothing more is sent', async () => {
    const { lithic, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    lithic.declineTransfers = 100;
    for (let i = 0; i < MAX_TRANSFER_ATTEMPTS + 3; i++) await advanceRun(run, deps);
    expect(lithic.transfers.size).toBe(MAX_TRANSFER_ATTEMPTS);
    expect(lithic.moved()).toBe(0);
    expect(run.state).toBe('transfer_declined');
  });

  test('a transaction that reverted is resent with the same ref; the chain applies it once', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    await placeHold(run, deps);
    run.state = 'submitting'; // a crash right after recording `submitting`, before anything was sent
    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(chain.sends).toBe(1);
    expect(lithic.moved()).toBe(5_000);
  });
});

describe('auto-clear off moves nothing', () => {
  test('turned off before the sweep: the hold is voided and no transfer is made', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    await placeHold(run, deps);
    expect(lithic.available).toBe(5_000);
    chain.on = false;
    const step = await advanceRun(run, deps);
    expect(step.action).toBe('off');
    expect(run.state).toBe('released');
    expect(chain.sends).toBe(0);
    expect(lithic.transfers.size).toBe(0);
    expect(lithic.available).toBe(10_000);
  });

  test('off before anything was held: released, and Lithic is not called', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    chain.on = false;
    expect((await advanceRun(run, deps)).action).toBe('released');
    expect(lithic.creates).toEqual({ holds: 0, transfers: 0, voids: 0 });
  });

  test('nothing owed on chain yet: nothing is held while it waits, and it releases after the wait', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 0 });
    expect((await advanceRun(run, deps)).action).toBe('waiting');
    expect(lithic.holds.size).toBe(0);
    expect(lithic.available).toBe(10_000);
    run.createdAt -= 73 * 60 * 60 * 1000;
    expect((await advanceRun(run, deps)).action).toBe('released');
    expect(chain.sends).toBe(0);
    expect(lithic.available).toBe(10_000);
    expect(lithic.transfers.size).toBe(0);
  });
});

describe('term plan dues paid from a Spendable deposit', () => {
  test('the book transfer is exactly what payPlan applied; the member is told it was paid', async () => {
    const { lithic, chain, run, deps, notices, unbooked } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 9_000 });
    const step = await advanceRun(run, deps);
    expect(step).toMatchObject({ action: 'repaid', cents: 3_000 });
    expect(chain.paidOnChain()).toBe(3_000);
    expect(lithic.settled()).toEqual([
      { amount: 3_000, status: 'SETTLED', from: MEMBER_FA, to: SETTLEMENT_FA, holdToken: run.holdToken! },
    ]);
    expect(lithic.available).toBe(7_000);
    expect(chain.booked).toHaveLength(1);
    expect(unbooked.size).toBe(0);
    expect(notices).toEqual(['$30.00 paid']);
  });

  test('less owed on the plan than booked: only that is held and moved, the rest is booked back and stays', async () => {
    const { lithic, chain, run, deps, unbooked } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 1_200 });
    await placeHold(run, deps);
    expect([...lithic.holds.values()].map((h) => h.amount)).toEqual([1_200]);
    const step = await advanceRun(run, deps);
    expect(step).toMatchObject({ action: 'repaid', cents: 1_200, releasedCents: 1_800 });
    expect(chain.paidOnChain()).toBe(1_200);
    expect(lithic.moved()).toBe(1_200);
    expect(lithic.creates.voids).toBe(0);
    expect(lithic.available).toBe(8_800);
    expect(unbooked.get(run.ref)).toBe(1_800);
  });

  test('the plan was paid off in between: released at once, nothing held, paid or moved, the booking undone', async () => {
    const { lithic, chain, run, deps, unbooked } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 0 });
    const step = await advanceRun(run, deps);
    expect(step.action).toBe('released');
    expect(lithic.holds.size).toBe(0);
    expect(chain.sends).toBe(0);
    expect(lithic.transfers.size).toBe(0);
    expect(lithic.available).toBe(10_000);
    expect(unbooked.get(run.ref)).toBe(3_000);
  });

  test('a lost receipt is read back from the recorded transaction, never paid twice', async () => {
    const { lithic, chain, run, deps } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 9_000 });
    chain.loseNextReceipt = true;
    expect((await advanceRun(run, deps)).action).toBe('failed');
    expect(run.state).toBe('submitting');
    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(chain.sends).toBe(1);
    expect(chain.paidOnChain()).toBe(3_000);
    expect(lithic.moved()).toBe(3_000);
  });

  test('a transaction still pending waits, and is not sent again', async () => {
    const { lithic, chain, run, deps } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 9_000 });
    chain.loseNextReceipt = true;
    await advanceRun(run, deps);
    chain.txs.get(run.txHash!)!.mined = false;
    expect((await advanceRun(run, deps)).action).toBe('waiting');
    expect(chain.sends).toBe(1);
    expect(lithic.transfers.size).toBe(0);
    chain.txs.get(run.txHash!)!.mined = true;
    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(chain.sends).toBe(1);
    expect(lithic.moved()).toBe(3_000);
  });

  test('a crash before the hash was recorded goes to a person: no blind resend, the money stays held', async () => {
    const { lithic, chain, run, deps, alerts } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 9_000 });
    await placeHold(run, deps);
    run.state = 'submitting'; // payPlan may or may not have been sent; nothing on chain can say
    const step = await advanceRun(run, deps);
    expect(step.action).toBe('needs_review');
    expect(run.state as string).toBe('needs_review');
    expect(chain.sends).toBe(0);
    expect(lithic.transfers.size).toBe(0);
    expect(lithic.available).toBe(7_000);
    expect(alerts.some((a) => a.includes('needs a person'))).toBe(true);
    // Later passes leave it alone.
    expect((await advanceRun(run, deps)).action).toBe('waiting');
    expect(chain.sends).toBe(0);
  });

  test('payPlan refused in simulation sent nothing: back to held and tried again, never to review', async () => {
    const { lithic, chain, run, deps } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 9_000 });
    chain.refuseNext = 'TermIssuerPlanClosed';
    expect((await advanceRun(run, deps)).action).toBe('failed');
    expect(run.state).toBe('held');
    expect(lithic.available).toBe(7_000);
    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(chain.sends).toBe(1);
    expect(lithic.moved()).toBe(3_000);
  });

  test('a transfer that fails after payPlan applied is retried with the same token, moved once', async () => {
    const { lithic, chain, run, deps } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 9_000 });
    lithic.failNextTransferRequest = true;
    expect((await advanceRun(run, deps)).action).toBe('failed');
    expect(lithic.available).toBe(7_000); // still held
    expect((await advanceRun(run, deps)).action).toBe('repaid');
    expect(chain.sends).toBe(1);
    expect(lithic.transfers.size).toBe(1);
    expect(lithic.moved()).toBe(3_000);
  });

  test('auto-clear turned off before the sweep: nothing paid or moved, the hold voided, the booking undone', async () => {
    const { lithic, chain, run, deps, unbooked } = setup({ kind: 'term', depositCents: 10_000, earmarkCents: 3_000, owedCents: 9_000 });
    await placeHold(run, deps);
    chain.on = false;
    expect((await advanceRun(run, deps)).action).toBe('off');
    expect(chain.sends).toBe(0);
    expect(lithic.transfers.size).toBe(0);
    expect(lithic.available).toBe(10_000);
    expect(unbooked.get(run.ref)).toBe(3_000);
  });
});
