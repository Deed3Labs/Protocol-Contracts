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
