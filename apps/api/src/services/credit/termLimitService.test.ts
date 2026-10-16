import { describe, expect, test } from 'bun:test';
import { grantStarterLimit, reviewTermLimits, type ChainTermState, type TermLimitChange, type TermLimitDeps } from './termLimitService.js';

const A = '0x00000000000000000000000000000000000000aa';
const B = '0x00000000000000000000000000000000000000bb';

interface Member extends ChainTermState {
  verified: boolean;
  clean: number;
  depositCents: number;
}

/** A pretend chain and database: limits written land in `members`, so a second pass sees them. */
function fake(members: Record<string, Partial<Member>>, over: Partial<TermLimitDeps> = {}) {
  const state: Record<string, Member> = {};
  for (const [w, m] of Object.entries(members)) {
    state[w] = { verified: true, currentCents: 0, suspended: false, defaulted: false, inArrears: false, clean: 0, depositCents: 0, ...m };
  }
  const writes: Array<{ wallet: string; cents: number }> = [];
  const changes: TermLimitChange[] = [];
  const lateMarks: string[] = [];
  const deps: TermLimitDeps = {
    enabled: () => true,
    configured: () => true,
    memberWallets: async () => Object.keys(state),
    verified: async (w) => state[w]?.verified ?? false,
    readChain: async (w) => {
      const { currentCents, suspended, defaulted, inArrears } = state[w];
      return { currentCents, suspended, defaulted, inArrears };
    },
    cleanInstallments: async (w) => state[w].clean,
    monthlyDepositCents: async (w) => state[w].depositCents,
    markLate: async (w) => {
      lateMarks.push(w);
    },
    setLimit: async (w, cents) => {
      writes.push({ wallet: w, cents });
      state[w].currentCents = cents;
      return `0xtx${writes.length}`;
    },
    recordChange: async (c) => {
      changes.push(c);
    },
    ...over,
  };
  return { deps, state, writes, changes, lateMarks };
}

describe('grantStarterLimit', () => {
  test('writes $500 once and records the change', async () => {
    const { deps, writes, changes } = fake({ [A]: {} });
    expect(await grantStarterLimit(A, deps)).toEqual({ termLimitCents: 50_000, reason: 'raised' });
    expect(writes).toEqual([{ wallet: A, cents: 50_000 }]);
    expect(changes).toEqual([{ wallet: A, fromCents: 0, toCents: 50_000, reason: 'starter', txHash: '0xtx1' }]);
  });

  test('a second grant is a no-op', async () => {
    const { deps, writes } = fake({ [A]: {} });
    await grantStarterLimit(A, deps);
    expect(await grantStarterLimit(A, deps)).toEqual({ termLimitCents: 50_000, reason: 'unchanged' });
    expect(writes).toHaveLength(1);
  });

  test('two grants at once still send one transaction', async () => {
    const { deps, writes } = fake({ [A]: {} });
    await Promise.all([grantStarterLimit(A, deps), grantStarterLimit(A, deps)]);
    expect(writes).toHaveLength(1);
  });

  test('takes the wallet in any case', async () => {
    const { deps, writes } = fake({ [A]: {} });
    await grantStarterLimit(A.toUpperCase().replace('0X', '0x'), deps);
    expect(writes[0]?.wallet).toBe(A);
  });

  test('an unverified member gets nothing', async () => {
    const { deps, writes } = fake({ [A]: { verified: false } });
    expect(await grantStarterLimit(A, deps)).toEqual({ termLimitCents: null, reason: 'not verified' });
    expect(writes).toHaveLength(0);
  });

  test('nothing is written when switched off or not configured', async () => {
    const off = fake({ [A]: {} }, { enabled: () => false });
    expect((await grantStarterLimit(A, off.deps)).termLimitCents).toBeNull();
    const bare = fake({ [A]: {} }, { configured: () => false });
    expect((await grantStarterLimit(A, bare.deps)).termLimitCents).toBeNull();
    expect(off.writes.length + bare.writes.length).toBe(0);
  });

  test('a failed write comes back as null with the reason, never thrown', async () => {
    const { deps } = fake({ [A]: {} }, { setLimit: async () => Promise.reject(new Error('execution reverted')) });
    expect(await grantStarterLimit(A, deps)).toEqual({ termLimitCents: null, reason: 'execution reverted' });
  });
});

describe('reviewTermLimits', () => {
  test('raises a member with clean installments and the income to back it', async () => {
    const { deps, writes, changes } = fake({ [A]: { currentCents: 50_000, clean: 3, depositCents: 200_000 } });
    const [result] = await reviewTermLimits(deps);
    expect(result).toMatchObject({ wallet: A, action: 'raised', fromCents: 50_000, toCents: 75_000, txHash: '0xtx1' });
    expect(writes).toEqual([{ wallet: A, cents: 75_000 }]);
    expect(changes[0]?.reason).toBe('3 clean installments');
  });

  test('a member behind right now gets a late mark and no raise', async () => {
    const { deps, writes, lateMarks } = fake({ [A]: { currentCents: 50_000, inArrears: true, clean: 9, depositCents: 1_000_000 } });
    expect(await reviewTermLimits(deps)).toEqual([{ wallet: A, action: 'late', fromCents: 50_000 }]);
    expect(lateMarks).toEqual([A]);
    expect(writes).toHaveLength(0);
  });

  test('suspended and defaulted members are left alone', async () => {
    const { deps, writes } = fake({ [A]: { suspended: true }, [B]: { defaulted: true } });
    const results = await reviewTermLimits(deps);
    expect(results.map((r) => r.action)).toEqual(['suspended', 'defaulted']);
    expect(writes).toHaveLength(0);
  });

  test('nothing is read or written when the flag is off', async () => {
    const { deps, writes } = fake({ [A]: {} }, { enabled: () => false });
    expect(await reviewTermLimits(deps)).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  test('one failed write is reported and the rest still run', async () => {
    const { deps, writes } = fake(
      { [A]: {}, [B]: {} },
      {
        setLimit: async (w, cents) => {
          if (w === A) throw new Error('nonce too low');
          writes.push({ wallet: w, cents });
          return '0xok';
        },
      },
    );
    const results = await reviewTermLimits(deps);
    expect(results[0]).toEqual({ wallet: A, action: 'failed', reason: 'nonce too low' });
    expect(results[1]).toMatchObject({ wallet: B, action: 'raised', toCents: 50_000 });
  });

  test('a change that landed but was not recorded still counts as raised', async () => {
    const { deps } = fake({ [A]: {} }, { recordChange: async () => Promise.reject(new Error('db down')) });
    const [result] = await reviewTermLimits(deps);
    expect(result).toMatchObject({ action: 'raised', toCents: 50_000 });
  });
});
