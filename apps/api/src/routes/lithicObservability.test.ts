import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const webhook = readFileSync(new URL('./lithicWebhook.ts', import.meta.url), 'utf8');
const asa = readFileSync(new URL('./lithicAuthStream.ts', import.meta.url), 'utf8');

/*
 * Both Lithic endpoints answer 200 whatever they decide, which is correct — a non-200 is a timeout
 * to Lithic and tells us nothing — but it means the logs are the only place their behaviour is
 * visible. A silent path here is a path nobody can debug from the outside.
 */
describe('a card transaction leaves a trace whatever it did', () => {
  test('the outcome that moved nothing is logged too', () => {
    // The first version logged only adjustments, so `unknown` — the case that matters most — wrote
    // nothing at all and looked exactly like success.
    expect(webhook).toContain("result.outcome === 'unknown'");
    expect(webhook).toMatch(/console\.warn\(line\)/);
  });

  test('the log carries the transaction token', () => {
    expect(webhook).toContain('tx=${result.transactionToken}');
  });
});

describe('the two halves can be matched up', () => {
  /*
   * A void has to find the decision the authorization filed. If the auth stream files under one
   * token and the webhook reports another, nothing ever matches and the money never comes back —
   * with both endpoints still answering 200. These two lines are what make that comparable.
   */
  test('the auth stream prints the token it files the decision under', () => {
    expect(asa).toContain('tx=${transactionToken}');
  });

  test('both use the same tx= spelling, so one search finds the pair', () => {
    const spelling = /tx=\$\{/;
    expect(asa).toMatch(spelling);
    expect(webhook).toMatch(spelling);
  });
});
