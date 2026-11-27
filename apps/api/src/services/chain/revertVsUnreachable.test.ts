import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const reader = readFileSync(new URL('./collateralReader.ts', import.meta.url), 'utf8');
const snapshots = readFileSync(
  new URL('../lithic/snapshotService.ts', import.meta.url),
  'utf8',
);

/*
 * One optional read failing used to zero a member's entire credit line.
 *
 * The pool contract on Base Sepolia reverts on `balanceOf` — it is not an ERC-4626. That returned
 * null, which made the collateral read "incomplete", which sent refreshSnapshot down its
 * carry-forward branch, which never reached the limit calculator that could state the member's
 * $431.44 ceiling exactly. The snapshot kept the zero it was born with and every authorization
 * declined.
 */
describe('a revert is an answer, unreachable is not', () => {
  test('a deterministic revert reads as zero, not unknown', () => {
    expect(reader).toContain('isDeterministicRevert');
    expect(reader).toMatch(/isDeterministicRevert\(error\)\)\s*\{[\s\S]{0,300}return 0;/);
  });

  test('a transport failure still reads as unknown', () => {
    // Rule 2 survives: a timeout or rate limit must not cut a limit to nothing over a blip.
    expect(reader).toMatch(/pool read unreachable[\s\S]{0,200}return null;/);
  });

  test('only CALL_EXCEPTION can be a revert', () => {
    expect(reader).toContain("!== 'CALL_EXCEPTION') return false");
  });

  test('the node phrases we actually saw are the ones matched', () => {
    // "missing revert data" is what came back from Base Sepolia; "execution reverted" is what the
    // raw JSON-RPC call returns for the same contract.
    expect(reader).toContain('missing revert data');
    expect(reader).toContain('execution reverted');
  });
});

describe('a stated limit beats a carried one', () => {
  test('carry-forward is skipped when the calculator answered', () => {
    expect(snapshots).toContain('!capacities.available');
  });
});

/*
 * The reverting contract was not a broken yield pool. It was a Chainlink CCIP token pool — the thing
 * that moves CLRUSD between chains — read as if it held shares. Confirmed on Base Sepolia by
 * getToken() answering on that address, which only a CCIP pool does, while balanceOf and decimals
 * both reverted.
 */
describe('the yield pool is not the bridge pool', () => {
  const earn = readFileSync(new URL('./earnReader.ts', import.meta.url), 'utf8');

  test('collateral reads LendingPool, not the CCIP token pool', () => {
    /*
     * Verified on Base Sepolia: LendingPool answers asset() = USDC, decimals() = 6, and
     * convertToAssets on this member's shares = $320.00. CLRUSDTokenPool answers getToken() — which
     * only a CCIP pool does — and reverts on everything an ERC-4626 needs.
     */
    expect(reader).toContain("getContractAddress(chainId, 'LendingPool')");
    expect(reader).not.toContain("getContractAddress(chainId, 'CLRUSDTokenPool')");
  });

  test('both readers point at the same pool, so the two pages cannot disagree', () => {
    // The Earn page and the card's credit line are the same holding seen from two sides.
    expect(earn).toContain("getContractAddress(chainId, 'LendingPool')");
  });
});

describe('bonds back credit, not just the Earn page', () => {
  const earn = readFileSync(new URL('./earnReader.ts', import.meta.url), 'utf8');

  test('the collateral reader reads the bond collection', () => {
    // bondsWorthCents was hardcoded to 0 with a comment saying no bond contract was deployed.
    // BurnerBond was deployed, and earnReader had been reading it the whole time.
    expect(reader).toContain("getContractAddress(chainId, 'BurnerBond')");
    expect(reader).toContain('readBondCents');
    expect(reader).not.toMatch(/bondsWorthCents: 0,\s*\n\s*complete:/);
  });

  test('it reads the same collection the Earn page does', () => {
    expect(earn).toContain("getContractAddress(chainId, 'BurnerBond')");
  });

  test('present value, never face value', () => {
    // A bond matures INTO its face value and is worth less until then. Lending against face lends
    // against money that does not exist yet.
    expect(reader).toContain('presentValueOf');
    expect(reader).not.toContain('faceValue)');
  });

  test('created is not held, and redeemed backs nothing', () => {
    expect(reader).toMatch(/balanceOf\(wallet, id\)[\s\S]{0,120}if \(balance === 0n\) continue/);
    expect(reader).toContain('if (info.isRedeemed) continue');
  });
});

/*
 * Verified against Base Sepolia while chasing why the deployed read failed: this member holds bond
 * ids [1, 2], neither redeemed, present values $97.17 and $97.10. Every call in the sequence
 * succeeds when made directly — sequential or batched, checksummed address or lowercased. So the
 * failure lives in the deployed process, and the code has to say what it was rather than swallow it.
 */
describe('a bond read that fails says why', () => {
  const reader = readFileSync(new URL('./collateralReader.ts', import.meta.url), 'utf8');

  test('the error reaches the log in both branches', () => {
    // The first version logged "cannot be read" with no error attached, which is what made the
    // deployed failure undiagnosable from outside.
    expect(reader).toMatch(/bond read reverted[\s\S]{0,60}, error\)/);
    expect(reader).toMatch(/bond read unreachable[\s\S]{0,40}, error\)/);
  });

  test('one unreadable bond costs only itself', () => {
    // Wrapping the loop meant a single bad id zeroed every bond the member holds.
    expect(reader).toMatch(/for \(const id of ids\) \{[\s\S]{0,600}try \{/);
    expect(reader).toContain('could not be priced — skipped');
  });
});
