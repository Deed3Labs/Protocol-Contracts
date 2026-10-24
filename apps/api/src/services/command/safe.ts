import { createPublicClient, getAddress, http, isAddress, type Abi, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';

/*
 * The Ops Safe, read (docs/command-center-plan.md, Phase 4a). Command never holds a key: it reads
 * owners, threshold and nonce from the chain, and the queue and its signatures from the Safe
 * Transaction Service. Which Safe, which chain and which service are all config, never code, so a
 * different Safe or a self-hosted service is a change of env.
 */

export interface SafeConfig {
  address: Address;
  chainId: number;
  /** The Safe Transaction Service for that chain, e.g. https://api.safe.global/tx-service/basesep. */
  serviceUrl: string;
  /** The hosted service wants one for real use (Authorization: Bearer). Railway only. */
  apiKey: string | null;
  rpcUrl: string;
}

const SHORT: Record<number, string> = { 84532: 'basesep', 8453: 'base' };

/** The Safe from env, or null when none is set: Contracts then says so and keeps its seeded rows. */
export function safeConfig(env: Record<string, string | undefined> = process.env): SafeConfig | null {
  const raw = (env.COMMAND_SAFE_ADDRESS ?? '').trim();
  if (!raw || !isAddress(raw)) return null;
  const chainId = Number(env.COMMAND_SAFE_CHAIN_ID ?? 84532);
  return {
    address: getAddress(raw),
    chainId,
    serviceUrl: (env.SAFE_TX_SERVICE_URL ?? `https://api.safe.global/tx-service/${SHORT[chainId] ?? 'basesep'}`).replace(/\/+$/, ''),
    apiKey: (env.SAFE_API_KEY ?? '').trim() || null,
    rpcUrl: env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
  };
}

/** Where a signer opens the Safe's queue in Safe{Wallet}. */
export const safeAppUrl = (c: SafeConfig) => `https://app.safe.global/transactions/queue?safe=${SHORT[c.chainId] ?? 'basesep'}:${c.address}`;

export interface SafeInfo {
  owners: Address[];
  threshold: number;
  nonce: number;
}

export interface SafeTx {
  safeTxHash: string;
  nonce: number;
  to: Address;
  value: string;
  data: string | null;
  /** The service's decoding of the call, when it has the ABI. */
  method: string | null;
  confirmationsRequired: number;
  confirmations: Array<{ owner: Address; at: string }>;
  executed: boolean;
  executedAt: string | null;
  submittedAt: string;
  proposer: Address | null;
}

/** What Command reads from the Safe: the chain for who and how many, the service for the queue. */
export interface SafeReader {
  info(c: SafeConfig): Promise<SafeInfo>;
  transactions(c: SafeConfig, opts: { executed: boolean; limit?: number }): Promise<SafeTx[]>;
  /** One transaction in the service, by its hash, with what's needed to sign it again. */
  transaction(c: SafeConfig, safeTxHash: string): Promise<(SafeTx & { operation: 0 | 1; safeTxGas: string; baseGas: string; gasPrice: string; gasToken: Address; refundReceiver: Address }) | null>;
  /** Puts a signed transaction in the Safe's queue. */
  propose(c: SafeConfig, body: Record<string, unknown>): Promise<void>;
  /** Adds a signer's signature to a queued transaction. */
  confirm(c: SafeConfig, safeTxHash: string, signature: string): Promise<void>;
  /** A contract read a builder needs first. */
  read(c: SafeConfig, address: Address, abi: Abi, functionName: string, args: unknown[]): Promise<unknown>;
}

const SAFE_ABI = [
  { type: 'function', name: 'getOwners', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'getThreshold', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export class SafeServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the Transaction Service, with the API key when there is one. */
export async function serviceFetch(c: SafeConfig, path: string, init: RequestInit = {}, f: typeof fetch = fetch) {
  const r = await f(`${c.serviceUrl}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}), ...(init.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new SafeServiceError(r.status, `The Safe Transaction Service said ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

type ServiceTx = {
  safeTxHash: string;
  nonce: number | string;
  to: string;
  value: string;
  data: string | null;
  dataDecoded?: { method?: string } | null;
  confirmationsRequired: number;
  confirmations?: Array<{ owner: string; submissionDate: string }>;
  isExecuted: boolean;
  executionDate: string | null;
  submissionDate: string;
  proposer?: string | null;
};

export const toSafeTx = (t: ServiceTx): SafeTx => ({
  safeTxHash: t.safeTxHash,
  nonce: Number(t.nonce),
  to: getAddress(t.to),
  value: String(t.value ?? '0'),
  data: t.data ?? null,
  method: t.dataDecoded?.method ?? null,
  confirmationsRequired: t.confirmationsRequired,
  confirmations: (t.confirmations ?? []).map((x) => ({ owner: getAddress(x.owner), at: x.submissionDate })),
  executed: t.isExecuted,
  executedAt: t.executionDate,
  submittedAt: t.submissionDate,
  proposer: t.proposer ? getAddress(t.proposer) : null,
});

/** The real reader: viem for the chain, fetch for the service. */
export function liveSafeReader(f: typeof fetch = fetch): SafeReader {
  return {
    async info(c) {
      const client = createPublicClient({ chain: c.chainId === baseSepolia.id ? baseSepolia : undefined, transport: http(c.rpcUrl) });
      const [owners, threshold, nonce] = await Promise.all([
        client.readContract({ address: c.address, abi: SAFE_ABI, functionName: 'getOwners' }),
        client.readContract({ address: c.address, abi: SAFE_ABI, functionName: 'getThreshold' }),
        client.readContract({ address: c.address, abi: SAFE_ABI, functionName: 'nonce' }),
      ]);
      return { owners: owners.map((o) => getAddress(o)), threshold: Number(threshold), nonce: Number(nonce) };
    },
    async transactions(c, { executed, limit = 50 }) {
      const out = await serviceFetch(c, `/api/v1/safes/${c.address}/multisig-transactions/?executed=${executed}&ordering=-nonce&limit=${limit}`, {}, f);
      return ((out?.results ?? []) as ServiceTx[]).map(toSafeTx);
    },
    async transaction(c, hash) {
      try {
        const t = await serviceFetch(c, `/api/v1/multisig-transactions/${hash}/`, {}, f);
        return { ...toSafeTx(t), operation: t.operation, safeTxGas: String(t.safeTxGas), baseGas: String(t.baseGas), gasPrice: String(t.gasPrice), gasToken: getAddress(t.gasToken), refundReceiver: getAddress(t.refundReceiver) };
      } catch (e) {
        if (e instanceof SafeServiceError && e.status === 404) return null;
        throw e;
      }
    },
    async propose(c, body) {
      await serviceFetch(c, `/api/v1/safes/${c.address}/multisig-transactions/`, { method: 'POST', body: JSON.stringify(body) }, f);
    },
    async confirm(c, hash, signature) {
      await serviceFetch(c, `/api/v1/multisig-transactions/${hash}/confirmations/`, { method: 'POST', body: JSON.stringify({ signature }) }, f);
    },
    async read(c, address, abi, functionName, args) {
      const client = createPublicClient({ chain: c.chainId === baseSepolia.id ? baseSepolia : undefined, transport: http(c.rpcUrl) });
      return client.readContract({ address, abi, functionName, args });
    },
  };
}
