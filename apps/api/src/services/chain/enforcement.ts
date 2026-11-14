import { ethers } from 'ethers';
import { getPostgresPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { chainErrorReason, decodeChainError } from './chainErrors.js';
import { alertOps } from '../opsAlert.js';

/*
 * Enforcement after a missed cycle or an Earn shortfall (Phase 2b, 12.5, 12.6, 12.8), and the
 * Liquidation Hold that pauses it.
 *
 * The Liquidator's section 12 paths are permissionless and need no role, only gas:
 *   - `settleExcess(member, issuer)`: after a missed cycle halves the unsecured limit, what is drawn
 *     above it (`RevolvingIssuer.unsecuredExcessOf`) is settled from pledged pool shares, then bonds.
 *     Never Savings.
 *   - `noticeShortfall(member, issuer)`: records that pledged Earn no longer backs what is drawn
 *     against it (`earnGapOf`). Moves nothing; starts the governed wait (72 hours or more).
 *   - `settleShortfall(member, issuer)`: once the wait has passed, redeems the smallest amount of
 *     Earn pledge that closes the gap. Never Savings.
 * Each reverts `LiquidatorOnHold` while a Liquidation Hold is active, so the keeper reads the hold
 * first and leaves a held member alone.
 *
 * The keeper is bounded per run, never runs twice at once, and is idempotent: a notice is sent only
 * when none is open, a settlement only when its condition still stands on chain, and a member it has
 * just settled is not tried again for a cooldown (a pool withdrawal can stay queued, and the excess
 * with it, until the pool pays it).
 *
 * Holds are two-person `HOLD_ROLE` actions taken from each signer's own wallet; `prepareHoldCall`
 * only encodes the call. No key for them is held here.
 */

export const LIQUIDATOR_ABI = [
  'function holdOf(address member) view returns ((address proposer, uint8 reason, bool confirmed, uint64 setAt, address lastSigner, uint64 until, address clearProposer) hold, bool active)',
  'function holdEvidence(address member) view returns (bytes32)',
  'function maxHoldOf(uint8 reason) view returns (uint64)',
  'function shortfallNoticedAt(address member, address issuer) view returns (uint64)',
  'function shortfallWait() view returns (uint64)',
  'function earnGapOf(address member, address issuer) view returns (uint256 poolGap, uint256 bondGap)',
  'function settleExcess(address member, address issuer) returns (uint256 applied)',
  'function noticeShortfall(address member, address issuer) returns (uint256 gap)',
  'function settleShortfall(address member, address issuer) returns (uint256 applied)',
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
  shortfallNoticedAt(member: string, issuer: string): Promise<bigint>;
  shortfallWait(): Promise<bigint>;
  earnGapOf(member: string, issuer: string): Promise<readonly [bigint, bigint] | readonly unknown[]>;
  unsecuredExcessOf(member: string): Promise<bigint>;
}

type Tx = { hash: string; wait: (confirms?: number) => Promise<unknown> };
export interface EnforcementWriter {
  settleExcess(member: string, issuer: string): Promise<Tx>;
  noticeShortfall(member: string, issuer: string): Promise<Tx>;
  settleShortfall(member: string, issuer: string): Promise<Tx>;
}

export type EnforcementAction = 'settleExcess' | 'noticeShortfall' | 'settleShortfall';

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
  issuer: string;
  wallets: () => Promise<string[]>;
  alert: (input: { key: string; subject: string; body: string }) => Promise<unknown>;
  now?: number;
  maxPerRun?: number;
  /** When each (action, member) was last tried, for the cooldown. Kept across runs by the job. */
  tried?: Map<string, number>;
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
  issuer: string,
  wallet: string,
  now: number,
  wait: number,
): Promise<{ held: boolean; actions: EnforcementAction[] }> {
  const hold = toHold(await reader.holdOf(wallet));
  if (hold?.active) return { held: true, actions: [] };
  const actions: EnforcementAction[] = [];
  if ((await reader.unsecuredExcessOf(wallet)) > 0n) actions.push('settleExcess');
  const noticedAt = Number(await reader.shortfallNoticedAt(wallet, issuer));
  if (noticedAt === 0) {
    const [poolGap, bondGap] = (await reader.earnGapOf(wallet, issuer)) as [bigint, bigint];
    if (poolGap + bondGap > 0n) actions.push('noticeShortfall');
  } else if (now >= noticedAt + wait) {
    actions.push('settleShortfall');
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
    const wait = Number(await deps.reader.shortfallWait());
    const queue: { wallet: string; action: EnforcementAction }[] = [];
    for (const wallet of await deps.wallets()) {
      run.checked += 1;
      try {
        const due = await enforcementDue(deps.reader, deps.issuer, wallet, now, wait);
        if (due.held) {
          run.held += 1;
          continue;
        }
        for (const action of due.actions) {
          const last = tried.get(`${action}:${wallet}`);
          // A notice is idempotent on chain (it reverts once noticed); settlements wait out the cooldown.
          if (action !== 'noticeShortfall' && last !== undefined && now - last < SETTLE_COOLDOWN_SECONDS) continue;
          queue.push({ wallet, action });
        }
      } catch (error) {
        run.results.push({ wallet, action: 'held', ok: false, reason: `read: ${chainErrorReason(error)}` });
      }
    }
    run.deferred = Math.max(0, queue.length - max);

    for (const { wallet, action } of queue.slice(0, max)) {
      tried.set(`${action}:${wallet}`, now);
      try {
        const tx = await deps.writer[action](wallet, deps.issuer);
        await tx.wait(1);
        run.results.push({ wallet, action, ok: true, txHash: tx.hash });
      } catch (error) {
        const name = decodeChainError(error)?.name;
        // Moved on since it was read: a hold confirmed, a gap closed, already noticed. Not a failure.
        if (name === 'LiquidatorOnHold') {
          run.held += 1;
          continue;
        }
        if (name === 'LiquidatorNoExcess' || name === 'LiquidatorNoShortfall' || name === 'LiquidatorShortfallNoticed' || name === 'LiquidatorShortfallNotDue') {
          run.results.push({ wallet, action, ok: true, reason: `nothing to do: ${name}` });
          continue;
        }
        run.results.push({ wallet, action, ok: false, reason: chainErrorReason(error).slice(0, 300) });
      }
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
            'They are permissionless and need only gas: check the card settler key has ETH, the Liquidator trusts the RevolvingIssuer, and its Earn sources are set.',
        })
        .catch(() => null);
    }
    return run;
  } finally {
    running = false;
  }
}

/* ---- Wiring ---- */

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}
const keeperKey = () => (process.env.CARD_SETTLER_PRIVATE_KEY || '').trim();

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
  const issuer = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!liquidator || !issuer || !keeperKey()) return null;
  const provider = chainProvider(chainId());
  const reads = new ethers.Contract(liquidator, LIQUIDATOR_ABI, provider);
  const issuerReads = new ethers.Contract(issuer, ISSUER_ABI, provider);
  const writer = new ethers.Contract(liquidator, LIQUIDATOR_ABI, writesAs(new ethers.Wallet(keeperKey(), provider)));
  const maxPerRun = Number(process.env.ENFORCEMENT_KEEPER_MAX_PER_RUN || DEFAULT_ENFORCEMENT_MAX_PER_RUN);
  return {
    reader: {
      holdOf: (m) => reads.holdOf(m),
      shortfallNoticedAt: (m, i) => reads.shortfallNoticedAt(m, i),
      shortfallWait: () => reads.shortfallWait(),
      earnGapOf: (m, i) => reads.earnGapOf(m, i),
      unsecuredExcessOf: (m) => issuerReads.unsecuredExcessOf(m),
    },
    writer: writer as unknown as EnforcementWriter,
    issuer,
    wallets: memberWallets,
    alert: (input) => alertOps(input),
    maxPerRun: Number.isFinite(maxPerRun) && maxPerRun > 0 ? maxPerRun : DEFAULT_ENFORCEMENT_MAX_PER_RUN,
    tried: triedAcrossRuns,
  };
}

/* ---- Liquidation Hold tooling (Command) ---- */

export interface MemberEnforcement {
  wallet: string;
  hold: HoldState | null;
  /** When a shortfall was noticed with the RevolvingIssuer, and when it may be settled. */
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
      const [hold, noticedAt, excess] = await Promise.all([
        reads.holdOf(wallet).then(toHold),
        reads.shortfallNoticedAt(wallet, issuer).then(Number),
        issuerReads.unsecuredExcessOf(wallet) as Promise<bigint>,
      ]);
      let shortfall: MemberEnforcement['shortfall'] = null;
      if (noticedAt > 0) {
        const [poolGap, bondGap] = (await reads.earnGapOf(wallet, issuer)) as [bigint, bigint];
        shortfall = { noticedAt, settleableAt: noticedAt + wait, gapCents: cents(poolGap + bondGap) };
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
