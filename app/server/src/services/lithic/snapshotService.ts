import { getPayPool } from '../../config/postgres.js';
import { authStore } from './authStore.js';
import { lithicStore } from './lithicStore.js';
import { getLithic } from './lithicClient.js';
import { tierAvailability, tierLimits, type CollateralInputs } from './tierLimits.js';
import { outstandingFor } from '../deposits/depositReceiptService.js';
import { pulledFundsStore } from './pulledFundsStore.js';
import { readChainCollateral } from '../chain/collateralReader.js';
import { cardStore } from './cardStore.js';

/*
 * Keeping `available_by_tier` true — the writer behind spec step 3.
 *
 * The authorization path reads a snapshot and never derives one, which only works if something
 * rewrites it on every balance-changing event. That is this. It runs after a deposit, after a
 * savings movement, after a card settles, and on a schedule as a backstop — anywhere the answer to
 * "what can this member spend" could have changed.
 *
 * Two things it is careful about:
 *
 * Cash here means CARD-SPENDABLE cash, which is the Lithic balance alone. The member's cash account
 * also holds USDC on their smart account, and that is genuinely their money — it just cannot settle
 * a card authorization in the moment, because converting it is not something that happens inside an
 * authorization window. The Home page adds the two together for display; the waterfall must not.
 * Counting USDC here would approve spend the float cannot fund.
 *
 * Pulled funds do not count as collateral until their return window closes. That rule belongs to
 * step 5, and the seam is `pendingCollateralCents` — subtracted from savings-backed before the
 * limit is computed, so an ACH debit that gets returned in three days was never lending against
 * itself.
 */

export interface SnapshotSources extends CollateralInputs {
  /** Lithic's available balance in cents. Card-spendable, and the only cash the waterfall sees. */
  lithicCashCents: number;
  /** Collateral that has arrived but is inside a return window. Excluded until it clears. */
  pendingCollateralCents?: number;
  cardPaused?: boolean;
}

export interface SnapshotResult {
  written: boolean;
  reason?: string;
  cashCents: number;
  savingsCents: number;
  assetCents: number;
  incomeCents: number;
  boostCents: number;
}

/**
 * Estimated monthly deposit, from what has actually arrived.
 *
 * A trailing 90-day average rather than the last paycheck: income-backed credit is lent against a
 * pattern, and one large deposit should not triple someone's unsecured limit for a month. Returns
 * zero when there's no history, which correctly gives a new member no income-backed room.
 */
export async function estimateMonthlyDeposit(wallet: string): Promise<number> {
  const pool = getPayPool();
  if (!pool) return 0;
  try {
    const { rows } = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM deposit_receipts
       WHERE wallet = $1 AND received_at > now() - interval '90 days'`,
      [wallet.toLowerCase()],
    );
    const total = parseInt(rows[0]?.total ?? '0', 10) || 0;
    return Math.round(total / 3);
  } catch {
    return 0;
  }
}

/** Lithic's own figure for what's in the member's cash account. Authoritative for fiat. */
export async function readLithicCashCents(wallet: string): Promise<number> {
  const lithic = getLithic();
  const record = await lithicStore.get(wallet);
  if (!lithic || !record?.cashFinancialAccountToken) return 0;

  try {
    const account = await lithic.financialAccounts.retrieve(record.cashFinancialAccountToken);
    const balance = (account as { available_balance?: number; balance?: number }).available_balance;
    const fallback = (account as { balance?: number }).balance;
    return Math.max(0, Math.round(balance ?? fallback ?? 0));
  } catch {
    // A balance we cannot read is not a balance of zero — but for the waterfall it has to behave
    // like one, because approving against an unknown balance is the failure this must not have.
    return 0;
  }
}

/**
 * Recompute and store one member's availability.
 *
 * Sources are passed in rather than fetched here so the caller controls what it already knows —
 * a deposit handler has just been told the new cash balance and shouldn't ask Lithic again.
 */
export async function writeSnapshot(
  wallet: string,
  cardToken: string,
  sources: SnapshotSources,
): Promise<SnapshotResult> {
  const outstanding = (await outstandingFor(wallet)) ?? {
    boost: 0,
    income: 0,
    asset: 0,
    savings: 0,
  };

  const limits = tierLimits({
    ...sources,
    // Collateral inside a return window lends nothing. See step 5.
    savingsCents: Math.max(0, sources.savingsCents - (sources.pendingCollateralCents ?? 0)),
  });

  const availability = tierAvailability(limits, outstanding);
  const cashCents = Math.max(0, Math.round(sources.lithicCashCents));

  if (!authStore.isConfigured()) {
    return { written: false, reason: 'no database', cashCents, ...availability };
  }

  await authStore.putSnapshot({
    cardToken,
    wallet: wallet.toLowerCase(),
    cashCents,
    cardPaused: Boolean(sources.cardPaused),
    ...availability,
  });

  return { written: true, cashCents, ...availability };
}

/**
 * Rewrite the availability snapshot for every card this member holds.
 *
 * Runs after a transaction commits, never inside one: it reads Lithic and the chain, and holding a
 * database transaction open across network calls is how a busy payday becomes a lock queue. A
 * snapshot that lags by a second is fine; a stalled deposit pipeline is not.
 *
 * Never throws. A snapshot that couldn't be rewritten must not fail the money movement that
 * prompted it — the deposit did arrive, the sweep did mint. The scheduled refresh is the backstop,
 * and the card fails closed in the meantime, which is the safe direction to be wrong in.
 */
export async function refreshSnapshotsFor(
  wallet: string,
  collateral: Partial<CollateralInputs> = {},
): Promise<number> {
  const pool = getPayPool();
  if (!pool) return 0;
  try {
    // Both sources on purpose. Reading only the snapshot table would skip a card that has never
    // had a snapshot written — a card issued moments ago, which is precisely the one that most
    // needs one, since the auth stream fails closed and would decline its first charge. The card
    // list goes through the store so its table is guaranteed to exist before this runs.
    const [snapshotRows, cards] = await Promise.all([
      pool.query<{ card_token: string }>(
        `SELECT card_token FROM lithic_tier_snapshots WHERE wallet = $1`,
        [wallet.trim().toLowerCase()],
      ),
      cardStore.listFor(wallet),
    ]);

    const tokens = new Set<string>([
      ...snapshotRows.rows.map((row) => row.card_token),
      ...cards.map((card) => card.cardToken),
    ]);

    for (const token of tokens) {
      await refreshSnapshot(wallet, token, collateral);
    }
    return tokens.size;
  } catch (error) {
    console.error('[snapshots] refresh failed for', wallet, error);
    return 0;
  }
}

/**
 * Rebuild a member's snapshot from scratch — reads every source itself.
 *
 * The backstop path: used by the scheduled reconcile and by anything that knows a balance changed
 * without knowing what it changed to. Chain reads and Lithic calls happen HERE, never on the
 * authorization path.
 */
export async function refreshSnapshot(
  wallet: string,
  cardToken: string,
  collateral: Partial<CollateralInputs> = {},
): Promise<SnapshotResult> {
  const [lithicCashCents, monthlyDepositCents, pendingCollateralCents, chain, card] =
    await Promise.all([
      readLithicCashCents(wallet),
      collateral.monthlyDepositCents !== undefined
        ? Promise.resolve(collateral.monthlyDepositCents)
        : estimateMonthlyDeposit(wallet),
      // Money pulled from an outside bank that could still be returned. Held out of collateral —
      // see achOriginationService for why sixty days is the number that matters.
      pulledFundsStore.pendingCollateralCents(wallet),
      readChainCollateral(wallet),
      // A frozen card must stay frozen across a refresh. Defaulting this to false would let any
      // rebuild — a deposit, an hourly job — quietly reopen a card the member had shut off.
      cardStore.get(cardToken),
    ]);

  // An RPC failure is "we don't know", not "the member has nothing". Writing a snapshot built on a
  // failed read would cut their limit to zero over a network blip and decline them at a checkout,
  // so the previous snapshot — stale but true as of when it was written — stands instead.
  if (!chain.complete && collateral.savingsCents === undefined) {
    return {
      written: false,
      reason: 'chain collateral unreadable',
      cashCents: Math.max(0, Math.round(lithicCashCents)),
      savingsCents: 0,
      assetCents: 0,
      incomeCents: 0,
      boostCents: 0,
    };
  }

  return writeSnapshot(wallet, cardToken, {
    lithicCashCents,
    monthlyDepositCents,
    pendingCollateralCents,
    // Explicit arguments still win — a sweep that just minted knows the new balance before an RPC
    // read would agree, and making it wait for consensus would show the member a stale limit.
    savingsCents: collateral.savingsCents ?? chain.savingsCents ?? 0,
    bondsWorthCents: collateral.bondsWorthCents ?? chain.bondsWorthCents,
    poolPositionCents: collateral.poolPositionCents ?? chain.poolPositionCents ?? 0,
    boostLimitCents: collateral.boostLimitCents ?? 0,
    cardPaused: card?.state === 'PAUSED',
  });
}
