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
 * Not every provider allows 10,000. The API falls back between RPCs, and one caps eth_getLogs at
 * 1,000 blocks ("eth_getLogs is limited to a 1,000 range"): every page of 9,500 was refused, on every
 * scan. So the cap is learned from the refusal, per chain, and the page asked again at the smaller
 * size -- nothing is skipped, and later scans start at the size that works.
 */
const spanByChain = new Map<number, number>();
const MIN_SPAN = 100;

/** How many blocks to ask for at once on this chain: what has worked, or the provider's usual cap. */
export function logSpan(chainId: number): number {
  return spanByChain.get(chainId) ?? MAX_SPAN;
}

/**
 * A refusal that was about the range, learned from: the stated cap (less a margin), or half the span
 * when it names none. True when there's a smaller span to try; false when this wasn't a range refusal.
 */
export function learnLogSpan(chainId: number, error: unknown, triedSpan: number): boolean {
  const text = error instanceof Error ? `${error.message} ${String((error as { error?: unknown }).error ?? '')}` : String(error);
  const stated = /limited to (?:a )?([\d,]+)[- ](?:block )?range|max(?:imum)? (?:block )?range (?:of |is )?([\d,]+)|range (?:limit|exceeds?)[^\d]{0,20}([\d,]+)/i.exec(text);
  const aboutRange = stated || /block range|getLogs.*range|range.*too (?:large|wide)|too many blocks/i.test(text);
  if (!aboutRange) return false;
  const cap = stated ? Number((stated[1] ?? stated[2] ?? stated[3] ?? '').replace(/,/g, '')) : 0;
  const next = cap > 0 ? Math.floor(cap * 0.9) : Math.floor(triedSpan / 2);
  if (!(next >= MIN_SPAN && next < triedSpan)) return false;
  spanByChain.set(chainId, next);
  return true;
}

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
  for (let start = from; start <= latestBlock; ) {
    const span = logSpan(chainId);
    const end = Math.min(start + span - 1, latestBlock);
    let page: (ethers.Log | ethers.EventLog)[];
    try {
      page = await contract.queryFilter(filter, start, end);
    } catch (error) {
      // Refused for the range: ask for the same blocks again, smaller. Anything else is not caught
      // here: a partial scan cached as complete would under-report gains for good, and the caller
      // already treats a failure as "no figure" rather than "zero".
      if (learnLogSpan(chainId, error, span)) continue;
      throw error;
    }
    found.push(...page);
    start = end + 1;
  }

  const events = [...known, ...found];
  cache.set(key, { scannedTo: latestBlock, events });
  return events as (ethers.Log | ethers.EventLog)[];
}

/** Tests only. */
export function resetLogScan(): void {
  cache.clear();
  spanByChain.clear();
}
