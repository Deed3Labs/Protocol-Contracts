import {
  CREDIT_TIERS,
  TIER_ORDER,
  mergeDraws,
  releaseDraws,
  type CreditFeeInput,
  type Draw,
  type DrawSource,
} from './authDecision.js';

/*
 * The card credit fee's settings, and the chain's bound on it (decision 55,
 * docs/audit/specs/card-credit-fee.md).
 *
 * A Clear Visa purchase that draws on a credit tier adds a flat fee on top (30¢ when it is switched
 * on). Two switches, and both must be on: the API's `CARD_CREDIT_FEE_CENTS`, and the RevolvingIssuer's
 * `maxCardCreditFee`, which bounds what the settler can charge. A fee the chain would refuse is never
 * decided, so it is never shown to a member and never held against their line.
 *
 * The Auth Stream answers from a snapshot and never calls out, so the chain's bound is read off the
 * authorization path (the card settlement sweeper, at startup and every pass) and cached here. This
 * file holds only the cache and pure arithmetic: nothing in it reaches a chain, which is what lets
 * the authorization path import it.
 *
 * OFF BY DEFAULT, and it stays off for real members until the plan of business allows it (L-02
 * §2.6C): `CARD_CREDIT_FEE_CENTS` defaults to 0, and the chain's bound defaults to 0 after the
 * upgrade. Who never pays it, whatever the settings (MB-04): a purchase Spendable covers in full; a
 * Pay with Clear payment (it never passes through the card's Auth Stream, the only caller of the
 * decision that adds the fee); a hold that never settles (released with the hold); and a member who
 * is a covered borrower under the Military Lending Act (MB-04 §5.10), read from the snapshot.
 * One fee per purchase, however many tiers it draws on and however many times the merchant clears it.
 */

export interface CreditFeeSettings {
  /** The fee in cents. 0 (the default) is off. */
  cents: number;
  /** Which tiers' use carries the fee. Default every credit tier. */
  tiers: DrawSource[];
  /** A purchase below this carries no fee. Default 0: no minimum. */
  minPurchaseCents: number;
}

const DEFAULT_TIERS: DrawSource[] = [...CREDIT_TIERS];

function wholeCents(raw: string | undefined): number {
  const text = String(raw ?? '').trim();
  if (!text) return 0;
  const value = Number(text);
  // A setting we cannot read is off, never a guess: a fee is money taken from a member.
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The settings, from the environment. Unreadable values read as off, or as the default. */
export function creditFeeSettings(env: Record<string, string | undefined> = process.env): CreditFeeSettings {
  const tiersRaw = String(env.CARD_CREDIT_FEE_TIERS ?? '').trim();
  const named = tiersRaw
    ? tiersRaw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t): t is DrawSource => (TIER_ORDER as readonly string[]).includes(t) && t !== 'cash')
    : DEFAULT_TIERS;
  return {
    cents: wholeCents(env.CARD_CREDIT_FEE_CENTS),
    tiers: [...new Set(named)],
    minPurchaseCents: wholeCents(env.CARD_CREDIT_FEE_MIN_PURCHASE_CENTS),
  };
}

/** Ledger units are the reserve token's six decimals; cents are two. */
export const FEE_CENTS_TO_UNITS = 10n ** 4n;

/**
 * The fee in force: the API's setting when the chain's bound covers it, else zero.
 *
 * `chainMaxUnits` is `maxCardCreditFee()` in ledger units (30¢ = 300000), or null when it has not
 * been read (or the last read is too old to trust). Null and zero both mean off: the chain refuses a
 * fee above its bound, so deciding one would put a charge on the member that settlement cannot make.
 */
export function effectiveCreditFee(
  settings: CreditFeeSettings,
  chainMaxUnits: bigint | null,
): CreditFeeInput {
  const off: CreditFeeInput = { cents: 0, tiers: settings.tiers, minPurchaseCents: settings.minPurchaseCents };
  if (!(settings.cents > 0) || chainMaxUnits === null || chainMaxUnits <= 0n) return off;
  if (BigInt(settings.cents) * FEE_CENTS_TO_UNITS > chainMaxUnits) return off;
  return { cents: settings.cents, tiers: settings.tiers, minPurchaseCents: settings.minPurchaseCents };
}

// ---- The cached bound ------------------------------------------------------------------------------

/** How long a read of the chain's bound is trusted. Past it, the fee is off until the next read. */
export const CHAIN_MAX_TRUSTED_MS = 60 * 60 * 1000;

let cachedMaxUnits: bigint | null = null;
let cachedAt = 0;

/** Record what the chain said (0n for a revert: the contract before the upgrade has no fee). */
export function setChainMaxCardCreditFee(units: bigint, at = Date.now()): void {
  cachedMaxUnits = units < 0n ? 0n : units;
  cachedAt = at;
}

/** The last trusted read, or null. */
export function chainMaxCardCreditFee(now = Date.now()): bigint | null {
  if (cachedMaxUnits === null || now - cachedAt > CHAIN_MAX_TRUSTED_MS) return null;
  return cachedMaxUnits;
}

/** For tests. */
export function resetChainMaxCardCreditFee(): void {
  cachedMaxUnits = null;
  cachedAt = 0;
}

/** What the authorization path passes to `decide`. No I/O: settings and a cached number. */
export function currentCreditFee(now = Date.now()): CreditFeeInput {
  return effectiveCreditFee(creditFeeSettings(), chainMaxCardCreditFee(now));
}

// ---- The fee's life on one purchase -----------------------------------------------------------------

/**
 * Where one purchase's fee stands, stored beside the authorization (`fee_status`).
 *
 *   held      decided at the swipe, drawn off the snapshot, not on chain yet. Shown as pending.
 *   charged   settled on chain with the purchase (`settleCardSpendWithFee`). The chain carries it.
 *   released  the purchase's credit part fell to zero before settlement (a void, or a clearing paid
 *             from cash): never charged.
 *   waived    decided, but the chain no longer accepted it at settlement (its bound lowered below
 *             the fee, or to zero): the purchase settled without it.
 *   returned  the purchase was refunded in full after settlement and the contract gave the fee back.
 *
 * Null: the purchase never carried one.
 */
export type CreditFeeStatus = 'held' | 'charged' | 'released' | 'waived' | 'returned';

/**
 * The fee still owed on this purchase: held, or on chain less what has been credited back
 * (`returnCardCreditFee`, MB-04 §5.4(f)). Released, waived and returned owe nothing.
 */
export function liveFeeCents(feeCents: unknown, status: unknown, returnedCents: unknown = 0): number {
  const cents = Number(feeCents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  if (status === 'held') return Math.round(cents);
  if (status !== 'charged') return 0;
  const back = Number(returnedCents ?? 0);
  return Math.max(0, Math.round(cents) - (Number.isFinite(back) ? Math.max(0, Math.round(back)) : 0));
}

/** The fee while it is only a hold (not on chain yet): what the member's pending figures include. */
export function heldFeeCents(feeCents: unknown, status: unknown): number {
  return status === 'held' ? liveFeeCents(feeCents, status) : 0;
}

/**
 * The tiers a fee still sits on once some of it was credited back. Credits come off the dearest tier
 * first, the way every release does (authDecision.releaseDraws), so what is left is the cheapest.
 */
export function feeDrawsLeft(feeDraws: Draw[], returnedCents: number): Draw[] {
  const back = releaseDraws(feeDraws, Math.max(0, Math.round(returnedCents || 0)));
  return mergeDraws(feeDraws, back.map((d) => ({ ...d, amountCents: -d.amountCents })));
}

/**
 * MB-04 §5.4(f): carry plus the card credit fee may never exceed the CFL maximum on the principal,
 * and any excess is credited back by that cycle's statement at the latest.
 *
 * How the excess is measured is not settled (counsel question MB-04 #52), so this returns 0 and the
 * rule is not invented here. The cycle keeper calls it for every member whose cycle it closes
 * (cardFeeCap.ts), and anything it returns is credited back on chain with `returnCardCreditFee`; when
 * counsel answers, the measurement goes in this one function.
 */
export function cardFeeCapExcess(_input: {
  wallet: string;
  /** The cycle's window, unix ms. */
  cycleStartMs: number;
  cycleEndMs: number;
  /** The fees charged in the cycle, net of anything already credited back. */
  feesCents: number;
  /** Carry accrued in the cycle, when known. */
  carryCents: number | null;
  /** The principal the CFL maximum is measured on, when known. */
  principalCents: number | null;
}): number {
  return 0;
}
