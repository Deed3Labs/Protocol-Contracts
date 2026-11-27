import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
// Comments stripped: guards in this repo have passed by matching the prose explaining a thing.
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/*
 * A savings move emitted no notification at all -- savings.ts never called the notification store,
 * so there was nothing to deliver and nothing to appear late.
 *
 * The risk in adding one is the failure this file exists to catch: there are TWO paths. A sponsored
 * UserOp reports to /record; the relayer fallback goes through /gasless/submit. The collateral sync
 * was added to one and not the other, and the result was a first deposit that needed a manual
 * backfill and a second that worked. A notification wired the same way fires for some moves and not
 * others, which reads as flakiness rather than as a missing call.
 */
describe('savings move notification', () => {
  const src = code('routes/savings.ts');

  test('both paths emit it, not just one', () => {
    // One definition + two call sites.
    expect((src.match(/notifySavingsMove\(/g) ?? []).length).toBe(3);
    // Anchored to each path's own sync, so moving one without the other is visible here.
    expect(src).toMatch(/savings\/gasless[\s\S]{0,400}?notifySavingsMove\(/);
    expect(src).toMatch(/savings\/record[\s\S]{0,400}?notifySavingsMove\(/);
  });

  test('fires for a withdrawal too, not only a deposit', () => {
    /*
     * The first version guarded both call sites with `action === 'deposit'`. A withdrawal lowers the
     * line, which is the direction a member is more likely to want telling about, and it silently
     * said nothing.
     */
    expect(/if \(action === 'deposit'\) void notifySavingsMove/.test(src)).toBe(false);
    expect(src).toMatch(/title: deposit \? 'Savings deposit added' : 'Savings withdrawal'/);
  });

  test('a withdrawal reports the redeemed amount, not the deposit field', () => {
    /*
     * The gasless path carries the two directions in different fields -- `submit.amount` for a
     * deposit and `submit.clrusdAmount` for a redeem, exactly as the equity ledger above it reads
     * them. Using the deposit field for both notifies a confident and wrong number.
     */
    expect(/action === 'deposit' \? submit\.amount : submit\.clrusdAmount/.test(src)).toBe(true);
  });

  test('deduped per direction and tx, because both paths can run for one move', () => {
    expect(src).toMatch(/dedupeKey:\s*`savings:\$\{action\}:\$\{txRef\}`/);
  });

  test('quotes no limit it cannot know yet', () => {
    /*
     * The calculator applies a haircut after two more writes land, and a release is capped at what
     * is *free* -- so for a withdrawal the amount leaving savings is not the amount leaving the
     * limit. Any figure stated here would be the wrong one.
     */
    const bodies = src.match(/body: deposit[\s\S]*?`,/)?.[0] ?? '';
    expect(bodies).toContain('backing your credit line');
    expect(bodies).not.toMatch(/limit is|new limit|reduced by|\$\{limit/);
  });

  test('failure cannot fail the move', () => {
    // The transfer is already on chain; an undelivered notification is not a reason to report it failed.
    expect(src).toMatch(/void notifySavingsMove\(/);
    expect(src).toMatch(/catch \(error\)[\s\S]{0,200}notification failed/);
  });

  test('the collateral sync is not gated on direction either', () => {
    /*
     * This is what makes the figures move after a withdrawal rather than only after a deposit. It is
     * already unguarded at both call sites; the guard exists so it stays that way.
     */
    const syncs = src.match(/void syncSavingsCollateralFromBalance\(/g) ?? [];
    expect(syncs.length).toBe(2);
    expect(/if \(action === 'deposit'\)[\s\S]{0,80}syncSavingsCollateralFromBalance/.test(src)).toBe(false);
  });
});

describe('it does not double up with the equity-match notification', () => {
  const src = code('routes/savings.ts');

  test('suppressed when the 1:1 match already told the member', () => {
    /*
     * Found in the logs of a real deposit: two `[notify] credit` lines back to back. This one and
     * `recordDepositMatch`'s "1:1 match applied", for the same deposit, from the same two routes.
     * The match message predates this and carries the number the member cares about, so it wins;
     * this one covers the deposits it does not -- a match capped for the month, or already awarded.
     */
    expect(src).toMatch(/if \(!matchNotified\) void notifySavingsMove\(/g);
    expect((src.match(/if \(!matchNotified\) void notifySavingsMove\(/g) ?? []).length).toBe(2);
  });

  test('a duplicate ledger write counts as already notified', () => {
    /*
     * Both routes run for one deposit. The second gets rowCount 0, so creditAwarded is 0 -- and
     * testing only that would let this fire as the second notification anyway, which is the exact
     * bug. That is what the logs showed.
     */
    expect((src.match(/match\.creditAwarded > 0 \|\| match\.duplicate/g) ?? []).length).toBe(2);
  });

  test('a withdrawal is never suppressed by it', () => {
    // The flag is only ever set in the deposit branch; a redeem has no match to duplicate.
    expect(/clawbackDepositMatch[\s\S]{0,200}matchNotified =/.test(src)).toBe(false);
  });
});
