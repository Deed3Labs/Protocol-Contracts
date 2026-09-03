import { ethers } from 'ethers';
import { coalesce } from './readCache.js';

/*
 * Reading a member's event history without asking for the whole chain.
 *
 * Three queries on the Earn page asked for `fromBlock: 0, toBlock: 'latest'` -- pool deposits, pool
 * withdrawals, bond redemptions. The provider caps `eth_getLogs` at a 10,000 block range, so all
 * three failed on every single read, and the catch around them returned 0. The Earn page has
 * therefore been showing zero realised gains for the pool and for bonds since it was written: not a
 * stale figure, a fabricated one, and silent because a swallowed error looks exactly like no gains.
 *
 * Paging alone does not fix it. These contracts are around 516,000 blocks old, which is 58 pages
 * each and roughly 174 requests per read of the page -- worse than the read volume just removed.
 *
 * So the events are cached, which is sound here in a way caching a balance is not: a log that has
 * been mined cannot change. Past ranges are never re-fetched; each read asks only for the blocks
 * since the last one. The first read after a restart pays the full scan, everything after it costs
 * one request. Held in memory, so a deploy pays that cost again -- worth persisting if it becomes
 * noticeable, but a cache that is merely cold is a different problem from a figure that is wrong.
 */

/** The provider's cap is 10,000; leave room rather than sit exactly on a boundary. */
const MAX_SPAN = 9_500;

/*
 * Where to start looking, per chain.
 *
 * Scanning from genesis is 46 million blocks and thousands of requests, so a start block is not an
 * optimisation here -- without one this cannot run at all. These are the deployment blocks; nothing
 * involving these contracts exists before them.
 */
const START_BLOCK: Record<number, number> = {
  84532: 45_799_000, // Base Sepolia: pool and bond deployed at ~45,799,600
};

/** Fallback span when a chain has no configured start block: enough to be useful, small enough to run. */
const FALLBACK_LOOKBACK = 500_000;

export function logStartBlock(chainId: number, latestBlock: number): number {
  const configured = Number(process.env[`LOGS_START_BLOCK_${chainId}`] ?? '');
  if (Number.isFinite(configured) && configured > 0) return configured;
  const known = START_BLOCK[chainId];
  if (known !== undefined) return known;
  /*
   * Said out loud rather than assumed. A wrong start block does not fail -- it silently omits
   * everything before it, which is the same shape of bug as the one this file exists to fix.
   */
  console.warn(
    `[logs] no start block configured for chain ${chainId}; scanning the last ${FALLBACK_LOOKBACK} blocks only.`,
    `Events before that will be missed — set LOGS_START_BLOCK_${chainId} to the deployment block.`,
  );
  return Math.max(0, latestBlock - FALLBACK_LOOKBACK);
}

type CacheEntry = { scannedTo: number; events: ethers.Log[] };
const cache = new Map<string, CacheEntry>();

/**
 * Every log matching `filter`, fetched in provider-sized pages and cached across calls.
 *
 * `key` must identify the contract, event and any indexed argument, since entries are reused
 * verbatim -- two different filters sharing a key would serve each other's history.
 */
export async function scanLogs(
  key: string,
  contract: ethers.Contract,
  filter: ethers.ContractEventName,
  chainId: number,
): Promise<(ethers.Log | ethers.EventLog)[]> {
  /*
   * Resolved here rather than threaded through the readers, and coalesced so the three scans a
   * single Earn read performs ask for the head block once between them instead of three times.
   */
  const provider = contract.runner as ethers.Provider;
  const latestBlock = await coalesce(`head:${chainId}`, () => provider.getBlockNumber());

  const cached = cache.get(key);
  const from = cached ? cached.scannedTo + 1 : logStartBlock(chainId, latestBlock);
  const known = cached ? cached.events : [];

  if (from > latestBlock) return known as (ethers.Log | ethers.EventLog)[];

  const found: ethers.Log[] = [];
  for (let start = from; start <= latestBlock; start += MAX_SPAN) {
    const end = Math.min(start + MAX_SPAN - 1, latestBlock);
    // Not caught here: a partial scan cached as complete would under-report gains for good, and the
    // caller already treats a failure as "no figure" rather than "zero".
    const page = await contract.queryFilter(filter, start, end);
    found.push(...page);
  }

  const events = [...known, ...found];
  cache.set(key, { scannedTo: latestBlock, events });
  return events as (ethers.Log | ethers.EventLog)[];
}

/** Tests only. */
export function resetLogScan(): void {
  cache.clear();
}
