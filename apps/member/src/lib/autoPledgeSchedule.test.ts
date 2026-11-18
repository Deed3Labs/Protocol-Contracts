import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTO_PLEDGE_EVERY_MS,
  AUTO_PLEDGE_KINDS,
  createAutoPledger,
  hasCreditLine,
  isAutoPledgeKind,
  memoryClock,
  type AutoPledgeKind,
} from './autoPledgeSchedule';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

const MEMBER = '0xAbC0000000000000000000000000000000000001';

function harness(opts: { pledged?: number; error?: string; throws?: boolean } = {}) {
  let now = 1_000_000;
  const calls: { kind: AutoPledgeKind; member: string }[] = [];
  let refreshed = 0;
  let release: (() => void) | null = null;
  let hold = false;
  const pledger = createAutoPledger({
    pledge: async (kind, member) => {
      calls.push({ kind, member });
      if (hold) await new Promise<void>((resolve) => (release = resolve));
      if (opts.throws) throw new Error('declined');
      return { pledged: opts.pledged ?? 0, ...(opts.error ? { error: opts.error } : {}) };
    },
    onPledged: () => void (refreshed += 1),
    now: () => now,
    clock: memoryClock(),
  });
  return {
    pledger,
    calls,
    refreshed: () => refreshed,
    advance: (ms: number) => void (now += ms),
    holdNext: () => void (hold = true),
    releaseHeld: () => {
      hold = false;
      release?.();
    },
  };
}

const ready = { member: MEMBER, hasLine: true, enabled: true } as const;

describe('background pledging: when it does not try', () => {
  test('no line yet: nothing is asked', async () => {
    const h = harness();
    expect(await h.pledger.run({ ...ready, hasLine: false })).toEqual({ skipped: 'no-line' });
    expect(h.calls).toHaveLength(0);
  });

  test('setting off: nothing is asked; setting not known yet: nothing is asked', async () => {
    const h = harness();
    expect(await h.pledger.run({ ...ready, enabled: false })).toEqual({ skipped: 'off' });
    expect(await h.pledger.run({ ...ready, enabled: null })).toEqual({ skipped: 'off' });
    expect(h.calls).toHaveLength(0);
  });

  test('signed out: nothing is asked', async () => {
    const h = harness();
    expect(await h.pledger.run({ ...ready, member: undefined })).toEqual({ skipped: 'signed-out' });
    expect(await h.pledger.run({ ...ready, member: '' })).toEqual({ skipped: 'signed-out' });
    expect(h.calls).toHaveLength(0);
  });

  test('a bond is never pledged in the background, even when asked for', async () => {
    expect(isAutoPledgeKind('BOND')).toBe(false);
    expect(AUTO_PLEDGE_KINDS).not.toContain('BOND' as AutoPledgeKind);
    const h = harness();
    expect(await h.pledger.run({ ...ready, kinds: ['BOND'] })).toEqual({ skipped: 'recent' });
    await h.pledger.run({ ...ready, kinds: ['BOND', 'SAVINGS'] });
    expect(h.calls.map((c) => c.kind)).toEqual(['SAVINGS']);
  });
});

describe('background pledging: when it tries', () => {
  test('Savings then Earn, for the member, once each', async () => {
    const h = harness();
    const outcome = await h.pledger.run(ready);
    expect(outcome).toEqual({ tried: ['SAVINGS', 'POOL_SHARE'], pledged: 0, errors: [] });
    expect(h.calls).toEqual([
      { kind: 'SAVINGS', member: MEMBER },
      { kind: 'POOL_SHARE', member: MEMBER },
    ]);
  });

  test('at most once per kind per ten minutes', async () => {
    const h = harness();
    await h.pledger.run(ready);
    expect(await h.pledger.run(ready)).toEqual({ skipped: 'recent' });
    h.advance(AUTO_PLEDGE_EVERY_MS - 1);
    expect(await h.pledger.run(ready)).toEqual({ skipped: 'recent' });
    h.advance(1);
    await h.pledger.run(ready);
    expect(h.calls).toHaveLength(4);
  });

  test('a kind that was tried waits; one that was not goes ahead', async () => {
    const h = harness();
    await h.pledger.run({ ...ready, kinds: ['SAVINGS'] });
    await h.pledger.run(ready);
    expect(h.calls.map((c) => c.kind)).toEqual(['SAVINGS', 'POOL_SHARE']);
  });

  test('the window is per member, whatever the address case', async () => {
    const h = harness();
    await h.pledger.run(ready);
    expect(await h.pledger.run({ ...ready, member: MEMBER.toLowerCase() })).toEqual({ skipped: 'recent' });
    await h.pledger.run({ ...ready, member: '0x0000000000000000000000000000000000000002' });
    expect(h.calls).toHaveLength(4);
  });

  test('one in flight at a time: a second run while the first is out is skipped, not queued', async () => {
    const h = harness();
    h.holdNext();
    const first = h.pledger.run(ready);
    expect(h.pledger.busy()).toBe(true);
    // Even after the window, a run during another is skipped.
    h.advance(AUTO_PLEDGE_EVERY_MS);
    expect(await h.pledger.run({ ...ready, member: '0x0000000000000000000000000000000000000003' })).toEqual({ skipped: 'busy' });
    h.releaseHeld();
    await first;
    expect(h.pledger.busy()).toBe(false);
    expect(h.calls.map((c) => c.member)).toEqual([MEMBER, MEMBER]);
  });

  test('a pledge after a deposit waits for the background run, and the background run skips while it is out', async () => {
    const order: string[] = [];
    const pledger = createAutoPledger({
      pledge: async (kind) => {
        order.push(`start ${kind}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`end ${kind}`);
        return { pledged: 0 };
      },
      clock: memoryClock(),
    });
    const background = pledger.run(ready);
    const afterDeposit = pledger.exclusive(async () => void order.push('deposit'));
    await Promise.all([background, afterDeposit]);
    expect(order).toEqual(['start SAVINGS', 'end SAVINGS', 'start POOL_SHARE', 'end POOL_SHARE', 'deposit']);

    let finish: () => void = () => {};
    const held = pledger.exclusive(() => new Promise<void>((resolve) => (finish = resolve)));
    expect(await pledger.run({ ...ready, member: '0x0000000000000000000000000000000000000004' })).toEqual({ skipped: 'busy' });
    finish();
    await held;
    expect(pledger.busy()).toBe(false);
  });

  test('something pledged refreshes the credit read; nothing pledged does not', async () => {
    const none = harness({ pledged: 0 });
    await none.pledger.run(ready);
    expect(none.refreshed()).toBe(0);
    const some = harness({ pledged: 1 });
    expect(await some.pledger.run(ready)).toEqual({ tried: ['SAVINGS', 'POOL_SHARE'], pledged: 2, errors: [] });
    expect(some.refreshed()).toBe(1);
  });

  test('never throws: a declined signature is reported, and still waits out the window', async () => {
    const h = harness({ throws: true });
    const outcome = await h.pledger.run(ready);
    expect(outcome).toEqual({ tried: ['SAVINGS', 'POOL_SHARE'], pledged: 0, errors: ['SAVINGS: declined', 'POOL_SHARE: declined'] });
    expect(await h.pledger.run(ready)).toEqual({ skipped: 'recent' });
    const refused = harness({ error: 'Pledging is not available on this network.' });
    expect(await refused.pledger.run(ready)).toMatchObject({ errors: ['SAVINGS: Pledging is not available on this network.', 'POOL_SHARE: Pledging is not available on this network.'] });
  });
});

describe('a line, as the credit read shows it', () => {
  test('a complete read with a period that has started', () => {
    expect(hasCreditLine({ complete: true, cycle: { issuedAt: 1_700_000_000 } })).toBe(true);
  });
  test('no read, a partial read, no period, or one never opened: no line', () => {
    expect(hasCreditLine(null)).toBe(false);
    expect(hasCreditLine({ complete: false, cycle: { issuedAt: 1_700_000_000 } })).toBe(false);
    expect(hasCreditLine({ complete: true, cycle: null })).toBe(false);
    expect(hasCreditLine({ complete: true, cycle: { issuedAt: 0 } })).toBe(false);
  });
});

describe('wiring', () => {
  test('Home runs it with the credit read; the pledge after a deposit goes through the setting', () => {
    expect(read('pages/app/HomeRoute.tsx')).toContain('useAutoPledge(address, credit)');
    for (const file of ['lib/aa.ts', 'lib/sendCalls.ts']) {
      const source = read(file);
      expect(source).toContain('pledgeAfterMove(');
      expect(source).not.toContain('pledgeWhatIsHeld(');
    }
    const wiring = read('lib/autoPledge.ts');
    // Savings and Earn check the setting; a bond (not an auto kind) is always asked for, explicitly.
    expect(wiring).toContain('isAutoPledgeKind(kind) && (await autoPledgeSetting(member)) === false');
    expect(wiring).toContain('autoPledger.exclusive(');
  });

  test('Settings has the switch, saved on the server', () => {
    expect(read('components/settings/PermissionsPanel.tsx')).toContain('Back my credit line with my Savings and Earn automatically');
    expect(read('lib/autoPledge.ts')).toContain('updateMemberSecurity({ autoPledge: on })');
    expect(read('../../api/src/routes/members.ts')).toContain("parseOptionalBoolean(body.autoPledge, 'autoPledge', res)");
  });
});
