import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const READER = readFileSync(join(import.meta.dir, 'creditReader.ts'), 'utf8');
const SYNC = readFileSync(join(import.meta.dir, 'savingsCollateralService.ts'), 'utf8');
/*
 * The routes, because a sync that exists and is never called pledges nothing.
 *
 * An earlier version of this file asserted the function's *name* appeared in the service. Renaming
 * it to `syncBondCollateralDISABLED` still satisfied that — a substring match cannot tell a
 * definition from a corpse. What matters is that a request path invokes it, so that is what is
 * checked.
 */
const ROUTES = readFileSync(join(import.meta.dir, '../../routes/savings.ts'), 'utf8');

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
    expect(ROUTES).toMatch(/syncSavingsCollateralFromBalance\(/);
  });

  /*
   * Each collateral tier is checked against its *own* sync, not against any sync.
   *
   * An earlier version asserted /BOND|POOL_SHARE/ — which passes if either exists, so a bond
   * purchase shipped alongside a pool sync would have satisfied it while pledging nothing. A guard
   * that can be satisfied by the wrong tier is not a guard.
   */
  const APP = join(import.meta.dir, '../../../../member/src');
  const SEND_CALLS = readFileSync(join(APP, 'lib/sendCalls.ts'), 'utf8');

  test('a pool path exists, so the pool pledge must too', () => {
    expect(/scPoolDeposit|LendingPool|lendingPool/i.test(SEND_CALLS)).toBe(true);
    expect(ROUTES).toMatch(/await syncPoolCollateral\(/);
    expect(SYNC).toContain('POOL_SHARE_KIND');
  });

  test('a bond path exists, so the bond pledge must too', () => {
    expect(/scBuyBond|burnerBondDeposit/i.test(SEND_CALLS)).toBe(true);
    expect(ROUTES).toMatch(/await syncBondCollateral\(/);
    expect(SYNC).toContain('BOND_KIND');
  });

  test('bonds pledge by identity, not by amount', () => {
    // A bond has identity — the registry records which one, because refusing to let it move and
    // valuing it both need to know that. Half a bond is not a thing, so `pledge` would be wrong.
    expect(SYNC).toContain('pledgeItem');
    expect(SYNC).toContain('releaseItem');
  });

  test('and the bond set is reconciled both ways', () => {
    // A bond can leave by transfer, redemption or seizure. A pledge left behind would value a
    // member's line against something they no longer own.
    expect(SYNC).toContain('getBondIdsByCreator');
    expect(SYNC).toContain('pledgedItemsOf');
  });
});


/*
 * The haircuts exist in three places that cannot import from each other: the contracts, the app,
 * and this server. Two of them are copies, and a copy that drifts quotes a member a limit the
 * contracts will not give them.
 *
 * Pinned here against the registry as deployed on Base Sepolia — POOL_SHARE 7000 bps, BOND 9500 —
 * and against the app's own constants, which have their own matching test. If governance moves a
 * haircut, three tests fail and each names the file to change.
 */
describe('the server’s haircuts match the contracts and the app', () => {
  test('a pool share is 70%', async () => {
    const { POOL_LTV } = await import('../lithic/tierLimits.js');
    expect(POOL_LTV).toBeCloseTo(7_000 / 10_000, 6);
  });

  test('a bond is 95%', async () => {
    const { BOND_LTV } = await import('../lithic/tierLimits.js');
    expect(BOND_LTV).toBeCloseTo(9_500 / 10_000, 6);
  });

  test('and the app agrees', () => {
    const model = readFileSync(join(import.meta.dir, '../../../../member/src/lib/clearModel.ts'), 'utf8');
    expect(model).toContain('POOL_SHARE_HAIRCUT_BPS = 7_000');
    expect(model).toContain('BOND_HAIRCUT_BPS = 9_500');
  });
});
