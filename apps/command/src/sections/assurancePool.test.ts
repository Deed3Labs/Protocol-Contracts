import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const money = readFileSync(new URL('./money2.tsx', import.meta.url), 'utf8');
const live = readFileSync(new URL('./moneyLive.ts', import.meta.url), 'utf8');

describe('the AssurancePool on Money, live (Phase 2c)', () => {
  test('reads the new pool’s figure, not the retired RTD one', () => {
    expect(live).toContain("assurance: fig('money.assurance') ?? null,");
    expect(live).not.toContain("fig('money.rtd')");
  });

  test('two compartments, the backstop floor and the coverage, read only', () => {
    expect(money).toContain('if (L) return assuranceCell();');
    expect(money).toContain('Backstop floor');
    expect(money).toContain('Available coverage');
    expect(money).toContain('Draws, grants and transfers need two signers, from their own wallets');
    // Nothing here proposes or sends a pool action.
    const cell = money.slice(money.indexOf('function assuranceCell()'), money.indexOf('function gateCell()'));
    expect(cell).not.toMatch(/data-npropose|requestDraw|releaseDraw|proposeTransfer/);
  });
});
