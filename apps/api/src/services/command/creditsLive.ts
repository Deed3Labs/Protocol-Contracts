import type { ChainReader } from './onchain.js';
import type { CreditsTotals } from '../payLedgerStore.js';
import type { HousingTotals } from '../housing/housingService.js';

/*
 * Clear Credits and the Housing Allowance, for Command's Money section:
 *
 *   - what the co-op's points line owes now (PointsIssuer.outstanding: credits minted and not yet
 *     redeemed, spent or reversed) and its cap, from the chain;
 *   - credits minted by why they were earned, what is still in its 30 days or vested and waiting for the
 *     minting job, what was voided, and what was minted each day, from the ledger (pay_credits);
 *   - every Housing Allowance record together: the Credit and Member Portions on live records, refunds
 *     due, and Credit Portions whose hold is over and may lapse, from the HousingAllowanceRecord.
 *
 * Each part is read on its own, so one that can't be read leaves the others standing (null).
 */

export interface CreditsLive {
  /** Credits the points line owes now, and the most it may owe. Null when the chain can't be read. */
  line: { outstanding: number; cap: number } | null;
  ledger: (CreditsTotals & { mintedTotal: number; mintedWeek: number }) | null;
  housing: HousingTotals | null;
}

/** Where Money reads the ledger and the records: the API's own unless a test gives its own. */
export interface CreditsSource {
  ledger: () => Promise<CreditsTotals>;
  housing: (() => Promise<HousingTotals>) | null;
}

export interface CreditsLiveDeps extends CreditsSource {
  reader: ChainReader;
}

/** Credits are 6-decimal amounts on their ledger; Command shows whole credits. */
const credits = (v: unknown) => Math.round(Number(BigInt(String(v)) / 10_000n) / 100);

export async function creditsLive(d: CreditsLiveDeps): Promise<CreditsLive> {
  const [line, ledger, housing] = await Promise.all([
    d.reader
      .read([
        { contract: 'PointsIssuer', fn: 'outstanding' },
        { contract: 'PointsIssuer', fn: 'cap' },
      ])
      .then(([outstanding, cap]) => ({ outstanding: credits(outstanding), cap: credits(cap) }))
      .catch(() => null),
    d
      .ledger()
      .then((t) => ({
        ...t,
        mintedTotal: t.minted.saving + t.minted.rent + t.minted.bill,
        mintedWeek: t.byDay.slice(-7).reduce((a, b) => a + b.minted, 0),
      }))
      .catch(() => null),
    d.housing ? d.housing().catch(() => null) : Promise.resolve(null),
  ]);
  return { line, ledger, housing };
}

/** The API's own: the pay ledger on the chain Command reads, and the Housing Allowance Record if deployed. */
export async function liveCreditsSource(): Promise<CreditsSource> {
  const [{ networkFromChainId, payLedgerStore }, { housingTotals, liveHousingChain }, { chainId }] = await Promise.all([
    import('../payLedgerStore.js'),
    import('../housing/housingService.js'),
    import('../chargeService.js'),
  ]);
  const housing = liveHousingChain();
  return {
    ledger: () => payLedgerStore.creditsTotals(networkFromChainId(chainId())),
    housing: housing ? () => housingTotals(housing) : null,
  };
}
