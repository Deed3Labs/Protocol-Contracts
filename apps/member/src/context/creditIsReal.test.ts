import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
const ctx = read('context/CreditContext.tsx');

/*
 * This context shipped a $5,000 base limit, three purpose lines and $1,200 already borrowed —
 * hardcoded, identical for every member, inside the same shell whose route containers go to real
 * lengths to avoid exactly that ("each field only overrides once it has been read").
 *
 * No member ever saw it, because nothing calls `openBorrow`. That is luck, not design, and luck is
 * what this file is here to replace.
 */
describe('the credit line is the member’s, not a fixture', () => {
  test('no hardcoded balance or seeded borrowings survive', () => {
    expect(ctx).not.toContain('CLRUSD_BALANCE');
    expect(ctx).not.toContain('SEED_LINES');
    // The tell was a `used:` with a number on it. The one legitimate `used` is the contract's.
    expect(ctx).not.toMatch(/used:\s*[1-9]/);
  });

  test('the figures come from the contracts', () => {
    expect(ctx).toContain('getCredit(address)');
    expect(ctx).toContain('tier.limitCents');
    expect(ctx).toContain('tier.usedCents');
  });

  test('and only from tiers the issuer actually activated', () => {
    // An inactive tier is a product a member could have, not headroom they do have.
    expect(ctx).toMatch(/filter\(\(tier\) => tier\.active\)/);
  });

  test('it re-reads on the same signal as the home screen', () => {
    // Before this it had no refresh path at all — one read on mount, then it described a past.
    expect(ctx).toContain('onChainStale(read)');
  });

  test('days-left goes through the shared mapper, not a second copy of the arithmetic', () => {
    expect(ctx).toContain('toCycle(');
    expect(ctx).not.toContain('DAY_SECONDS');
  });

  test('product copy carries no invented limits', () => {
    const products = ctx.slice(ctx.indexOf('const PRODUCTS'), ctx.indexOf('interface CreditValue'));
    expect(products).not.toMatch(/limit:\s*\d/);
    // ...and none are summed into headroom.
    expect(ctx).toContain('const totalPower = available;');
  });

  test('borrowing throws rather than miming a loan', () => {
    // It used to move a number in local state and nothing else: no draw, no transfer, no receipt.
    expect(ctx).toContain('is not implemented');
    expect(ctx).not.toMatch(/const borrow = \(amount/);
  });

  test('both hooks refuse to hand back a silent stub', () => {
    expect(ctx).toContain('useCredit must be used within a CreditProvider');
    expect(read('hooks/useClearBalances.ts')).toContain('useClearBalances must be used within a ClearBalancesProvider');
  });
});
