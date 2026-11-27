import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

/*
 * The OTP on a claim is what proves the person collecting money is the person it was sent to.
 * A bypass exists for testing, and it was armed on both live environments for a long time — not
 * because anybody enabled it carelessly, but because the guard asked the wrong question.
 *
 * These pin the two things that made it dangerous, both of which are one edit away from returning.
 */
describe('the send OTP bypass fails closed', () => {
  const route = read('routes/send.ts');
  const fn = route.slice(route.indexOf('function otpBypassEnabled'), route.indexOf('function otpBypassCode'));

  test('an unset NODE_ENV is treated as production, not as development', () => {
    // The shape that armed it on live services: NODE_ENV is unset on Railway, so `=== 'production'`
    // was false and the bypass was permitted. The question has to be "is this deliberately a
    // sandbox", never "is this production".
    expect(fn).not.toMatch(/env\s*===\s*'production'/);
    expect(fn).toMatch(/env !== 'development' && env !== 'test'/);
  });

  test('there is no default bypass code anywhere', () => {
    // '000000' as a fallback meant enabling the bypass without configuring anything produced a
    // guessable code. No default is the only safe default.
    expect(route).not.toContain("'000000'");
  });

  test('the bypass requires a code somebody actually set', () => {
    expect(fn).toContain('SEND_OTP_BYPASS_CODE');
    expect(fn).toMatch(/\\d\{6\}/);
  });
});
