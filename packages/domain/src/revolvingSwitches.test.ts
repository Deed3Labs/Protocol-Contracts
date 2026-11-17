import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  AUTO_CLEAR_SCOPE,
  AUTO_CLEAR_TYPE_STRING,
  autoClearTypedData,
  SAVINGS_DRAW_TYPE_STRING,
  savingsDrawTypedData,
  switchMismatch,
} from './revolvingSwitches';

const MEMBER = '0x00000000000000000000000000000000000000a1';
const ISSUER = '0x00000000000000000000000000000000000000c4';
const cycles = new URL('../../../contracts/peripherals/RevolvingIssuerCycles.sol', import.meta.url);

describe('the member’s revolving switches are the contract’s typed data', () => {
  test('AutoClear and SavingsDrawAllowance, field for field', () => {
    expect(AUTO_CLEAR_TYPE_STRING).toBe('AutoClear(address member,bool on,uint8 scope,uint256 nonce,uint256 deadline)');
    expect(SAVINGS_DRAW_TYPE_STRING).toBe('SavingsDrawAllowance(address member,uint256 amount,uint256 nonce,uint256 deadline)');
  });

  test('and still match RevolvingIssuerCycles.sol, domain included', () => {
    if (!existsSync(cycles)) return;
    const source = readFileSync(cycles, 'utf8');
    expect(source).toContain(`"${AUTO_CLEAR_TYPE_STRING}"`);
    expect(source).toContain(`"${SAVINGS_DRAW_TYPE_STRING}"`);
    expect(source).toContain('keccak256("Clear RevolvingIssuer")');
  });

  test('scope 0 is unsecured only (the default), 1 is every tier', () => {
    expect(AUTO_CLEAR_SCOPE).toEqual({ UNSECURED_ONLY: 0, ALL: 1 });
  });
});

describe('what the phone checks before it signs a switch', () => {
  const expected = { chainId: 84532, revolvingIssuer: ISSUER };
  const on = autoClearTypedData({ chainId: 84532, revolvingIssuer: ISSUER, member: MEMBER, on: true, scope: 0, nonce: 2n, deadline: 2_000_000_000 });
  const allowance = savingsDrawTypedData({ chainId: 84532, revolvingIssuer: ISSUER, member: MEMBER, amount: 50_000_000n, nonce: 2n, deadline: 2_000_000_000 });

  test('the choice on the screen passes', () => {
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 0 }, expected, nowSeconds: 1 })).toBeNull();
    expect(switchMismatch({ typedData: allowance, shown: { member: MEMBER, amount: 50_000_000n }, expected, nowSeconds: 1 })).toBeNull();
  });

  test('anything else is refused', () => {
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 1 }, expected, nowSeconds: 1 })).toBe('a different setting');
    expect(switchMismatch({ typedData: on, shown: { member: ISSUER, on: true, scope: 0 }, expected, nowSeconds: 1 })).toBe('not your line');
    expect(switchMismatch({ typedData: allowance, shown: { member: MEMBER, amount: 1n }, expected, nowSeconds: 1 })).toBe('a different amount');
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 0 }, expected: { ...expected, chainId: 1 }, nowSeconds: 1 })).toBe('wrong network');
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 0 }, expected, nowSeconds: 2_000_000_000 })).toBe('a request that has expired');
  });
});
