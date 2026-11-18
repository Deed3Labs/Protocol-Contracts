import { ethers } from 'ethers';
import { getPostgresPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { chainErrorReason, decodeChainError } from './chainErrors.js';
import { alertOps } from '../opsAlert.js';
import { keeperChainId, keeperKey, keeperMode, withKeeperSendLock } from './keeperKit.js';

/*
 * Enforcement after an Earn shortfall (Phase 2b, 12.6 and 12.8, as Phase 2f left it), and the
 * Liquidation Hold that pauses it.
 *
 * A missed cycle takes no collateral at all (decision 4, MB-05 §6.1), so there is no excess to
 * settle any more: `settleExcess`, `settleShortfall`, `liquidateShares`, `settleRealized` and
 * `earnGapOf` are gone from the Liquidator (Phase 2f enforcement, section 8). What is left for a
 * keeper here is the notice:
 *   - `noticeShortfall(member)`: records that the member's Asset-Backed Drawn is above their
 *     Asset-Backed Limit (`shortfallOf(member)` -> gap, dueAt). Moves nothing; starts the governed
 *     wait (72 hours or more). With the gap closed, the same call clears a notice.
 * Once the wait has passed (`dueAt`), the shortfall is settled from Pledged Pool Shares through the
 * queue (`PoolShareEnforcer.enforce`) and then Pledged BurnerBonds (`payPledged`), decision 21. The
 * pledge keepers do that (services/chain/pledgeEnforcement, decision 53), each behind its own switch;
 * a due shortfall is still alerted to ops once a day, saying whether they are on.
 * `noticeShortfall` reverts `LiquidatorOnHold` while a Liquidation Hold is active, so the keeper reads
 * the hold first and leaves a held member alone.
 *
 * The keeper is bounded per run, never runs twice at once, and is idempotent: a notice is sent only
 * when none is open and the gap stands, a clearing only when a notice is open and the gap closed.
 *
 * Holds are two-person `HOLD_ROLE` actions taken from each signer's own wallet; `prepareHoldCall`
 * only encodes the call. No key for them is held here.
 */

export const LIQUIDATOR_ABI = [
  'function holdOf(address member) view returns ((address proposer, uint8 reason, bool confirmed, uint64 setAt, address lastSigner, uint64 until, address clearProposer) hold, bool active)',
  'function holdEvidence(address member) view returns (bytes32)',
  'function maxHoldOf(uint8 reason) view returns (uint64)',
  'function shortfallWait() view returns (uint64)',
  'function shortfallOf(address member) view returns (uint256 gap, uint256 dueAt)',
  'function earnDefaultedOf(address member) view returns (uint256 due, address issuer)',
  'function nextBondOf(address member) view returns (bool found, uint256 bondId)',
  'function noticeShortfall(address member) returns (uint256 gap)',
  'function proposeHold(address member, uint8 reason, uint64 duration, bytes32 evidenceHash)',
  'function confirmHold(address member)',
  'function renewHold(address member, uint64 until)',
  'function clearHold(address member)',
];
const ISSUER_ABI = ['function unsecuredExcessOf(address member) view returns (uint256)'];

/** `Liquidator.HoldReason`. */
export const HOLD_REASONS = ['NONE', 'BANKRUPTCY', 'DEATH', 'BILLING_DISPUTE', 'LATE_NOTICE'] as const;
export type HoldReasonName = (typeof HOLD_REASONS)[number];

export const DEFAULT_ENFORCEMENT_MAX_PER_RUN = 25;
/** A member just settled is not tried again for this long: a queued pool withdrawal pays later. */
export const SETTLE_COOLDOWN_SECONDS = 12 * 60 * 60;

export interface HoldState {
  proposer: string;
  reason: HoldReasonName;
  confirmed: boolean;
  setAt: number;
  lastSigner: string;
  until: number;
  clearProposer: string | null;
  active: boolean;
}

export function toHold(raw: readonly unknown[] | { hold: unknown; active: unknown }): HoldState | null {
  const [h, active] = Array.isArray(raw) ? raw : [(raw as { hold: unknown }).hold, (raw as { active: unknown }).active];
  const t = h as { proposer: string; reason: bigint | number; confirmed: boolean; setAt: bigint | number; lastSigner: string; until: bigint | number; clearProposer: string };
  if (!t || Number(t.setAt) === 0) return null;
  return {
    proposer: String(t.proposer),
    reason: HOLD_REASONS[Number(t.reason)] ?? 'NONE',
    confirmed: Boolean(t.confirmed),
    setAt: Number(t.setAt),
    lastSigner: String(t.lastSigner),
    until: Number(t.until),
    clearProposer: t.clearProposer && t.clearProposer !== ethers.ZeroAddress ? String(t.clearProposer) : null,
    active: Boolean(active),
  };
}

export interface EnforcementReader {
  holdOf(member: string): Promise<readonly unknown[]>;
  shortfallWait(): Promise<bigint>;
  /** (gap, dueAt): dueAt is 0 while no notice is open. */
  shortfallOf(member: string): Promise<readonly [bigint, bigint] | readonly unknown[]>;
}

type Tx = { hash: string; wait: (confirms?: number) => Promise<unknown> };
export interface EnforcementWriter {
  noticeShortfall(member: string): Promise<Tx>;
  /** The same call, simulated only (an eth_call); throws its revert. For the dry run. */
  simulateNoticeShortfall?(member: string): Promise<unknown>;
}

/**
 * `noticeShortfall` opens a notice; `clearShortfall` is the same call once the gap has closed;
 * `shortfallDue` sends nothing: the wait is over, and settling it is the enforcement keeper's to
 * come (PoolShareEnforcer, payPledged), so ops are told.
 */
export type EnforcementAction = 'noticeShortfall' | 'clearShortfall' | 'shortfallDue';

export interface EnforcementResult {
  wallet: string;
  action: EnforcementAction | 'held';
  ok: boolean;
  txHash?: string;
  reason?: string;
}

export interface EnforcementDeps {
  reader: EnforcementReader;
  writer: EnforcementWriter;
  wallets: () => Promise<string[]>;
  alert: (input: { key: string; subject: string; body: string }) => Promise<unknown>;
  now?: number;
  maxPerRun?: number;
  /** When each (action, member) was last tried, for the cooldown. Kept across runs by the job. */
  tried?: Map<string, number>;
  /** Who settles a shortfall past its wait: the pledge keepers' switches, in words, for the alert. */
  settledBy?: string;
  /** ENFORCEMENT_KEEPER_DRY_RUN: simulate each notice and report it; send nothing. */
  dryRun?: boolean;
}

export interface EnforcementRun {
  checked: number;
  held: number;
  results: EnforcementResult[];
  deferred: number;
}

/** What is due for one member now, read from chain; nothing while a hold is active. */
export async function enforcementDue(
  reader: EnforcementReader,
  wallet: string,
  now: number,
): Promise<{ held: boolean; actions: EnforcementAction[] }> {
  const hold = toHold(await reader.holdOf(wallet));
  if (hold?.active) return { held: true, actions: [] };
  const [gap, dueAt] = (await reader.shortfallOf(wallet)) as [bigint, bigint];
  const actions: EnforcementAction[] = [];
  if (Number(dueAt) === 0) {
    if (gap > 0n) actions.push('noticeShortfall');
  } else if (gap === 0n) {
    actions.push('clearShortfall');
  } else if (now >= Number(dueAt)) {
    actions.push('shortfallDue');
  }
  return { held: false, actions };
}

let running = false;

export async function runEnforcementKeeper(deps: EnforcementDeps): Promise<EnforcementRun> {
  const run: EnforcementRun = { checked: 0, held: 0, results: [], deferred: 0 };
  if (running) return run;
  running = true;
  try {
    const now = deps.now ?? Math.floor(Date.now() / 1000);
    const max = deps.maxPerRun ?? DEFAULT_ENFORCEMENT_MAX_PER_RUN;
    const tried = deps.tried ?? new Map<string, number>();
    const queue: { wallet: string; action: EnforcementAction }[] = [];
    const due: string[] = [];
    for (const wallet of await deps.wallets()) {
      run.checked += 1;
      try {
        const next = await enforcementDue(deps.reader, wallet, now);
        if (next.held) {
          run.held += 1;
          continue;
        }
        for (const action of next.actions) {
          if (action === 'shortfallDue') due.push(wallet);
          else queue.push({ wallet, action });
        }
      } catch (error) {
        run.results.push({ wallet, action: 'held', ok: false, reason: `read: ${chainErrorReason(error)}` });
      }
    }
    run.deferred = Math.max(0, queue.length - max);

    for (const { wallet, action } of queue.slice(0, max)) {
      tried.set(`${action}:${wallet}`, now);
      try {
        if (deps.dryRun) {
          await deps.writer.simulateNoticeShortfall?.(wallet);
          run.results.push({ wallet, action, ok: true, reason: 'dry run: would send noticeShortfall' });
          console.log(`[enforcement] dry run: would send noticeShortfall(${wallet}) (${action})`);
          continue;
        }
        const tx = await deps.writer.noticeShortfall(wallet);
        await tx.wait(1);
        run.results.push({ wallet, action, ok: true, txHash: tx.hash });
      } catch (error) {
        const name = decodeChainError(error)?.name;
        // Moved on since it was read: a hold confirmed, a gap closed, already noticed. Not a failure.
        if (name === 'LiquidatorOnHold' || name === 'LiquidatorPauseInForce') {
          run.held += 1;
          continue;
        }
        if (name === 'LiquidatorNoShortfall' || name === 'LiquidatorShortfallNoticed') {
          run.results.push({ wallet, action, ok: true, reason: `nothing to do: ${name}` });
          continue;
        }
        run.results.push({ wallet, action, ok: false, reason: chainErrorReason(error).slice(0, 300) });
      }
    }

    const wouldSend = run.results.filter((r) => r.reason?.startsWith('dry run'));
    if (wouldSend.length) {
      await deps
        .alert({
          key: `enforcement:dry-run:${new Date(now * 1000).toISOString().slice(0, 10)}`,
          subject: `Enforcement keeper (dry run): would send ${wouldSend.length} noticeShortfall call(s)`,
          body: `noticeShortfall simulates successfully for ${wouldSend.map((r) => `${r.wallet} (${r.action === 'clearShortfall' ? 'clears a closed gap' : 'opens a notice'})`).join(', ')}. Nothing was sent: dry run.`,
        })
        .catch(() => null);
    }

    if (due.length) {
      for (const wallet of due) run.results.push({ wallet, action: 'shortfallDue', ok: true });
      await deps
        .alert({
          key: `enforcement:due:${new Date(now * 1000).toISOString().slice(0, 10)}`,
          subject: `Enforcement: ${due.length} Earn shortfall(s) past their wait`,
          body:
            `The shortfall notice's wait has passed for ${due.join(', ')}. It is settled from Pledged Pool Shares ` +
            '(PoolShareEnforcer.enforce, then fillQueue and settle) and then Pledged BurnerBonds (payPledged), smallest amount first ' +
            `(decision 21). ${deps.settledBy ?? 'No keeper sends those: do it by hand, or leave it while a Liquidation Hold is proposed.'}`,
        })
        .catch(() => null);
    }

    const failed = run.results.filter((r) => !r.ok);
    if (failed.length) {
      for (const f of failed) console.error(`[enforcement] ${f.wallet} ${f.action} failed: ${f.reason}`);
      await deps
        .alert({
          key: `enforcement:failures:${new Date(now * 1000).toISOString().slice(0, 13)}`,
          subject: `Enforcement keeper: ${failed.length} call(s) failed`,
          body:
            `Liquidator calls failed: ${failed.map((f) => `${f.action} ${f.wallet} (${f.reason})`).join('; ')}. ` +
            'noticeShortfall is permissionless and needs only gas: check the card settler key has ETH, and the Liquidator’s Earn sources are set.',
        })
        .catch(() => null);
    }
    return run;
  } finally {
    running = false;
  }
}

/* ---- Wiring ---- */

const chainId = () => keeperChainId();

/** noticeShortfall has run since Phase 2b whenever configured: on unless ENFORCEMENT_KEEPER_ENABLED=0. */
export const shortfallNoticeMode = (env: Record<string, string | undefined> = process.env) => keeperMode('ENFORCEMENT_KEEPER', env, true);

/** The pledge keepers' switches, in a sentence for the shortfall-due alert. */
function settledBySentence(env: Record<string, string | undefined> = process.env): string {
  const word = (prefix: string) => ({ off: 'off', dry_run: 'in dry run', live: 'on' })[keeperMode(prefix, env)];
  const pool = word('POOL_ENFORCE_KEEPER');
  const bond = word('BOND_PLEDGE_KEEPER');
  if (pool === 'on' && bond === 'on') return 'The pledge keepers send those when the contracts say they are due (hourly); nothing to do unless they alert.';
  return `The pledge keepers are: pool shares ${pool}, bonds ${bond}. What they do not send must be done by hand, or left while a Liquidation Hold is proposed.`;
}

export function isEnforcementConfigured(): boolean {
  return Boolean(
    getContractAddress(chainId(), 'Liquidator') && getContractAddress(chainId(), 'RevolvingIssuer') && keeperKey() && getPostgresPool(),
  );
}

/** Whether the Liquidator has the section 12 paths (a hold view). Before 2b it does not. */
export async function liquidatorHasSection12(): Promise<boolean> {
  const address = getContractAddress(chainId(), 'Liquidator');
  if (!address) return false;
  try {
    await new ethers.Contract(address, LIQUIDATOR_ABI, chainProvider(chainId())).shortfallWait();
    return true;
  } catch {
    return false;
  }
}

async function memberWallets(): Promise<string[]> {
  const pool = getPostgresPool();
  if (!pool) return [];
  const { rows } = await pool.query<{ primary_wallet: string }>(
    `SELECT DISTINCT primary_wallet FROM members
      WHERE primary_wallet IS NOT NULL AND primary_wallet <> ''
      ORDER BY primary_wallet`,
  );
  return rows.map((r) => r.primary_wallet.toLowerCase());
}

const triedAcrossRuns = new Map<string, number>();

export function enforcementDeps(): EnforcementDeps | null {
  const liquidator = getContractAddress(chainId(), 'Liquidator');
  if (!liquidator || !keeperKey()) return null;
  const provider = chainProvider(chainId());
  const reads = new ethers.Contract(liquidator, LIQUIDATOR_ABI, provider);
  const signer = new ethers.Wallet(keeperKey(), provider);
  const writer = new ethers.Contract(liquidator, LIQUIDATOR_ABI, writesAs(signer));
  const iface = new ethers.Interface(LIQUIDATOR_ABI);
  const maxPerRun = Number(process.env.ENFORCEMENT_KEEPER_MAX_PER_RUN || DEFAULT_ENFORCEMENT_MAX_PER_RUN);
  return {
    reader: {
      holdOf: (m) => reads.holdOf(m),
      shortfallWait: () => reads.shortfallWait(),
      shortfallOf: (m) => reads.shortfallOf(m),
    },
    writer: {
      // One keeper send at a time from this key, each mined before the next (keeperKit).
      noticeShortfall: (m) =>
        withKeeperSendLock(async () => {
          const tx = (await writer.noticeShortfall(m)) as Tx;
          await tx.wait(1);
          return tx;
        }),
      simulateNoticeShortfall: (m) => provider.call({ to: liquidator, data: iface.encodeFunctionData('noticeShortfall', [m]), from: signer.address }),
    },
    wallets: memberWallets,
    alert: (input) => alertOps(input),
    maxPerRun: Number.isFinite(maxPerRun) && maxPerRun > 0 ? maxPerRun : DEFAULT_ENFORCEMENT_MAX_PER_RUN,
    tried: triedAcrossRuns,
    settledBy: settledBySentence(),
    dryRun: shortfallNoticeMode() === 'dry_run',
  };
}

/* ---- Liquidation Hold tooling (Command) ---- */

export interface MemberEnforcement {
  wallet: string;
  hold: HoldState | null;
  /** When a shortfall was noticed, and when it may be settled (`shortfallOf`'s dueAt). */
  shortfall: { noticedAt: number; settleableAt: number; gapCents: number } | null;
  excessCents: number;
}

const cents = (units: bigint) => Number((units + 9_999n) / 10_000n);

/**
 * Every member with a hold (proposed, active or lapsed), an open shortfall notice, or an excess,
 * for the operator screen. Reads only.
 */
export async function readEnforcement(limit = 500): Promise<{ members: MemberEnforcement[]; shortfallWaitSeconds: number; maxHoldDays: Record<string, number> } | null> {
  const liquidator = getContractAddress(chainId(), 'Liquidator');
  const issuer = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!liquidator || !issuer) return null;
  try {
    const provider = chainProvider(chainId());
    const reads = new ethers.Contract(liquidator, LIQUIDATOR_ABI, provider);
    const issuerReads = new ethers.Contract(issuer, ISSUER_ABI, provider);
    const wait = Number(await reads.shortfallWait());
    const maxHoldDays: Record<string, number> = {};
    for (let r = 1; r < HOLD_REASONS.length; r++) maxHoldDays[HOLD_REASONS[r]] = Math.round(Number(await reads.maxHoldOf(r)) / 86_400);
    const members: MemberEnforcement[] = [];
    for (const wallet of (await memberWallets()).slice(0, limit)) {
      const [hold, [gap, dueAt], excess] = await Promise.all([
        reads.holdOf(wallet).then(toHold),
        reads.shortfallOf(wallet) as Promise<[bigint, bigint]>,
        issuerReads.unsecuredExcessOf(wallet) as Promise<bigint>,
      ]);
      let shortfall: MemberEnforcement['shortfall'] = null;
      if (Number(dueAt) > 0) {
        // dueAt is the notice plus the wait (and any pause clock); the notice time is read back from it.
        shortfall = { noticedAt: Number(dueAt) - wait, settleableAt: Number(dueAt), gapCents: cents(gap) };
      }
      if (hold || shortfall || excess > 0n) members.push({ wallet, hold, shortfall, excessCents: cents(excess) });
    }
    return { members, shortfallWaitSeconds: wait, maxHoldDays };
  } catch (error) {
    console.error('[enforcement] read failed', error instanceof Error ? error.message : error);
    return null;
  }
}

export type HoldCall =
  | { action: 'propose'; member: string; reason: HoldReasonName; durationDays: number; evidence: string }
  | { action: 'confirm'; member: string }
  | { action: 'renew'; member: string; untilUnix: number }
  | { action: 'clear'; member: string };

/**
 * The transaction a `HOLD_ROLE` signer sends from their own wallet for one hold step. Only encodes;
 * nothing is signed or sent here. `evidence` is hashed (keccak-256 of its text) unless it already is
 * a 32-byte hex hash, so the document itself never goes on chain.
 */
export function prepareHoldCall(call: HoldCall, liquidator: string, chain: number): { to: string; data: string; value: '0'; chainId: number; note: string } | { error: string } {
  if (!ethers.isAddress(call.member)) return { error: 'Not a member address.' };
  const iface = new ethers.Interface(LIQUIDATOR_ABI);
  const member = ethers.getAddress(call.member);
  let data: string;
  let note: string;
  switch (call.action) {
    case 'propose': {
      const reason = HOLD_REASONS.indexOf(call.reason);
      if (reason <= 0) return { error: 'Choose a reason: bankruptcy, death, billing dispute or late notice.' };
      if (!Number.isFinite(call.durationDays) || call.durationDays <= 0) return { error: 'The hold needs a length in days.' };
      const evidence = /^0x[0-9a-fA-F]{64}$/.test(call.evidence.trim()) ? call.evidence.trim() : call.evidence.trim() ? ethers.id(call.evidence.trim()) : '';
      if (!evidence) return { error: 'A hold needs evidence: its reference, or a hash of it.' };
      data = iface.encodeFunctionData('proposeHold', [member, reason, BigInt(Math.round(call.durationDays * 86_400)), evidence]);
      note = 'Proposes the hold. It does nothing until a DIFFERENT HOLD_ROLE signer confirms it.';
      break;
    }
    case 'confirm':
      data = iface.encodeFunctionData('confirmHold', [member]);
      note = 'Confirms the hold. Must be sent by a different HOLD_ROLE signer from the one who proposed it (LiquidatorSameSigner otherwise).';
      break;
    case 'renew':
      if (!Number.isFinite(call.untilUnix) || call.untilUnix <= 0) return { error: 'Choose when the renewed hold ends.' };
      data = iface.encodeFunctionData('renewHold', [member, BigInt(Math.floor(call.untilUnix))]);
      note = 'Extends an active hold, never past its reason’s maximum. Must be a different signer from the last one who confirmed or renewed it.';
      break;
    case 'clear':
      data = iface.encodeFunctionData('clearHold', [member]);
      note = 'Ends a hold. An active hold takes two different signers: the first send proposes clearing it, a second signer’s send clears it.';
      break;
  }
  return { to: ethers.getAddress(liquidator), data, value: '0', chainId: chain, note };
}

export function liquidatorAddress(): { address: string | null; chainId: number } {
  return { address: getContractAddress(chainId(), 'Liquidator'), chainId: chainId() };
}
