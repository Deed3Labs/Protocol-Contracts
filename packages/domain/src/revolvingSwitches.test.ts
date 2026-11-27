import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  AUTO_CLEAR_AUTHORIZATION_VERSION,
  AUTO_CLEAR_SCOPE,
  AUTO_CLEAR_TYPE_STRING,
  autoClearAuthorizationLines,
  autoClearAuthorizationText,
  autoClearTypedData,
  SAVINGS_DRAW_TYPE_STRING,
  savingsDrawTypedData,
  switchMismatch,
  ZERO_AUTH_HASH,
} from './revolvingSwitches';

const MEMBER = '0x00000000000000000000000000000000000000a1';
const ISSUER = '0x00000000000000000000000000000000000000c4';
const workouts = new URL('../../../contracts/peripherals/RevolvingIssuerWorkouts.sol', import.meta.url);
const base = new URL('../../../contracts/peripherals/RevolvingIssuerBase.sol', import.meta.url);
const AUTH = '0x' + 'aa'.repeat(32);

describe('the member’s revolving switches are the contract’s typed data', () => {
  test('AutoClear and SavingsDrawAllowance, field for field', () => {
    expect(AUTO_CLEAR_TYPE_STRING).toBe('AutoClear(address member,bool on,uint8 level,bytes32 authHash,uint256 nonce,uint256 deadline)');
    expect(SAVINGS_DRAW_TYPE_STRING).toBe('SavingsDrawAllowance(address member,uint256 amount,uint256 nonce,uint256 deadline)');
  });

  test('and still match RevolvingIssuerWorkouts.sol, domain included', () => {
    if (!existsSync(workouts)) return;
    const source = readFileSync(workouts, 'utf8');
    expect(source).toContain(`"${AUTO_CLEAR_TYPE_STRING}"`);
    expect(source).toContain(`"${SAVINGS_DRAW_TYPE_STRING}"`);
    expect(readFileSync(base, 'utf8')).toContain('keccak256("Clear RevolvingIssuer")');
  });

  test('level 0 is unsecured only (the default), 1 is every tier, 2 only what is due', () => {
    expect(AUTO_CLEAR_SCOPE).toEqual({ UNSECURED_ONLY: 0, ALL: 1, DUE_ONLY: 2 });
  });

  test('the authorization is versioned and says what each level clears', () => {
    const lines = autoClearAuthorizationLines(0);
    expect(lines[0]).toBe(AUTO_CLEAR_AUTHORIZATION_VERSION);
    expect(autoClearAuthorizationText(lines)).toBe(lines.join('\n'));
    expect(autoClearAuthorizationText(autoClearAuthorizationLines(1))).not.toBe(autoClearAuthorizationText(lines));
    expect(lines.join(' ')).toContain('federal benefit payer');
  });
});

describe('what the phone checks before it signs a switch', () => {
  const expected = { chainId: 84532, revolvingIssuer: ISSUER };
  const on = autoClearTypedData({ chainId: 84532, revolvingIssuer: ISSUER, member: MEMBER, on: true, scope: 0, authHash: AUTH, nonce: 2n, deadline: 2_000_000_000 });
  const off = autoClearTypedData({ chainId: 84532, revolvingIssuer: ISSUER, member: MEMBER, on: false, scope: 0, authHash: ZERO_AUTH_HASH, nonce: 2n, deadline: 2_000_000_000 });
  const allowance = savingsDrawTypedData({ chainId: 84532, revolvingIssuer: ISSUER, member: MEMBER, amount: 50_000_000n, nonce: 2n, deadline: 2_000_000_000 });

  test('the choice on the screen passes', () => {
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 0, authHash: AUTH }, expected, nowSeconds: 1 })).toBeNull();
    expect(switchMismatch({ typedData: off, shown: { member: MEMBER, on: false, scope: 0 }, expected, nowSeconds: 1 })).toBeNull();
    expect(on.message.level).toBe(0);
    expect(switchMismatch({ typedData: allowance, shown: { member: MEMBER, amount: 50_000_000n }, expected, nowSeconds: 1 })).toBeNull();
  });

  test('anything else is refused', () => {
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 1, authHash: AUTH }, expected, nowSeconds: 1 })).toBe('a different setting');
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 0, authHash: ZERO_AUTH_HASH }, expected, nowSeconds: 1 })).toBe(
      'a different authorization',
    );
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 0 }, expected, nowSeconds: 1 })).toBe('a different authorization');
    expect(switchMismatch({ typedData: on, shown: { member: ISSUER, on: true, scope: 0, authHash: AUTH }, expected, nowSeconds: 1 })).toBe('not your line');
    expect(switchMismatch({ typedData: allowance, shown: { member: MEMBER, amount: 1n }, expected, nowSeconds: 1 })).toBe('a different amount');
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 0, authHash: AUTH }, expected: { ...expected, chainId: 1 }, nowSeconds: 1 })).toBe('wrong network');
    expect(switchMismatch({ typedData: on, shown: { member: MEMBER, on: true, scope: 0, authHash: AUTH }, expected, nowSeconds: 2_000_000_000 })).toBe('a request that has expired');
  });
});
