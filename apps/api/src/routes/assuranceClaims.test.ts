import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('./assurance.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('../services/assurance/claimStore.ts', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

/*
 * A claim is the worst day a member has with Clear. The failure this route exists to avoid is a
 * form that looked like it worked on the day somebody needed it to.
 */
describe('a claim is never quietly dropped', () => {
  test('no database means the member is told, not thanked', () => {
    expect(route).toContain('claimStore.isConfigured()');
    expect(route).toMatch(/503[\s\S]{0,200}Nothing was sent/);
  });

  test('a claim that came back empty is reported too', () => {
    // file() returns null rather than throwing, and a null answered 201 would be the same lie.
    expect(route).toMatch(/if \(!claim\)[\s\S]{0,200}503/);
  });

  test('it says what it is claiming on, and what happened', () => {
    expect(route).toMatch(/if \(!protectionId \|\| !protectionName\)[\s\S]{0,160}400/);
    expect(route).toMatch(/if \(!detail\)[\s\S]{0,160}400/);
  });
});

describe('a claim keeps the words the member was given', () => {
  test('the protection name is stored beside its id', () => {
    /*
     * Protections get renamed — four were, the day this table was written — and a claim has to keep
     * saying what the member was told they were covered by, not what the row is called now.
     */
    expect(store).toContain('protection_name');
    expect(store).toContain('protectionName');
  });

  test('nothing in the service decides a claim', () => {
    // The page promises a person reads it. `open` is the only state this can create.
    expect(store).toContain("DEFAULT 'open'");
    expect(store).not.toMatch(/status = 'paid'\s*WHERE|UPDATE .* SET status/);
  });
});

describe('the published record includes the declines', () => {
  test('paid and declined are counted from the same place', () => {
    // "One in four is declined. We publish that because a reserve that never says no is not being
    // managed." A figure that only counted payouts could not say that.
    expect(store).toContain("FILTER (WHERE status = 'declined')");
    expect(store).toContain("FILTER (WHERE status = 'paid')");
  });
});

describe('the route is mounted behind the member', () => {
  test('claims require auth', () => {
    expect(index).toMatch(/'\/api\/assurance', requireAuth, assuranceRouter/);
    expect(route).toContain('requireWalletMatch');
  });
});
