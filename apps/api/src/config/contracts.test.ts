import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

/*
 * The Base Sepolia defaults are the deployment records (deployments/base-sepolia/<record>.json), not
 * typed-in addresses, and none names a contract retired with the pre-audit credit stack (decision 48)
 * or the pre-2f bonds. Env still wins over a default, so a stale env value is checked on the host.
 */

const records = new URL('../../../../deployments/base-sepolia/', import.meta.url);
const record = (name: string): string | null => {
  const file = new URL(`${name}.json`, records);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { address: string }).address : null;
};

/** The config key and the record it must name. */
const DEFAULTS: Record<string, string> = {
  ClearCredit: 'ClearCredit',
  RevolvingIssuer: 'RevolvingIssuer',
  TermIssuer: 'TermIssuer',
  CollateralRegistry: 'CollateralRegistry',
  LimitCalculator: 'LimitCalculator',
  AssurancePoolV2: 'AssurancePoolV2',
  SavingsIntentFactory: 'SavingsIntentFactory',
  BondVault: 'BondVault',
  BurnerBond: 'BurnerBond',
  BurnerBondFactory: 'BurnerBondFactory',
  BondValuer: 'BondValuer',
  LendingPool: 'LendingPool',
  EarnControls: 'EarnControls',
  PayoutPool: 'PayoutPool',
  MerchantRegistry: 'MerchantRegistry',
  Liquidator: 'Liquidator',
  CLRUSD: 'ClearUSDUpgradeable',
  ESADepositVault: 'ESADepositVault',
};

const ENV_KEYS = Object.keys(process.env).filter((k) => k.endsWith('_84532'));

describe('Base Sepolia defaults follow the deployment records', async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  const { DEPLOYED_CONTRACTS } = await import('./contracts');
  const sepolia = DEPLOYED_CONTRACTS[84532];

  test('each default is its record’s address', () => {
    if (!record('ClearCredit')) return; // the API checked out on its own
    for (const [key, name] of Object.entries(DEFAULTS)) {
      expect(`${key} ${sepolia[key]?.toLowerCase()}`).toBe(`${key} ${record(name)!.toLowerCase()}`);
    }
  });

  test('no default names a retired contract, and the retired deposit contract and OffersIssuer have none', () => {
    if (!record('ClearCredit')) return;
    const retired = ['ClearCreditPreAudit', 'RevolvingIssuerPreAudit', 'TermIssuerPreAudit', 'CollateralRegistryPreAudit', 'LimitCalculatorPreAudit',
      'PayoutPoolPreAudit', 'MerchantRegistryPreAudit', 'LiquidatorPreAudit', 'OffersIssuerPreAudit', 'BurnerBondPre2f', 'BurnerBondDepositPre2f',
      'BurnerBondFactoryPre2f', 'SavingsIntentFactoryPre2d']
      .map(record)
      .filter((a): a is string => Boolean(a))
      .map((a) => a.toLowerCase());
    for (const value of Object.values(sepolia)) expect(retired).not.toContain(String(value).toLowerCase());
    expect(sepolia.BurnerBondDeposit).toBeUndefined();
    expect(sepolia.OffersIssuer).toBe('');
  });
});
