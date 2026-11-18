import { getAddress } from 'viem';

/*
 * Build → Contracts, the two cards under the map (brief update 2, section 6), and the timelocks the map is
 * headed with: worked out from the deployment records by name (the indexer's inventory, command.chain_contracts,
 * synced from deployments/base-sepolia), never from a hand list of addresses. A record that isn't there isn't
 * shown; one that lands (OffersIssuer.json, a new timelock) shows up by its name.
 *
 * - Timelocks and helpers (`CTR_AUX`): every `*Timelock` record, then BurnerBondFactory, BurnerBondDeposit and
 *   Create2Deployer, each with what it does and who runs it (the reference's words, by name; a record the table
 *   doesn't know gets '…' and no one).
 * - Retired (`CTR_OLD`): the old OffersIssuer, AssurancePool v1, ClearUSD v1 and AssuranceOracle, each only when
 *   its record is there (and, for the two replaced in place, when what replaced it is). `CTR_OLD_N` counts the
 *   other earlier copies: names ending PreAudit, Pre2f, Pre2d or Legacy, and a `*V1` whose unsuffixed name is
 *   also recorded (RevolvingIssuerV1, retired before the audit: docs/audit/DEPLOY-RUNBOOK.md). The records carry
 *   nothing that marks a copy retired, so the names are the mark.
 */

type Inventory = Map<string, { address: string }>;
/** name, address (shortened), what it does, who runs it */
export type AuxRow = [string, string, string, string];
/** label, address (shortened), note */
export type OldRow = [string, string, string];

const short = (a: string) => {
  const g = getAddress(a);
  return `${g.slice(0, 6)}…${g.slice(-4)}`;
};

/** The timelocks in the order the reference lists them; one it doesn't know comes after, by name. */
const TIMELOCK_ORDER = ['CreditTimelock', 'AssuranceTimelock', 'VaultTimelock', 'EarnTimelock'];
const HELPERS = ['BurnerBondFactory', 'BurnerBondDeposit', 'Create2Deployer'];

/** What each does and who runs it, as the reference's CTR_AUX words it. */
const AUX_WORDS: Record<string, [string, string]> = {
  CreditTimelock: ['Holds the credit contracts’ upgrades and settings for 7 days', 'Clear Treasury Safe, as the Ops Safe'],
  AssuranceTimelock: ['Holds AssurancePool changes for 7 days, after two Assurance signers approve', 'Clear Treasury Safe, as the board Safe'],
  VaultTimelock: ['Holds the savings vault and CLRUSD changes for 7 days', 'Clear Treasury Safe, as the Clear Financial Safe'],
  EarnTimelock: ['Holds EarnControls, the Yield Pool, BondVault and the bond contracts for 7 days', 'Clear Lending Safe'],
  BurnerBondFactory: ['Opens a bond collection for each approved token', 'Through the Earn timelock'],
  BurnerBondDeposit: ['Takes the money behind each bond and holds the proceeds', 'Through the Earn timelock'],
  Create2Deployer: ['Deploys contracts to addresses known in advance', 'No one: a helper'],
};

const RETIRED = /(PreAudit|Pre2f|Pre2d|Legacy)$/;

/** The `*Timelock` records, the reference's four first. */
export function timelocksOf(inv: Inventory): string[] {
  const rank = (n: string) => (TIMELOCK_ORDER.includes(n) ? TIMELOCK_ORDER.indexOf(n) : TIMELOCK_ORDER.length);
  return [...inv.keys()].filter((n) => /Timelock$/.test(n)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function auxRows(inv: Inventory): AuxRow[] {
  return [...timelocksOf(inv), ...HELPERS.filter((n) => inv.has(n))].map((n) => [n, short(inv.get(n)!.address), ...(AUX_WORDS[n] ?? ['…', ''])] as AuxRow);
}

export function retiredRows(inv: Inventory): { CTR_OLD: OldRow[]; CTR_OLD_N: number } {
  const at = (n: string) => short(inv.get(n)!.address);
  const listed: Array<[string, OldRow]> = [];
  if (inv.has('OffersIssuerPreAudit'))
    listed.push([
      'OffersIssuerPreAudit',
      ['OffersIssuer (old)', at('OffersIssuerPreAudit'), inv.has('OffersIssuer') ? 'Replaced by the 17 Nov deploy' : 'Replaced on 17 Nov · the new record isn’t pushed yet'],
    ]);
  if (inv.has('AssurancePool') && inv.has('AssurancePoolV2')) listed.push(['AssurancePool', ['AssurancePool v1', at('AssurancePool'), 'Replaced by AssurancePool v2']]);
  if (inv.has('ClearUSD') && inv.has('ClearUSDUpgradeable')) listed.push(['ClearUSD', ['ClearUSD v1', at('ClearUSD'), 'Replaced by the upgradeable ClearUSD']]);
  if (inv.has('AssuranceOracle')) listed.push(['AssuranceOracle', ['AssuranceOracle', at('AssuranceOracle'), 'Off the money path since section 13']]);
  const shown = new Set(listed.map(([n]) => n));
  const earlier = [...inv.keys()].filter((n) => !shown.has(n) && (RETIRED.test(n) || (/V1$/.test(n) && inv.has(n.slice(0, -2)))));
  return { CTR_OLD: listed.map(([, r]) => r), CTR_OLD_N: earlier.length };
}
