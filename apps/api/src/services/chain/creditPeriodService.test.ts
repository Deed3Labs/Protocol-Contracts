import { beforeEach, describe, expect, mock, test } from 'bun:test';

/*
 * Who gets a fresh cycle and who does not, against a stand-in issuer.
 *
 * The policy is the whole point of the job: a member the chain considers clear is put back on a
 * clock, and a member inside their grace is left there. Renewing the second would move a deadline
 * they are in the middle of.
 */

process.env.CREDIT_OPERATOR_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
process.env.SAVINGS_DEFAULT_CHAIN_ID = '84532';

const DAY = 86_400;
const CYCLE = 30 * DAY;
const now = 1_800_000_000;

type Member = { issuedAt: number; expiration: number; graceLength: number; paused: boolean; compliant: boolean; defaulted: boolean };
const chain = new Map<string, Member>();
const sent: { wallet: string; expiration: number; graceLength: number }[] = [];

const wallets: string[] = [];
/*
 * Only the members database answers, and that is the assertion.
 *
 * The job read `getPayPool` at first, which is a different database whenever PAY_DATABASE_URL is
 * set -- so on the deployed server it never saw a wallet and renewed nobody. Wiring the rows to
 * `getPostgresPool` alone means a regression cannot pass: the wrong pool returns null, the sweep
 * finds no members, and every test below fails on an empty `sent`.
 */
mock.module('../../config/postgres.js', () => ({
  getPostgresPool: () => ({
    query: async () => ({ rows: wallets.map((primary_wallet) => ({ primary_wallet })) }),
  }),
  getPayPool: () => null,
}));
mock.module('../../config/contracts.js', () => ({
  getContractAddress: (_chain: number, name: string) => (name === 'RevolvingIssuer' ? '0x7f15E45aB5eAF0307200274211a90FcbD6716070' : ''),
}));
mock.module('./provider.js', () => ({
  chainProvider: () => ({ _isProvider: true }),
  writesAs: (signer: unknown) => signer,
}));
mock.module('ethers', () => {
  class Wallet {
    constructor(readonly key: string, readonly provider: unknown) {}
  }
  class Contract {
    constructor(_address: string, _abi: string[], readonly runner: unknown) {}
    cycleLength = async () => BigInt(CYCLE);
    creditPeriods = async (wallet: string) => {
      const m = chain.get(wallet)!;
      return [BigInt(m.issuedAt), BigInt(m.expiration), BigInt(m.graceLength), m.paused];
    };
    inCompliance = async (wallet: string) => chain.get(wallet)!.compliant;
    inDefault = async (wallet: string) => chain.get(wallet)!.defaulted;
    updateCreditPeriod = async (wallet: string, expiration: bigint | number, graceLength: bigint | number) => {
      sent.push({ wallet, expiration: Number(expiration), graceLength: Number(graceLength) });
      return { hash: `0x${wallet.slice(2, 8)}`, wait: async () => ({}) };
    };
  }
  return { ethers: { Contract, Wallet }, Contract, Wallet };
});

const { renewExpiredPeriods } = await import('./creditPeriodService');

function member(wallet: string, m: Partial<Member>) {
  wallets.push(wallet);
  chain.set(wallet, {
    issuedAt: now - CYCLE,
    expiration: now - DAY,
    graceLength: CYCLE,
    paused: false,
    compliant: true,
    defaulted: false,
    ...m,
  });
}

describe('rolling the cycle over', () => {
  beforeEach(() => {
    wallets.length = 0;
    sent.length = 0;
    chain.clear();
  });

  test('a member who cleared their line gets a full cycle from today, not from the old expiry', async () => {
    member('0xclear', { expiration: now - 3 * DAY });
    const [result] = await renewExpiredPeriods(now);
    expect(result).toMatchObject({ wallet: '0xclear', action: 'renewed', expiresAt: now + CYCLE });
    expect(sent).toEqual([{ wallet: '0xclear', expiration: now + CYCLE, graceLength: CYCLE }]);
  });

  test('a member carrying a balance is left in their grace, untouched', async () => {
    member('0xcarrying', { compliant: false });
    const [result] = await renewExpiredPeriods(now);
    expect(result).toMatchObject({ action: 'carrying' });
    expect(sent).toEqual([]);
  });

  test('a default is its own state with its own way out', async () => {
    member('0xdefaulted', { compliant: false, defaulted: true });
    expect((await renewExpiredPeriods(now))[0]).toMatchObject({ action: 'defaulted' });
    expect(sent).toEqual([]);
  });

  test('a period the operator paused stays paused', async () => {
    member('0xpaused', { paused: true });
    expect((await renewExpiredPeriods(now))[0]).toMatchObject({ action: 'paused' });
    expect(sent).toEqual([]);
  });

  test('a cycle still running is not touched, so an ordinary pass sends nothing', async () => {
    member('0xrunning', { expiration: now + 10 * DAY });
    expect(await renewExpiredPeriods(now)).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('a member with no period is left to the opener, not given one here', async () => {
    member('0xnoline', { issuedAt: 0, expiration: 0 });
    expect(await renewExpiredPeriods(now)).toEqual([]);
    expect(sent).toEqual([]);
  });

  test('the grace they had is the grace they keep', async () => {
    member('0xshortgrace', { graceLength: 7 * DAY });
    await renewExpiredPeriods(now);
    expect(sent[0].graceLength).toBe(7 * DAY);
  });

  test('one member failing does not stop the rest', async () => {
    member('0xbroken', {});
    member('0xfine', {});
    const contract = chain.get('0xbroken')!;
    Object.defineProperty(contract, 'compliant', {
      get() {
        throw new Error('rpc fell over');
      },
    });
    const results = await renewExpiredPeriods(now);
    expect(results.find((r) => r.wallet === '0xbroken')).toMatchObject({ action: 'failed' });
    expect(results.find((r) => r.wallet === '0xfine')).toMatchObject({ action: 'renewed' });
  });
});

describe('wired through', () => {
  const read = (p: string) => require('node:fs').readFileSync(require('node:path').join(import.meta.dirname, p), 'utf8');
  test('the renewer runs hourly and from startup, since every existing period has already expired', () => {
    const job = read('../../jobs/creditPeriodRenewer.ts');
    expect(job).toContain('setInterval(() => void tick(), HOUR_MS)');
    expect(job).toMatch(/void tick\(\);\s*console\.log\('\[credit-period\] renewer started/);
    expect(read('../../index.ts')).toContain('startCreditPeriodRenewer();');
  });
});
