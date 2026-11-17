import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Audit Phase 2g, decision 12: Clear's autopay may never hold a key that can install or remove a
 * module, configure the Legacy Contact module, or confirm a bond roll for the member.
 *
 * Autopay holds no ZeroDev session key at all. The member signs a vault `DepositMandate` (amount per
 * run, run count, cadence, expiry) and one USDC allowance to the vault; Clear's relayer can only
 * submit `executeMandateDeposit`, which the vault checks against that signature. These tests pin
 * that: if a session key or permission validator is ever added, they fail, and the new key must
 * come with a call policy limited to the savings-deposit call (no installModule, uninstallModule,
 * Legacy Contact or confirmRoll) and its own test before they are changed.
 */
const SRC = join(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

const SESSION_KEY_APIS = [
  '@zerodev/permissions',
  'toPermissionValidator',
  'toCallPolicy',
  'toSudoPolicy',
  'serializePermissionAccount',
  'deserializePermissionAccount',
  'toECDSASigner',
];
// Calls no Clear-held key may make for a member; the app has no reason to encode them for autopay.
const FORBIDDEN_CALLS = ['installModule', 'uninstallModule', 'confirmRoll', 'LegacyContact'];

describe('autopay scope (decision 12)', () => {
  const files = sources(SRC);

  test('no ZeroDev session key or permission validator exists in the member app', () => {
    const hits = files.flatMap((f) => {
      const text = readFileSync(f, 'utf8');
      return SESSION_KEY_APIS.filter((api) => text.includes(api)).map((api) => `${f}: ${api}`);
    });
    expect(hits).toEqual([]);
  });

  test('nothing in the member app encodes a module install or removal, the Legacy Contact module or confirmRoll', () => {
    const hits = files.flatMap((f) => {
      const text = readFileSync(f, 'utf8');
      return FORBIDDEN_CALLS.filter((name) => text.includes(name)).map((name) => `${f}: ${name}`);
    });
    expect(hits).toEqual([]);
  });

  test('autopay signs only the vault DepositMandate and a USDC allowance to the vault', () => {
    const text = readFileSync(join(SRC, 'lib', 'autopay.ts'), 'utf8');
    const primaryTypes = [...text.matchAll(/primaryType:\s*'(\w+)'/g)].map((m) => m[1]).sort();
    expect(primaryTypes).toEqual(['DepositMandate', 'Permit']);
    expect(text).toContain("verifyingContract: vault");
    expect(text).toContain('spender: vault');
  });
});
