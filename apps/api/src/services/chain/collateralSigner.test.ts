import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const svc = strip(readFileSync(join(import.meta.dirname, 'savingsCollateralService.ts'), 'utf8'));

/*
 * The signer used to be chosen by absence: a raw key won whenever one happened to be in the
 * environment, and the managed wallet only got a turn when none was.
 *
 * That is backwards for the thing we are trying not to do, and it failed quietly in both
 * directions — a key present for an unrelated reason silently took over signing, and a key missing
 * silently meant no collateral was pledged at all. Neither said anything.
 */
describe('the collateral signer is chosen deliberately', () => {
  test('the managed wallet is the default when nothing is configured', () => {
    /*
     * Asserts the FALLBACK, not that the string appears somewhere.
     *
     * The first version of this checked `toContain("'cdp_server_wallet'")` and passed happily with
     * the default flipped to 'local_key' — the name still appeared in the ternary two lines below.
     * A guard that matches a word rather than a position is not a guard.
     */
    const fn = svc.slice(svc.indexOf('function collateralSignerMode'), svc.indexOf('function operatorKey'));
    expect(fn).toMatch(/\|\|\s*'cdp_server_wallet';/);
    expect(fn).not.toMatch(/\|\|\s*'local_key';/);
  });

  test('it follows the convention the other relayers already use', () => {
    // SAVINGS_RELAYER_MODE / SEND_RELAYER_MODE have worked this way all along; a third pattern for
    // the same decision is a third thing to learn.
    expect(svc).toContain('COLLATERAL_SIGNER_MODE');
    expect(svc).toContain('SAVINGS_RELAYER_MODE');
  });

  test('a raw key is opt-in, not opt-out', () => {
    // The presence of a private key must not, by itself, change who signs.
    const send = svc.slice(svc.indexOf('async function sendCollateralTx'), svc.indexOf('async function runSync'));
    expect(send).toContain("collateralSignerMode() === 'local_key'");
    expect(send.indexOf('collateralSignerMode()')).toBeLessThan(send.indexOf('operatorKey()'));
  });

  test('asking for a raw key that is not there fails loudly', () => {
    /*
     * Falling back to the relayer here would be the old behaviour wearing a new name: someone set
     * this mode on purpose, and quietly doing the other thing answers a different question.
     */
    const send = svc.slice(svc.indexOf('async function sendCollateralTx'), svc.indexOf('async function runSync'));
    expect(send).toContain('throw new Error');
    expect(send).toContain('COLLATERAL_SIGNER_MODE=local_key but no');
  });

  test('and the default path needs no key at all', () => {
    const send = svc.slice(svc.indexOf('async function sendCollateralTx'), svc.indexOf('async function runSync'));
    const fallthrough = send.slice(send.indexOf('return savingsRelayerService.sendAsRelayer'));
    expect(fallthrough).not.toContain('operatorKey');
  });
});
