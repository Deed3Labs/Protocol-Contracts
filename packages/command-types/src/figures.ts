import growthFigures from './fixtures/growth-figures.json';
import merchantsFigures from './fixtures/merchants-figures.json';
import moneyFigures from './fixtures/money-figures.json';
import shopFigures from './fixtures/shop-figures.json';
import contractsFigures from './fixtures/contracts-figures.json';
import governanceFigures from './fixtures/governance-figures.json';
import recordsFigures from './fixtures/records-figures.json';
import homeFigures from './fixtures/home-figures.json';

/**
 * The figures each section shows that aren't counted from its own rows: weekly series, the waitlist,
 * previews. Stored in `command.figures` by key, written by the seed (these values, the prototype's)
 * and later by the jobs that compute them from live sources.
 */

export const MEMBERS_FIGURES = {
  /** People waiting for an invite. */
  'members.waitlist.total': 1500,
  'members.waitlist.median_days': 24,
  'members.waitlist.over_4_weeks': 440,
  'members.waitlist.wait_buckets': [
    ['< 1 wk', 318],
    ['1–2 wks', 300],
    ['2–3 wks', 270],
    ['3–4 wks', 172],
    ['4–6 wks', 260],
    ['6 wks +', 180],
  ],
  'members.waitlist.sources': [
    ['Poster', 1236],
    ['Website', 264],
  ],
  'members.waitlist.cities': [
    ['Redlands', 480],
    ['San Bernardino', 390],
    ['Riverside', 270],
    ['Other', 360],
  ],
  /** Twelve weeks, 4 Aug to 20 Oct. */
  'members.weekly.opened': [0, 0, 0, 0, 0, 0, 14, 18, 32, 48, 44, 32],
  'members.weekly.active_total': [0, 0, 0, 0, 0, 0, 9, 25, 49, 82, 117, 124],
  'members.weekly.first_spend_total': [0, 0, 0, 0, 0, 0, 6, 19, 40, 68, 96, 109],
  'members.weekly.waitlist_total': [20, 48, 88, 118, 193, 288, 393, 572, 792, 1007, 1232, 1500],
  /** First spends that were a poster's $10. */
  'members.first_spends.poster_ten': 97,
  /** Who the next batch would take, by size: weeks waited (under 4, 4–6, over 6), source, city. */
  'members.next_batch.preview': {
    25: { wk: [25, 0, 0], src: [22, 3], city: [10, 7, 4, 4] },
    50: { wk: [50, 0, 0], src: [43, 7], city: [19, 14, 9, 8] },
    75: { wk: [71, 4, 0], src: [64, 11], city: [28, 21, 13, 13] },
  },
} as const;

/** Growth's figures, written from the prototype's data by apps/command/scripts/fixtures.ts. */
export const GROWTH_FIGURES: Record<string, unknown> = growthFigures;

/** Merchants' figures, likewise. */
export const MERCHANTS_FIGURES: Record<string, unknown> = merchantsFigures;

/** Money's figures, likewise. */
export const MONEY_FIGURES: Record<string, unknown> = moneyFigures;

/** The shop's figures, likewise. */
export const SHOP_FIGURES: Record<string, unknown> = shopFigures;

/** Contracts', Governance's, Records' and Home's figures, likewise. */
export const CONTRACTS_FIGURES: Record<string, unknown> = contractsFigures;
export const GOVERNANCE_FIGURES: Record<string, unknown> = governanceFigures;
export const RECORDS_FIGURES: Record<string, unknown> = recordsFigures;
export const HOME_FIGURES: Record<string, unknown> = homeFigures;

export const SEED_FIGURES: Record<string, unknown> = {
  ...MEMBERS_FIGURES,
  ...GROWTH_FIGURES,
  ...MERCHANTS_FIGURES,
  ...MONEY_FIGURES,
  ...SHOP_FIGURES,
  ...CONTRACTS_FIGURES,
  ...GOVERNANCE_FIGURES,
  ...RECORDS_FIGURES,
  ...HOME_FIGURES,
};
