import { describe, expect, test } from 'bun:test';
import {
  advanceRun,
  placeHold,
  refFor,
  tokenFor,
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
 * min(amount, owed), one application per ref). No live Lithic, no keys.
 */

const WALLET = '0x00000000000000000000000000000000000000a1';
const MEMBER_FA = 'fa-member';
const SETTLEMENT_FA = 'fa-clear-settlement';

class FakeLithic implements SpendableMoves {
  available: number;
  holds = new Map<string, { amount: number; status: string; account: string }>();
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
  async createHold(account: string, input: { token: string; amountCents: number }) {
    const existing = this.holds.get(input.token);
    if (existing) return { status: existing.status };
    this.creates.holds += 1;
    const ok = this.available >= input.amountCents;
    if (ok) this.available -= input.amountCents;
    const hold = { amount: input.amountCents, status: ok ? 'PENDING' : 'DECLINED', account };
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
  applied = new Map<string, number>();
  sends = 0;
  booked: string[] = [];
  /** The transaction lands, but the wait for its receipt fails (an RPC that dropped). */
  loseNextReceipt = false;
  /** Someone else repays this much between our read and our transaction. */
  repaidUnderUs = 0;

  constructor(owedCents: number) {
    this.owed = owedCents;
  }
  async enabled() {
    return this.on;
  }
  async pausedForEveryone() {
    return this.paused;
  }
  async owedInScopeCents() {
    return this.owed;
  }
  async appliedOf(ref: string) {
    return this.applied.get(ref) ?? 0;
  }
  async txState() {
    return 'mined' as const;
  }
  async settlerCannotPay() {
    return null;
  }
  async submit(ref: string, _wallet: string, cents: number) {
    this.sends += 1;
    if (this.applied.has(ref)) {
      const error = Object.assign(new Error('reverted'), { name_: 'RevolvingIssuerAutoRepayAlreadyUsed' });
      throw error;
    }
    if (!this.on) throw Object.assign(new Error('reverted'), { name_: 'RevolvingIssuerAutoRepayNotEnabled' });
    this.owed -= this.repaidUnderUs;
    this.repaidUnderUs = 0;
    const applied = Math.min(cents, this.owed);
    if (applied === 0) throw Object.assign(new Error('reverted'), { name_: 'RevolvingIssuerNothingToClear' });
    this.owed -= applied;
    this.applied.set(ref, applied);
    const hash = `0x${String(this.sends).padStart(64, '0')}`;
    if (this.loseNextReceipt) {
      this.loseNextReceipt = false;
      return { hash, applied: Promise.reject(new Error('receipt wait timed out')) };
    }
    return { hash, applied: Promise.resolve(applied) };
  }
  async findClearingTx() {
    return null;
  }
  async book(_wallet: string, hash: string) {
    this.booked.push(hash);
  }
  errorName(error: unknown) {
    return (error as { name_?: string }).name_ ?? null;
  }
}

function setup(input: { depositCents: number; earmarkCents: number; owedCents: number }) {
  const lithic = new FakeLithic(input.depositCents);
  const chain = new FakeChain(input.owedCents);
  const alerts: string[] = [];
  const notices: string[] = [];
  const saved: AutoClearRun[] = [];
  const run: AutoClearRun = {
    ref: refFor('lithic_ach', 'ach-1'),
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
    chain,
    alert: async (a) => void alerts.push(a.subject),
    notify: async (n) => void notices.push(n.body),
    now: () => Date.now(),
  };
  return { lithic, chain, run, deps, alerts, notices, saved };
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

  test('the remainder stays spendable: less owed in scope than set aside', async () => {
    // $80 set aside from a $100 deposit, but only $30 is owed in the member's scope on chain.
    const { lithic, chain, run, deps, notices } = setup({ depositCents: 10_000, earmarkCents: 8_000, owedCents: 3_000 });
    const step = await advanceRun(run, deps);
    expect(step).toMatchObject({ action: 'repaid', cents: 3_000, releasedCents: 5_000 });
    expect(chain.applied.get(run.ref)).toBe(3_000);
    expect(lithic.moved()).toBe(3_000);
    // The $80 hold was replaced by one for $30 before anything was sent; $70 is the member's.
    expect(lithic.creates.voids).toBe(1);
    expect(lithic.available).toBe(7_000);
    expect(notices).toEqual(['$30.00 cleared · $50.00 now spendable']);
  });

  test('the transfer uses the applied amount, not the amount sent, when the chain applies less', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 5_000 });
    chain.repaidUnderUs = 2_000; // the member repaid $20 themselves between the read and the transaction
    const step = await advanceRun(run, deps);
    expect(step).toMatchObject({ action: 'repaid', cents: 3_000 });
    expect(lithic.moved()).toBe(3_000);
    expect(lithic.settled()[0].holdToken).toBeUndefined(); // the $50 hold was voided first
    expect(lithic.available).toBe(7_000);
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

  test('nothing owed for the whole wait: the hold is voided and the money is the member’s', async () => {
    const { lithic, chain, run, deps } = setup({ depositCents: 10_000, earmarkCents: 5_000, owedCents: 0 });
    expect((await advanceRun(run, deps)).action).toBe('waiting');
    expect(lithic.available).toBe(5_000);
    run.createdAt -= 73 * 60 * 60 * 1000;
    expect((await advanceRun(run, deps)).action).toBe('released');
    expect(chain.sends).toBe(0);
    expect(lithic.available).toBe(10_000);
    expect(lithic.transfers.size).toBe(0);
  });
});
