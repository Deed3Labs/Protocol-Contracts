/*
 * Bounded automatic PayoutPool top-ups (decision 51, owner-approved Nov 17, 2026): when to move
 * money from CL Operating into the PayoutPool, how much, and the three calls that do it.
 *
 * The money path. CL Operating (Clear Lending's Safe) gives one dedicated top-up wallet a spending
 * limit through Safe's AllowanceModule (v0.1.1, the canonical deployment). The wallet holds the
 * PayoutPool's FUNDER_ROLE and nothing else. For a top-up it makes exactly three calls:
 *
 *   1. AllowanceModule.executeAllowanceTransfer(CL Operating, USDC, wallet, amount, 0, 0, wallet, "")
 *      pulls `amount` from CL Operating to itself. The delegate sends it itself: with an empty
 *      signature the module takes msg.sender as the signer, and it must be a delegate of that Safe.
 *      The module refuses anything over what is left of the allowance this period.
 *   2. USDC.approve(PayoutPool, amount): the exact amount, never more.
 *   3. PayoutPool.fund(amount): the pool pulls it, and records it as the wallet's capital.
 *
 * It never calls `withdrawCapital` (`assertTopUpCall` refuses it, and every other call), and it
 * pulls only the amount it is about to fund, so between top-ups it holds nothing.
 *
 * When it moves (the owner's rules). Checks are frequent and cheap (views); moves are rare:
 *   - it moves only when the claims due within the low horizon (default 14 days) cannot all be paid
 *     (`dueWithin(low).short > 0`), which includes anything overdue and unfunded now;
 *   - when it moves, it refills to the target horizon (default 30 days, the standing balance of
 *     decision 49) plus a margin, so the next move is weeks away;
 *   - it never moves more than the Safe spending limit has left this period. What the limit cannot
 *     cover is prepared for CL Operating's owners to send by hand, and alerted;
 *   - nothing short at the low horizon means no move, even when the 30-day picture is short. When
 *     that 30-day need is more than the limit has left, it alerts once, so people can act early;
 *   - when CL Operating itself lacks the money, it alerts and does not try.
 *
 * `dueWithin` lists at most `maxClaims` claims and `amount` covers only those. A read that comes back
 * full is read again with a larger limit, up to a ceiling; past that the need is taken as everything
 * queued (`queuedTotal`), which is never less than the truth. It may over-fund, within the cap; it
 * never under-funds silently.
 *
 * No imports: it is shared by the API job (jobs/payoutTopUp.ts) and the Hardhat tests, which run it
 * against the real AllowanceModule and Safe code. Everything after the reads is pure.
 */

const DAY = 86_400;
export const USDC_UNIT = 1_000_000n;

/** Safe's AllowanceModule v0.1.1, at the same address on every chain it is deployed to (safe-modules-deployments). */
export const CANONICAL_ALLOWANCE_MODULE = '0xAA46724893dedD72658219405185Fb0Fc91e091C';
/** CL Operating on Base Sepolia (deploy/config/base-sepolia.rollout.env, CLEAR_LENDING_ACCOUNT). */
export const CL_OPERATING_BASE_SEPOLIA = '0xfAFf1081F77bF528bA21eea590f251a755bCdf65';
/** The Safe's sentinel for its module list. */
export const SENTINEL = '0x0000000000000000000000000000000000000001';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/* ========== ABIs (the official AllowanceModule ABI, only the functions used) ========== */

export const ALLOWANCE_MODULE_ABI = [
  'function NAME() view returns (string)',
  'function VERSION() view returns (string)',
  'function getTokenAllowance(address safe, address delegate, address token) view returns (uint256[5])',
  'function getDelegates(address safe, uint48 start, uint8 pageSize) view returns (address[] results, uint48 next)',
  'function generateTransferHash(address safe, address token, address to, uint96 amount, address paymentToken, uint96 payment, uint16 nonce) view returns (bytes32)',
  'function executeAllowanceTransfer(address safe, address token, address to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes signature)',
  'function addDelegate(address delegate)',
  'function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)',
  'event ExecuteAllowanceTransfer(address indexed safe, address delegate, address token, address to, uint96 value, uint16 nonce)',
] as const;

export const SAFE_MODULE_ABI = [
  'function isModuleEnabled(address module) view returns (bool)',
  'function enableModule(address module)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function VERSION() view returns (string)',
] as const;

export const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const;

export const PAYOUT_POOL_TOPUP_ABI = [
  'function dueWithin(uint256 horizon, uint256 maxClaims) view returns (uint256[] ids, uint256 amount, uint256 short)',
  'function held() view returns (uint256)',
  'function refundsOwed() view returns (uint256)',
  'function memberFunded() view returns (uint256)',
  'function queuedTotal() view returns (uint256)',
  'function reserveToken() view returns (address)',
  'function capitalOf(address funder) view returns (uint256)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function fund(uint256 amount)',
] as const;

/** The selectors the top-up wallet may send, and the one it must never send. */
export const SELECTORS = {
  executeAllowanceTransfer: '0x4515641a',
  approve: '0x095ea7b3',
  fund: '0xca1d209d',
  withdrawCapital: '0xf29dfb33',
} as const;

/** keccak256("FUNDER_ROLE") and the other PayoutPool roles, which the wallet must not hold. */
export const PAYOUT_POOL_ROLES = {
  DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000',
  OPERATOR_ROLE: '0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929',
  FUNDER_ROLE: '0x0914bb97ca83e85ef385857d9d418f187ff630589e0c9f44db92976d8e4519cb',
  REDEEMER_ROLE: '0x44ac9762eec3a11893fefb11d028bb3102560094137c3ed4518712475b2577cc',
} as const;

/* ========== CONFIG ========== */

export interface TopUpConfig {
  /** How often the job checks, in minutes. */
  checkMinutes: number;
  /** The low-water horizon, in calendar days: a move happens only when this is short. */
  lowDays: number;
  /** The refill horizon, in calendar days: a move covers this (the standing balance). */
  targetDays: number;
  /** Added on top of the target's shortfall, in USDC base units. */
  margin: bigint;
  /** `dueWithin`'s first `maxClaims`, and the most it is raised to. */
  maxClaims: number;
  maxClaimsCeiling: number;
  /** When set, the bot also never moves more than this per allowance period, whatever the chain allows. */
  capOverride: bigint | null;
}

/** Addendum 12.10 is two business days; a week covers that across any weekend and holiday, with room. */
export const MIN_LOW_DAYS = 7;

export const DEFAULT_TOPUP_CONFIG: TopUpConfig = {
  checkMinutes: 15,
  lowDays: 14,
  targetDays: 30,
  margin: 100n * USDC_UNIT,
  maxClaims: 200,
  maxClaimsCeiling: 3200,
  capOverride: null,
};

function int(raw: string | undefined, fallback: number, min = 1): number {
  const n = Number((raw ?? '').trim());
  return (raw ?? '').trim() && Number.isInteger(n) && n >= min ? n : fallback;
}

/** A dollar amount ("5000", "5000.50") as USDC base units, or null when it does not parse. */
export function parseUsdc(raw: string | undefined): bigint | null {
  const v = (raw ?? '').trim().replace(/[$,_\s]/g, '');
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(v);
  if (!m) return null;
  return BigInt(m[1]) * USDC_UNIT + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
}

/**
 * The settings from the environment: PAYOUT_TOPUP_CHECK_MINUTES (15), PAYOUT_TOPUP_LOW_DAYS (14,
 * at least 7), PAYOUT_TOPUP_TARGET_DAYS (30, at least the low horizon), PAYOUT_TOPUP_MARGIN_USDC
 * (100 dollars), PAYOUT_TOPUP_MAX_CLAIMS (200) and PAYOUT_TOPUP_CAP_USDC (optional, dollars). A
 * value that does not parse keeps the default; a low horizon under a week is raised to a week.
 */
export function topUpConfigFromEnv(env: Record<string, string | undefined>): TopUpConfig {
  const d = DEFAULT_TOPUP_CONFIG;
  const lowDays = Math.max(MIN_LOW_DAYS, int(env.PAYOUT_TOPUP_LOW_DAYS, d.lowDays));
  const targetDays = Math.max(lowDays, int(env.PAYOUT_TOPUP_TARGET_DAYS, d.targetDays));
  const maxClaims = int(env.PAYOUT_TOPUP_MAX_CLAIMS, d.maxClaims);
  return {
    checkMinutes: int(env.PAYOUT_TOPUP_CHECK_MINUTES, d.checkMinutes),
    lowDays,
    targetDays,
    margin: parseUsdc(env.PAYOUT_TOPUP_MARGIN_USDC) ?? d.margin,
    maxClaims,
    maxClaimsCeiling: Math.max(maxClaims, d.maxClaimsCeiling),
    capOverride: parseUsdc(env.PAYOUT_TOPUP_CAP_USDC),
  };
}

/* ========== READS ========== */

/** One horizon's `dueWithin`, made whole. */
export interface Projection {
  /** Seconds from now. */
  horizon: number;
  /** Claims listed by the last read. */
  listed: number;
  /** What the claims due add up to (everything queued, when `truncated`). */
  amount: bigint;
  /** What the pool lacks to pay them. */
  short: bigint;
  /** The list was still full at the ceiling: `amount` and `short` are the conservative bound. */
  truncated: boolean;
}

export interface AllowanceRead {
  /** The cap per period, USDC base units. */
  amount: bigint;
  /** Spent this period (already zero when the period has reset; the module applies it on read). */
  spent: bigint;
  resetTimeMin: number;
  lastResetMin: number;
  nonce: number;
}

export interface TopUpReads {
  /** The latest block's timestamp. */
  now: number;
  held: bigint;
  /** `held` less refunds owed to members (PayoutPool `_payable`). */
  payable: bigint;
  queuedTotal: bigint;
  overdue: Projection;
  low: Projection;
  target: Projection;
  allowance: AllowanceRead;
  moduleEnabled: boolean;
  isFunder: boolean;
  /** Any other PayoutPool role the wallet holds (it must hold none). */
  otherRoles: string[];
  /** USDC in CL Operating. */
  operatingBalance: bigint;
  /** USDC in the top-up wallet (zero between top-ups). */
  walletBalance: bigint;
  /** What the wallet has approved the PayoutPool for. */
  walletPoolAllowance: bigint;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Read = (...args: any[]) => Promise<any>;
export interface TopUpSource {
  now: () => Promise<number>;
  payoutPool: { dueWithin: Read; held: Read; refundsOwed: Read; memberFunded: Read; queuedTotal: Read; hasRole: Read };
  module: { getTokenAllowance: Read };
  safe: { isModuleEnabled: Read };
  usdc: { balanceOf: Read; allowance: Read };
  addresses: TopUpAddresses;
}

export interface TopUpAddresses {
  payoutPool: string;
  /** CL Operating: the Safe the allowance is on. */
  safe: string;
  module: string;
  usdc: string;
  /** The top-up wallet: the module's delegate and the PayoutPool's funder. */
  wallet: string;
}

/**
 * `dueWithin(horizon)` read until the list is not full, raising `maxClaims` (x4) up to the ceiling.
 * Past the ceiling the claims are taken to be everything queued: `queuedTotal` is the sum of every
 * unpaid claim, so it is never less than what is due within any horizon.
 */
export async function projection(
  pool: TopUpSource['payoutPool'],
  horizon: number,
  config: Pick<TopUpConfig, 'maxClaims' | 'maxClaimsCeiling'>,
  payable: bigint,
  queuedTotal: bigint,
): Promise<Projection> {
  let max = config.maxClaims;
  for (;;) {
    const r = await pool.dueWithin(BigInt(horizon), BigInt(max));
    const listed = Array.from(r[0] as Iterable<unknown>).length;
    const amount = BigInt(r[1]);
    const short = BigInt(r[2]);
    if (listed < max) return { horizon, listed, amount, short, truncated: false };
    if (max >= config.maxClaimsCeiling) {
      const bound = queuedTotal > amount ? queuedTotal : amount;
      return { horizon, listed, amount: bound, short: bound > payable ? bound - payable : 0n, truncated: true };
    }
    max = Math.min(max * 4, config.maxClaimsCeiling);
  }
}

/** Every read a check needs, as view calls. */
export async function gatherTopUp(source: TopUpSource, config: TopUpConfig): Promise<TopUpReads> {
  const { payoutPool: pool, addresses: a } = source;
  const now = await source.now();
  const [held, refundsOwed, memberFunded, queuedTotal, allowance, moduleEnabled, isFunder, operatingBalance, walletBalance, walletPoolAllowance] =
    await Promise.all([
      pool.held().then(BigInt),
      pool.refundsOwed().then(BigInt),
      pool.memberFunded().then(BigInt),
      pool.queuedTotal().then(BigInt),
      source.module.getTokenAllowance(a.safe, a.wallet, a.usdc),
      source.safe.isModuleEnabled(a.module).then(Boolean),
      pool.hasRole(PAYOUT_POOL_ROLES.FUNDER_ROLE, a.wallet).then(Boolean),
      source.usdc.balanceOf(a.safe).then(BigInt),
      source.usdc.balanceOf(a.wallet).then(BigInt),
      source.usdc.allowance(a.wallet, a.payoutPool).then(BigInt),
    ]);
  const reserved = refundsOwed < memberFunded ? refundsOwed : memberFunded;
  const payable = held > reserved ? held - reserved : 0n;
  const others = (['DEFAULT_ADMIN_ROLE', 'OPERATOR_ROLE', 'REDEEMER_ROLE'] as const);
  const held_ = await Promise.all(others.map((r) => pool.hasRole(PAYOUT_POOL_ROLES[r], a.wallet).then(Boolean)));
  const otherRoles = others.filter((_r, i) => held_[i]);
  const [overdue, low, target] = await Promise.all([
    projection(pool, 0, config, payable, queuedTotal),
    projection(pool, config.lowDays * DAY, config, payable, queuedTotal),
    projection(pool, config.targetDays * DAY, config, payable, queuedTotal),
  ]);
  const al = Array.from(allowance as Iterable<unknown>, (x) => BigInt(x as bigint));
  return {
    now,
    held,
    payable,
    queuedTotal,
    overdue,
    low,
    target,
    allowance: { amount: al[0], spent: al[1], resetTimeMin: Number(al[2]), lastResetMin: Number(al[3]), nonce: Number(al[4]) },
    moduleEnabled,
    isFunder,
    otherRoles,
    operatingBalance,
    walletBalance,
    walletPoolAllowance,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ========== THE DECISION ========== */

export type TopUpTrigger = 'overdue' | 'low-water';

export type TopUpDecision =
  /** Nothing short at the low horizon. `early` when the target's need already exceeds what the cap has left. */
  | { kind: 'none'; why: string; early: { need: bigint; remaining: bigint } | null }
  /** Short, but the setup is not in place (module, delegate and allowance, or FUNDER_ROLE). */
  | { kind: 'setup'; trigger: TopUpTrigger; need: bigint; missing: string[] }
  /** Short, and CL Operating lacks the money: alert, no move. */
  | { kind: 'operating-short'; trigger: TopUpTrigger; need: bigint; move: bigint; operatingBalance: bigint }
  /** Short, and the cap has nothing left this period: everything goes to people. */
  | { kind: 'cap-exhausted'; trigger: TopUpTrigger; need: bigint; remainder: bigint; resetsAt: number }
  /** Move `amount`; `remainder` (when not zero) is for CL Operating's owners. */
  | { kind: 'move'; trigger: TopUpTrigger; need: bigint; amount: bigint; remainder: bigint };

/** What the allowance lets the bot move this period: the chain's, never more than the configured cap. */
export function capRemaining(allowance: AllowanceRead, capOverride: bigint | null): bigint {
  const chain = allowance.amount > allowance.spent ? allowance.amount - allowance.spent : 0n;
  if (capOverride === null) return chain;
  const own = capOverride > allowance.spent ? capOverride - allowance.spent : 0n;
  return own < chain ? own : chain;
}

/** When the allowance next resets, unix seconds (0 when it never does). */
export function resetsAt(allowance: AllowanceRead): number {
  if (!allowance.resetTimeMin) return 0;
  return (allowance.lastResetMin + allowance.resetTimeMin) * 60;
}

/**
 * The owner's rules, pure. Moves only when the low horizon is short; then refills to the target plus
 * the margin, capped by what the allowance has left; never when CL Operating lacks the money.
 */
export function decideTopUp(reads: TopUpReads, config: Pick<TopUpConfig, 'margin' | 'capOverride'>): TopUpDecision {
  const remaining = capRemaining(reads.allowance, config.capOverride);
  const targetShort = reads.target.short > reads.low.short ? reads.target.short : reads.low.short;
  const need = targetShort + config.margin;

  if (reads.low.short === 0n) {
    const early = reads.target.short > 0n && need > remaining ? { need, remaining } : null;
    return { kind: 'none', why: reads.target.short > 0n ? 'short only beyond the low horizon' : 'nothing short', early };
  }
  const trigger: TopUpTrigger = reads.overdue.short > 0n ? 'overdue' : 'low-water';

  const missing: string[] = [];
  if (!reads.moduleEnabled) missing.push('the AllowanceModule is not enabled on CL Operating');
  if (reads.allowance.amount === 0n) missing.push('the top-up wallet has no allowance on CL Operating (addDelegate, setAllowance)');
  if (!reads.isFunder) missing.push('the top-up wallet does not hold the PayoutPool FUNDER_ROLE');
  if (reads.otherRoles.length) missing.push(`the top-up wallet holds PayoutPool roles it must not (${reads.otherRoles.join(', ')}): revoke them`);
  if (missing.length) return { kind: 'setup', trigger, need, missing };

  if (remaining === 0n) return { kind: 'cap-exhausted', trigger, need, remainder: need, resetsAt: resetsAt(reads.allowance) };
  const amount = need < remaining ? need : remaining;
  if (reads.operatingBalance < amount) return { kind: 'operating-short', trigger, need, move: amount, operatingBalance: reads.operatingBalance };
  return { kind: 'move', trigger, need, amount, remainder: need - amount };
}

/* ========== THE CALLS ========== */

export interface TopUpCall {
  step: 'pull' | 'approve' | 'fund';
  to: string;
  /** ABI fragment name in the ABI it belongs to. */
  fn: 'executeAllowanceTransfer' | 'approve' | 'fund';
  args: unknown[];
}

/** The three calls of one top-up of `amount`, in order. Every amount is the same, exact one. */
export function topUpCalls(a: TopUpAddresses, amount: bigint): TopUpCall[] {
  if (amount <= 0n) throw new Error('A top-up moves a positive amount.');
  if (amount >= 1n << 96n) throw new Error('A top-up over uint96 cannot be an allowance transfer.');
  return [
    // The delegate sends it itself: an empty signature means msg.sender signs (AllowanceModule.recoverSignature).
    { step: 'pull', to: a.module, fn: 'executeAllowanceTransfer', args: [a.safe, a.usdc, a.wallet, amount, ZERO_ADDRESS, 0n, a.wallet, '0x'] },
    { step: 'approve', to: a.usdc, fn: 'approve', args: [a.payoutPool, amount] },
    { step: 'fund', to: a.payoutPool, fn: 'fund', args: [amount] },
  ];
}

const lower = (x: string) => x.toLowerCase();
const word = (data: string, i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
const addressAt = (data: string, i: number) => '0x' + word(data, i).slice(24);
const uintAt = (data: string, i: number) => BigInt('0x' + word(data, i));

/**
 * Refuses any transaction the top-up wallet should never send: only the three calls above, to
 * their own contracts, with the same exact amount and the wallet itself as recipient and delegate.
 * `withdrawCapital` (and every other PayoutPool function) is refused by name.
 */
export function assertTopUpCall(a: TopUpAddresses, tx: { to: string; data: string }, amount: bigint): void {
  const sel = lower(tx.data.slice(0, 10));
  const fail = (why: string) => {
    throw new Error(`Refusing a top-up transaction: ${why}.`);
  };
  if (sel === SELECTORS.withdrawCapital) fail('the top-up wallet never calls PayoutPool.withdrawCapital');
  if (sel === SELECTORS.executeAllowanceTransfer) {
    if (lower(tx.to) !== lower(a.module)) fail('an allowance transfer goes only to the AllowanceModule');
    if (lower(addressAt(tx.data, 0)) !== lower(a.safe)) fail('the allowance transfer is not from CL Operating');
    if (lower(addressAt(tx.data, 1)) !== lower(a.usdc)) fail('the allowance transfer is not USDC');
    if (lower(addressAt(tx.data, 2)) !== lower(a.wallet)) fail('the allowance transfer does not pay the top-up wallet');
    if (uintAt(tx.data, 3) !== amount) fail('the allowance transfer is not the exact top-up amount');
    if (uintAt(tx.data, 5) !== 0n) fail('the allowance transfer pays a fee');
    if (lower(addressAt(tx.data, 6)) !== lower(a.wallet)) fail('the delegate is not the top-up wallet');
    return;
  }
  if (sel === SELECTORS.approve) {
    if (lower(tx.to) !== lower(a.usdc)) fail('approve goes only to USDC');
    if (lower(addressAt(tx.data, 0)) !== lower(a.payoutPool)) fail('approve names only the PayoutPool');
    if (uintAt(tx.data, 1) !== amount) fail('approve is not the exact top-up amount');
    return;
  }
  if (sel === SELECTORS.fund) {
    if (lower(tx.to) !== lower(a.payoutPool)) fail('fund goes only to the PayoutPool');
    if (uintAt(tx.data, 0) !== amount) fail('fund is not the exact top-up amount');
    return;
  }
  fail(`selector ${sel} is not one of the three top-up calls`);
}

/* ========== WORDS ========== */

export function formatUsdc(units: bigint): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const cents = (v + 5_000n) / 10_000n;
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${dollars}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** The Safe Transaction Builder batch for what the cap could not cover: CL Operating sends it to the top-up wallet, which funds it on its next check. */
export function remainderBatch(chainId: number, a: TopUpAddresses, remainder: bigint, transferData: string, createdAt: number) {
  return {
    version: '1.0',
    chainId: String(chainId),
    createdAt,
    meta: {
      name: `PayoutPool top-up remainder: ${formatUsdc(remainder)}`,
      description:
        `CL Operating sends ${formatUsdc(remainder)} USDC to the payout top-up wallet ${a.wallet}, which funds the PayoutPool with exactly that on its next check ` +
        '(approve and fund, never withdrawCapital). This is what the Safe spending limit could not cover this period. Review the call before signing.',
    },
    transactions: [{ to: a.usdc, value: '0', data: transferData }],
  };
}
