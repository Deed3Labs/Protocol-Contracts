import { ethers } from 'ethers';
import { savingsIntentService } from '../savingsIntentService.js';

/*
 * One provider per chain, for the whole server.
 *
 * Three readers each kept a private `cachedProvider`, and the collateral and credit-line services
 * built a fresh one on every call -- ten construction sites for what is one connection to one chain.
 * Each instance is its own connection, its own batching queue, and its own network detection.
 *
 * `staticNetwork` is the part that costs real requests. Without it ethers verifies the chain id
 * before it will send anything, and re-verifies on a new instance, so a burst of reads spent a
 * meaningful share of its budget on `eth_chainId` calls answering a question that cannot change: the
 * chain id is in the URL we resolved. Those calls were visible in the rate-limit errors that started
 * this -- the throttled request being reported was `eth_chainId`, not any figure a member asked for.
 *
 * Sharing the instance also means ethers' own request batching works across callers rather than
 * per-module, so concurrent reads travel as one HTTP request instead of three.
 */
const providers = new Map<number, ethers.JsonRpcProvider>();

// The chain id came from our own config, so there is nothing to discover and nothing to re-check.
// Batches of up to 50: the plain reads in a batch travel as ONE multicall (below), so a batch no
// longer costs the public node one call per read. Whatever cannot be packed is still few.
const OPTIONS: ethers.JsonRpcApiProviderOptions = { staticNetwork: true, batchMaxCount: 50 };

/** Multicall3: the same address on every chain it is deployed to, Base and Base Sepolia included. */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL_CHAINS = new Set([8453, 84532]);
const MULTICALL = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]);

/** An RPC's way of saying "not now", as opposed to an answer. */
export function isRateLimited(message: string | undefined): boolean {
  return /rate limit|too many requests|429|exceeded.*capacity|throttl/i.test(message ?? '');
}

/**
 * The backup RPC, used only for what the primary refuses. An explicit URL wins; otherwise Alchemy
 * when a key is set. None: the primary stands alone, as before.
 */
export function backupRpcUrl(chainId: number): string | null {
  const explicit = process.env[`RPC_FALLBACK_URL_${chainId}`]?.trim();
  if (explicit) return explicit;
  const key = process.env.ALCHEMY_API_KEY?.trim();
  if (!key) return null;
  const host: Record<number, string> = { 8453: 'base-mainnet', 84532: 'base-sepolia' };
  return host[chainId] ? `https://${host[chainId]}.g.alchemy.com/v2/${key}` : null;
}

type CallTx = { to?: string; data?: string; from?: string; value?: string; gas?: string };

/**
 * A read that can ride in a multicall: a plain `eth_call` at `latest` with no sender, value or gas.
 * A call that names a sender is left alone -- inside a multicall its msg.sender would be Multicall3,
 * and a view that reads the caller would answer a different question.
 */
export function isPackable(p: ethers.JsonRpcPayload): boolean {
  if (p.method !== 'eth_call' || !Array.isArray(p.params)) return false;
  const [tx, tag] = p.params as [CallTx, unknown];
  return Boolean(tx?.to && tx.data) && !tx.from && !tx.value && !tx.gas && (tag === undefined || tag === 'latest');
}

/** Pack several reads into one Multicall3 `aggregate3` call; every one may fail on its own. */
export function packCalls(calls: ethers.JsonRpcPayload[], id: number): ethers.JsonRpcPayload {
  const data = MULTICALL.encodeFunctionData('aggregate3', [
    calls.map((c) => {
      const [tx] = c.params as [CallTx];
      return { target: tx.to!, allowFailure: true, callData: tx.data! };
    }),
  ]);
  return { id, jsonrpc: '2.0', method: 'eth_call', params: [{ to: MULTICALL3, data }, 'latest'] };
}

/**
 * Give each packed read back its own answer. A read that reverted comes back as the revert the
 * node would have returned for it alone (code 3, with its revert data), so a caller telling a
 * revert from an outage still can. If the multicall itself failed, every read in it shares that.
 */
export function unpackCalls(
  calls: ethers.JsonRpcPayload[],
  response: ethers.JsonRpcResult | ethers.JsonRpcError,
): Array<ethers.JsonRpcResult | ethers.JsonRpcError> {
  if ('error' in response) return calls.map((c) => ({ id: c.id, error: response.error }));
  const [results] = MULTICALL.decodeFunctionResult('aggregate3', response.result) as unknown as [
    Array<{ success: boolean; returnData: string }>,
  ];
  return calls.map((c, i) =>
    results[i].success
      ? { id: c.id, result: results[i].returnData }
      : { id: c.id, error: { code: 3, message: 'execution reverted', data: results[i].returnData } },
  );
}

/*
 * One connection per chain, doing two things to what ethers hands it:
 *
 * 1. Packing. The plain reads in each batch are sent as a single Multicall3 call. A credit read is
 *    about thirty contract reads; the node now sees one. That is what keeps the free node under
 *    its burst limit, and what makes any call that does overflow cheap.
 *
 * 2. Overflow. Everything goes to the primary (the free public node) first. Only what it answers
 *    with a rate limit -- a call inside a batch, or a whole-request 429 -- is sent again to the
 *    backup (Alchemy). A revert is an answer and is never re-sent.
 */
class ClearRpcProvider extends ethers.JsonRpcProvider {
  private nextPackId = 1_000_000_000;

  constructor(
    url: string,
    chainId: number,
    private readonly backup: ethers.JsonRpcProvider | null,
    private readonly multicall: boolean,
  ) {
    super(url, chainId, OPTIONS);
  }

  // Typed as results by ethers, but a batch carries per-call errors in the same array.
  override async _send(payload: ethers.JsonRpcPayload | ethers.JsonRpcPayload[]): Promise<ethers.JsonRpcResult[]> {
    const payloads = Array.isArray(payload) ? payload : [payload];
    const packable = this.multicall ? payloads.filter(isPackable) : [];
    if (packable.length < 2) return this.sendWithOverflow(payloads);

    const rest = payloads.filter((p) => !isPackable(p));
    const pack = packCalls(packable, this.nextPackId++);
    packedCalls += packable.length;
    const results = await this.sendWithOverflow([pack, ...rest]);
    const packed = results.find((r) => r.id === pack.id);
    const answers = new Map<number, ethers.JsonRpcResult | ethers.JsonRpcError>(
      results.filter((r) => r.id !== pack.id).map((r) => [r.id, r]),
    );
    if (packed) for (const r of unpackCalls(packable, packed)) answers.set(r.id, r);
    return payloads.map((p) => answers.get(p.id) as ethers.JsonRpcResult);
  }

  private async sendWithOverflow(payloads: ethers.JsonRpcPayload[]): Promise<ethers.JsonRpcResult[]> {
    let results: ethers.JsonRpcResult[];
    sentCalls += payloads.length;
    try {
      results = await super._send(payloads.length === 1 ? payloads[0] : payloads);
    } catch (error) {
      // The whole request refused (HTTP 429): all of it goes to the backup, if there is one.
      if (this.backup && isRateLimited(error instanceof Error ? error.message : String(error))) {
        overflowCalls += payloads.length;
        return this.backup._send(payloads);
      }
      throw error;
    }
    if (!this.backup) return results;
    const limited = new Set(
      results
        .filter((r) => isRateLimited((r as unknown as ethers.JsonRpcError).error?.message))
        .map((r) => r.id),
    );
    if (limited.size === 0) return results;
    overflowCalls += limited.size;
    const retried = await this.backup._send(payloads.filter((p) => limited.has(p.id)));
    const byId = new Map(retried.map((r) => [r.id, r]));
    return results.map((r) => byId.get(r.id) ?? r);
  }
}

/** Calls sent to the backup, and reads that rode in a multicall, since start -- logged by the sweep. */
let overflowCalls = 0;
let packedCalls = 0;
let sentCalls = 0;
/** Calls actually sent to the primary node -- what its rate limit counts. */
export function sentCallCount(): number {
  return sentCalls;
}
export function overflowCallCount(): number {
  return overflowCalls;
}
export function packedCallCount(): number {
  return packedCalls;
}

export function chainProvider(chainId: number): ethers.JsonRpcProvider {
  const existing = providers.get(chainId);
  if (existing) return existing;
  const primary = savingsIntentService.resolveRpcUrl(chainId);
  const backupUrl = backupRpcUrl(chainId);
  const backup =
    backupUrl && backupUrl !== primary ? new ethers.JsonRpcProvider(backupUrl, chainId, OPTIONS) : null;
  // RPC_MULTICALL=off is the switch back to one call per read, should packing ever misbehave.
  const multicall = MULTICALL_CHAINS.has(chainId) && process.env.RPC_MULTICALL?.trim() !== 'off';
  const provider = new ClearRpcProvider(primary, chainId, backup, multicall);
  providers.set(chainId, provider);
  return provider;
}

/**
 * A contract runner that writes as `signer` and reads as nobody.
 *
 * A contract connected straight to a Wallet sends its reads with `from` set, and a read with a
 * sender cannot ride in a multicall (inside one, msg.sender would be Multicall3). The background
 * sweeps read far more than they write, all through the settler's wallet, so each of those reads
 * went out on its own. This keeps writes exactly as they were -- signed, sent, gas estimated by the
 * signer -- and sends plain reads through the provider, where they pack.
 */
export function writesAs(signer: ethers.Wallet): ethers.ContractRunner {
  const provider = signer.provider!;
  return {
    provider,
    call: (tx) => provider.call({ to: tx.to, data: tx.data, blockTag: tx.blockTag }),
    estimateGas: (tx) => signer.estimateGas(tx),
    sendTransaction: (tx) => signer.sendTransaction(tx),
    resolveName: (name) => signer.resolveName(name),
  };
}

/** Drop cached providers. Tests only -- a long-lived process wants the connection kept. */
export function resetChainProviders(): void {
  providers.clear();
}
