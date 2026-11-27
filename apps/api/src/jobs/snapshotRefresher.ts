import { cardStore } from '../services/lithic/cardStore.js';
import { refreshSnapshotsFor } from '../services/lithic/snapshotService.js';

/*
 * The scheduled snapshot refresh — the backstop the rest of the system already assumed existed.
 *
 * Tier snapshots are rewritten by the events that move money through us: a deposit landing, a sweep
 * minting, a card being issued, a pulled-funds hold elapsing. Every one of those is something we do.
 * None of them fire when a member's collateral changes **on chain** — CLRUSD arriving in savings, a
 * bond bought, a pool position opened — because nothing tells us. So the snapshot keeps saying what
 * was true the last time we happened to write it.
 *
 * The consequence is not a stale number on a page. The authorization path reads exactly this row and
 * fails closed, so a member with real collateral gets declined at a till for money they demonstrably
 * have. That was live: a card with $431 of savings-backed and $408 of asset-backed availability
 * declining a $5 charge, because its snapshot had said zero since the day it was issued.
 *
 * Rebuilding from scratch rather than adjusting: refreshSnapshot reads every source itself, so this
 * job needs to know nothing about what changed. It is the path for "something moved and we do not
 * know what", which is the honest description of any change we were not told about.
 */

/** Minutes between passes. Long enough that chain reads are not a poll, short enough to be useful. */
const DEFAULT_MINUTES = 15;

function intervalMs(): number {
  const configured = Number(process.env.SNAPSHOT_REFRESH_MINUTES);
  const minutes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MINUTES;
  return minutes * 60 * 1000;
}

let running = false;

export async function tick(): Promise<number> {
  // A pass that overruns its interval must not start a second one on top of itself: each wallet
  // costs chain reads and a Lithic call, and two passes racing would double that for no new answer.
  if (running) return 0;
  running = true;

  try {
    const wallets = await cardStore.walletsWithCards();
    if (wallets.length === 0) return 0;

    let refreshed = 0;
    for (const wallet of wallets) {
      // refreshSnapshotsFor never throws — a wallet whose chain read failed carries its last known
      // credit forward rather than dropping to zero, which would decline somebody mid-shop.
      refreshed += await refreshSnapshotsFor(wallet);
    }

    console.log(`[snapshots] refreshed ${refreshed} card snapshot(s) across ${wallets.length} member(s)`);
    return refreshed;
  } catch (error) {
    console.error('[snapshots] scheduled refresh failed:', error);
    return 0;
  } finally {
    running = false;
  }
}

export async function startSnapshotRefresher(): Promise<void> {
  const ms = intervalMs();
  setInterval(() => {
    void tick();
  }, ms);
  // Once at boot, because a deploy is also a moment when the snapshots may have gone stale — and it
  // is the only chance to be correct before the first swipe of the day.
  void tick();
  console.log(`[snapshots] scheduled refresh started (${Math.round(ms / 60000)}m interval)`);
}
