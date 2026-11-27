import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

/**
 * The server's charge states must stay a subset of the shared domain's.
 *
 * `packages/domain` owns the lifecycle both apps read, but apps/api is not an npm workspace member
 * — its container installs from its own manifest — so it cannot import the package and its
 * `ChargeStatus` is necessarily a second declaration of the same thing. Two declarations drift.
 *
 * This reads both files and asserts they agree, the same way the tests either side of the
 * member/api boundary already do. It is not as good as one import. It is enough to fail loudly the
 * day someone adds a status here and the merchant app has no label for it.
 */

const read = (p: string) => readFileSync(join(import.meta.dirname, p), 'utf8');

const serverSource = read('chargeStore.ts');
const domainSource = read('../../../../packages/domain/src/charge.ts');

/** `export type ChargeStatus = 'a' | 'b';` -> ['a','b'] */
function serverStates(): string[] {
  const m = serverSource.match(/export type ChargeStatus =([^;]+);/);
  if (!m) throw new Error('ChargeStatus not found in chargeStore.ts');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

/**
 * The union members of ChargeState, written one per line with doc comments between.
 *
 * Ends at the first `';` — the union's own terminator. Not at the first semicolon: the doc
 * comments contain prose, and prose contains semicolons.
 */
function domainStates(): string[] {
  const m = domainSource.match(/export type ChargeState =([\s\S]*?';)/);
  if (!m) throw new Error('ChargeState not found in domain charge.ts');
  return [...m[1].matchAll(/\|\s*'([a-z_]+)'/g)].map((x) => x[1]);
}

/** The domain's wire mapping: only states stored under a different name appear here. */
function domainWireAliases(): Record<string, string> {
  const m = domainSource.match(/const WIRE:[^=]+=\s*\{([^}]*)\}/);
  if (!m) throw new Error('WIRE map not found in domain charge.ts');
  return Object.fromEntries(
    [...m[1].matchAll(/(\w+):\s*'([a-z_]+)'/g)].map((x) => [x[1], x[2]]),
  );
}

describe('the server and the shared domain agree on charge states', () => {
  it('finds both declarations', () => {
    expect(serverStates().length).toBeGreaterThan(0);
    expect(domainStates().length).toBeGreaterThan(0);
  });

  it('every state the server persists is one the domain knows', () => {
    const wire = new Set(domainStates().map((s) => domainWireAliases()[s] ?? s));
    for (const s of serverStates()) expect([...wire]).toContain(s);
  });

  it('still stores waiting as pending — renaming the column is a migration, not a refactor', () => {
    expect(serverStates()).toContain('pending');
    expect(domainWireAliases().waiting).toBe('pending');
  });

  it('keeps resolving, which exists so a dead process cannot duplicate a term plan', () => {
    expect(serverStates()).toContain('resolving');
    expect(domainStates()).toContain('resolving');
  });

  it('the states the domain adds are derived, not stored', () => {
    // `cancelled` and `refunded` are now real columns values. What remains domain-only is the set
    // that is derived rather than persisted:
    //
    //   draft            — the merchant has an amount on screen and nothing has been raised.
    //   refund_requested — an open row in merchant.refunds; the charge is still 'approved'.
    //   refund_declined  — a declined row in merchant.refunds; the charge still stands.
    //
    // A refund is its own record with its own lifecycle, and the charge stores only the terminal
    // outcome. Deriving the in-flight states is the same move `withDerivedStatus` already makes
    // for `expired`.
    const wire = serverStates();
    const derived = domainStates()
      .map((s) => domainWireAliases()[s] ?? s)
      .filter((s) => !wire.includes(s));
    expect(derived.sort()).toEqual(['draft', 'refund_declined', 'refund_requested'].sort());
  });

  it('persists the two terminal states the merchant app writes', () => {
    for (const s of ['cancelled', 'refunded']) expect(serverStates()).toContain(s);
  });
});
