import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
// Comments stripped: guards in this repo have passed by matching the prose explaining a thing.
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/*
 * A savings deposit emitted no notification at all -- savings.ts never called the notification
 * store, so there was nothing to deliver and nothing to appear late.
 *
 * The risk in adding one is the failure this file exists to catch: there are TWO deposit paths. A
 * sponsored UserOp reports to /record; the relayer fallback goes through /gasless/submit. The
 * collateral sync was added to one of them and not the other, and the result was a first deposit
 * that needed a manual backfill. A notification wired the same way would fire for some deposits
 * and not others, which reads as flakiness rather than as a missing call.
 */
describe('savings deposit notification', () => {
  const src = code('routes/savings.ts');

  test('both deposit paths emit it, not just one', () => {
    const calls = src.match(/notifySavingsDeposit\(/g) ?? [];
    // One definition + two call sites.
    expect(calls.length).toBe(3);
    // Anchored to each path's own sync, so moving one without the other is visible here.
    expect(src).toMatch(/savings\/gasless[\s\S]{0,400}?notifySavingsDeposit\(/);
    expect(src).toMatch(/savings\/record[\s\S]{0,400}?notifySavingsDeposit\(/);
  });

  test('deduped on the tx hash, because both paths can run for one deposit', () => {
    expect(src).toMatch(/dedupeKey:\s*`savings:deposit:\$\{txRef\}`/);
  });

  test('fires on deposit only, not on redeem', () => {
    const guarded = src.match(/if \(action === 'deposit'\) void notifySavingsDeposit\(/g) ?? [];
    expect(guarded.length).toBe(2);
  });

  test('quotes no credit limit it cannot know yet', () => {
    // The calculator applies a haircut after two more writes land. A number here would be wrong often.
    const body = src.match(/body: `\$\$\{usd[\s\S]*?`,/)?.[0] ?? '';
    expect(body).toContain('backing your credit line');
    expect(body).not.toMatch(/limit is|new limit|\$\{limit/);
  });

  test('failure cannot fail the deposit', () => {
    // The deposit is already on chain; an undelivered notification is not a reason to report it failed.
    expect(src).toMatch(/void notifySavingsDeposit\(/);
    expect(code('routes/savings.ts')).toMatch(/catch \(error\)[\s\S]{0,200}deposit notification failed/);
  });
});
