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
// Batches capped at 10: the public Base Sepolia RPC answers "over rate limit" to every call past
// roughly a dozen in one burst, and ethers otherwise packs up to 100 into a single request.
const OPTIONS: ethers.JsonRpcApiProviderOptions = { staticNetwork: true, batchMaxCount: 10 };

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

/*
 * The free node first, the paid one only for its overflow.
 *
 * Every call goes to the primary (the public node). Only the calls it answers with a rate limit --
 * individually, inside a batch, or as a whole-request 429 -- are sent again to the backup. So the
 * backup pays for bursts, not for the steady load, and nothing a member asked for fails because the
 * free node was busy. A real revert from the primary is an answer and is never re-sent.
 */
class OverflowRpcProvider extends ethers.JsonRpcProvider {
  constructor(
    url: string,
    chainId: number,
    private readonly backup: ethers.JsonRpcProvider,
  ) {
    super(url, chainId, OPTIONS);
  }

  // Typed as results by ethers, but a batch carries per-call errors in the same array.
  override async _send(payload: ethers.JsonRpcPayload | ethers.JsonRpcPayload[]): Promise<ethers.JsonRpcResult[]> {
    const payloads = Array.isArray(payload) ? payload : [payload];
    let results: ethers.JsonRpcResult[];
    try {
      results = await super._send(payload);
    } catch (error) {
      // The whole request refused (HTTP 429): all of it goes to the backup.
      if (isRateLimited(error instanceof Error ? error.message : String(error))) return this.backup._send(payloads);
      throw error;
    }
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

/** How many calls have gone to the backup since start -- logged, so its cost can be watched. */
let overflowCalls = 0;
export function overflowCallCount(): number {
  return overflowCalls;
}

export function chainProvider(chainId: number): ethers.JsonRpcProvider {
  const existing = providers.get(chainId);
  if (existing) return existing;
  const primary = savingsIntentService.resolveRpcUrl(chainId);
  const backupUrl = backupRpcUrl(chainId);
  const provider =
    backupUrl && backupUrl !== primary
      ? new OverflowRpcProvider(primary, chainId, new ethers.JsonRpcProvider(backupUrl, chainId, OPTIONS))
      : new ethers.JsonRpcProvider(primary, chainId, OPTIONS);
  providers.set(chainId, provider);
  return provider;
}

/** Drop cached providers. Tests only -- a long-lived process wants the connection kept. */
export function resetChainProviders(): void {
  providers.clear();
}
