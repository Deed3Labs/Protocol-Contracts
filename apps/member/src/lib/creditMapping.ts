import type {
  TermPlan,
  TermPlans,
  CreditTier,
  TierKey,
  Credit,
  Cycle,
  LimitBacking,
  LimitBackingRow,
} from '@/lib/clearModel';
import { money, count } from '@clear/domain';
import type { CreditTierRow, CreditCycleRow, CreditTermPlanRow } from '@/utils/apiClient';

/**
 * Turning the contracts' tiers into the ones a member reads.
 *
 * The two vocabularies differ on purpose. On-chain a tier is keyed by the *collateral kind* it
 * draws against, because that is what the registry values and haircuts. On the page a tier is one
 * of four things a member recognises. `ASSET_INTERNAL` is the only place they diverge today, and
 * they will diverge further: when bonds and pool shares become separate kinds with separate
 * haircuts, both still read as "Assets" to the member.
 *
 * Anything the chain reports that this does not recognise is dropped rather than guessed at. A
 * tier nobody has named is a tier nobody can price, and showing it under a made-up label would
 * put a number on a member's screen that no part of the product can explain.
 */
const KIND_TO_KEY: Record<string, TierKey> = {
  SAVINGS: 'savings',
  ASSET_INTERNAL: 'asset',
  ASSET: 'asset',
  BOND: 'asset',
  POOL_SHARE: 'asset',
  INCOME: 'income',
  BOOST: 'boost',
};

const LABELS: Record<TierKey, { label: string; shortLabel: string }> = {
  savings: { label: 'Savings (CLRUSD)', shortLabel: 'Savings' },
  asset: { label: 'Assets', shortLabel: 'Assets' },
  income: { label: 'Income', shortLabel: 'Income' },
  boost: { label: 'Clear Boost', shortLabel: 'Boost' },
};

/** Basis points per cycle, as the member is told it. */
function rateLabel(rateBps: number): string {
  if (rateBps === 0) return 'free';
  return `${(rateBps / 100).toFixed(2).replace(/\.?0+$/, '')}% / cycle`;
}

const fromCents = (cents: number) => cents / 100;

/**
 * Collapses the chain's tiers onto the page's four.
 *
 * Several chain kinds can map to one page tier, so limits and drawn amounts are summed rather than
 * overwritten — two asset kinds are one Assets row, and a member with both should see the total.
 * The rate shown is the highest of the collapsed set, which is the honest one: it is what the next
 * dollar drawn on that row will cost, and quoting the cheaper of two would understate it.
 */
export function toCreditTiers(rows: CreditTierRow[]): CreditTier[] {
  const merged = new Map<TierKey, CreditTier>();

  for (const row of rows) {
    const key = KIND_TO_KEY[row.kind];
    if (!key) continue;

    const existing = merged.get(key);
    const limit = fromCents(row.limitCents);
    const used = fromCents(row.usedCents);

    if (existing) {
      existing.limit += limit;
      existing.used += used;
      if (row.rateBps > (existing.ratePerCycle ?? 0) * 10_000) {
        existing.rate = rateLabel(row.rateBps);
        existing.ratePerCycle = row.rateBps / 10_000;
      }
      // A tier counts as added if any of its kinds lends anything.
      existing.added = existing.added || (row.active && limit > 0);
      continue;
    }

    merged.set(key, {
      key,
      label: LABELS[key].label,
      shortLabel: LABELS[key].shortLabel,
      rate: rateLabel(row.rateBps),
      ratePerCycle: row.rateBps / 10_000,
      used,
      limit,
      // Boost is opt-in: a tier that lends nothing is not part of the limit, and saying it is
      // would show a member a ceiling they cannot actually reach.
      added: row.active && limit > 0,
    });
  }

  return [...merged.values()];
}

/**
 * The credit line, carry included.
 *
 * Carry is summed from what each tier reports rather than derived from `used - principal`. The
 * issuer computes it against the tier's index; subtracting two rounded figures would produce a
 * third carrying both errors, on a number the member is actually charged.
 */
export function toCredit(
  rows: CreditTierRow[],
  fallback: Credit,
  /**
   * Carry a closed plan left on the ledger, in cents.
   *
   * Added to the tiers' own carry rather than shown apart from it. The member is charged one
   * figure and thinks in one figure; where the carry came from is our bookkeeping, not theirs. It
   * had no home at all before — the plan that carried it is closed, so the Term plans shelf does
   * not list it, and this function summed only the tier rows, so the credit card did not either.
   */
  carryOwedCents = 0,
): Credit {
  const tiers = toCreditTiers(rows);
  if (tiers.length === 0 && carryOwedCents === 0) return fallback;
  const carryCost =
    rows.reduce((sum, row) => sum + fromCents(row.carryCents), 0) + fromCents(carryOwedCents);
  return { ...fallback, tiers: tiers.length === 0 ? fallback.tiers : tiers, carryCost };
}

const DAY_SECONDS = 86_400;

/**
 * The credit period, as a member reads it.
 *
 * Returns the fallback when no line has ever been opened -- the mapping answers with zeroes, and a
 * cycle of zero days ending on the epoch is worse than the placeholder it would replace.
 *
 * `rebalanceBy` is the grace expiry, not the cycle end. The distinction is the whole point of the
 * row: the cycle is when the balance should clear, and the grace is how long after that the limit
 * survives before it contracts.
 */
export function toCycle(row: CreditCycleRow | null, fallback: Cycle): Cycle {
  // No period: fall straight through to whatever the caller supplies.
  //
  // This used to substitute a full cycle from the network's length, on the grounds that zero on a
  // countdown reads as expired when the truth is "not started". That reasoning still holds, but it
  // made the two states indistinguishable on screen -- a member with a real line and one with none
  // both showed thirty days -- and the state it was papering over should not exist at all: a
  // member has a line from signup, and the backfill gives one to everybody who predates that.
  //
  // So it is left visibly empty on purpose. If a member is seeing this, something did not open
  // their line, and that is worth being able to tell at a glance.
  if (!row || row.issuedAt === 0 || row.expiration === 0) return fallback;

  const now = Math.floor(Date.now() / 1000);
  const lengthDays = Math.max(1, Math.round((row.expiration - row.issuedAt) / DAY_SECONDS));
  // Never negative: an expired period has no days left, and a negative count would read as the
  // member being owed time.
  const daysLeft = Math.max(0, Math.ceil((row.expiration - now) / DAY_SECONDS));
  const onDay = (unix: number) =>
    new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return {
    lengthDays,
    daysLeft,
    clearsOn: onDay(row.expiration),
    rebalanceBy: onDay(row.expiration + row.graceLength),
  };
}

/**
 * What each tier is actually backed by.
 *
 * Two rows exist for two different reasons and the page splits them accordingly: a savings or
 * asset row is covered by something the co-op holds, so its detail shows the value, the haircut
 * and the rate -- the three figures that produce the contribution. An unsecured row has no
 * collateral to describe, so it shows the rate alone rather than a haircut of nothing.
 *
 * A tier that lends nothing is offered rather than hidden. `notAdded` is what makes Boost appear
 * with an Add action instead of a zero, and excludes it from the subtotal it is not part of.
 */
export function toLimitBacking(rows: CreditTierRow[], fallback: LimitBacking): LimitBacking {
  const assetBacked: LimitBackingRow[] = [];
  const unsecured: LimitBackingRow[] = [];

  for (const row of rows) {
    const key = KIND_TO_KEY[row.kind];
    if (!key) continue;

    const contribution = fromCents(row.limitCents);
    const collateral = fromCents(row.collateralValueCents);
    const secured = key === 'savings' || key === 'asset';
    const rate = rateLabel(row.rateBps);

    const entry: LimitBackingRow = {
      label: LABELS[key].label,
      contribution,
      detail: secured
        ? `${money(collateral)} value today · ${row.haircutBps / 100}% · ${rate}`
        : rate,
      tier: key,
      ...(contribution === 0 ? { notAdded: true } : {}),
    };

    (secured ? assetBacked : unsecured).push(entry);
  }

  if (assetBacked.length === 0 && unsecured.length === 0) return fallback;
  return { assetBacked, unsecured };
}


/**
 * The ELPA row, against the member's actual credits.
 *
 * Its unlock condition is a balance, not a date or a behaviour, so the row is the one place a
 * member watches that balance climb toward the thing they are saving for. It read a hardcoded "0
 * of 15,000" — the same for a member with nothing and a member with fourteen thousand.
 *
 * Returns the row with no `lockedNote` once the goal is met, which is what unlocks it: the shelf
 * treats a row as locked precisely when it carries a reason it is locked.
 */
function withElpaProgress(plan: TermPlan, equity?: { credits: number; goal: number }): TermPlan {
  if (!equity) return plan;
  if (equity.credits >= equity.goal) {
    const { lockedNote: _locked, ...unlocked } = plan;
    return unlocked;
  }
  return {
    ...plan,
    lockedNote: `${count(equity.credits)} of ${count(equity.goal)} credits`,
  };
}

/**
 * The term-plan shelf, from the plans the contracts hold.
 *
 * The last placeholder on Home, and the one that made day one's two arrivals unreachable: the page
 * already reverses its order for a member who has a plan, and until now no member could have one
 * the page could see. A counter arrival now leads with their repair because they actually have a
 * repair.
 *
 * Only open plans arrive here — the route filters closed ones out — so everything below describes
 * something still being paid.
 *
 * The locked rows in `fallback` are kept. They are not placeholder data standing in for something
 * unread: partner credit and an ELPA are real products a member has not unlocked yet, and the
 * spec is explicit that they are visible from the first minute with their own unlock conditions.
 * Dropping them because the chain returned one plan would delete the point of the component.
 */
export function toTermPlans(
  rows: CreditTermPlanRow[],
  fallback: TermPlans,
  /** The member's equity credits, and what an ELPA needs. Omitted before they have been read. */
  equity?: { credits: number; goal: number },
): TermPlans {
  const locked = fallback.plans
    .filter((plan) => plan.lockedNote)
    .map((plan) => (plan.id === 'elpa' ? withElpaProgress(plan, equity) : plan))
    // An ELPA whose condition is met is no longer a locked row; it is a product the member can
    // take up, and leaving it greyed out would be telling them they cannot have the thing they
    // just spent two years qualifying for.
    .filter((plan) => plan.lockedNote !== undefined);

  const live: TermPlan[] = rows.map((row) => {
    const cyclesLeft =
      row.installmentCents > 0
        ? Math.max(0, Math.ceil(row.outstandingCents / row.installmentCents))
        : undefined;

    return {
      id: String(row.planId),
      // An address is not what somebody recognises on their own shelf. Without a name the plan is
      // still shown — a row labelled generically beats a row that silently disappears.
      name: row.merchantName ?? 'Term plan',
      openedOn: row.openedAt
        ? new Date(row.openedAt * 1000).toLocaleDateString('en-US', { month: 'short' })
        : undefined,
      balance: fromCents(row.principalCents),
      splitInto: row.installments,
      perCycle: fromCents(row.installmentCents),
      cyclesLeft,
      rate: rateLabel(row.rateBps),
      ratePerCycle: row.rateBps / 10_000,
    };
  });

  // Nothing read is not the same as nothing owed. An empty array from a route that answered is a
  // member with no plans, and that is exactly what day one looks like — so it is kept, not
  // treated as a failed read. The route reports an unreadable chain as 503 and the caller never
  // gets here.
  return { ...fallback, plans: [...live, ...locked] };
}
