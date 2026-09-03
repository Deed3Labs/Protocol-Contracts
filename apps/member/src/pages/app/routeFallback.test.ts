import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * No page or route may fall back to the design preview's furnished account.
 *
 * `*_IN_USE` is a fixture showing what a page looks like with money in it. Using it as a runtime
 * fallback rendered somebody else's balances as the member's own — a real deployment showed
 * $6,200 available and a term plan with a merchant's name on it, to an account holding nothing.
 * That is not a placeholder, it is a fabrication, and it is indistinguishable from real data on
 * the screen where it matters most.
 *
 * `*_DAY_ONE` is the honest base: zeros, empty lists, products locked or not yet activated. Only
 * PreviewApp may reach for the furnished one, because showing the populated design IS its job.
 */
const HERE = join(import.meta.dir);

describe('runtime fallbacks', () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.tsx'));

  for (const file of files) {
    test(`${file} does not fall back to a furnished fixture`, () => {
      const source = readFileSync(join(HERE, file), 'utf8');
      // Comments explain the rule and name the symbol; strip them before checking.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/_IN_USE/);
    });
  }
});
