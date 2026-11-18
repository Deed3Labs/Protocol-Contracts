import { parseUsdc, USDC_UNIT } from '../payoutFunding/topUp.js';
import { DEFAULT_SCHEDULE, parseClock, type CutoffSchedule } from './schedule.js';

/*
 * The settlement funding desk's settings (decision 54), all from the environment. Everything the
 * owner fills in later (cut-off times, the CSA's required minimum, the off-ramp's rail and latency,
 * whether the Collection Account's book transfer is same-day) is here and has a placeholder
 * default; none of it is written into the rules.
 *
 * Amounts are dollars in the environment and USDC base units (6 decimals) here.
 */

export interface DeskConfig {
  /** SETTLEMENT_FUNDING_ENABLED: off unless 1. */
  enabled: boolean;
  /** SETTLEMENT_FUNDING_DRY_RUN: decides, records and logs; sends nothing. */
  dryRun: boolean;
  /** SETTLEMENT_RETURNS_ENABLED: the surplus direction (Margin, then the pool). Off unless 1. */
  returnsEnabled: boolean;
  checkMinutes: number;
  schedule: CutoffSchedule;
  /** The Settlement Buffer above what is due. */
  buffer: bigint;
  /** The CSA minimum or reserve the bank requires: the buffer's floor. */
  csaMinimum: bigint;
  /** What the Collection Account keeps (never booked out). */
  collectionReserve: bigint;
  /** The off-ramp's latency, minutes (configured; the measured one is used when longer). */
  offRampLatencyMinutes: number;
  /** Added to the latency for the forced run. */
  marginMinutes: number;
  /** Moves may start this long before the forced run (earlier runs only record). */
  windowMinutes: number;
  /** Whether a Collection Account to CSA book transfer lands the same day. */
  bookSameDay: boolean;
  /** Below this nothing moves (no chasing individual swipes). */
  minMove: bigint;
  /** Surplus must have been there this long before it goes back. */
  returnIdleHours: number;
  /** Surplus must be back within this many business days (L-01 §8.4A). */
  returnBusinessDays: number;
  /** Share (0 to 1) of authorized-but-unsettled credit counted when a run covers more than one cut-off. */
  rolloverPendingShare: number;
  /** Optional: the desk holds itself to this per period even if the chain allows more. */
  capOverride: bigint | null;
  /** How far back settled credit is averaged for the buffer's velocity part, days. */
  velocityDays: number;
}

const truthy = (v: string | undefined) => /^(1|true|on|yes)$/i.test((v ?? '').trim());

function int(raw: string | undefined, fallback: number, min = 0): number {
  const n = Number((raw ?? '').trim());
  return (raw ?? '').trim() && Number.isInteger(n) && n >= min ? n : fallback;
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export const DEFAULT_DESK_CONFIG: DeskConfig = {
  enabled: false,
  dryRun: false,
  returnsEnabled: false,
  checkMinutes: 15,
  schedule: DEFAULT_SCHEDULE,
  buffer: 1_000n * USDC_UNIT,
  csaMinimum: 0n,
  collectionReserve: 0n,
  offRampLatencyMinutes: 240,
  marginMinutes: 60,
  windowMinutes: 180,
  bookSameDay: false,
  minMove: 10n * USDC_UNIT,
  returnIdleHours: 24,
  returnBusinessDays: 2,
  rolloverPendingShare: 1,
  capOverride: null,
  velocityDays: 7,
};

/** Whether the zone is one Intl knows. */
function zoneOk(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

export function deskConfigFromEnv(env: Record<string, string | undefined>): DeskConfig {
  const d = DEFAULT_DESK_CONFIG;
  const zone = (env.SETTLEMENT_CUTOFF_TZ ?? '').trim();
  const days = list(env.SETTLEMENT_BUSINESS_DAYS).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const holidays = list(env.SETTLEMENT_HOLIDAYS).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const share = Number((env.SETTLEMENT_ROLLOVER_PENDING_SHARE ?? '').trim());
  return {
    enabled: truthy(env.SETTLEMENT_FUNDING_ENABLED),
    dryRun: truthy(env.SETTLEMENT_FUNDING_DRY_RUN),
    returnsEnabled: truthy(env.SETTLEMENT_RETURNS_ENABLED),
    checkMinutes: int(env.SETTLEMENT_FUNDING_CHECK_MINUTES, d.checkMinutes, 1),
    schedule: {
      timeZone: zone && zoneOk(zone) ? zone : d.schedule.timeZone,
      cutoffMinutes: parseClock(env.SETTLEMENT_CUTOFF_TIME) ?? d.schedule.cutoffMinutes,
      businessDays: days.length ? [...new Set(days)] : d.schedule.businessDays,
      holidays,
      lagDays: int(env.SETTLEMENT_LAG_BUSINESS_DAYS, d.schedule.lagDays, 0),
    },
    buffer: parseUsdc(env.SETTLEMENT_BUFFER_USDC) ?? d.buffer,
    csaMinimum: parseUsdc(env.SETTLEMENT_CSA_MINIMUM_USDC) ?? d.csaMinimum,
    collectionReserve: parseUsdc(env.SETTLEMENT_COLLECTION_RESERVE_USDC) ?? d.collectionReserve,
    offRampLatencyMinutes: int(env.SETTLEMENT_OFFRAMP_LATENCY_MINUTES, d.offRampLatencyMinutes, 0),
    marginMinutes: int(env.SETTLEMENT_FORCED_MARGIN_MINUTES, d.marginMinutes, 0),
    windowMinutes: int(env.SETTLEMENT_FUNDING_WINDOW_MINUTES, d.windowMinutes, 0),
    bookSameDay: truthy(env.SETTLEMENT_BOOK_TRANSFER_SAME_DAY),
    minMove: parseUsdc(env.SETTLEMENT_MIN_MOVE_USDC) ?? d.minMove,
    returnIdleHours: int(env.SETTLEMENT_RETURN_IDLE_HOURS, d.returnIdleHours, 1),
    returnBusinessDays: Math.min(2, int(env.SETTLEMENT_RETURN_BUSINESS_DAYS, d.returnBusinessDays, 1)),
    rolloverPendingShare: Number.isFinite(share) && share >= 0 && share <= 1 && (env.SETTLEMENT_ROLLOVER_PENDING_SHARE ?? '').trim() ? share : d.rolloverPendingShare,
    capOverride: parseUsdc(env.SETTLEMENT_FUNDING_CAP_USDC),
    velocityDays: int(env.SETTLEMENT_VELOCITY_DAYS, d.velocityDays, 1),
  };
}

export function settlementFundingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return truthy(env.SETTLEMENT_FUNDING_ENABLED);
}

/** The desk wallet's CDP account name (looked up, never created); Build → Security's automatic jobs show it too. */
export function deskAccountName(id: number, env: Record<string, string | undefined> = process.env): string {
  return (env[`SETTLEMENT_DESK_CDP_ACCOUNT_NAME_${id}`] || env.SETTLEMENT_DESK_CDP_ACCOUNT_NAME || '').trim() || (id === 84532 ? 'settlement-desk-base-sepolia' : `settlement-desk-chain-${id}`);
}
