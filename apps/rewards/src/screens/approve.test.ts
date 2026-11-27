import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const SHOP = readFileSync(new URL('./shop.tsx', import.meta.url), 'utf8');
const REAL = readFileSync(new URL('../data/real.ts', import.meta.url), 'utf8');
const APPROVE = SHOP.slice(SHOP.indexOf('export function ApproveScreen'), SHOP.indexOf('// ---- You (section 6)'));

/** Pay with Clear (pay spec §4): the rewards app's approve sheet holds for online charges too. */
describe('the approve sheet, online', () => {
  test('the charge’s online fields come through from the Clear app’s route', () => {
    expect(REAL).toContain('overTime: c.overTime ?? null');
    expect(REAL).toContain('online: c.online ?? null');
  });

  test('the head says ONLINE or LINK in place of a table', () => {
    expect(APPROVE).toContain("c.online ? ` · ${c.online.channel === 'online' ? 'ONLINE' : 'LINK'}`");
  });

  test('Pay now only: no switch, and Over time can’t be what’s sent', () => {
    expect(APPROVE).toContain('const overTime = c?.overTime !== false;');
    expect(APPROVE).toContain("const paying = overTime ? mode : 'now';");
    expect(APPROVE).toContain('{overTime ? (');
    expect(APPROVE).toContain('data.approve(c.code, paying)');
  });

  test('where approving leaves you, when the shop has a site', () => {
    expect(APPROVE).toContain('Then you’re back on {c.online.shopHost}');
  });
});
