import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const store = readFileSync(new URL('./pulledFundsStore.ts', import.meta.url), 'utf8');

describe('elapsed pulled-funds holds are released', () => {
  test('uses valid Postgres — RETURNING DISTINCT is a syntax error that released nothing', () => {
    expect(store).not.toMatch(/RETURNING\s+DISTINCT\s+wallet`/);
    expect(store).toMatch(/collateral_eligible_at <= now\(\)\s+RETURNING wallet`/);
    expect(store).toContain('return [...new Set(rows.map((r) => r.wallet))];');
  });
});
