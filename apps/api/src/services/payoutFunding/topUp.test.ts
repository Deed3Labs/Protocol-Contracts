import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import {
  ALLOWANCE_MODULE_ABI,
  ERC20_ABI,
  PAYOUT_POOL_ROLES,
  PAYOUT_POOL_TOPUP_ABI,
  SELECTORS,
  DEFAULT_TOPUP_CONFIG,
  assertTopUpCall,
  capRemaining,
  decideTopUp,
  parseUsdc,
  projection,
  topUpCalls,
  topUpConfigFromEnv,
  type Projection,
  type TopUpAddresses,
  type TopUpReads,
} from './topUp';

const U = 1_000_000n;
const DAY = 86_400;
const config = DEFAULT_TOPUP_CONFIG; // margin $100, no cap override
const proj = (short: bigint, amount = short): Projection => ({ horizon: 0, listed: 1, amount, short, truncated: false });

/** A pool with everything set up, a $5,000 cap untouched, $50,000 in CL Operating, and nothing short. */
function reads(over: Partial<TopUpReads> = {}): TopUpReads {
  return {
    now: 1_795_000_000,
    held: 1_000n * U,
    payable: 1_000n * U,
    queuedTotal: 0n,
    overdue: proj(0n),
    low: proj(0n),
    target: proj(0n),
    allowance: { amount: 5_000n * U, spent: 0n, resetTimeMin: 10_080, lastResetMin: 29_913_120, nonce: 1 },
    moduleEnabled: true,
    isFunder: true,
    otherRoles: [],
    operatingBalance: 50_000n * U,
    walletBalance: 0n,
    walletPoolAllowance: 0n,
    ...over,
  };
}

describe('when a top-up moves, and how much (the owner\'s rules)', () => {
  const cases: Array<[string, Partial<TopUpReads>, (d: ReturnType<typeof decideTopUp>) => void]> = [
    ['nothing short: no move', {}, (d) => expect(d).toEqual({ kind: 'none', why: 'nothing short', early: null })],
    [
      'low short: refill to the target plus the margin',
      { low: proj(300n * U), target: proj(1_200n * U) },
      (d) => expect(d).toEqual({ kind: 'move', trigger: 'low-water', need: 1_300n * U, amount: 1_300n * U, remainder: 0n }),
    ],
    [
      'target short but the low horizon fine: no move, and no early alert while the cap covers it',
      { target: proj(1_200n * U) },
      (d) => expect(d).toEqual({ kind: 'none', why: 'short only beyond the low horizon', early: null }),
    ],
    [
      'target short beyond what the cap has left, low fine: no move, an early alert',
      { target: proj(6_000n * U), allowance: { amount: 5_000n * U, spent: 1_000n * U, resetTimeMin: 10_080, lastResetMin: 1, nonce: 2 } },
      (d) => expect(d).toEqual({ kind: 'none', why: 'short only beyond the low horizon', early: { need: 6_100n * U, remaining: 4_000n * U } }),
    ],
    [
      'need over the remaining cap: move what the cap allows, the rest for people',
      { low: proj(2_000n * U), target: proj(7_000n * U), allowance: { amount: 5_000n * U, spent: 1_000n * U, resetTimeMin: 10_080, lastResetMin: 1, nonce: 2 } },
      (d) => expect(d).toEqual({ kind: 'move', trigger: 'low-water', need: 7_100n * U, amount: 4_000n * U, remainder: 3_100n * U }),
    ],
    [
      'the cap spent this period: nothing moves, everything for people',
      { low: proj(200n * U), target: proj(500n * U), allowance: { amount: 5_000n * U, spent: 5_000n * U, resetTimeMin: 10_080, lastResetMin: 100, nonce: 3 } },
      (d) => expect(d).toEqual({ kind: 'cap-exhausted', trigger: 'low-water', need: 600n * U, remainder: 600n * U, resetsAt: (100 + 10_080) * 60 }),
    ],
    [
      'CL Operating short: alert, no move',
      { low: proj(300n * U), target: proj(1_200n * U), operatingBalance: 1_000n * U },
      (d) => expect(d).toEqual({ kind: 'operating-short', trigger: 'low-water', need: 1_300n * U, move: 1_300n * U, operatingBalance: 1_000n * U }),
    ],
    [
      'overdue now: act, and say so',
      { overdue: proj(50n * U), low: proj(50n * U), target: proj(50n * U) },
      (d) => expect(d).toEqual({ kind: 'move', trigger: 'overdue', need: 150n * U, amount: 150n * U, remainder: 0n }),
    ],
    [
      'short, but not set up: no move, says what is missing',
      { low: proj(10n * U), moduleEnabled: false, isFunder: false, otherRoles: ['OPERATOR_ROLE'] },
      (d) => {
        expect(d.kind).toBe('setup');
        expect((d as { missing: string[] }).missing.join('\n')).toContain('not enabled on CL Operating');
        expect((d as { missing: string[] }).missing.join('\n')).toContain('FUNDER_ROLE');
        expect((d as { missing: string[] }).missing.join('\n')).toContain('OPERATOR_ROLE');
      },
    ],
  ];
  for (const [name, over, check] of cases) test(name, () => check(decideTopUp(reads(over), config)));

  test('a configured cap below the chain\'s holds the bot to it', () => {
    const al = { amount: 10_000n * U, spent: 1_000n * U, resetTimeMin: 10_080, lastResetMin: 1, nonce: 2 };
    expect(capRemaining(al, null)).toBe(9_000n * U);
    expect(capRemaining(al, 5_000n * U)).toBe(4_000n * U);
    expect(capRemaining(al, 500n * U)).toBe(0n);
    const d = decideTopUp(reads({ low: proj(1n * U), target: proj(9_000n * U), allowance: al }), { ...config, capOverride: 5_000n * U });
    expect(d).toEqual({ kind: 'move', trigger: 'low-water', need: 9_100n * U, amount: 4_000n * U, remainder: 5_100n * U });
  });
});

describe('dueWithin truncation', () => {
  /** A pool with `n` claims of $10 due within the horizon; dueWithin lists at most maxClaims of them. */
  const pool = (n: number, payable: bigint, calls: bigint[]) => ({
    dueWithin: async (_h: bigint, max: bigint) => {
      calls.push(max);
      const listed = Math.min(n, Number(max));
      const amount = BigInt(listed) * 10n * U;
      return [Array.from({ length: listed }, (_, i) => BigInt(i)), amount, amount > payable ? amount - payable : 0n];
    },
  });
  const cfg = { maxClaims: 200, maxClaimsCeiling: 3200 };

  test('a full list is read again with a larger limit until it is not full', async () => {
    const calls: bigint[] = [];
    const p = await projection(pool(500, 0n, calls) as never, 14 * DAY, cfg, 0n, 5_000n * U);
    expect(calls).toEqual([200n, 800n]);
    expect(p).toEqual({ horizon: 14 * DAY, listed: 500, amount: 5_000n * U, short: 5_000n * U, truncated: false });
  });

  test('still full at the ceiling: the need is everything queued, never less', async () => {
    const calls: bigint[] = [];
    const queued = 50_000n * U; // 5,000 claims of $10
    const p = await projection(pool(5_000, 1_000n * U, calls) as never, 14 * DAY, cfg, 1_000n * U, queued);
    expect(calls).toEqual([200n, 800n, 3200n]);
    expect(p.truncated).toBe(true);
    expect(p.amount).toBe(queued);
    expect(p.short).toBe(49_000n * U);
  });
});

describe('the three calls', () => {
  const a: TopUpAddresses = {
    payoutPool: ethers.Wallet.createRandom().address,
    safe: ethers.Wallet.createRandom().address,
    module: ethers.Wallet.createRandom().address,
    usdc: ethers.Wallet.createRandom().address,
    wallet: ethers.Wallet.createRandom().address,
  };
  const ifaces = { executeAllowanceTransfer: new ethers.Interface(ALLOWANCE_MODULE_ABI), approve: new ethers.Interface(ERC20_ABI), fund: new ethers.Interface(PAYOUT_POOL_TOPUP_ABI) };
  const encode = (c: ReturnType<typeof topUpCalls>[number]) => ({ to: c.to, data: ifaces[c.fn].encodeFunctionData(c.fn, c.args) });

  test('allowance transfer of the exact amount to the wallet, approve exactly that to the PayoutPool, fund exactly that', () => {
    const amount = 1_234_560_000n;
    const calls = topUpCalls(a, amount);
    expect(calls.map((c) => [c.step, c.to, c.fn])).toEqual([
      ['pull', a.module, 'executeAllowanceTransfer'],
      ['approve', a.usdc, 'approve'],
      ['fund', a.payoutPool, 'fund'],
    ]);
    // The delegate sends it itself: no fee, no payment token, an empty signature.
    expect(calls[0].args).toEqual([a.safe, a.usdc, a.wallet, amount, ethers.ZeroAddress, 0n, a.wallet, '0x']);
    expect(calls[1].args).toEqual([a.payoutPool, amount]);
    expect(calls[2].args).toEqual([amount]);
    for (const c of calls) expect(() => assertTopUpCall(a, encode(c), amount)).not.toThrow();
  });

  test('refuses withdrawCapital, any other call, and any other amount or recipient', () => {
    const pool = new ethers.Interface(['function withdrawCapital(uint256 amount, address to)', 'function redeem(uint256 amount)', 'function grantRole(bytes32,address)']);
    const amount = 10n * U;
    expect(() => assertTopUpCall(a, { to: a.payoutPool, data: pool.encodeFunctionData('withdrawCapital', [amount, a.wallet]) }, amount)).toThrow('never calls PayoutPool.withdrawCapital');
    expect(() => assertTopUpCall(a, { to: a.payoutPool, data: pool.encodeFunctionData('redeem', [amount]) }, amount)).toThrow('not one of the three top-up calls');
    const [pull, approve, fund] = topUpCalls(a, amount);
    expect(() => assertTopUpCall(a, encode(pull), amount + 1n)).toThrow('exact top-up amount');
    expect(() => assertTopUpCall(a, encode({ ...approve, args: [a.wallet, amount] }), amount)).toThrow('names only the PayoutPool');
    expect(() => assertTopUpCall(a, encode({ ...approve, args: [a.payoutPool, amount * 2n] }), amount)).toThrow('exact');
    expect(() => assertTopUpCall(a, encode({ ...pull, args: [a.safe, a.usdc, ethers.Wallet.createRandom().address, amount, ethers.ZeroAddress, 0n, a.wallet, '0x'] }), amount)).toThrow('does not pay the top-up wallet');
    expect(() => assertTopUpCall(a, encode({ ...pull, args: [a.safe, a.usdc, a.wallet, amount, a.usdc, 1n, a.wallet, '0x'] }), amount)).toThrow('pays a fee');
    expect(() => assertTopUpCall(a, { to: a.usdc, data: encode(fund).data }, amount)).toThrow('fund goes only to the PayoutPool');
    expect(() => topUpCalls(a, 0n)).toThrow();
  });

  test('the selectors and role hashes are the contracts\' own', () => {
    expect(ifaces.executeAllowanceTransfer.getFunction('executeAllowanceTransfer')!.selector).toBe(SELECTORS.executeAllowanceTransfer);
    expect(ifaces.approve.getFunction('approve')!.selector).toBe(SELECTORS.approve);
    expect(ifaces.fund.getFunction('fund')!.selector).toBe(SELECTORS.fund);
    expect(ethers.id('withdrawCapital(uint256,address)').slice(0, 10)).toBe(SELECTORS.withdrawCapital);
    expect(ethers.id('FUNDER_ROLE')).toBe(PAYOUT_POOL_ROLES.FUNDER_ROLE);
    expect(ethers.id('OPERATOR_ROLE')).toBe(PAYOUT_POOL_ROLES.OPERATOR_ROLE);
    expect(ethers.id('REDEEMER_ROLE')).toBe(PAYOUT_POOL_ROLES.REDEEMER_ROLE);
  });
});

describe('settings', () => {
  test('defaults, overrides, and a low horizon never under a week', () => {
    expect(topUpConfigFromEnv({})).toEqual({ ...DEFAULT_TOPUP_CONFIG });
    const c = topUpConfigFromEnv({ PAYOUT_TOPUP_LOW_DAYS: '3', PAYOUT_TOPUP_TARGET_DAYS: '5', PAYOUT_TOPUP_MARGIN_USDC: '250.5', PAYOUT_TOPUP_CAP_USDC: '5,000', PAYOUT_TOPUP_CHECK_MINUTES: '30' });
    expect(c.lowDays).toBe(7);
    expect(c.targetDays).toBe(7);
    expect(c.margin).toBe(250_500_000n);
    expect(c.capOverride).toBe(5_000n * U);
    expect(c.checkMinutes).toBe(30);
    expect(parseUsdc('abc')).toBe(null);
    expect(parseUsdc('0.000001')).toBe(1n);
  });
});
