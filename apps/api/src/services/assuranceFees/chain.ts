import crypto from 'crypto';
import { ethers } from 'ethers';
import { chainProvider } from '../chain/provider.js';
import { assertCdpNetworkMatches, expectedCdpNetwork } from '../cdpNetworkGuard.js';
import type { AssuranceFeeConfig } from './config.js';

/*
 * What the Assurance fee payer reads and sends on chain, behind two small interfaces so the job and
 * its tests never touch a real network: FeeChain (reads, dry runs, receipts) and FeeSigner (the CL
 * Fees wallet). The live ones are ethers on this server's provider, and Coinbase CDP's server wallet
 * found by name (never created: a mistyped name must fail, not make an empty wallet). Logs carry
 * addresses only; no key is read here except the dev-only local key, which is never printed.
 */

export const POOL_ABI = [
  'function availableCoverage() view returns (uint256)',
  'function backstopBalance() view returns (uint256)',
  'function backstopFloor() view returns (uint256)',
  'function coverageCap() view returns (uint256)',
  'function floorInputsAt() view returns (uint256)',
  'function payerTags(address) view returns (uint256)',
  'function asset() view returns (address)',
  'function drawCount() view returns (uint256)',
  'function drawAt(uint256 drawId) view returns ((uint64 periodId, uint8 status, address approver, uint128 requested, uint128 approved, bytes32 evidenceHash))',
  'function deposit(uint8 sourceTag, uint256 amount)',
] as const;

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
] as const;

const POOL = new ethers.Interface(POOL_ABI);
const ERC20 = new ethers.Interface(ERC20_ABI);
export const TRANSFER_TOPIC = ERC20.getEvent('Transfer')!.topicHash;

/** The pool's SourceTag (IAssurancePool). */
export const SOURCE_TAG = { CREDIT_ENHANCEMENT_FEE: 0, RECOVERY: 1, INTERCHANGE: 2, BOARD_ALLOCATION: 3 } as const;
/** DrawStatus.Released. */
const RELEASED = 3n;

export const approveData = (spender: string, amount: bigint) => ERC20.encodeFunctionData('approve', [spender, amount]);
export const transferData = (to: string, amount: bigint) => ERC20.encodeFunctionData('transfer', [to, amount]);
export const depositData = (tag: number, amount: bigint) => POOL.encodeFunctionData('deposit', [tag, amount]);

export interface PoolReading {
  availableCoverage: bigint;
  backstopBalance: bigint;
  backstopFloor: bigint;
  coverageCap: bigint;
  block: number;
}

export interface ReceiptLite {
  status: number;
  blockNumber: number;
  logs: Array<{ address: string; topics: readonly string[]; data: string }>;
}

export interface FeeChain {
  block(): Promise<number>;
  readPool(pool: string): Promise<PoolReading>;
  floorInputsAt(pool: string): Promise<bigint>;
  /** Σ approved amount of every draw the pool has released, and how many. */
  releasedDraws(pool: string): Promise<{ total: bigint; count: number }>;
  asset(pool: string): Promise<string>;
  payerTags(pool: string, payer: string): Promise<bigint>;
  balanceOf(token: string, who: string): Promise<bigint>;
  allowance(token: string, owner: string, spender: string): Promise<bigint>;
  /** The account's mined and pending transaction counts: different while something is in flight. */
  nonces(who: string): Promise<{ latest: number; pending: number }>;
  /** eth_call and eth_estimateGas as `from`: throws (with the revert) if it would fail. */
  dryRun(tx: { from: string; to: string; data: string }): Promise<void>;
  receipt(hash: string): Promise<ReceiptLite | null>;
  /** Token transfers from → to since a block: how a deposit whose hash was lost is found. */
  transfers(token: string, from: string, to: string, fromBlock: number): Promise<Array<{ hash: string; value: bigint; block: number }>>;
}

export interface FeeSigner {
  address(): Promise<string>;
  /** Sends one call and returns its hash; never waits for the receipt. */
  send(tx: { to: string; data: string }, idempotencyKey: string): Promise<string>;
}

/** Whether a payer may deposit under a tag: the pool's own payerTags bit. */
export const mayPay = (mask: bigint, tag: number) => ((mask >> BigInt(tag)) & 1n) === 1n;

/** A deterministic UUID (v4 layout) for a CDP idempotency key: the same send asked twice is one send. */
export function idempotencyKey(...parts: Array<string | number>): string {
  const h = crypto.createHash('sha256').update(parts.join(':')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Did a receipt carry token `value` moving from → to? */
export function receiptMoved(r: ReceiptLite, token: string, from: string, to: string, value: bigint): boolean {
  const pad = (a: string) => ethers.zeroPadValue(a.toLowerCase(), 32).toLowerCase();
  return r.logs.some(
    (l) =>
      l.address.toLowerCase() === token.toLowerCase() &&
      l.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
      l.topics[1]?.toLowerCase() === pad(from) &&
      l.topics[2]?.toLowerCase() === pad(to) &&
      BigInt(l.data) === value,
  );
}

/** The chain through this server's provider. Reads only. */
export function liveFeeChain(chainId: number): FeeChain {
  const provider = chainProvider(chainId);
  const pool = (a: string) => new ethers.Contract(a, POOL_ABI, provider);
  const token = (a: string) => new ethers.Contract(a, ERC20_ABI, provider);
  return {
    block: () => provider.getBlockNumber(),
    async readPool(a) {
      const p = pool(a);
      const [availableCoverage, backstopBalance, backstopFloor, coverageCap, block] = await Promise.all([
        p.availableCoverage() as Promise<bigint>,
        p.backstopBalance() as Promise<bigint>,
        p.backstopFloor() as Promise<bigint>,
        p.coverageCap() as Promise<bigint>,
        provider.getBlockNumber(),
      ]);
      return { availableCoverage, backstopBalance, backstopFloor, coverageCap, block };
    },
    floorInputsAt: (a) => pool(a).floorInputsAt() as Promise<bigint>,
    async releasedDraws(a) {
      const p = pool(a);
      const n = Number((await p.drawCount()) as bigint);
      let total = 0n;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const d = await p.drawAt(i);
        if (BigInt(d.status) === RELEASED) {
          total += BigInt(d.approved);
          count += 1;
        }
      }
      return { total, count };
    },
    asset: async (a) => ethers.getAddress((await pool(a).asset()) as string),
    payerTags: (a, payer) => pool(a).payerTags(payer) as Promise<bigint>,
    balanceOf: (t, who) => token(t).balanceOf(who) as Promise<bigint>,
    allowance: (t, owner, spender) => token(t).allowance(owner, spender) as Promise<bigint>,
    async nonces(who) {
      const [latest, pending] = await Promise.all([provider.getTransactionCount(who, 'latest'), provider.getTransactionCount(who, 'pending')]);
      return { latest, pending };
    },
    async dryRun(tx) {
      await provider.call(tx);
      await provider.estimateGas(tx);
    },
    async receipt(hash) {
      const r = await provider.getTransactionReceipt(hash);
      if (!r) return null;
      return { status: r.status ?? 0, blockNumber: r.blockNumber, logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })) };
    },
    async transfers(t, from, to, fromBlock) {
      const latest = await provider.getBlockNumber();
      const out: Array<{ hash: string; value: bigint; block: number }> = [];
      const topics = [TRANSFER_TOPIC, ethers.zeroPadValue(from, 32), ethers.zeroPadValue(to, 32)];
      // a public node answers a few thousand blocks at a time
      for (let start = Math.max(0, fromBlock); start <= latest; start += 5_000) {
        const logs = await provider.getLogs({ address: t, topics, fromBlock: start, toBlock: Math.min(latest, start + 4_999) });
        for (const l of logs) out.push({ hash: l.transactionHash, value: BigInt(l.data), block: l.blockNumber });
      }
      return out;
    },
  };
}

interface CdpClientLike {
  evm: {
    getAccount(options: { name: string }): Promise<{ address: string }>;
    sendTransaction(options: { address: string; network: string; transaction: { to: string; data: string; value: bigint }; idempotencyKey?: string }): Promise<{ transactionHash: string }>;
  };
}

function cdpOptions(env: Record<string, string | undefined>) {
  const first = (...names: string[]) => names.map((n) => (env[n] ?? '').trim()).find(Boolean) ?? '';
  const apiKeyId = first('CDP_API_KEY_ID', 'CDP_API_KEY_NAME', 'SAVINGS_CDP_API_KEY_ID', 'SEND_CDP_API_KEY_ID');
  const apiKeySecret = first('CDP_API_KEY_SECRET', 'SAVINGS_CDP_API_KEY_SECRET', 'SEND_CDP_API_KEY_SECRET');
  const walletSecret = first('CDP_WALLET_SECRET', 'SAVINGS_CDP_WALLET_SECRET', 'SEND_CDP_WALLET_SECRET');
  const basePath = first('CDP_BASE_PATH', 'SAVINGS_CDP_BASE_PATH', 'SEND_CDP_BASE_PATH');
  if (!apiKeyId || !apiKeySecret || !walletSecret) throw new Error('The Assurance fee payer needs the CDP credentials (CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET)');
  return { apiKeyId, apiKeySecret, walletSecret, ...(basePath ? { basePath } : {}) };
}

const isHash = (h: string) => /^0x[0-9a-fA-F]{64}$/.test(h);

/**
 * The CL Fees wallet: a CDP server wallet found by name (ASSURANCE_FEE_PAYER_CDP_ACCOUNT_NAME), or,
 * for dev only, a local key (ASSURANCE_FEE_PAYER_MODE=local_key, ASSURANCE_FEE_PAYER_PRIVATE_KEY).
 * The CDP SDK is loaded the first time it's needed.
 */
export function liveFeeSigner(config: AssuranceFeeConfig, env: Record<string, string | undefined> = process.env): FeeSigner {
  if (config.payerMode === 'local_key') {
    const raw = (env.ASSURANCE_FEE_PAYER_PRIVATE_KEY ?? '').trim();
    if (!raw) throw new Error('ASSURANCE_FEE_PAYER_MODE=local_key needs ASSURANCE_FEE_PAYER_PRIVATE_KEY (dev only)');
    const wallet = new ethers.Wallet(raw.startsWith('0x') ? raw : `0x${raw}`, chainProvider(config.chainId));
    return {
      address: async () => wallet.address,
      async send(tx) {
        const sent = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
        return sent.hash;
      },
    };
  }
  const network = (env[`ASSURANCE_FEE_PAYER_CDP_NETWORK_${config.chainId}`] ?? '').trim() || expectedCdpNetwork(config.chainId) || '';
  if (!network) throw new Error(`No CDP network for chain ${config.chainId}`);
  // a testnet chain id with a mainnet network name would sign on mainnet: refuse (cdpNetworkGuard)
  assertCdpNetworkMatches(config.chainId, network, 'Assurance fee payer');
  const name = config.cdpAccountName;
  if (!name) throw new Error('Set ASSURANCE_FEE_PAYER_CDP_ACCOUNT_NAME (the CL Fees wallet, cl-fees-base-sepolia on Base Sepolia)');
  let client: Promise<CdpClientLike> | null = null;
  let address: string | null = null;
  const load = () =>
    (client ??= (async () => {
      const m = await import('@coinbase/cdp-sdk');
      if (!m || typeof m.CdpClient !== 'function') throw new Error('Could not load @coinbase/cdp-sdk');
      return new m.CdpClient(cdpOptions(env)) as unknown as CdpClientLike;
    })());
  const resolve = async () => {
    if (address) return address;
    const account = await (await load()).evm.getAccount({ name });
    address = ethers.getAddress(account.address);
    return address;
  };
  return {
    address: resolve,
    async send(tx, key) {
      const from = await resolve();
      const r = await (await load()).evm.sendTransaction({ address: from, network, transaction: { to: tx.to, data: tx.data, value: 0n }, idempotencyKey: key });
      if (!isHash(r.transactionHash)) throw new Error('CDP did not return a transaction hash');
      return r.transactionHash;
    },
  };
}
