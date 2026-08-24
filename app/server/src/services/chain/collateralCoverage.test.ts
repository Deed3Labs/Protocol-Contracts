import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const READER = readFileSync(join(import.meta.dir, 'creditReader.ts'), 'utf8');
const SYNC = readFileSync(join(import.meta.dir, 'savingsCollateralService.ts'), 'utf8');

/*
 * Every tier the issuer offers has to be reachable, and this is the test that says so.
 *
 * The savings tier read zero for weeks with money sitting behind it, because minting the asset and
 * pledging it as collateral are separate steps and only the first was wired. Then the asset tiers
 * turned out to have the same shape of hole twice over: nothing pledges them, and the limits read
 * asked for a kind that is not an issuer tier at all.
 *
 * These are deployment facts, not code facts, which is why they kept slipping through unit tests.
 * The tiers below are what `RevolvingIssuer.tierAt` actually returns on Base Sepolia, read from
 * chain. If a tier is added, this list must grow, and the two checks under it say what wiring the
 * new tier needs before it can ever be anything but zero.
 */
const ISSUER_TIERS = ['SAVINGS', 'BOND', 'POOL_SHARE', 'INCOME', 'BOOST'] as const;

/** Tiers backed by a pledged asset. These need a sync that pledges as holdings change. */
const COLLATERAL_TIERS = ['SAVINGS', 'BOND', 'POOL_SHARE'] as const;

/**
 * Underwritten off-chain and delivered as attestations, so they have no holdings to sync. Named
 * here rather than left implicit — "no sync" has to be a decision, not an omission.
 */
const ATTESTED_TIERS = ['INCOME', 'BOOST'] as const;

describe('every issuer tier is accounted for', () => {
  test('the two lists cover the issuer exactly', () => {
    expect([...COLLATERAL_TIERS, ...ATTESTED_TIERS].sort()).toEqual([...ISSUER_TIERS].sort());
  });
});

describe('the limits read asks for tiers that exist', () => {
  test('it reads only kinds the issuer actually offers', () => {
    const asked = [...READER.matchAll(/encodeBytes32String\('([A-Z_]+)'\)/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(0);
    for (const kind of new Set(asked)) {
      expect(ISSUER_TIERS).toContain(kind as (typeof ISSUER_TIERS)[number]);
    }
  });

  test('ASSET_INTERNAL is never asked for', () => {
    // Registered as a collateral type, but not an issuer tier — so nothing is ever pledged under
    // it and the read returns zero forever. Zero is a number, so a caller's `?? fallback` never
    // fires either: the failure is total and silent.
    expect(READER).not.toContain("encodeBytes32String('ASSET_INTERNAL')");
  });

  test('both asset tiers are read, not just one', () => {
    expect(READER).toContain("encodeBytes32String('BOND')");
    expect(READER).toContain("encodeBytes32String('POOL_SHARE')");
  });
});

describe('collateral tiers have something that pledges them', () => {
  test('savings syncs from the balance that backs it', () => {
    expect(SYNC).toContain('SAVINGS');
    expect(SYNC).toContain('syncSavingsCollateralFromBalance');
  });

  /*
   * Deliberately not asserting that bonds and pool shares sync yet — they cannot, because there is
   * no way to buy either. `BuyBondDialog` and `PoolDepositDialog` render with no handler, nothing
   * calls the bond or pool contracts, and so no member can hold one to pledge.
   *
   * This test documents that and will fail the moment it stops being true, which is exactly when
   * the pledge becomes necessary. Whoever wires the purchase will land here and be told what else
   * the tier needs, instead of shipping a bond that mints fine and backs nothing.
   */
  test('bonds and pool shares still have no purchase path — wire the pledge when they do', () => {
    const app = join(import.meta.dir, '../../../../src');
    const sendCalls = readFileSync(join(app, 'lib/sendCalls.ts'), 'utf8');
    const bondPathExists = /scBuyBond|BondVault|burnerBond/i.test(sendCalls);
    const poolPathExists = /scPoolDeposit|LendingPool/i.test(sendCalls);

    if (bondPathExists || poolPathExists) {
      // A purchase path now exists. The tier it feeds needs a pledge, or it reads zero with the
      // asset sitting behind it — the savings bug, again, in a tier nobody is watching yet.
      expect(SYNC).toMatch(/BOND|POOL_SHARE/);
    } else {
      expect(bondPathExists).toBe(false);
      expect(poolPathExists).toBe(false);
    }
  });
});
