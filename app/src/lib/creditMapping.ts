import type { CreditTier, TierKey, Credit } from '@/lib/clearModel';
import type { CreditTierRow } from '@/utils/apiClient';

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
 * The credit line, with the parts the chain cannot answer left as they were.
 *
 * Carry cost is not read here. It accrues per position against a per-tier index, so the figure a
 * member owes right now is derivable but not a single call, and reporting a wrong one is worse
 * than reporting the placeholder it replaces.
 */
export function toCredit(rows: CreditTierRow[], fallback: Credit): Credit {
  const tiers = toCreditTiers(rows);
  if (tiers.length === 0) return fallback;
  return { ...fallback, tiers };
}
