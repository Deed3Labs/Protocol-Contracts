import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { decodeStateCode, encodeStateCode, normalizeStateCode, US_STATE_NAMES } from './stateCode';
import { describeCreditRefusal, decodeChainError, CHAIN_ERRORS } from './chainErrors';

/*
 * The attestation must be the bytes the contracts compare: deploy 25 writes each RateSchedule
 * product under `ethers.encodeBytes32String(state)` for the codes in deploy/config/rate-schedule.json,
 * and the RevolvingIssuer's state gate looks the attested bytes32 up there as it is.
 */

const config = new URL('../../../../../deploy/config/rate-schedule.json', import.meta.url);
const deploy = new URL('../../../../../deploy/25_wire_Compliance.ts', import.meta.url);

describe('the state code is encoded exactly as deploy 25 encodes the rate table', () => {
  test('CA is 0x4341 then zeros: left-aligned ASCII, as encodeBytes32String writes it', () => {
    expect(encodeStateCode('CA')).toBe(`0x4341${'00'.repeat(30)}`);
    expect(decodeStateCode(encodeStateCode('CA'))).toBe('CA');
  });

  test('every state in the rate table encodes to the bytes deploy 25 wrote for it', () => {
    if (!existsSync(config)) return; // the API checked out on its own
    const table = JSON.parse(readFileSync(config, 'utf8')) as { products: Array<{ state: string; role: string; product: string }> };
    const states = [...new Set(table.products.map((p) => p.state))];
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) {
      expect(normalizeStateCode(state)).toEqual({ ok: true, code: state });
      expect(encodeStateCode(state)).toBe(ethers.encodeBytes32String(state));
    }
    // The revolving product the state gate asks about is the table's ceiling: REVOLVING, in CA.
    expect(table.products.find((p) => p.role === 'revolving-ceiling')).toMatchObject({ state: 'CA', product: 'REVOLVING' });
  });

  test('deploy 25 still encodes with encodeBytes32String', () => {
    if (!existsSync(deploy)) return;
    expect(readFileSync(deploy, 'utf8')).toContain('state: ethers.encodeBytes32String(p.state)');
  });

  test('the member-facing sentences read the same encoding back', () => {
    const data = CHAIN_ERRORS.encodeErrorResult('RevolvingIssuerStateNotEnabled', [ethers.ZeroAddress, encodeStateCode('NY')]);
    expect(describeCreditRefusal(decodeChainError({ data }))).toContain('in NY');
  });

  test('zero is no state; nothing else is encoded', () => {
    expect(decodeStateCode(ethers.ZeroHash)).toBeNull();
    expect(decodeStateCode(undefined)).toBeNull();
    expect(() => encodeStateCode('ca')).toThrow();
    expect(() => encodeStateCode('XX')).toThrow();
    expect(() => encodeStateCode('California')).toThrow();
  });
});

describe('the profile’s free-text state, read as a code and never guessed', () => {
  test('a code in any case or a full name', () => {
    expect(normalizeStateCode('CA')).toEqual({ ok: true, code: 'CA' });
    expect(normalizeStateCode(' ny ')).toEqual({ ok: true, code: 'NY' });
    expect(normalizeStateCode('New York')).toEqual({ ok: true, code: 'NY' });
    expect(normalizeStateCode('new   york')).toEqual({ ok: true, code: 'NY' });
    expect(normalizeStateCode('California')).toEqual({ ok: true, code: 'CA' });
    expect(normalizeStateCode('Washington')).toEqual({ ok: true, code: 'WA' });
    expect(normalizeStateCode('Washington, D.C.')).toEqual({ ok: true, code: 'DC' });
    expect(normalizeStateCode('D.C.')).toEqual({ ok: true, code: 'DC' });
    expect(normalizeStateCode('Puerto Rico')).toEqual({ ok: true, code: 'PR' });
  });

  test('missing, or anything that is not a US state, is skipped', () => {
    expect(normalizeStateCode(null)).toEqual({ ok: false, reason: 'missing' });
    expect(normalizeStateCode('  ')).toEqual({ ok: false, reason: 'missing' });
    for (const raw of ['Calif', 'XX', 'Ontario', 'ON', 'AE', 'CA 94110', 'Cali', 'N.Y.C.']) {
      expect(normalizeStateCode(raw)).toEqual({ ok: false, reason: 'unrecognized' });
    }
  });

  test('every code is two letters and round-trips', () => {
    expect(Object.keys(US_STATE_NAMES)).toHaveLength(56);
    for (const [code, name] of Object.entries(US_STATE_NAMES)) {
      expect(normalizeStateCode(name)).toEqual({ ok: true, code });
      expect(decodeStateCode(encodeStateCode(code))).toBe(code);
    }
  });
});
