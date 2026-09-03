import { markChainSettled } from './chainStale';

/*
 * "Refresh everything the member can see", as one call.
 *
 * The app grew two refresh channels, and that is fine -- they mean different things. `clear:activity`
 * is a DOM event carrying "your money moved" to balances, transactions and linked wallets. The
 * chain-stale module carries "the figures derived from chain state are old" to credit, savings, home,
 * earn and card. Different listeners, different lifetimes, both legitimate.
 *
 * What was not fine is that no trigger fired both. Pull-to-refresh dispatched `clear:activity` alone,
 * so on mobile -- where there is no reload button in an installed PWA -- pulling refreshed balances
 * and left the credit limit and vesting credits exactly as they were. The socket fired the chain
 * signal alone, and only reached a device whose socket was awake, which a backgrounded PWA's is not.
 * Between them a phone had no path back to fresh credit figures short of a hard reload.
 *
 * So this is deliberately not a third channel. It is the single thing every "the member asked for
 * fresh data" trigger calls, so adding a fourth trigger cannot pick the wrong half again. Adding a
 * listener still means choosing a channel -- that choice is real and stays -- but the fan-out is now
 * one place instead of a convention nobody could see.
 *
 * Settled rather than stale: the member is asking now and is watching the spinner. The backoff exists
 * to cover writes that have not landed yet, and re-reading three more times over fifteen seconds is
 * not what "I pulled to refresh" means.
 */
export function refreshAllNow(): void {
  markChainSettled();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('clear:activity'));
}
