import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getLithic } from '../lithic/lithicClient.js';
import { lithicStore } from '../lithic/lithicStore.js';

/*
 * Auto-clear moves the money as well as the line (Phase 2b 12.2, the owner's 10f clarification:
 * Automatic Clearing "sweeps Spendable deposits at the bank").
 *
 * `repayForMember` pays the line on chain with the card settler's USDC. The dollars that pay for it
 * arrived in the member's Spendable account at the partner bank, so exactly what the chain applied
 * leaves that account for Clear's settlement account in a Lithic book transfer. Without that step
 * Clear pays the member's debt and the member keeps the deposit.
 *
 * One clearing per Spendable deposit, keyed by its ref: `refFor(rail, externalId)`, derived from the
 * deposit receipt's identity. The same ref is the on-chain idempotency key (`repayForMember` refuses
 * a ref twice: `autoRepayments[ref]`), and the Lithic hold and book transfer tokens are derived from
 * it, so a retry anywhere resolves to the same hold, the same chain application and the same
 * transfer, never a second one.
 *
 * Why the chain goes before the transfer. The amount that moves is what the contract APPLIED
 * (`AutoCleared.applied`, `autoRepaymentOf(ref)`, or `PlanPaid`), which is only known once the
 * transaction is mined. So:
 *
 *   1. Read on chain what this clearing will apply: A = min(what the deposit set aside, what is owed
 *      now -- within the member's scope for the line, on the plan for a term clearing).
 *   2. Hold exactly A (a Lithic hold moves it from available to pending). The rest of the deposit is
 *      never held: it is spendable at once.
 *   3. Send `repayForMember` / `payPlan` for A.
 *   4. Book-transfer exactly what was applied with `hold_token`, which settles that hold (Lithic:
 *      "Token of an existing hold to settle when this transfer is initiated").
 *
 * The money is never released between the chain and the transfer. The one exception: the chain
 * applied LESS than A (the member repaid in between). Lithic does not document settling part of a
 * hold, so that is not assumed: the hold is voided, the applied amount transferred without
 * `hold_token`, and ops are alerted. It is the only void-then-transfer, and it is rare.
 *
 * Lithic's tokens are UUIDs (its idempotency keys must be valid UUIDs): each is a UUIDv5 of the ref
 * and the step (`tokenFor`), sent as the object's `token` and as the `Idempotency-Key` header.
 *
 * THE STATE MACHINE (table `auto_clear_runs`, one row per ref):
 *
 *   earmarked ──hold placed──▶ held ──tx sent──▶ submitting ──applied read──▶ applied
 *       │                       │  ▲                  │                          │
 *       │                       │  └──reverted, or────┘                          │ book transfer
 *       │                       │     dropped (resend: same ref)                 ▼
 *       │                       │                               transferred ◀── or transfer_declined
 *       ▼                       ▼                                 (done)        (retry, alert ops)
 *    released ◀───────────── released
 *
 *   earmarked   A Spendable deposit with auto-clear ON set aside `earmark_cents` (what was owed, up
 *               to what the deposit left). Nothing is held yet. The hold is placed right after the
 *               deposit is recorded, and again by every sweep until it is: for A, read on chain
 *               first. With nothing owed on chain yet (a card purchase still pending), nothing is
 *               held; a plan already paid off releases at once.
 *   held        A Lithic hold reserves exactly A in the member's account, expiring a little after
 *               the 72-hour wait (`AUTO_CLEAR_MAX_HOLD_HOURS`) in case nothing voids it. Before
 *               sending, what is owed is read again: if it fell below A (nothing has been sent yet),
 *               the hold is voided and the clearing goes back to `earmarked` to hold the new A.
 *   submitting  Recorded BEFORE `repayForMember(ref, member, amount)` is sent, with the amount.
 *               After a crash the chain is asked (`autoRepaymentOf(ref)`); a transaction that
 *               reverted or was dropped goes back to `held` and is resent with the same ref, which
 *               the contract can apply at most once. (A term clearing reads its recorded
 *               transaction instead; see below.) A call refused in simulation, before any hash,
 *               sent nothing and goes back to `held`.
 *   applied     The chain applied X. The books are written from the transaction. X is transferred
 *               from the member's account to Clear's settlement account with `hold_token`, settling
 *               the hold. Only if X < A: the hold is voided first, X transferred without it, and ops
 *               alerted (Lithic does not document partial settlement).
 *   transferred The money and the line agree. Done.
 *   transfer_declined  Lithic refused the transfer (the chain has applied, so Clear is owed X). Ops
 *               are alerted at once. Each later pass checks the last transfer token first, then tries
 *               once with the next token, up to MAX_TRANSFER_ATTEMPTS; after that it waits for a
 *               person. A new token is only used once the previous one is known to be declined, so
 *               nothing can move twice.
 *   released    Nothing will be cleared from this deposit: auto-clear was turned off, the hold was
 *               declined after the wait, or nothing in scope became owed within the wait. Any hold is
 *               voided, and the money is simply the member's.
 *
 * A failure inside a step (a timeout, an RPC error) leaves the row in its state and the next pass
 * resumes there: every step first looks for what it would create (`findHold`, `findTransfer`,
 * `appliedOf`) before creating it.
 *
 * Only Spendable bank deposits reach this: the deposit service creates a run only for the Lithic
 * rail with auto-clear ON. Ready to allocate USDC and CLRUSD are never touched: the chain takes the
 * settler's USDC, and the transfer moves only fiat out of the Spendable account.
 *
 * TWO KINDS OF CLEARING, one machine. What differs is only the chain side (`ChainSide`, chosen per
 * run by `deps.chainFor`):
 *
 *   line  The revolving line: `RevolvingIssuer.repayForMember(ref, ...)`. The ref is the on-chain
 *         idempotency key, so a transaction that may not have landed is simply resent with it.
 *   term  A term plan's arrears (`TermIssuer.payPlan(planId, ...)`) or carry owed on nothing
 *         (`StableCredit.repayCreditBalance`), paid from the same deposit before the line, as part
 *         of auto-clear (the deposit pays them only with auto-clear ON). Keyed by a ref from the
 *         deposit receipt and the plan id. `payPlan` has no idempotency key on chain, so its side
 *         never resends blind: what it applied is read from the recorded transaction's own events,
 *         and a send with no recorded hash, or a hash that never lands, goes to `needs_review`
 *         with the money still held. The deposit already booked the payment, so whatever the chain
 *         did not take (or all of it, on release) is booked back to the member's cash (`unbook`).
 *
 *   needs_review  The chain's outcome cannot be known without a person (term clearings only). The
 *               hold stays; ops are alerted.
 */

export type AutoClearState =
  | 'earmarked'
  | 'held'
  | 'submitting'
  | 'applied'
  | 'transferred'
  | 'transfer_declined'
  | 'needs_review'
  | 'released';

export type AutoClearKind = 'line' | 'term';

export const OPEN_STATES: readonly AutoClearState[] = ['earmarked', 'held', 'submitting', 'applied', 'transfer_declined'];
/** Before the chain has applied anything: what auto-save and the member see as set aside. */
export const PENDING_STATES: readonly AutoClearState[] = ['earmarked', 'held', 'submitting'];

export interface AutoClearRun {
  ref: string;
  /** `line`: the revolving line (`repayForMember`). `term`: a term plan's arrears, or carry. */
  kind: AutoClearKind;
  /** The term plan paid; null for the line, and for carry owed on no plan. */
  planId: number | null;
  wallet: string;
  rail: string;
  externalId: string;
  earmarkCents: number;
  state: AutoClearState;
  holdToken: string | null;
  holdSeq: number;
  holdCents: number;
  holdVoided: boolean;
  submittedCents: number;
  txHash: string | null;
  submittedAt: number | null;
  appliedCents: number;
  booked: boolean;
  transferToken: string | null;
  transferAttempt: number;
  transferStatus: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: number;
}

/** The clearing's ref: on chain as `repayForMember`'s ref, and the root of every Lithic token. */
export function refFor(rail: string, externalId: string): string {
  return ethers.id(`clear.auto-clear:${rail}:${externalId}`);
}

/** A term clearing's ref: the deposit receipt and the plan (or carry), never the line's. */
export function termRefFor(rail: string, externalId: string, planId: number | null): string {
  return refFor(rail, `${externalId}#term:${planId === null ? 'carry' : `plan:${planId}`}`);
}

/** RFC 4122 UUIDv5: SHA-1 of the namespace and the name, version 5, RFC variant. */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Clear's namespace for auto-clear's Lithic tokens: the UUIDv5 of its name in the URL namespace. */
export const AUTO_CLEAR_NAMESPACE = uuidV5('https://useclear.org/auto-clear', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');

/**
 * A Lithic token derived from the ref, so the same step always carries the same token: a valid UUID
 * (Lithic's idempotency keys must be), sent as the object's `token` and its `Idempotency-Key`.
 */
export function tokenFor(ref: string, purpose: string): string {
  return uuidV5(`${ref}:${purpose}`, AUTO_CLEAR_NAMESPACE);
}

/** After this many tries, a declined transfer waits for a person (each try is alerted). */
export const MAX_TRANSFER_ATTEMPTS = 5;
/** A sent transaction with no receipt after this long is treated as dropped and resent (same ref). */
export const SUBMIT_STALE_MS = 30 * 60 * 1000;

/** How long a member's money may stay held while the chain has nothing to clear yet. */
export function maxHoldMs(): number {
  const hours = Number(process.env.AUTO_CLEAR_MAX_HOLD_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 72) * 60 * 60 * 1000;
}

/* ---- what the state machine depends on, so each side can be stood in for in tests ---- */

export interface RunStore {
  save(run: AutoClearRun): Promise<void>;
}

export type LithicTxStatus = 'PENDING' | 'SETTLED' | 'DECLINED' | 'REVERSED' | 'CANCELED' | 'RETURNED' | 'EXPIRED' | 'VOIDED' | string;

/** The Lithic side: a hold on the member's Spendable account and a book transfer out of it. */
export interface SpendableMoves {
  /** Clear's settlement financial account, or null when it is not configured. */
  settlementAccount(): string | null;
  cashAccountOf(wallet: string): Promise<string | null>;
  findHold(token: string): Promise<{ status: LithicTxStatus; result?: string } | null>;
  createHold(
    account: string,
    input: { token: string; amountCents: number; ref: string; expiresAt: string },
  ): Promise<{ status: LithicTxStatus; result?: string }>;
  voidHold(token: string): Promise<void>;
  findTransfer(token: string): Promise<{ status: LithicTxStatus } | null>;
  createTransfer(input: {
    token: string;
    amountCents: number;
    from: string;
    to: string;
    holdToken?: string;
    ref: string;
  }): Promise<{ status: LithicTxStatus }>;
}

/**
 * The chain side of a clearing, paid by the card settler: `repayForMember` for the line, `payPlan`
 * (or `repayCreditBalance` for carry) for a term clearing.
 */
export interface ChainSide {
  /** The member's auto-clear switch (`RevolvingIssuer.autoRepayEnabled`): it governs both kinds. */
  enabled(wallet: string): Promise<boolean>;
  pausedForEveryone(): Promise<boolean>;
  /** What this clearing could pay now, in whole cents, rounded down. */
  owedCents(run: AutoClearRun): Promise<number>;
  /**
   * With nothing owed yet: keep the hold and wait (true: a card purchase still pending becomes
   * debt), or release now (false: a plan's arrears were already due when the deposit arrived).
   */
  waitsForDebt(run: AutoClearRun): boolean;
  /**
   * What the chain applied for this clearing, in whole cents: 0 when nothing (safe to send again),
   * 'pending' while a sent transaction has no receipt yet, null when only a person can tell.
   */
  appliedOf(run: AutoClearRun): Promise<number | 'pending' | null>;
  /** Null when the settler can pay `cents`; otherwise why not (ops are told by the caller). */
  settlerCannotPay(run: AutoClearRun, cents: number): Promise<string | null>;
  /** Sends the transaction; `applied` resolves once it is mined, from the transaction's events. */
  submit(run: AutoClearRun, cents: number): Promise<{ hash: string; applied: Promise<number> }>;
  /** The transaction that applied this clearing, when its hash was lost (the line's `AutoCleared`). */
  findClearingTx(run: AutoClearRun): Promise<string | null>;
  /** The books, from the transaction's own events. Idempotent by hash. */
  book(run: AutoClearRun): Promise<void>;
  /** The custom error's name, or null. */
  errorName(error: unknown): string | null;
}

export interface AutoClearDeps {
  store: RunStore;
  moves: SpendableMoves;
  chainFor(run: AutoClearRun): ChainSide;
  /**
   * Books back to the member's cash whatever the deposit booked for this clearing and the chain did
   * not take (`earmarkCents - appliedCents`), once per ref. Nothing for the line, whose deposit
   * booked nothing.
   */
  unbook(run: AutoClearRun): Promise<void>;
  alert(input: { key: string; subject: string; body: string }): Promise<void>;
  notify(input: { wallet: string; title: string; body: string; data: Record<string, unknown>; dedupeKey: string }): Promise<void>;
  now(): number;
}

export interface AutoClearStep {
  wallet: string;
  ref: string;
  action: 'repaid' | 'held' | 'waiting' | 'off' | 'paused' | 'released' | 'failed' | 'needs_review';
  cents?: number;
  /** What was left of the earmark once the chain had what it needed: the member's to spend. */
  releasedCents?: number;
  txHash?: string;
  reason?: string;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const MOVED: ReadonlySet<string> = new Set(['PENDING', 'SETTLED']);

/** A hold outlives the release by an hour, so ours voids it; Lithic expires it if we never do. */
export function holdExpiry(run: Pick<AutoClearRun, 'createdAt'>): string {
  return new Date(run.createdAt + maxHoldMs() + 60 * 60 * 1000).toISOString();
}

async function ensureHold(
  run: AutoClearRun,
  deps: Pick<AutoClearDeps, 'moves'>,
  account: string,
  cents: number,
): Promise<{ token: string; held: boolean }> {
  const token = tokenFor(run.ref, `hold:${run.holdSeq}`);
  const hold =
    (await deps.moves.findHold(token)) ??
    (await deps.moves.createHold(account, { token, amountCents: cents, ref: run.ref, expiresAt: holdExpiry(run) }));
  return { token, held: hold.status === 'PENDING' && hold.result !== 'DECLINED' };
}

async function voidIfHeld(run: AutoClearRun, deps: AutoClearDeps): Promise<void> {
  if (!run.holdToken || run.holdVoided) return;
  const hold = await deps.moves.findHold(run.holdToken);
  if (hold?.status === 'PENDING') await deps.moves.voidHold(run.holdToken);
  run.holdVoided = true;
  await deps.store.save(run);
}

async function release(
  run: AutoClearRun,
  deps: Pick<AutoClearDeps, 'store' | 'moves' | 'unbook'>,
  reason: string,
): Promise<AutoClearStep> {
  await voidIfHeld(run, deps as AutoClearDeps);
  run.appliedCents = 0;
  await deps.unbook(run);
  run.state = 'released';
  run.lastError = reason;
  await deps.store.save(run);
  return { wallet: run.wallet, ref: run.ref, action: 'released', reason };
}

/**
 * earmarked → held: read on chain what this clearing will apply, and hold exactly that. Also run on
 * its own right after the deposit is recorded, so the money is out of the card's reach at once.
 */
export async function placeHold(run: AutoClearRun, deps: AutoClearDeps): Promise<AutoClearStep> {
  if (run.state !== 'earmarked') return { wallet: run.wallet, ref: run.ref, action: 'waiting', reason: run.state };
  if (deps.now() - run.createdAt > maxHoldMs()) return release(run, deps, 'nothing was held within the wait');
  const chain = deps.chainFor(run);
  if (!(await chain.enabled(run.wallet))) return release(run, deps, 'auto-clear is off');
  const settlement = deps.moves.settlementAccount();
  const account = await deps.moves.cashAccountOf(run.wallet);
  if (!settlement || !account) {
    await deps
      .alert({
        key: 'auto-clear:not-configured',
        subject: 'Auto-clear is waiting: Lithic settlement is not configured',
        body: `Auto-clear cannot move a member's Spendable dollars without Clear's settlement account (LITHIC_AUTO_CLEAR_SETTLEMENT_ACCOUNT_TOKEN), the book transfer subtype Lithic set up for the program (LITHIC_AUTO_CLEAR_TRANSFER_SUBTYPE), and the member's Lithic cash account. Nothing is held, cleared or moved until all three exist (${settlement ? 'member account missing' : 'settlement account or subtype missing'}).`,
      })
      .catch(() => {});
    return { wallet: run.wallet, ref: run.ref, action: 'waiting', reason: 'no settlement account' };
  }
  if (await chain.pausedForEveryone()) return { wallet: run.wallet, ref: run.ref, action: 'paused', reason: 'switched off network-wide' };

  // A: what the chain will apply now. Only that is held; the rest of the deposit stays spendable.
  const owed = await chain.owedCents(run);
  const amount = Math.min(run.earmarkCents, Math.max(0, Math.floor(owed)));
  if (amount <= 0) {
    // The line: a card purchase still pending is a hold at Lithic, not debt on chain, so wait for
    // it, holding nothing. A plan's arrears paid off in between: nothing to wait for.
    if (chain.waitsForDebt(run)) return { wallet: run.wallet, ref: run.ref, action: 'waiting', reason: 'nothing in scope owed on chain yet' };
    return release(run, deps, 'nothing left to pay');
  }
  const { token, held } = await ensureHold(run, deps, account, amount);
  if (!held) {
    // Most often the member already spent it. Nothing is held; the next pass tries a fresh hold.
    run.holdSeq += 1;
    await deps.store.save(run);
    return { wallet: run.wallet, ref: run.ref, action: 'waiting', reason: 'hold declined' };
  }
  run.state = 'held';
  run.holdToken = token;
  run.holdCents = amount;
  run.holdVoided = false;
  await deps.store.save(run);
  return { wallet: run.wallet, ref: run.ref, action: 'held', cents: amount };
}

/** Advance one clearing as far as it can go now. See the state machine above. */
export async function advanceRun(run: AutoClearRun, deps: AutoClearDeps): Promise<AutoClearStep> {
  try {
    for (let i = 0; i < 8; i++) {
      const step = await advanceOnce(run, deps);
      if (step) return step;
    }
    return { wallet: run.wallet, ref: run.ref, action: 'waiting', reason: run.state };
  } catch (error) {
    run.attempts += 1;
    run.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await deps.store.save(run).catch(() => {});
    if (run.state === 'applied' || run.state === 'submitting') {
      await deps
        .alert({
          key: `auto-clear:stuck:${run.ref}:${run.state}`,
          subject: `Auto-clear: a clearing is retrying in "${run.state}"`,
          body: `Clearing ${run.ref} for ${run.wallet} failed in "${run.state}" (${run.lastError}). It retries with the same ref and tokens, so nothing moves twice. ${run.state === 'applied' ? `The chain has applied ${run.appliedCents}c; the transfer out of Spendable has not been confirmed.` : ''}`,
        })
        .catch(() => {});
    }
    return { wallet: run.wallet, ref: run.ref, action: 'failed', reason: run.lastError ?? undefined };
  }
}

/** One transition. Returns a result to stop, or null to go on to the next state. */
async function advanceOnce(run: AutoClearRun, deps: AutoClearDeps): Promise<AutoClearStep | null> {
  const { moves, store } = deps;
  const chain = deps.chainFor(run);
  const wait = (reason: string, action: AutoClearStep['action'] = 'waiting'): AutoClearStep => ({
    wallet: run.wallet,
    ref: run.ref,
    action,
    reason,
  });

  switch (run.state) {
    case 'earmarked': {
      const step = await placeHold(run, deps);
      return step.action === 'held' ? null : step;
    }

    case 'held': {
      if (deps.now() - run.createdAt > maxHoldMs()) return release(run, deps, 'nothing in scope became owed within the wait');
      if (!(await chain.enabled(run.wallet))) {
        const step = await release(run, deps, 'auto-clear is off');
        return { ...step, action: 'off' };
      }
      // The hold may have expired or been voided under us (or by a crash mid-resize): hold again.
      const hold = run.holdToken ? await moves.findHold(run.holdToken) : null;
      if (!run.holdToken || run.holdVoided || hold?.status !== 'PENDING') {
        run.state = 'earmarked';
        run.holdSeq += 1;
        run.holdToken = null;
        run.holdVoided = false;
        await store.save(run);
        return null;
      }
      if (await chain.pausedForEveryone()) return wait('switched off network-wide', 'paused');

      // Owed again, just before sending: if it fell below what is held (nothing has been sent yet),
      // the hold is voided and the clearing holds the new amount from `earmarked`.
      const owed = Math.max(0, Math.floor(await chain.owedCents(run)));
      if (owed < run.holdCents) {
        await voidIfHeld(run, deps);
        run.state = 'earmarked';
        run.holdSeq += 1;
        run.holdToken = null;
        run.holdVoided = false;
        run.holdCents = 0;
        await store.save(run);
        return null;
      }
      const amount = run.holdCents;

      const cannot = await chain.settlerCannotPay(run, amount);
      if (cannot) {
        await deps
          .alert({
            key: 'auto-clear:settler-balance',
            subject: 'Auto-clear: the card settler cannot pay',
            body: `${cannot}. Auto-clear pays the line with the settler's USDC (repayForMember pulls from msg.sender) and then moves the member's dollars to the settlement account. Members' deposits stay held meanwhile.`,
          })
          .catch(() => {});
        return wait(cannot, 'failed');
      }

      // Recorded before sending, so a crash after the send is resolved by asking the chain.
      run.state = 'submitting';
      run.submittedCents = amount;
      run.submittedAt = deps.now();
      run.txHash = null;
      await store.save(run);
      try {
        const sent = await chain.submit(run, amount);
        run.txHash = sent.hash;
        await store.save(run);
        const applied = await sent.applied;
        if (applied <= 0) return null; // `submitting` asks the chain what happened
        run.appliedCents = applied;
        run.state = 'applied';
        await store.save(run);
        return null;
      } catch (error) {
        const name = chain.errorName(error);
        if (name === 'RevolvingIssuerAutoRepayAlreadyUsed') return null; // `submitting` reads it
        if (name === 'RevolvingIssuerNothingToClear' || name === 'RevolvingIssuerAutoClearOff' || name === 'RevolvingIssuerAutoRepayNotEnabled') {
          // Reverted: nothing applied. Back to held; the next look decides (off releases it).
          run.state = 'held';
          await store.save(run);
          if (name === 'RevolvingIssuerAutoRepayNotEnabled') return null;
          return wait(name === 'RevolvingIssuerAutoClearOff' ? 'switched off network-wide' : 'nothing in scope owed on chain', name === 'RevolvingIssuerAutoClearOff' ? 'paused' : 'waiting');
        }
        if (name && !run.txHash) {
          // Refused in simulation, before anything was broadcast: nothing was sent. Back to held;
          // it is tried again until the hold's wait runs out.
          run.state = 'held';
          run.lastError = `refused on chain: ${name}`;
          await store.save(run);
          return wait(run.lastError, 'failed');
        }
        throw error; // outcome unknown: stays `submitting`, resolved next pass
      }
    }

    case 'submitting': {
      const applied = await chain.appliedOf(run);
      if (applied === 'pending') return wait('transaction pending');
      if (applied === null) {
        // Only a person can tell whether this landed. The money stays held meanwhile.
        run.state = 'needs_review';
        await store.save(run);
        await deps
          .alert({
            key: `auto-clear:review:${run.ref}`,
            subject: 'Auto-clear: a clearing needs a person',
            body: `Clearing ${run.ref} (${run.kind}${run.planId !== null ? `, plan ${run.planId}` : ''}) for ${run.wallet}: the chain's outcome cannot be read (tx ${run.txHash ?? 'not recorded'}), and it has no on-chain key to resend safely. ${run.holdCents}c stay held in the member's Spendable account until it is resolved.`,
          })
          .catch(() => {});
        return wait('the chain outcome is unknown', 'needs_review');
      }
      if (applied > 0) {
        if (!run.txHash) run.txHash = await chain.findClearingTx(run);
        run.appliedCents = applied;
        run.state = 'applied';
        await store.save(run);
        return null;
      }
      // Reverted, dropped or never sent: nothing was applied. Back to held, which sends again (the
      // line with the same ref) or releases if nothing is owed any more.
      run.state = 'held';
      await store.save(run);
      return null;
    }

    case 'applied': {
      if (!run.booked) {
        if (run.txHash) {
          await chain.book(run);
          // What the deposit booked and the chain did not take is the member's again.
          await deps.unbook(run);
          run.booked = true;
          await store.save(run);
        } else {
          await deps
            .alert({
              key: `auto-clear:unbooked:${run.ref}`,
              subject: 'Auto-clear: a clearing applied on chain without a transaction to book from',
              body: `Ref ${run.ref} for ${run.wallet} applied ${run.appliedCents}c on chain but its transaction was not found. The money still moves; book the repayment by hand.`,
            })
            .catch(() => {});
        }
      }
      const settlement = moves.settlementAccount();
      const account = await moves.cashAccountOf(run.wallet);
      if (!settlement || !account) throw new Error('settlement or member account not configured');
      if (run.appliedCents > run.holdCents) {
        await deps
          .alert({
            key: `auto-clear:over-hold:${run.ref}`,
            subject: 'Auto-clear: the chain applied more than was held',
            body: `Ref ${run.ref} for ${run.wallet}: applied ${run.appliedCents}c, held ${run.holdCents}c. The applied amount is transferred.`,
          })
          .catch(() => {});
      }

      // Settle the hold with the transfer: it holds exactly what was sent, which is what the chain
      // applies. The exception -- applied less than held -- voids it first (below) and tells ops.
      let useHold = !run.holdVoided && run.holdToken !== null && run.appliedCents === run.holdCents;
      if (!useHold && !run.holdVoided && run.appliedCents < run.holdCents) {
        await deps
          .alert({
            key: `auto-clear:under-hold:${run.ref}`,
            subject: 'Auto-clear: the chain applied less than was held',
            body: `Ref ${run.ref} (${run.kind}) for ${run.wallet}: held ${run.holdCents}c, applied ${run.appliedCents}c (repaid in between?). Lithic does not document settling part of a hold, so the hold is voided and ${run.appliedCents}c transferred without it. Check the transfer landed.`,
          })
          .catch(() => {});
      }
      if (useHold) {
        const hold = await moves.findHold(run.holdToken!);
        if (hold?.status !== 'PENDING') {
          run.holdVoided = true;
          useHold = false;
        }
      }
      if (!useHold) await voidIfHeld(run, deps);

      const token = tokenFor(run.ref, `transfer:${run.transferAttempt}`);
      run.transferToken = token;
      await store.save(run);
      const transfer =
        (await moves.findTransfer(token)) ??
        (await moves.createTransfer({
          token,
          amountCents: run.appliedCents,
          from: account,
          to: settlement,
          ...(useHold ? { holdToken: run.holdToken! } : {}),
          ref: run.ref,
        }));
      run.transferStatus = transfer.status;
      if (MOVED.has(transfer.status)) {
        if (useHold) run.holdVoided = true; // settled by the transfer
        run.state = 'transferred';
        await store.save(run);
        const releasedCents = Math.max(0, run.earmarkCents - run.appliedCents);
        await deps
          .notify({
            wallet: run.wallet,
            title: run.kind === 'term' ? 'Paid on your plan from your deposit' : 'Cleared from your deposit',
            body:
              run.kind === 'term'
                ? `${money(run.appliedCents)} paid${releasedCents > 0 ? ` · ${money(releasedCents)} now spendable` : ''}`
                : releasedCents > 0
                  ? `${money(run.appliedCents)} cleared · ${money(releasedCents)} now spendable`
                  : `${money(run.appliedCents)} cleared`,
            data: { txHash: run.txHash, appliedCents: run.appliedCents, spendableCents: releasedCents, ref: run.ref },
            dedupeKey: `auto-clear:${run.ref}`,
          })
          .catch(() => {});
        return {
          wallet: run.wallet,
          ref: run.ref,
          action: 'repaid',
          cents: run.appliedCents,
          releasedCents,
          txHash: run.txHash ?? undefined,
        };
      }
      run.state = 'transfer_declined';
      await store.save(run);
      await deps
        .alert({
          key: `auto-clear:declined:${run.ref}:${run.transferAttempt}`,
          subject: 'Auto-clear: the transfer out of Spendable was declined',
          body: `Ref ${run.ref} for ${run.wallet}: the chain applied ${run.appliedCents}c (tx ${run.txHash ?? 'unknown'}), and Lithic answered ${transfer.status} to book transfer ${token}. Clear is owed ${run.appliedCents}c. It is retried with a new token only once this one is confirmed declined (attempt ${run.transferAttempt + 1} of ${MAX_TRANSFER_ATTEMPTS}).`,
        })
        .catch(() => {});
      return wait(`transfer ${transfer.status}`, 'failed');
    }

    case 'transfer_declined': {
      // The last token first: if it went through after all, it is done and nothing is sent again.
      const last = run.transferToken ? await moves.findTransfer(run.transferToken) : null;
      if (last && MOVED.has(last.status)) {
        run.state = 'applied';
        await store.save(run);
        return null; // `applied` finds the same token and completes
      }
      if (run.transferAttempt + 1 >= MAX_TRANSFER_ATTEMPTS) return wait('transfer declined; needs a person', 'failed');
      run.transferAttempt += 1;
      run.state = 'applied';
      await store.save(run);
      return null;
    }

    case 'transferred':
    case 'released':
    case 'needs_review':
      return wait(run.state);
  }
}

/* ---- Postgres and Lithic ---- */

export async function ensureAutoClearRuns(client: { query: PoolClient['query'] }): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS auto_clear_runs (
      ref TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'line',
      plan_id BIGINT,
      wallet TEXT NOT NULL,
      rail TEXT NOT NULL,
      external_id TEXT NOT NULL,
      earmark_cents BIGINT NOT NULL,
      state TEXT NOT NULL DEFAULT 'earmarked',
      hold_token TEXT,
      hold_seq INT NOT NULL DEFAULT 0,
      hold_cents BIGINT NOT NULL DEFAULT 0,
      hold_voided BOOLEAN NOT NULL DEFAULT false,
      submitted_cents BIGINT NOT NULL DEFAULT 0,
      tx_hash TEXT,
      submitted_at TIMESTAMPTZ,
      applied_cents BIGINT NOT NULL DEFAULT 0,
      booked BOOLEAN NOT NULL DEFAULT false,
      transfer_token TEXT,
      transfer_attempt INT NOT NULL DEFAULT 0,
      transfer_status TEXT,
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS auto_clear_runs_open_idx ON auto_clear_runs (state, updated_at);
    CREATE INDEX IF NOT EXISTS auto_clear_runs_wallet_idx ON auto_clear_runs (wallet);
  `);
}

interface RunRow {
  ref: string;
  kind: AutoClearKind;
  plan_id: string | null;
  wallet: string;
  rail: string;
  external_id: string;
  earmark_cents: string;
  state: AutoClearState;
  hold_token: string | null;
  hold_seq: number;
  hold_cents: string;
  hold_voided: boolean;
  submitted_cents: string;
  tx_hash: string | null;
  submitted_at: Date | null;
  applied_cents: string;
  booked: boolean;
  transfer_token: string | null;
  transfer_attempt: number;
  transfer_status: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
}

function fromRow(r: RunRow): AutoClearRun {
  return {
    ref: r.ref,
    kind: r.kind,
    planId: r.plan_id === null ? null : Number(r.plan_id),
    wallet: r.wallet,
    rail: r.rail,
    externalId: r.external_id,
    earmarkCents: Number(r.earmark_cents),
    state: r.state,
    holdToken: r.hold_token,
    holdSeq: r.hold_seq,
    holdCents: Number(r.hold_cents),
    holdVoided: r.hold_voided,
    submittedCents: Number(r.submitted_cents),
    txHash: r.tx_hash,
    submittedAt: r.submitted_at ? new Date(r.submitted_at).getTime() : null,
    appliedCents: Number(r.applied_cents),
    booked: r.booked,
    transferToken: r.transfer_token,
    transferAttempt: r.transfer_attempt,
    transferStatus: r.transfer_status,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export const pgRunStore = {
  async get(ref: string): Promise<AutoClearRun | null> {
    const pool = getPayPool();
    if (!pool) return null;
    await ensureAutoClearRuns(pool);
    const { rows } = await pool.query<RunRow>(`SELECT * FROM auto_clear_runs WHERE ref = $1`, [ref]);
    return rows[0] ? fromRow(rows[0]) : null;
  },
  async listOpen(limit: number): Promise<AutoClearRun[]> {
    const pool = getPayPool();
    if (!pool) return [];
    await ensureAutoClearRuns(pool);
    const { rows } = await pool.query<RunRow>(
      `SELECT * FROM auto_clear_runs WHERE state = ANY($1::text[]) ORDER BY updated_at LIMIT $2`,
      [OPEN_STATES, limit],
    );
    return rows.map(fromRow);
  },
  async save(run: AutoClearRun): Promise<void> {
    const pool = getPayPool();
    if (!pool) throw new Error('no Pay database');
    await pool.query(
      `UPDATE auto_clear_runs SET state = $2, hold_token = $3, hold_seq = $4, hold_cents = $5, hold_voided = $6,
         submitted_cents = $7, tx_hash = $8, submitted_at = $9, applied_cents = $10, booked = $11,
         transfer_token = $12, transfer_attempt = $13, transfer_status = $14, attempts = $15, last_error = $16,
         updated_at = now()
       WHERE ref = $1`,
      [
        run.ref,
        run.state,
        run.holdToken,
        run.holdSeq,
        run.holdCents,
        run.holdVoided,
        run.submittedCents,
        run.txHash,
        run.submittedAt === null ? null : new Date(run.submittedAt),
        run.appliedCents,
        run.booked,
        run.transferToken,
        run.transferAttempt,
        run.transferStatus,
        run.attempts,
        run.lastError,
      ],
    );
  },
};

function notFound(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 404;
}

/**
 * The book transfer's classification. Types and subtypes are set up for the program with Lithic's
 * implementation specialist and typically need the sponsor bank's approval, so they are
 * configuration.
 */
function transferClass() {
  return {
    // Lithic's "Balance or Funding / Collection": moving funds from a cash-funded account to collect
    // on credit. The subtype is the program's own, issued by Lithic; there is no default to guess.
    category: (process.env.LITHIC_AUTO_CLEAR_TRANSFER_CATEGORY || 'BALANCE_OR_FUNDING').trim(),
    type: (process.env.LITHIC_AUTO_CLEAR_TRANSFER_TYPE || 'COLLECTION').trim(),
    subtype: (process.env.LITHIC_AUTO_CLEAR_TRANSFER_SUBTYPE || '').trim(),
  };
}

/** The Lithic side, with the shared client. Inert (null accounts) until Lithic is configured. */
export const lithicMoves: SpendableMoves = {
  settlementAccount() {
    // Without the program's subtype no transfer can be made, so nothing is held either.
    if (!transferClass().subtype) return null;
    return (process.env.LITHIC_AUTO_CLEAR_SETTLEMENT_ACCOUNT_TOKEN || '').trim() || null;
  },
  async cashAccountOf(wallet) {
    if (!getLithic()) return null;
    return (await lithicStore.get(wallet))?.cashFinancialAccountToken ?? null;
  },
  async findHold(token) {
    const lithic = getLithic();
    if (!lithic) return null;
    try {
      const hold = await lithic.holds.retrieve(token);
      return { status: hold.status, result: hold.result };
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  },
  async createHold(account, input) {
    const lithic = getLithic();
    if (!lithic) throw new Error('Lithic is not configured');
    const hold = await lithic.holds.create(
      account,
      {
        token: input.token,
        amount: Math.round(input.amountCents),
        memo: 'Automatic clearing',
        user_defined_id: input.ref,
        expiration_datetime: input.expiresAt,
      },
      { idempotencyKey: input.token },
    );
    return { status: hold.status, result: hold.result };
  },
  async voidHold(token) {
    const lithic = getLithic();
    if (!lithic) throw new Error('Lithic is not configured');
    await lithic.holds.void(token, { memo: 'Automatic clearing: released' });
  },
  async findTransfer(token) {
    const lithic = getLithic();
    if (!lithic) return null;
    try {
      const transfer = await lithic.bookTransfers.retrieve(token);
      return { status: transfer.status };
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  },
  async createTransfer(input) {
    const lithic = getLithic();
    if (!lithic) throw new Error('Lithic is not configured');
    const transfer = await lithic.bookTransfers.create({
      ...transferClass(),
      token: input.token,
      amount: Math.round(input.amountCents),
      from_financial_account_token: input.from,
      to_financial_account_token: input.to,
      ...(input.holdToken ? { hold_token: input.holdToken } : {}),
      memo: 'Automatic clearing',
      external_id: input.ref,
      on_closed_account: 'FAIL',
    } as Parameters<typeof lithic.bookTransfers.create>[0], { idempotencyKey: input.token });
    return { status: transfer.status };
  },
};

/**
 * Books back what a term clearing's deposit booked and the chain did not take: the payment's legs
 * reversed, to the member's cash. Once per ref. The line's deposit books nothing, so nothing to do.
 */
export async function pgUnbook(run: AutoClearRun): Promise<void> {
  if (run.kind !== 'term') return;
  const cents = Math.max(0, run.earmarkCents - run.appliedCents);
  if (cents <= 0) return;
  const pool = getPayPool();
  if (!pool) throw new Error('no Pay database');
  const key = `term-return:${run.ref}`;
  const done = await pool.query(`SELECT 1 FROM lithic_ledger_entries WHERE external_id = $1 LIMIT 1`, [key]);
  if (done.rowCount) return;
  const account = run.planId === null ? 'member_term_carry' : 'member_term_plan';
  await pool.query(
    `INSERT INTO lithic_ledger_entries (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
     VALUES ($1, $2, $3, 'debit', $4, 'fiat', 'term_settlement_return', $1, $5::jsonb),
            ($1, $2, 'member_cash_fiat', 'credit', $4, 'fiat', 'term_settlement_return', $1, $5::jsonb)`,
    [key, run.wallet, account, cents, JSON.stringify({ planId: run.planId, ref: run.ref })],
  );
}
