import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const read = (p: string) => strip(readFileSync(join(import.meta.dirname, '..', p), 'utf8'));

/*
 * Savings → See all → Assurance is one flow about one member, and both ends decide the same thing:
 * which protections are on, from the member's credit total.
 *
 * The pane was routed with no data, so it fell back to the day-one fixture and judged everything
 * against zero credits. A member holding 1,500 read "2 of 4 active" on Savings and was then told
 * the second protection was 1,000 credits away.
 */
describe('Savings and Assurance read the same credits', () => {
  test('both routes take their data from one hook', () => {
    expect(read('pages/app/SavingsRoute.tsx')).toContain('useSavingsData()');
    expect(read('pages/app/AssuranceRoute.tsx')).toContain('useSavingsData()');
  });

  test('the pane is routed with data, not left to its fallback', () => {
    const app = read('App.tsx');
    expect(app).toContain('<AssuranceRoute />');
    // The bare page would silently take SAVINGS_DAY_ONE again.
    expect(app).not.toContain('<AssurancePage />');
  });

  test('the fallback stays day-one, so a fetch in flight never invents credits', () => {
    // Comments are stripped first: the file explains what the IN_USE fixtures are, and matching
    // its own prose would be the test reading the warning rather than the code.
    const hook = read('hooks/useSavingsData.ts');
    expect(hook).toContain('SAVINGS_DAY_ONE');
    expect(hook).not.toContain('IN_USE');
  });
});
