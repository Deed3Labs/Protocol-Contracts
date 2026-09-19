import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { allocateTermDue } from './termCollection.js';

const SOURCE = readFileSync(new URL('./termCollection.ts', import.meta.url), 'utf8');
const DEPOSITS = readFileSync(new URL('../deposits/depositReceiptService.ts', import.meta.url), 'utf8');
const SWEEP = readFileSync(new URL('../../jobs/cardSettlementSweeper.ts', import.meta.url), 'utf8');

describe('a bank deposit pays what is due on term plans', () => {
  test('in order: each plan behind, then carry owed on nothing, then stops', () => {
    const due = [{ planId: 0, cents: 5_000 }, { planId: 2, cents: 3_000 }, { planId: null, cents: 3 }];
    expect(allocateTermDue(20_000, due)).toEqual({ paid: due, remainingCents: 11_997 });
  });

  test('a deposit too small for everything pays the oldest first and leaves nothing', () => {
    const due = [{ planId: 0, cents: 5_000 }, { planId: 2, cents: 3_000 }];
    expect(allocateTermDue(6_000, due)).toEqual({ paid: [{ planId: 0, cents: 5_000 }, { planId: 2, cents: 1_000 }], remainingCents: 0 });
  });

  test('nothing due takes nothing', () => {
    expect(allocateTermDue(10_000, [])).toEqual({ paid: [], remainingCents: 10_000 });
  });

  test('only a fiat deposit, and before card debt: card settlement gets what is left', () => {
    expect(DEPOSITS).toContain("const termDue = receipt.rail === 'lithic_ach' ? await readTermDue(wallet) : [];");
    expect(DEPOSITS).toMatch(/const term = allocateTermDue\(amount, termDue\);[\s\S]{0,600}planSettlement\(term\.remainingCents,/);
  });

  test('the sweep puts it on chain', () => {
    expect(SWEEP).toContain('await sweepTermCollections()');
  });
});

describe('never paid twice', () => {
  test('marked sending before the send, and the hash stored straight after', () => {
    expect(SOURCE).toMatch(/SET status = 'sending', tx = NULL[\s\S]{0,200}payPlan\(planId, payUnits\)[\s\S]{0,200}SET tx = \$2/);
  });

  test('a send interrupted before its hash was stored goes to a person, not back out', () => {
    expect(SOURCE).toMatch(/if \(!row\.tx\) \{[\s\S]{0,200}status = 'needs_review'/);
  });

  test('an error after broadcast keeps the row sending, so the chain is asked, not resent', () => {
    expect(SOURCE).toMatch(/if \(!reverted && pool\)[\s\S]{0,300}SET status = 'sending'/);
  });

  test('what the chain did not take goes back to the member, once', () => {
    expect(SOURCE).toMatch(/const short = Number\(row\.amount_cents\) - paidCents;\s*if \(short > 0\) await giveBack/);
    expect(SOURCE).toMatch(/SELECT 1 FROM \$\{ENTRIES\} WHERE external_id = \$1 LIMIT 1/);
  });

  test('leftover carry waits until nothing else could absorb an undirected payment', () => {
    expect(SOURCE).toMatch(/if \(termPrincipal > 0n \|\| revolvingPrincipal > 0n\) return \{ id, wallet: row\.wallet, action: 'waiting' \}/);
  });
});
