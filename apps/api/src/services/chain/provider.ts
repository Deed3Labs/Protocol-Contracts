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

export function chainProvider(chainId: number): ethers.JsonRpcProvider {
  const existing = providers.get(chainId);
  if (existing) return existing;
  const provider = new ethers.JsonRpcProvider(
    savingsIntentService.resolveRpcUrl(chainId),
    chainId,
    // The chain id came from our own config, so there is nothing to discover and nothing to re-check.
    { staticNetwork: true },
  );
  providers.set(chainId, provider);
  return provider;
}

/** Drop cached providers. Tests only -- a long-lived process wants the connection kept. */
export function resetChainProviders(): void {
  providers.clear();
}
