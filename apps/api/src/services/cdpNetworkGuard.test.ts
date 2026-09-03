import { describe, expect, test } from 'bun:test';
import { assertCdpNetworkMatches, expectedCdpNetwork } from './cdpNetworkGuard';

/*
 * The failure this exists for is not a broken transaction — it is a working one on the wrong chain.
 *
 * The demo environment had chain 84532 paired with network "base", because the chain-suffixed
 * override was missing and the global fallback was left over from mainnet. CDP signs for the
 * network it is told, so a send from a testnet UI would have been submitted to Base mainnet with
 * the mainnet relayer, moving real money, and nothing in the path would have objected.
 */
describe('a chain and a CDP network have to agree', () => {
  test('the pairing that would have moved real money is refused', () => {
    expect(() => assertCdpNetworkMatches(84532, 'base', 'send relayer')).toThrow(/does not match chain 84532/);
  });

  test('and the reverse, which is the same mistake pointing the other way', () => {
    expect(() => assertCdpNetworkMatches(8453, 'base-sepolia', 'send relayer')).toThrow();
  });

  test('matching pairs pass', () => {
    expect(() => assertCdpNetworkMatches(8453, 'base', 'x')).not.toThrow();
    expect(() => assertCdpNetworkMatches(84532, 'base-sepolia', 'x')).not.toThrow();
    expect(() => assertCdpNetworkMatches(84532, ' Base-Sepolia ', 'x')).not.toThrow();
  });

  test('an unknown chain passes rather than breaking a new deployment', () => {
    // This guards a known mismatch. Refusing every chain we have not enumerated would block a
    // deployment for a reason that has nothing to do with safety.
    expect(expectedCdpNetwork(999999)).toBeNull();
    expect(() => assertCdpNetworkMatches(999999, 'whatever', 'x')).not.toThrow();
  });

  test('the message says what to change, not just that something is wrong', () => {
    // "does not match" sends someone hunting; naming the suffixed override ends the hunt.
    try {
      assertCdpNetworkMatches(84532, 'base', 'send relayer');
    } catch (error) {
      expect((error as Error).message).toContain('chain-suffixed override');
    }
  });
});
