import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PAYOUT_KEEPER_CONFIG,
  addBusinessDays,
  deadlineHorizonSeconds,
  describePayoutFunding,
  evaluatePayoutFunding,
  formatUsdc,
  gatherPayoutFunding,
  isBusinessDay,
  payoutKeeperConfigFromEnv,
  subtractBusinessDays,
  yieldPoolHeadroom,
  type ClaimRead,
  type PayoutFundingReads,
  type PayoutPoolReader,
  type YieldPoolRead,
} from './fundingStatus';

const USDC = 1_000_000n;
const HOUR = 3600;
const DAY = 86_400;
const config = DEFAULT_PAYOUT_KEEPER_CONFIG;

/** A moment in Pacific time (PST, UTC-8, in late November). */
function pst(date: string, hour = 10): number {
  return Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00-08:00`) / 1000;
}

// Wednesday 18 November 2026, 10:00 PST.
const NOW = pst('2026-11-18');

function claim(id: number, amount: bigint, dueBy: number, paid = false): ClaimRead {
  return { id: BigInt(id), amount, dueBy, paid };
}

const healthyYieldPool: YieldPoolRead = {
  deployedBalance: 800n * USDC,
  vaultCash: 1_200n * USDC,
  poolTierPrincipal: 5_000n * USDC,
  poolTierPostedAt: NOW - 30 * DAY,
  queuedShares: 0n,
  suspended: false,
  lossChargePending: false,
  finalMaturity: NOW + 20 * 365 * DAY,
  deploymentAccount: '0x00000000000000000000000000000000000000c1',
};

/**
 * The reads for a pool holding `payable` with `claims` queued, as the PayoutPool would answer
 * them: each dueWithin lists the unpaid claims due by its cutoff and is short what `payable` lacks.
 */
function reads(payable: bigint, claims: ClaimRead[], extra: Partial<PayoutFundingReads> = {}): PayoutFundingReads {
  const deadlineHorizon = deadlineHorizonSeconds(NOW, config.deadlineBusinessDays, config);
  const standingHorizon = config.standingDays * DAY;
  const due = (horizon: number) => {
    const listed = claims.filter((c) => !c.paid && c.dueBy <= NOW + horizon);
    const amount = listed.reduce((s, c) => s + c.amount, 0n);
    return { ids: listed.map((c) => c.id), amount, short: amount > payable ? amount - payable : 0n };
  };
  const unpaid = claims.filter((c) => !c.paid).sort((a, b) => a.dueBy - b.dueBy);
  return {
    now: NOW,
    held: payable,
    payable,
    overdue: due(0),
    deadline: due(deadlineHorizon),
    deadlineHorizon,
    standing: due(standingHorizon),
    standingHorizon,
    head: unpaid[0] ?? null,
    claims: claims.filter((c) => c.dueBy <= NOW + standingHorizon),
    yieldPool: { ok: true, value: healthyYieldPool },
    bondVaultExcess: { ok: true, value: 3_000n * USDC },
    treasuryAvailable: { ok: true, value: 0n },
    ...extra,
  };
}

describe('status', () => {
  test('GREEN when the payable balance covers everything due within 30 days', () => {
    const s = evaluatePayoutFunding(
      reads(1_000n * USDC, [claim(0, 400n * USDC, NOW + 10 * DAY), claim(1, 500n * USDC, NOW + 25 * DAY), claim(2, 900n * USDC, NOW + 40 * DAY)]),
      config,
    );
    expect(s.level).toBe('GREEN');
    expect(s.reasons).toEqual([]);
    expect(s.topUp).toBe(0n);
    expect(s.neededNow).toBe(0n);
    expect(s.standing.amount).toBe(900n * USDC);
    expect(s.fundBy).toBeNull();
  });

  test('AMBER below the standing balance, with the exact top-up and when it is due', () => {
    const first = claim(0, 200n * USDC, NOW + 10 * DAY);
    const second = claim(1, 500n * USDC + 1n, NOW + 20 * DAY);
    const s = evaluatePayoutFunding(reads(300n * USDC, [first, second]), config);
    expect(s.level).toBe('AMBER');
    // 700.000001 due within 30 days against 300 payable.
    expect(s.topUp).toBe(400n * USDC + 1n);
    expect(s.neededNow).toBe(0n);
    // The first claim is covered; the second is not, so it sets the date: two business days before
    // its payout deadline.
    expect(s.firstUnfunded?.id).toBe(1n);
    expect(s.fundBy).toBe(subtractBusinessDays(second.dueBy, 2, config));
    // Rounded up to the cent: funding what the message says is always enough.
    expect(describePayoutFunding(s, { chain: 'chain 84532', payoutPool: '0xPool' }).subject).toContain('top up $400.01');
  });

  test('RED for a claim past its payout deadline', () => {
    const late = claim(0, 100n * USDC, NOW - HOUR);
    const s = evaluatePayoutFunding(reads(0n, [late, claim(1, 50n * USDC, NOW + 20 * DAY)]), config);
    expect(s.level).toBe('RED');
    expect(s.overdue.ids).toEqual([0n]);
    expect(s.overdue.earliestDueBy).toBe(late.dueBy);
    expect(s.neededNow).toBe(100n * USDC);
    expect(s.topUp).toBe(150n * USDC);
    expect(s.fundBy).toBe(NOW);
    expect(s.payableNow).toBe(false);
  });

  test('RED for an overdue claim even when the cash is there: payNext has not been called', () => {
    const s = evaluatePayoutFunding(reads(500n * USDC, [claim(0, 100n * USDC, NOW - HOUR)]), config);
    expect(s.level).toBe('RED');
    expect(s.neededNow).toBe(0n);
    expect(s.payableNow).toBe(true);
    expect(describePayoutFunding(s, { chain: 'c', payoutPool: 'p' }).body).toContain('payNext()');
  });

  test('RED for a claim the head shows is late, though a long queue cut dueWithin(0) short', () => {
    const late = claim(7, 100n * USDC, NOW - DAY);
    const r = reads(0n, [late]);
    r.overdue = { ids: [], amount: 0n, short: 0n };
    const s = evaluatePayoutFunding(r, config);
    expect(s.level).toBe('RED');
    expect(s.overdue.ids).toEqual([7n]);
    expect(s.overdue.short).toBe(100n * USDC);
  });

  test('RED when the claims due within 2 business days are short', () => {
    // Wednesday 10:00: due Friday 09:00 is inside two business days, so it should already be funded.
    const soon = claim(0, 250n * USDC, pst('2026-11-20', 9));
    const s = evaluatePayoutFunding(reads(100n * USDC, [soon, claim(1, 50n * USDC, NOW + 15 * DAY)]), config);
    expect(s.level).toBe('RED');
    expect(s.overdue.ids).toEqual([]);
    expect(s.deadline.short).toBe(150n * USDC);
    expect(s.neededNow).toBe(150n * USDC);
    expect(s.topUp).toBe(200n * USDC);
    expect(s.reasons[0]).toContain('12.10');
  });

  test('a claim just outside 2 business days is AMBER, not RED', () => {
    // Friday 11:00 is two business days and an hour away.
    const s = evaluatePayoutFunding(reads(100n * USDC, [claim(0, 250n * USDC, pst('2026-11-20', 11))]), config);
    expect(s.level).toBe('AMBER');
    expect(s.fundBy).toBe(pst('2026-11-18', 11));
  });

  test('a truncated list says its amounts are lower bounds', () => {
    const small = { ...config, maxClaims: 1 };
    const r = reads(0n, [claim(0, 10n * USDC, NOW + 5 * DAY), claim(1, 10n * USDC, NOW + 6 * DAY)]);
    r.standing = { ids: [0n], amount: 10n * USDC, short: 10n * USDC };
    const s = evaluatePayoutFunding(r, small);
    expect(s.standing.truncated).toBe(true);
    expect(s.reasons.join('\n')).toContain('lower bounds');
  });
});

describe('business days', () => {
  test('weekdays are business days, weekends and listed holidays are not', () => {
    expect(isBusinessDay(pst('2026-11-20'), config)).toBe(true); // Friday
    expect(isBusinessDay(pst('2026-11-21'), config)).toBe(false); // Saturday
    expect(isBusinessDay(pst('2026-11-22'), config)).toBe(false); // Sunday
    const withThanksgiving = { ...config, holidays: ['2026-11-26'] };
    expect(isBusinessDay(pst('2026-11-26'), config)).toBe(true);
    expect(isBusinessDay(pst('2026-11-26'), withThanksgiving)).toBe(false);
  });

  test('the day is the Pacific date, not the UTC one', () => {
    // Friday 20:00 PST is already Saturday in UTC.
    expect(isBusinessDay(pst('2026-11-20', 20), config)).toBe(true);
  });

  test('two business days from a Wednesday is Friday', () => {
    expect(addBusinessDays(NOW, 2, config)).toBe(pst('2026-11-20'));
    expect(deadlineHorizonSeconds(NOW, 2, config)).toBe(2 * DAY);
  });

  test('two business days from a Friday runs across the weekend to Tuesday', () => {
    const friday = pst('2026-11-20');
    expect(addBusinessDays(friday, 2, config)).toBe(pst('2026-11-24'));
    expect(deadlineHorizonSeconds(friday, 2, config)).toBe(4 * DAY);
    // And back: a Monday deadline is funded by the Thursday before.
    expect(subtractBusinessDays(pst('2026-11-23'), 2, config)).toBe(pst('2026-11-19'));
  });

  test('on a Saturday, everything due by the end of Tuesday should already be funded', () => {
    const saturday = pst('2026-11-21');
    const endOfTuesday = pst('2026-11-25', 0) - 1;
    expect(saturday + deadlineHorizonSeconds(saturday, 2, config)).toBe(endOfTuesday);
    // Late Tuesday's funding deadline is Friday evening, which has passed.
    expect(subtractBusinessDays(pst('2026-11-24', 23), 2, config)).toBeLessThan(saturday);
    // Wednesday's is Monday, which has not.
    expect(subtractBusinessDays(pst('2026-11-25', 1), 2, config)).toBeGreaterThan(saturday);
  });

  test('a holiday is skipped like a weekend', () => {
    const cal = { ...config, holidays: ['2026-11-26', '2026-11-27'] };
    // Wednesday before Thanksgiving: Thursday and Friday off, so Monday and Tuesday.
    expect(addBusinessDays(pst('2026-11-25'), 2, cal)).toBe(pst('2026-12-01'));
  });

  test('zero business days is no lead time', () => {
    expect(deadlineHorizonSeconds(NOW, 0, config)).toBe(0);
  });
});

describe('funding options', () => {
  test('the Yield Pool headroom is the tightest of cash, the 90% cap and the Pool Tier principal', () => {
    // D 800, cash 1,200: 90% of 2,000 is 1,800, so 1,000 more keeps Utilization at 90%.
    const h = yieldPoolHeadroom(healthyYieldPool, NOW);
    expect(h.blockedBy).toEqual([]);
    expect(h.limits.utilizationCap).toBe(1_000n * USDC);
    expect(h.limits.poolTier).toBe(4_200n * USDC);
    expect(h.headroom).toBe(1_000n * USDC);
    expect(h.binding).toBe('utilization cap');
    // (800 + 1,000) / 2,000 is exactly 90%: the contract's check passes at the limit.
    const D = healthyYieldPool.deployedBalance;
    expect(((D + h.headroom) * 10n ** 18n) / (D + healthyYieldPool.vaultCash)).toBe(9n * 10n ** 17n);
  });

  test('the Pool Tier principal can bind', () => {
    const h = yieldPoolHeadroom({ ...healthyYieldPool, poolTierPrincipal: 850n * USDC }, NOW);
    expect(h.headroom).toBe(50n * USDC);
    expect(h.binding).toBe('Pool Tier principal');
  });

  test('already over the cap is 0, not negative', () => {
    const h = yieldPoolHeadroom({ ...healthyYieldPool, deployedBalance: 9_500n * USDC, vaultCash: 500n * USDC, poolTierPrincipal: 20_000n * USDC }, NOW);
    expect(h.headroom).toBe(0n);
  });

  test.each([
    ['suspended', { suspended: true }],
    ['withdrawal queue open', { queuedShares: 1n }],
    ['loss charge pending', { lossChargePending: true }],
    ['no Pool Tier principal posted', { poolTierPostedAt: 0 }],
    ['past Final Maturity', { finalMaturity: NOW - 1 }],
    ['no deployment account set', { deploymentAccount: '0x0000000000000000000000000000000000000000' }],
  ] as Array<[string, Partial<YieldPoolRead>]>)('0 headroom when %s', (reason, change) => {
    const h = yieldPoolHeadroom({ ...healthyYieldPool, ...change }, NOW);
    expect(h.headroom).toBe(0n);
    expect(h.blockedBy).toContain(reason);
  });

  test('the options are reported with the status, and a failed read is unavailable rather than zero', () => {
    const r = reads(0n, [claim(0, 10n * USDC, NOW + 10 * DAY)], {
      bondVaultExcess: { ok: false, error: 'execution reverted' },
      treasuryAvailable: { ok: true, value: 25n * USDC },
    });
    const s = evaluatePayoutFunding(r, config);
    expect(s.options.yieldPool?.ok && s.options.yieldPool.value.headroom).toBe(1_000n * USDC);
    expect(s.options.total).toBe(1_025n * USDC);
    const { body } = describePayoutFunding(s, { chain: 'chain 84532', payoutPool: '0xPool' });
    expect(body).toContain('BondVault deployable excess (through the Collateral Agent): unavailable (read failed: execution reverted)');
    expect(body).toContain('Yield Pool Deployment headroom: $1,000.00 (limited by utilization cap');
    expect(body).toContain('treasuryAvailable): $25.00');
  });
});

describe('config and text', () => {
  test('defaults: 30 days, 2 business days, 200 claims, Pacific', () => {
    expect(payoutKeeperConfigFromEnv({})).toEqual(DEFAULT_PAYOUT_KEEPER_CONFIG);
    expect(DEFAULT_PAYOUT_KEEPER_CONFIG).toMatchObject({ standingDays: 30, deadlineBusinessDays: 2, maxClaims: 200, timeZone: 'America/Los_Angeles' });
  });

  test('read from the environment, ignoring what does not parse', () => {
    const c = payoutKeeperConfigFromEnv({
      PAYOUT_KEEPER_STANDING_DAYS: '45',
      PAYOUT_KEEPER_DEADLINE_BUSINESS_DAYS: '3',
      PAYOUT_KEEPER_MAX_CLAIMS: 'lots',
      PAYOUT_KEEPER_HOLIDAYS: '2026-11-26, 2026-12-25,christmas',
      PAYOUT_KEEPER_TIMEZONE: 'Not/AZone',
    });
    expect(c).toEqual({ standingDays: 45, deadlineBusinessDays: 3, maxClaims: 200, holidays: ['2026-11-26', '2026-12-25'], timeZone: 'America/Los_Angeles' });
  });

  test('dollars: needed rounds up, available rounds down', () => {
    expect(formatUsdc(1_234_567_891n)).toBe('$1,234.56');
    expect(formatUsdc(1_234_567_891n, 'up')).toBe('$1,234.57');
    expect(formatUsdc(5n * USDC, 'up')).toBe('$5.00');
    expect(formatUsdc(0n)).toBe('$0.00');
  });
});

describe('reading the chain', () => {
  test('asks dueWithin for 0, the business-day horizon and 30 days, and works out the payable balance', async () => {
    const calls: Array<[bigint, bigint]> = [];
    const late = claim(3, 40n * USDC, NOW - HOUR);
    const pool: PayoutPoolReader = {
      dueWithin: async (horizon: bigint, max: bigint) => {
        calls.push([horizon, max]);
        return horizon === 0n ? [[3n], 40n * USDC, 0n] : [[3n, 4n], 90n * USDC, 10n * USDC];
      },
      held: async () => 100n * USDC,
      refundsOwed: async () => 30n * USDC,
      memberFunded: async () => 20n * USDC,
      treasuryAvailable: async () => {
        throw new Error('missing function');
      },
      nextUnpaid: async () => 3n,
      claimCount: async () => 5n,
      claimAt: async (id: bigint) =>
        id === 3n ? ['0xm', late.amount, 0n, BigInt(late.dueBy), false] : ['0xm', 50n * USDC, 0n, BigInt(NOW + DAY), false],
    };
    const r = await gatherPayoutFunding({ now: async () => NOW, payoutPool: pool }, config);
    expect(calls).toEqual([
      [0n, 200n],
      [BigInt(2 * DAY), 200n],
      [BigInt(30 * DAY), 200n],
    ]);
    // Refunds owed come out of members' money first: 100 held less min(30, 20).
    expect(r.payable).toBe(80n * USDC);
    expect(r.head).toEqual(late);
    expect(r.claims.map((c) => c.id)).toEqual([3n, 4n]);
    expect(r.treasuryAvailable).toEqual({ ok: false, error: 'missing function' });
    expect(r.yieldPool).toBeNull();
    expect(r.bondVaultExcess).toBeNull();
    expect(evaluatePayoutFunding(r, config).level).toBe('RED');
  });

  test('reads claims one by one only when something is short or late', async () => {
    let claimReads = 0;
    const pool: PayoutPoolReader = {
      dueWithin: async (horizon: bigint) => (horizon === 0n ? [[], 0n, 0n] : [[1n], 10n * USDC, 0n]),
      held: async () => 100n * USDC,
      refundsOwed: async () => 0n,
      memberFunded: async () => 0n,
      treasuryAvailable: async () => 0n,
      nextUnpaid: async () => 1n,
      claimCount: async () => 2n,
      claimAt: async () => {
        claimReads++;
        return ['0xm', 10n * USDC, 0n, BigInt(NOW + 10 * DAY), false];
      },
    };
    const r = await gatherPayoutFunding({ now: async () => NOW, payoutPool: pool }, config);
    expect(claimReads).toBe(1); // the head only
    expect(evaluatePayoutFunding(r, config).level).toBe('GREEN');
  });
});
