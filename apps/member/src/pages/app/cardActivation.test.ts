import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', '..', p), 'utf8');

/*
 * Pressing Activate card did nothing at all.
 *
 * The server was answering `503 Cards unavailable` — LITHIC_API_KEY is not set — and the client
 * turned that into `null`, which the route treated as "no card yet". A failure and a no-op were
 * the same value, so the spinner stopped and the page did not change.
 */
describe('a failed activation says so', () => {
  const client = read('utils/apiClient.ts');
  const route = read('pages/app/CardRoute.tsx');
  const page = read('pages/app/CardPage.tsx');

  test('createCard returns the reason instead of collapsing to null', () => {
    const fn = client.slice(client.indexOf('export async function createCard'), client.indexOf('export async function setCardFrozen'));
    expect(fn).toContain('CardResult<MemberCard>');
    expect(fn).not.toMatch(/return r\.error \? null/);
  });

  test('and separates "not switched on" from "that failed"', () => {
    // A member cannot retry their way out of an unconfigured integration, so telling them to try
    // again would send them round a loop with no exit. Now carried by the shared shape, so every
    // card call gets the distinction rather than only the one that was reported.
    const shape = client.slice(client.indexOf('export interface CardResult'), client.indexOf('export async function getCards'));
    expect(shape).toContain('error?: string');
    expect(shape).toContain('unavailable?: boolean');
    expect(shape).toMatch(/unavailable: \/unavailable\/i\.test\(error\)/);
  });

  test('the route shows the outcome rather than discarding it', () => {
    expect(route).toContain('setNotice(');
    // The old shape: a failure fell off the end of the function.
    expect(route).not.toMatch(/const created = await createCard\('Clear card'\);\s*if \(created\) setCard\(created\);/);
  });

  test('and the page has somewhere to put it', () => {
    expect(page).toContain('notice?: string | null');
    expect(page).toContain('role="status"');
  });
});

/*
 * The other half of that console paste: the service worker rejecting on /card.
 */
describe('the service worker can open a route offline', () => {
  const sw = readFileSync(join(import.meta.dirname, '..', '..', '..', 'public', 'sw.js'), 'utf8');

  test('navigations are matched by request mode, not by path', () => {
    // isHTML only ever matched `/` and `*.html`, so /card, /savings, /earn and the rest fell
    // through to a bare fetch with no fallback and no catch.
    expect(sw).toContain("request.mode === 'navigate'");
  });

  test('a failed navigation serves the app shell', () => {
    const nav = sw.slice(sw.indexOf('async function navigation'));
    expect(nav).toContain("cache.match('/index.html')");
  });

  test('and never a JSON body, which the browser would render as the page', () => {
    const nav = sw.slice(sw.indexOf('async function navigation'), sw.indexOf('// Cache First Strategy'));
    expect(nav).not.toContain('JSON.stringify');
    expect(nav).toContain('text/html');
  });

  test('the default branch cannot reject unhandled any more', () => {
    const fetchHandler = sw.slice(sw.indexOf("self.addEventListener('fetch'"), sw.indexOf('async function navigation'));
    expect(fetchHandler).toMatch(/fetch\(request\)\.catch\(/);
  });
});

/*
 * The sweep: every card call a member can trigger, held to the same contract.
 *
 * Activation was the one that got noticed, because it is the one with a button that visibly does
 * nothing. The others fail the same way and are quieter about it.
 */
describe('no card path fails silently', () => {
  const client = read('utils/apiClient.ts');
  const route = read('pages/app/CardRoute.tsx');

  function fn(name: string): string {
    const start = client.indexOf(`export async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    return client.slice(start, client.indexOf('\nexport ', start + 10));
  }

  test('they all report through one shape, not four', () => {
    for (const name of ['getCards', 'createCard', 'setCardFrozen', 'activateClearCard', 'freezeClearCard']) {
      expect(fn(name)).toContain('CardResult<');
    }
  });

  test('none of them collapse a failure into an empty success', () => {
    for (const name of ['getCards', 'createCard', 'setCardFrozen', 'activateClearCard', 'freezeClearCard']) {
      // `r.error ? [] :` and `r.error ? null :` are the two shapes that lost the reason.
      expect(fn(name)).not.toMatch(/r\.error \?\s*(\[\]|null)/);
    }
  });

  test('a failed read is not rendered as an empty account', () => {
    // The page renders "no cards" as an Activate button, so `[]` on failure invited a member who
    // has a card to create another one. `loaded` must stay false when the read failed.
    const load = route.slice(route.indexOf('void getCards()'), route.indexOf('const activate'));
    expect(load).toContain('if (error)');
    expect(load.indexOf('if (error)')).toBeLessThan(load.indexOf('setLoaded(true)'));
  });

  test('a freeze that springs back explains itself', () => {
    const toggle = route.slice(route.indexOf('const toggleFreeze'));
    expect(toggle).toContain('setCard({ ...card })');
    expect(toggle).toContain('setNotice(');
  });

  test('and the Bridge card activation keeps its reason too', () => {
    const hook = readFileSync(join(import.meta.dirname, '..', '..', 'hooks', 'useClearCard.ts'), 'utf8');
    expect(hook).toContain('setError(');
    const portal = readFileSync(
      join(import.meta.dirname, '..', '..', 'components', 'app-ui', 'BillPortalBrowser.tsx'), 'utf8',
    );
    expect(portal).toContain('role="status"');
  });
});

/*
 * "Member is not provisioned" is a third thing, and worth its own case.
 *
 * It is not an outage and not a retry: the key is set, Lithic is answering, and the member simply
 * has no account holder. They cannot have one — `ensureProvisioned` is reached from exactly one
 * route, POST /api/lithic/account, and nothing in the client calls it. No member is provisioned,
 * old account or new.
 *
 * So the member-facing wording deliberately collapses it with `unavailable`: the distinction
 * between an unset API key and an unbuilt setup step matters to us and not at all to them. What
 * matters to them is that pressing the button again will not help.
 */
describe('an unprovisioned member is told something true', () => {
  const client = read('utils/apiClient.ts');
  const route = read('pages/app/CardRoute.tsx');

  test('the server’s wording is matched, not shown', () => {
    // "Member is not provisioned" is a sentence about our database, not about the person reading.
    const shape = client.slice(client.indexOf('function cardFailure'), client.indexOf('export async function getCards'));
    expect(shape).toMatch(/needsSetup: \/not provisioned\/i\.test\(error\)/);
    expect(route).not.toContain('not provisioned');
  });

  test('and it does not invite a retry that cannot work', () => {
    const activate = route.slice(route.indexOf('const activate'), route.indexOf('const toggleFreeze'));
    expect(activate).toContain('unavailable || needsSetup');
    const retry = activate.slice(activate.indexOf('unavailable || needsSetup'));
    // The "try again" branch must be the other one.
    expect(retry.indexOf("we'll let you know")).toBeLessThan(retry.indexOf('Please try again'));
  });
});
