import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const asa = readFileSync(new URL('./lithicAuthStream.ts', import.meta.url), 'utf8');
const webhook = readFileSync(new URL('./lithicWebhook.ts', import.meta.url), 'utf8');

/**
 * Lithic signs with two different secrets, and the two endpoints must not share a variable.
 *
 * `GET /v1/auth_stream/secret` is the Auth Stream's; an event subscription gets its own when it is
 * created. A single variable can only hold one, so whichever endpoint it does not belong to rejects
 * every request it receives — and for the auth stream that means declining card authorizations,
 * because it fails closed. This was live: setting the subscription's secret silently stopped the
 * auth stream verifying.
 */
describe('the two Lithic secrets stay apart', () => {
  test('the auth stream reads its own secret first', () => {
    expect(asa).toContain('LITHIC_ASA_SECRET');
    // The old name stays as a fallback, so a deployment that only ever set one keeps working.
    expect(asa).toContain('LITHIC_WEBHOOK_SECRET');
    expect(asa.indexOf('LITHIC_ASA_SECRET')).toBeLessThan(asa.indexOf('process.env.LITHIC_WEBHOOK_SECRET'));
  });

  test('the event webhook reads the subscription secret, not the auth stream one', () => {
    expect(webhook).toContain('LITHIC_WEBHOOK_SECRET');
    expect(webhook).not.toContain('LITHIC_ASA_SECRET');
  });

  test('both refuse rather than trust when no secret is configured', () => {
    for (const source of [asa, webhook]) {
      expect(source).toMatch(/if \(!secret\)[\s\S]{0,400}return false/);
    }
  });
});
