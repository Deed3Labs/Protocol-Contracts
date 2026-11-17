import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PAYOUT_KEEPER_CONFIG,
  evaluatePayoutFunding,
  type ClaimRead,
  type PayoutFundingStatus,
} from '../services/payoutFunding/fundingStatus';
import { alertKey, createPayoutFundingKeeper, decideAlert } from './payoutFundingKeeper';

const USDC = 1_000_000n;
const HOUR = 3600;
const DAY = 86_400;
const config = DEFAULT_PAYOUT_KEEPER_CONFIG;
// Wednesday 18 November 2026, 10:00 PST.
const START = Date.parse('2026-11-18T10:00:00-08:00') / 1000;

/** The status for a pool holding `payable` with these claims queued, at `now`. */
function statusAt(now: number, payable: bigint, claims: ClaimRead[]): PayoutFundingStatus {
  const due = (horizon: number) => {
    const listed = claims.filter((c) => !c.paid && c.dueBy <= now + horizon);
    const amount = listed.reduce((s, c) => s + c.amount, 0n);
    return { ids: listed.map((c) => c.id), amount, short: amount > payable ? amount - payable : 0n };
  };
  const unpaid = [...claims].sort((a, b) => a.dueBy - b.dueBy);
  return evaluatePayoutFunding(
    {
      now,
      held: payable,
      payable,
      overdue: due(0),
      deadline: due(2 * DAY),
      deadlineHorizon: 2 * DAY,
      standing: due(30 * DAY),
      standingHorizon: 30 * DAY,
      head: unpaid[0] ?? null,
      claims,
      yieldPool: null,
      bondVaultExcess: { ok: true, value: 0n },
      treasuryAvailable: { ok: true, value: 0n },
    },
    config,
  );
}

const c = (id: number, amount: bigint, dueBy: number): ClaimRead => ({ id: BigInt(id), amount, dueBy, paid: false });

/** A keeper whose chain answers whatever `next` holds, and whose alerts are recorded. */
function harness() {
  const sent: Array<{ key: string; subject: string; body: string }> = [];
  const logs: string[] = [];
  let next: PayoutFundingStatus | Error = statusAt(START, 0n, []);
  let wall = START;
  const keeper = createPayoutFundingKeeper({
    config,
    read: async () => {
      if (next instanceof Error) throw next;
      return { status: next, chain: 'chain 84532', payoutPool: '0xPool' };
    },
    alert: async (a) => {
      sent.push(a);
    },
    clock: () => wall,
    log: (l) => logs.push(l),
    warn: (l) => logs.push(l),
  });
  return {
    sent,
    logs,
    keeper,
    set(status: PayoutFundingStatus | Error) {
      next = status;
    },
    setWall(t: number) {
      wall = t;
    },
  };
}

describe('when the keeper alerts', () => {
  test('GREEN is logged, never alerted', async () => {
    const h = harness();
    h.set(statusAt(START, 1_000n * USDC, [c(0, 100n * USDC, START + 10 * DAY)]));
    expect(await h.keeper.tick()).toBe('GREEN');
    expect(h.sent).toEqual([]);
    expect(h.logs.join('\n')).toContain('GREEN');
  });

  test('the same AMBER alerts once a day, not every hour', async () => {
    const h = harness();
    const claims = [c(0, 500n * USDC, START + 10 * DAY)];
    h.set(statusAt(START, 100n * USDC, claims));
    expect(await h.keeper.tick()).toBe('AMBER');
    for (let i = 1; i <= 5; i++) {
      h.set(statusAt(START + i * HOUR, 100n * USDC, claims));
      expect(await h.keeper.tick()).toBe('AMBER');
    }
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].subject).toContain('AMBER: top up $400.00');
    expect(h.sent[0].body).toContain('Funding options');

    // The next day, still short: told again.
    h.set(statusAt(START + DAY, 100n * USDC, claims));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].key).not.toBe(h.sent[0].key);
  });

  test('a larger shortfall alerts again the same day; a smaller one does not', async () => {
    const h = harness();
    const claims = [c(0, 500n * USDC, START + 10 * DAY)];
    h.set(statusAt(START, 100n * USDC, claims));
    await h.keeper.tick();
    // A new claim queued: the top-up grows from 400 to 700.
    const more = [...claims, c(1, 300n * USDC, START + 20 * DAY)];
    h.set(statusAt(START + HOUR, 100n * USDC, more));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].subject).toContain('$700.00');
    // Part funded: 500 short now, better than what was alerted, so quiet.
    h.set(statusAt(START + 2 * HOUR, 300n * USDC, more));
    await h.keeper.tick();
    // Back to 700 short: no worse than the 700 already alerted today.
    h.set(statusAt(START + 3 * HOUR, 100n * USDC, more));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(2);
  });

  test('RED alerts, and a claim newly past its deadline alerts again', async () => {
    const h = harness();
    const a = c(0, 100n * USDC, START + DAY + 2 * HOUR);
    const b = c(1, 100n * USDC, START + DAY + 4 * HOUR);
    // Inside two business days and unfunded: RED from the start.
    h.set(statusAt(START, 0n, [a, b]));
    expect(await h.keeper.tick()).toBe('RED');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].subject).toBe('Payout funding RED: $200.00 needed now');

    // An hour later, nothing has changed.
    h.set(statusAt(START + HOUR, 0n, [a, b]));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(1);

    // `a` passes its deadline: the shortfall is the same, but a merchant is now late.
    h.set(statusAt(a.dueBy + 60, 0n, [a, b]));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].body).toContain('reached their payout deadline unpaid');

    // Still only `a` late: quiet. Then `b` too: alerted.
    h.set(statusAt(a.dueBy + HOUR, 0n, [a, b]));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(2);
    h.set(statusAt(b.dueBy + 60, 0n, [a, b]));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(3);
  });

  test('RED after AMBER the same day alerts; AMBER after RED does not', () => {
    const day = '2026-11-18';
    const amber = statusAt(START, 0n, [c(0, 100n * USDC, START + 10 * DAY)]);
    const red = statusAt(START, 0n, [c(0, 100n * USDC, START + 10 * DAY), c(1, 1n, START + DAY)]);
    const first = decideAlert(null, amber, day);
    expect(first.send).toBe(true);
    const escalated = decideAlert(first.memory, red, day);
    expect(escalated.send).toBe(true);
    expect(escalated.why).toContain('now RED');
    const calmer = decideAlert(escalated.memory, amber, day);
    expect(calmer.send).toBe(false);
  });

  test('a GREEN pass in between does not reset the day', async () => {
    const h = harness();
    const claims = [c(0, 500n * USDC, START + 10 * DAY)];
    h.set(statusAt(START, 100n * USDC, claims));
    await h.keeper.tick();
    h.set(statusAt(START + HOUR, 1_000n * USDC, claims));
    await h.keeper.tick();
    h.set(statusAt(START + 2 * HOUR, 100n * USDC, claims));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(1);
  });

  test('the key names the day, level, shortfalls and overdue claims, so a restart cannot repeat an alert', () => {
    const s = statusAt(START, 100n * USDC, [c(0, 500n * USDC, START + 10 * DAY)]);
    const key = alertKey(s, '2026-11-18', 'chain 84532:0xPool');
    expect(key).toBe(alertKey(statusAt(START + HOUR, 100n * USDC, [c(0, 500n * USDC, START + 10 * DAY)]), '2026-11-18', 'chain 84532:0xPool'));
    expect(key).toContain('2026-11-18');
    expect(key).toContain('AMBER');
    expect(key).toContain(`due30d=${400n * USDC}`);
    expect(alertKey(statusAt(START, 0n, [c(0, 500n * USDC, START + 10 * DAY)]), '2026-11-18', 'chain 84532:0xPool')).not.toBe(key);
  });

  test('a keeper that cannot read the chain says so after three passes in a row, once a day', async () => {
    const h = harness();
    h.set(new Error('rpc down'));
    expect(await h.keeper.tick()).toBe('failed');
    expect(await h.keeper.tick()).toBe('failed');
    expect(h.sent).toHaveLength(0);
    await h.keeper.tick();
    await h.keeper.tick();
    expect(h.sent).toHaveLength(2);
    // The same key both times: opsAlert sends it once.
    expect(h.sent[0].key).toBe('payout-funding:read-failed:2026-11-18');
    expect(h.sent[1].key).toBe(h.sent[0].key);
    expect(h.sent[0].body).toContain('rpc down');
    // A good read resets the count.
    h.set(statusAt(START, 1_000n * USDC, []));
    await h.keeper.tick();
    h.set(new Error('rpc down'));
    await h.keeper.tick();
    expect(h.sent).toHaveLength(2);
  });
});

describe('the job is wired up and read-only', () => {
  const job = readFileSync(new URL('./payoutFundingKeeper.ts', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../services/payoutFunding/fundingStatus.ts', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const envExample = readFileSync(new URL('../../env.example', import.meta.url), 'utf8');

  test('the server starts it, hourly, behind PAYOUT_KEEPER_ENABLED', () => {
    expect(index).toContain('startPayoutFundingKeeper()');
    expect(job).toContain('const HOUR_MS = 60 * 60 * 1000');
    expect(job).toContain('PAYOUT_KEEPER_ENABLED');
    expect(envExample).toContain('PAYOUT_KEEPER_ENABLED=');
  });

  test('it holds no key and sends nothing', () => {
    for (const source of [job, shared]) {
      expect(source).not.toMatch(/new ethers\.Wallet|sendTransaction|PRIVATE_KEY|writesAs|getSigner/);
    }
  });
});
