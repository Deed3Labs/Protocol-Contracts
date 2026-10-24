import chain from '@clear/command-types/src/chain/base-sepolia.json';
import { createPublicClient, decodeEventLog, getAddress, http, type Abi, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { Db, Queryable } from '../../db/db.js';
import { backupRpcUrl, isRateLimited } from '../chain/provider.js';

/*
 * The indexer (docs/command-center-plan.md, Phase 5a): every event from every deployed contract,
 * kept in command.chain_events.
 *
 * Efficient by design. One eth_getLogs covers every contract at once; only blocks not read before
 * are asked for; pages are as large as the RPC allows (it says when a range is too big, and the
 * page is asked again smaller). The public RPC is asked first and Alchemy only when it refuses.
 *
 * History comes from the block explorer. Base's public RPC answers eth_getLogs only 200 blocks at a
 * time: right for keeping up (5 minutes is 150 blocks, one request) and hopeless for 20 million
 * blocks of history. So a gap wider than HISTORY_GAP is read from a block explorer's log API, a
 * contract at a time over any range, and the RPC carries on from there: Etherscan's (V2, all chains)
 * when ETHERSCAN_API_KEY is set, else Blockscout's, which rate-limits callers without a key.
 * COMMAND_HISTORY_API overrides the URL (off to skip); COMMAND_HISTORY_API_KEY the key.
 *
 * Safe against reorgs. It indexes only to CONFIRMATIONS behind the head, and every run reads the
 * last RECHECK indexed blocks again in the same request and reconciles them: a log that's gone is
 * deleted, one that moved is moved. A log is unique on (chain, tx, log index), so reading a block
 * twice changes nothing.
 */

export const CONFIRMATIONS = 5;
export const RECHECK = 30;
const MAX_SPAN = 9_500;
const MIN_SPAN = 100;

export interface RawLog {
  address: Address;
  blockNumber: number;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
  topics: Hex[];
  data: Hex;
  /** Seconds since 1970, when the source says (the explorer does). */
  time?: number;
}

/** What the indexer asks of a chain. The live one is viem over RPC; tests use a stand-in. */
export interface ChainSource {
  chainId: number;
  head(): Promise<number>;
  /** Seconds since 1970 for a block. */
  blockTime(block: number): Promise<number>;
  hasCode(address: Address, block: number): Promise<boolean>;
  logs(addresses: Address[], from: number, to: number): Promise<RawLog[]>;
  /** One contract's logs over any range, for history (the block explorer). */
  history?(address: Address, from: number, to: number): Promise<RawLog[]>;
  /** The block each contract was created in, from the explorer: five a call instead of ~26 reads each. */
  creationBlocks?(addresses: Address[]): Promise<Map<string, number>>;
}

/** A gap wider than this is history, read from the explorer rather than 200 blocks at a time. */
export const HISTORY_GAP = 20_000;
/** The explorer trails the head a little: history stops this far behind, and the RPC reads the rest. */
const HISTORY_MARGIN = 1_000;

/** Base and Base Sepolia make a block every 2 seconds, so a block's time follows from one other's. */
const STEADY_BLOCK_SECONDS: Record<number, number> = { 84532: 2, 8453: 2 };

export function liveChainSource(chainId = 84532): ChainSource {
  // the public RPC first; the backup (Alchemy) only when the public one rate-limits, as the API does
  // elsewhere. Any other refusal (a range too wide) is the public RPC's answer, and comes back as is.
  const pub = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org', { retryCount: 1 }) });
  const backupUrl = backupRpcUrl(chainId);
  const backup = backupUrl ? createPublicClient({ chain: baseSepolia, transport: http(backupUrl, { retryCount: 1 }) }) : null;
  const ask = async <T>(run: (c: typeof pub) => Promise<T>): Promise<T> => {
    try {
      return await run(pub);
    } catch (e) {
      if (backup && isRateLimited(String((e as Error)?.message ?? ''))) return run(backup);
      throw e;
    }
  };
  const client = {
    getBlockNumber: () => ask((c) => c.getBlockNumber()),
    getBlock: (a: { blockNumber: bigint }) => ask((c) => c.getBlock(a)),
    getCode: (a: { address: Address; blockNumber: bigint }) => ask((c) => c.getCode(a)),
    request: (a: any) => ask((c) => c.request(a) as Promise<any>),
  };
  return {
    chainId,
    head: async () => Number(await client.getBlockNumber()),
    blockTime: async (n) => Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp),
    hasCode: async (address, n) => {
      const code = await client.getCode({ address, blockNumber: BigInt(n) });
      return !!code && code !== '0x';
    },
    logs: async (addresses, from, to) =>
      (await client.request({ method: 'eth_getLogs', params: [{ address: addresses, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] })).map((l: any) => ({
        address: getAddress(l.address),
        blockNumber: Number(l.blockNumber),
        blockHash: l.blockHash,
        transactionHash: l.transactionHash,
        logIndex: Number(l.logIndex),
        topics: l.topics,
        data: l.data,
      })),
    ...(process.env.COMMAND_HISTORY_API === 'off'
      ? {}
      : { history: (a: Address, from: number, to: number) => explorerHistory(historyApi(chainId), a, from, to), creationBlocks: (as: Address[]) => explorerCreations(historyApi(chainId), as) }),
  };
}

/** Contract creation blocks from the explorer, five addresses a call; any it can't say are left out. */
export async function explorerCreations(api: { url: string; key: string | null }, addresses: Address[], f: typeof fetch = fetch): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const key = api.key ? `&apikey=${encodeURIComponent(api.key)}` : '';
  const base = api.url + (api.url.includes('?') ? '&' : '?');
  for (let i = 0; i < addresses.length; i += 5) {
    try {
      await new Promise((r) => setTimeout(r, 400));
      const r = await f(`${base}module=contract&action=getcontractcreation&contractaddresses=${addresses.slice(i, i + 5).join(',')}${key}`, { signal: AbortSignal.timeout(30_000) });
      const j = (await r.json()) as { result?: Array<{ contractAddress: string; blockNumber?: string }> };
      for (const c of Array.isArray(j.result) ? j.result : []) if (c.blockNumber) out.set(c.contractAddress.toLowerCase(), Number(c.blockNumber));
    } catch {
      // the halving search finds whatever this didn't
    }
  }
  return out;
}

/** An explorer's hex number; Etherscan writes zero as "0x". */
const hexNum = (v: string | number) => (v === '0x' || v === '' ? 0 : Number(v));

/** Which explorer serves history, and its key: Etherscan V2 with a key, else Blockscout. */
export function historyApi(chainId: number, env: Record<string, string | undefined> = process.env): { url: string; key: string | null } {
  const key = (env.COMMAND_HISTORY_API_KEY || env.ETHERSCAN_API_KEY || '').trim() || null;
  if (env.COMMAND_HISTORY_API) return { url: env.COMMAND_HISTORY_API, key };
  if (env.ETHERSCAN_API_KEY || env.COMMAND_HISTORY_API_KEY) return { url: `https://api.etherscan.io/v2/api?chainid=${chainId}`, key };
  return { url: chainId === 84532 ? 'https://base-sepolia.blockscout.com/api' : 'https://base.blockscout.com/api', key: null };
}

/**
 * A contract's logs from an Etherscan-style explorer API (Etherscan V2, Blockscout): up to 1,000 a call, over any
 * range. A range that times out is halved; a full page is followed from its last block.
 */
export async function explorerHistory(api: { url: string; key: string | null }, address: Address, from: number, to: number, f: typeof fetch = fetch, pause = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<RawLog[]> {
  const out = new Map<string, RawLog>();
  const key = api.key ? `&apikey=${encodeURIComponent(api.key)}` : '';
  const base = api.url + (api.url.includes('?') ? '&' : '?');
  let span = 2_000_000,
    waits = 0;
  for (let at = from; at <= to; ) {
    const end = Math.min(at + span - 1, to);
    let page: any[];
    try {
      // a free explorer key allows a few calls a second: keep under it
      await pause(400);
      const r = await f(`${base}module=logs&action=getLogs&address=${address}&fromBlock=${at}&toBlock=${end}&page=1&offset=1000${key}`, { signal: AbortSignal.timeout(30_000) });
      const j = (await r.json().catch(() => ({ message: `HTTP ${r.status}` }))) as { message?: string; result?: unknown };
      // Etherscan says why in result ("Max calls per sec rate limit reached")
      const why = `${j.message ?? ''} ${typeof j.result === 'string' ? j.result : ''}`;
      if (r.status === 429 || /too many requests|rate limit/i.test(why)) {
        if (++waits > 8) throw new Error('explorer: still rate-limited after waiting');
        await pause(Math.min(30_000, 1_000 * 2 ** waits));
        continue;
      }
      waits = 0;
      if (j.message !== 'OK' && !/no records|no logs/i.test(why)) throw new Error(`explorer: ${why.trim() || r.status}`);
      page = Array.isArray(j.result) ? j.result : [];
    } catch (e) {
      if (String((e as Error).message).startsWith('explorer:')) throw e;
      if (span > 10_000) {
        span = Math.floor(span / 2);
        continue;
      }
      throw e;
    }
    for (const l of page) {
      const k = `${l.transactionHash}:${hexNum(l.logIndex)}`;
      out.set(k, {
        address: getAddress(l.address),
        blockNumber: hexNum(l.blockNumber),
        blockHash: (l.blockHash ?? '0x') as Hex,
        transactionHash: l.transactionHash,
        logIndex: hexNum(l.logIndex),
        topics: (l.topics as Array<string | null>).filter((t): t is string => !!t) as Hex[],
        data: l.data,
        time: hexNum(l.timeStamp),
      });
    }
    // a full page may have more in its last block: go on from that block (duplicates are dropped)
    if (page.length >= 1000) at = hexNum(page[page.length - 1].blockNumber);
    else at = end + 1;
  }
  return [...out.values()];
}

type Inventory = Array<{ address: Address; name: string; abi: Abi; deployBlock: number | null }>;

const CONTRACTS = chain.contracts as Record<string, { address: string; events?: unknown[] }>;

/** The deployed contracts into command.chain_contracts (new ones only; known deploy blocks kept). */
export async function syncInventory(db: Queryable, chainId = 84532): Promise<void> {
  for (const [name, c] of Object.entries(CONTRACTS)) {
    await db.query('INSERT INTO command.chain_contracts (chain_id, address, name) VALUES ($1, $2, $3) ON CONFLICT (chain_id, address) DO UPDATE SET name = EXCLUDED.name', [chainId, c.address.toLowerCase(), name]);
  }
}

async function inventory(db: Queryable, chainId: number): Promise<Inventory> {
  const { rows } = await db.query<{ address: string; name: string; deploy_block: string | null }>('SELECT address, name, deploy_block FROM command.chain_contracts WHERE chain_id = $1 ORDER BY name', [chainId]);
  return rows.map((r) => ({ address: getAddress(r.address), name: r.name, abi: ((CONTRACTS[r.name]?.events ?? []) as Abi), deployBlock: r.deploy_block == null ? null : Number(r.deploy_block) }));
}

/**
 * The first block each contract has code at, found once by halving: about 26 reads a contract on
 * Base Sepolia, never again. Proxies count from the proxy's deployment, which is when its events start.
 */
export async function findDeployBlocks(db: Queryable, src: ChainSource, log: (s: string) => void = () => undefined): Promise<number> {
  const head = await src.head();
  let found = 0;
  const todo = (await inventory(db, src.chainId)).filter((x) => x.deployBlock == null);
  // the explorer knows most creation blocks outright; each is checked against the chain before it's kept
  const known = src.creationBlocks && todo.length ? await src.creationBlocks(todo.map((c) => c.address)).catch(() => new Map<string, number>()) : new Map<string, number>();
  for (const c of todo) {
    const b = known.get(c.address.toLowerCase());
    if (b != null && (await src.hasCode(c.address, b)) && (b === 0 || !(await src.hasCode(c.address, b - 1)))) {
      await db.query('UPDATE command.chain_contracts SET deploy_block = $3, found_at = now() WHERE chain_id = $1 AND address = $2', [src.chainId, c.address.toLowerCase(), b]);
      c.deployBlock = b;
      found++;
      log(`${c.name}: deployed at block ${b} (explorer, checked)`);
    }
  }
  for (const c of todo.filter((x) => x.deployBlock == null)) {
    if (!(await src.hasCode(c.address, head))) {
      log(`${c.name}: no code at ${c.address}`);
      continue;
    }
    let lo = 0,
      hi = head;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (await src.hasCode(c.address, mid)) hi = mid;
      else lo = mid + 1;
    }
    await db.query('UPDATE command.chain_contracts SET deploy_block = $3, found_at = now() WHERE chain_id = $1 AND address = $2', [src.chainId, c.address.toLowerCase(), lo]);
    found++;
    log(`${c.name}: deployed at block ${lo}`);
  }
  return found;
}

/** A too-wide range, by any of the ways RPCs say so, and the cap when the message gives it ("limited to a 200 range"). */
const tooWide = (e: unknown) => /range|limit|too many|10,?000|exceed|block range|query returned more/i.test(String((e as Error)?.message ?? e));
const statedCap = (e: unknown) => Number(/limited to an? (\d[\d,]*)/i.exec(String((e as Error)?.message ?? e))?.[1]?.replace(/,/g, '')) || null;

export interface IndexRun {
  from: number;
  to: number;
  head: number;
  added: number;
  removed: number;
  pages: number;
  caughtUp: boolean;
}

/**
 * One run: from the last indexed block (less the recheck window) to CONFIRMATIONS behind the head,
 * at most maxPages pages, so a backfill spreads over runs instead of one long one.
 */
export async function indexOnce(db: Db, src: ChainSource, opts: { maxPages?: number; span?: number } = {}): Promise<IndexRun> {
  const inv = await inventory(db, src.chainId);
  const byAddress = new Map(inv.map((c) => [c.address.toLowerCase(), c]));
  const deployed = inv.filter((c) => c.deployBlock != null);
  if (!deployed.length) throw new Error('No deploy blocks known yet: findDeployBlocks first');
  const head = await src.head();
  const safe = head - CONFIRMATIONS;
  const { rows: cur } = await db.query<{ indexed_to: string }>('SELECT indexed_to FROM command.chain_cursor WHERE chain_id = $1', [src.chainId]);
  const start = Math.min(...deployed.map((c) => c.deployBlock!));
  const indexedTo = cur[0] ? Number(cur[0].indexed_to) : start - 1;
  const from = Math.max(start, indexedTo - RECHECK + 1);
  let span = opts.span ?? MAX_SPAN;
  const maxPages = opts.maxPages ?? 200;
  const addresses = deployed.map((c) => c.address);
  const timeOf = await blockTimer(src, head);

  let at = from,
    pages = 0,
    added = 0,
    removed = 0;
  // a wide gap is history: read it from the explorer, a contract at a time, then carry on by RPC
  if (src.history && safe - from > HISTORY_GAP) {
    const target = safe - HISTORY_MARGIN;
    for (const c of deployed) {
      if (c.deployBlock! > target) continue;
      const found = await src.history(c.address, Math.max(from, c.deployBlock!), target);
      added += await store(db, src.chainId, found, byAddress, timeOf);
      pages++;
    }
    await db.query(
      `INSERT INTO command.chain_cursor (chain_id, indexed_to, head, ran_at, error) VALUES ($1, $2, $3, now(), NULL)
       ON CONFLICT (chain_id) DO UPDATE SET indexed_to = GREATEST(command.chain_cursor.indexed_to, EXCLUDED.indexed_to), head = EXCLUDED.head, ran_at = now(), error = NULL`,
      [src.chainId, target, head],
    );
    return { from, to: target, head, added, removed, pages, caughtUp: false };
  }
  while (at <= safe && pages < maxPages) {
    const to = Math.min(at + span - 1, safe);
    let logs: RawLog[];
    try {
      logs = await src.logs(addresses, at, to);
    } catch (e) {
      if (tooWide(e) && span > MIN_SPAN) {
        span = Math.max(Math.min(statedCap(e) ?? Math.floor(span / 4), span - 1), Math.min(MIN_SPAN, statedCap(e) ?? MIN_SPAN));
        continue;
      }
      throw e;
    }
    const n = await db.transaction(async (tx) => {
      // the part of this page already indexed: what's no longer there is a reorged-out log
      if (at <= indexedTo) {
        const keep = logs.map((l) => `${l.transactionHash.toLowerCase()}:${l.logIndex}`);
        const del = await tx.query<{ id: string }>(
          `DELETE FROM command.chain_events WHERE chain_id = $1 AND block_number BETWEEN $2 AND $3 AND NOT ((tx_hash || ':' || log_index) = ANY($4)) RETURNING id`,
          [src.chainId, at, Math.min(to, indexedTo), keep],
        );
        removed += del.rows.length;
      }
      const k = await store(tx, src.chainId, logs, byAddress, timeOf);
      await tx.query(
        `INSERT INTO command.chain_cursor (chain_id, indexed_to, head, ran_at, error) VALUES ($1, $2, $3, now(), NULL)
         ON CONFLICT (chain_id) DO UPDATE SET indexed_to = GREATEST(command.chain_cursor.indexed_to, EXCLUDED.indexed_to), head = EXCLUDED.head, ran_at = now(), error = NULL`,
        [src.chainId, to, head],
      );
      return k;
    });
    added += n;
    pages++;
    at = to + 1;
  }
  return { from, to: Math.min(at - 1, safe), head, added, removed, pages, caughtUp: at > safe };
}

/** Decodes and keeps logs; a log already kept is only moved (a reorg). Returns how many are new. */
async function store(db: Queryable, chainId: number, logs: RawLog[], byAddress: Map<string, Inventory[number]>, timeOf: (n: number) => Promise<number>): Promise<number> {
  let k = 0;
  for (const l of logs) {
    const c = byAddress.get(l.address.toLowerCase());
    if (!c) continue;
    let event: string | null = null,
      args: unknown = null;
    try {
      const d = decodeEventLog({ abi: c.abi, topics: l.topics as [Hex, ...Hex[]], data: l.data });
      event = d.eventName ?? null;
      args = JSON.parse(JSON.stringify(d.args ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    } catch {
      // an event the ABI doesn't know: kept raw
    }
    const r = await db.query(
      `INSERT INTO command.chain_events (chain_id, block_number, block_hash, block_time, tx_hash, log_index, address, contract, event, args, topics, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET block_number = EXCLUDED.block_number, block_hash = CASE WHEN EXCLUDED.block_hash = '0x' THEN command.chain_events.block_hash ELSE EXCLUDED.block_hash END, block_time = EXCLUDED.block_time
       RETURNING (xmax = 0) AS inserted`,
      [chainId, l.blockNumber, l.blockHash.toLowerCase(), new Date((l.time ?? (await timeOf(l.blockNumber))) * 1000), l.transactionHash.toLowerCase(), l.logIndex, l.address.toLowerCase(), c.name, event, args == null ? null : JSON.stringify(args), l.topics, l.data],
    );
    if ((r.rows[0] as { inserted?: boolean })?.inserted) k++;
  }
  return k;
}

/** A block's time: arithmetic on Base, where blocks are steady; asked of the chain (and kept) elsewhere. */
async function blockTimer(src: ChainSource, head: number) {
  const steady = STEADY_BLOCK_SECONDS[src.chainId];
  if (steady) {
    const headTime = await src.blockTime(head);
    return async (n: number) => headTime - (head - n) * steady;
  }
  const seen = new Map<number, number>();
  return async (n: number) => {
    if (!seen.has(n)) seen.set(n, await src.blockTime(n));
    return seen.get(n)!;
  };
}

export async function recordError(db: Queryable, chainId: number, error: unknown) {
  await db.query(
    `INSERT INTO command.chain_cursor (chain_id, indexed_to, error) VALUES ($1, 0, $2) ON CONFLICT (chain_id) DO UPDATE SET error = EXCLUDED.error, ran_at = now()`,
    [chainId, String((error as Error)?.message ?? error).slice(0, 500)],
  );
}

/** Where the indexer is, for Contracts. */
export async function indexStatus(db: Queryable, chainId = 84532) {
  const [{ rows: c }, { rows: n }, { rows: k }] = await Promise.all([
    db.query<{ indexed_to: string; head: string | null; ran_at: Date; error: string | null }>('SELECT * FROM command.chain_cursor WHERE chain_id = $1', [chainId]),
    db.query<{ n: number }>('SELECT count(*)::int AS n FROM command.chain_events WHERE chain_id = $1', [chainId]),
    db.query<{ n: number; found: number }>('SELECT count(*)::int AS n, count(deploy_block)::int AS found FROM command.chain_contracts WHERE chain_id = $1', [chainId]),
  ]);
  return {
    chainId,
    contracts: k[0].n,
    deployBlocksFound: k[0].found,
    events: n[0].n,
    indexedTo: c[0] ? Number(c[0].indexed_to) : null,
    head: c[0]?.head ? Number(c[0].head) : null,
    behind: c[0]?.head ? Number(c[0].head) - Number(c[0].indexed_to) : null,
    ranAt: c[0]?.ran_at ?? null,
    error: c[0]?.error ?? null,
  };
}
