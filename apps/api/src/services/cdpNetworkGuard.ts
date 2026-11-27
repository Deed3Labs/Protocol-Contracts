/*
 * A CDP network name and a chain id have to agree, and nothing was checking.
 *
 * The relayers resolve them from separate environment variables, each with its own chain-suffixed
 * override and its own global fallback. On the demo environment that produced chain id 84532 with
 * network "base" — a testnet chain paired with the mainnet network name — because the suffixed
 * override was absent and the global one was left over from mainnet.
 *
 * The consequence is not a failed transaction. CDP signs for the network it is told, so a send
 * initiated from a testnet UI would have been submitted to Base mainnet, with the mainnet relayer,
 * moving real money. Nothing in the path would have objected.
 *
 * So this objects. A mismatch is a configuration error and it should stop the transaction rather
 * than pick one of the two answers and proceed — there is no safe guess between "testnet" and
 * "the account with real funds in it".
 */

/** CDP's network names, by chain id. */
const NETWORK_BY_CHAIN: Record<number, string> = {
  1: 'ethereum',
  8453: 'base',
  84532: 'base-sepolia',
  11155111: 'ethereum-sepolia',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
};

/** The network CDP should be told for a chain, or null when we have no opinion. */
export function expectedCdpNetwork(chainId: number): string | null {
  return NETWORK_BY_CHAIN[chainId] ?? null;
}

/**
 * Throw unless the network matches the chain.
 *
 * Unknown chains pass: this guards against a known mismatch, and refusing every chain we have not
 * enumerated would break a new deployment for a reason that has nothing to do with safety.
 */
export function assertCdpNetworkMatches(chainId: number, network: string, context: string): void {
  const expected = expectedCdpNetwork(chainId);
  if (!expected) return;
  if (network.trim().toLowerCase() === expected) return;

  throw new Error(
    `${context}: CDP network "${network}" does not match chain ${chainId} (expected "${expected}"). ` +
      `Set the chain-suffixed override for this chain rather than relying on the global one — ` +
      `signing here would submit the transaction to the wrong network.`,
  );
}
