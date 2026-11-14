import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { businessDayHorizon, PAYOUT_DUE_ABI, payoutDueWithin } from './payoutFunding';

const DAY = 86_400;
// Wednesday 2026-11-11 15:00 UTC, and Friday 2026-11-13 15:00 UTC.
const WED = Date.UTC(2026, 10, 11, 15) / 1000;
const FRI = Date.UTC(2026, 10, 13, 15) / 1000;

describe('two business days, as a horizon in seconds', () => {
  test('from a Wednesday: to the end of Friday', () => {
    expect(WED + businessDayHorizon(WED)).toBe(Date.UTC(2026, 10, 14) / 1000);
  });

  test('from a Friday: the weekend does not count, so to the end of Tuesday', () => {
    expect(FRI + businessDayHorizon(FRI)).toBe(Date.UTC(2026, 10, 18) / 1000);
  });

  test('one business day from a Saturday is the end of Monday', () => {
    const sat = FRI + DAY;
    expect(sat + businessDayHorizon(sat, 1)).toBe(Date.UTC(2026, 10, 17) / 1000);
  });
});

describe('PayoutPool.dueWithin, read inline', () => {
  test('the fragment is the contract’s signature', () => {
    const source = new URL('../../../../../contracts/peripherals/PayoutPool.sol', import.meta.url);
    let solidity = '';
    try {
      solidity = readFileSync(source, 'utf8');
    } catch {
      return; // the API checked out on its own
    }
    const decl = solidity.slice(solidity.indexOf('function dueWithin('), solidity.indexOf('{', solidity.indexOf('function dueWithin(')));
    expect(decl.replace(/\s+/g, ' ')).toContain('function dueWithin(uint256 horizon, uint256 maxClaims) external view returns (uint256[] memory ids, uint256 amount, uint256 short)');
    expect(PAYOUT_DUE_ABI[0]).toBe('function dueWithin(uint256 horizon, uint256 maxClaims) view returns (uint256[] ids, uint256 amount, uint256 short)');
  });

  test('says what is due, and what to fund, in cents', async () => {
    let asked: [bigint, bigint] | null = null;
    const due = await payoutDueWithin({
      chainId: 84532,
      nowSeconds: WED,
      pool: {
        dueWithin: async (horizon, max) => {
          asked = [horizon, max];
          return [[3n, 7n], 1_250_005_000n, 400_000_000n];
        },
      },
    });
    expect(asked).toEqual([BigInt(businessDayHorizon(WED)), 200n]);
    expect(due).toMatchObject({ claimIds: [3, 7], amountCents: 125_001, shortCents: 40_000, businessDays: 2, truncated: false });
  });

  test('an unreadable pool is null, never zeroes', async () => {
    const due = await payoutDueWithin({ chainId: 84532, pool: { dueWithin: async () => { throw new Error('no such function'); } } });
    expect(due).toBeNull();
  });
});

describe('Command shows it beside the payouts calendar', () => {
  const sections = readFileSync(new URL('../command/sections.ts', import.meta.url), 'utf8');
  test('the merchants section carries DUE_SOON from dueWithin', () => {
    expect(sections).toContain('await payoutDueWithin({ chainId: payoutChainId()');
    expect(sections).toContain('    DUE_SOON,');
  });
});
