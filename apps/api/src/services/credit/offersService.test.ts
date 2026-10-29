import { describe, expect, test } from 'bun:test';
import { grantOffer, reviewOffers, type OffersDeps } from './offersService.js';

const A = '0x00000000000000000000000000000000000000aa';
const B = '0x00000000000000000000000000000000000000bb';
const C = '0x00000000000000000000000000000000000000cc';
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-29T12:00:00Z');

interface Member {
  verified: boolean;
  grantedAt: number;
  expiresAt: number;
}

/** A pretend chain: offers given land in `state`, so a second pass sees them. */
function fake(members: Record<string, Partial<Member>>, line: { offersLeft?: number; owed?: number; allowance?: number } = {}, over: Partial<OffersDeps> = {}) {
  const state: Record<string, Member> = {};
  for (const [w, m] of Object.entries(members)) state[w] = { verified: true, grantedAt: 0, expiresAt: 0, ...m };
  let offersLeft = BigInt(line.offersLeft ?? 100);
  let owed = BigInt(line.owed ?? 0);
  const allowance = BigInt(line.allowance ?? 0);
  const sent: string[] = [];
  const deps: OffersDeps = {
    enabled: () => true,
    configured: () => true,
    now: () => NOW,
    memberWallets: async () => Object.keys(state),
    verified: async (w) => state[w]?.verified ?? false,
    readOffer: async (w) => ({ grantedAt: state[w]?.grantedAt ?? 0, expiresAt: state[w]?.expiresAt ?? 0 }),
    readLine: async () => ({ owed, offersLeft, treasuryAvailable: allowance }),
    grant: async (w) => {
      sent.push(`grant ${w}`);
      state[w].grantedAt = NOW;
      state[w].expiresAt = NOW + 90 * DAY;
      offersLeft -= 1n;
      owed += 10n;
      return `0xtx${sent.length}`;
    },
    expire: async (w) => {
      sent.push(`expire ${w}`);
      state[w].expiresAt = 0;
      return `0xtx${sent.length}`;
    },
    settle: async () => {
      sent.push('settle');
      owed = 0n;
      return `0xtx${sent.length}`;
    },
    ...over,
  };
  return { deps, state, sent };
}

describe('grantOffer', () => {
  test('gives a verified member their offer, once', async () => {
    const { deps, sent } = fake({ [A]: {} });
    expect(await grantOffer(A, deps)).toEqual({ wallet: A, action: 'granted', txHash: '0xtx1' });
    expect(await grantOffer(A, deps)).toEqual({ wallet: A, action: 'has-one' });
    expect(sent).toEqual([`grant ${A}`]);
  });

  test('waits for the identity check', async () => {
    const { deps, sent } = fake({ [A]: { verified: false } });
    expect((await grantOffer(A, deps))?.action).toBe('unverified');
    expect(sent).toEqual([]);
  });

  test('does nothing switched off or unconfigured, and never throws', async () => {
    expect(await grantOffer(A, fake({ [A]: {} }, {}, { enabled: () => false }).deps)).toBeNull();
    expect(await grantOffer(A, fake({ [A]: {} }, {}, { configured: () => false }).deps)).toBeNull();
    const broken = fake({ [A]: {} }, {}, { grant: async () => { throw new Error('reverted'); } });
    expect(await grantOffer(A, broken.deps)).toEqual({ wallet: A, action: 'failed', reason: 'reverted' });
  });
});

describe('reviewOffers', () => {
  test('gives whoever is due one, until the line is at its cap', async () => {
    const { deps, sent } = fake({ [A]: {}, [B]: {}, [C]: {} }, { offersLeft: 2 });
    const { results } = await reviewOffers(deps);
    expect(results.map((r) => r.action)).toEqual(['granted', 'granted', 'cap-reached']);
    expect(sent).toEqual([`grant ${A}`, `grant ${B}`]);
  });

  test('takes back an offer whose window has passed, and leaves one that has not', async () => {
    const { deps, sent } = fake({
      [A]: { grantedAt: NOW - 100 * DAY, expiresAt: NOW - 10 * DAY },
      [B]: { grantedAt: NOW - 10 * DAY, expiresAt: NOW + 80 * DAY },
      // given and spent: nothing left to take back
      [C]: { grantedAt: NOW - 100 * DAY, expiresAt: 0 },
    });
    const { results } = await reviewOffers(deps);
    expect(results.map((r) => [r.wallet, r.action])).toEqual([
      [A, 'expired'],
      [B, 'has-one'],
      [C, 'has-one'],
    ]);
    expect(sent).toEqual([`expire ${A}`]);
  });

  test('pays the line down when something is owed and the Safe allows it', async () => {
    const paid = fake({}, { owed: 40, allowance: 100 });
    expect((await reviewOffers(paid.deps)).settled).toBe('0xtx1');

    const noAllowance = fake({}, { owed: 40, allowance: 0 });
    expect((await reviewOffers(noAllowance.deps)).settled).toBeUndefined();
    expect(noAllowance.sent).toEqual([]);

    const nothingOwed = fake({}, { owed: 0, allowance: 100 });
    expect((await reviewOffers(nothingOwed.deps)).settled).toBeUndefined();
  });

  test('one member failing doesn’t stop the rest', async () => {
    const { deps, sent } = fake({ [A]: {}, [B]: {} }, {}, {
      readOffer: async (w) => {
        if (w === A) throw new Error('rpc down');
        return { grantedAt: 0, expiresAt: 0 };
      },
    });
    const { results } = await reviewOffers(deps);
    expect(results.map((r) => r.action)).toEqual(['failed', 'granted']);
    expect(sent).toEqual([`grant ${B}`]);
  });
});
