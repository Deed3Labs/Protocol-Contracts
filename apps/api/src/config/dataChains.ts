/*
 * Which chains we actually fetch data for.
 *
 * Clear operates on ONE chain — Base, or Base Sepolia on the demo. Everything else in
 * SUPPORTED_NETWORKS exists so a member can connect an external wallet that happens to live
 * somewhere else, which is a wallet-connect concern and not a reason to poll that chain for
 * balances every few seconds.
 *
 * This used to default to four to seven chains, and the cost was multiplied twice over: the
 * transfer monitor starts one interval PER ADDRESS PER CHAIN, so a single connected member on
 * seven chains meant seven timers and seven streams of RPC calls for six chains they hold nothing
 * on. That is Alchemy compute units and Railway CPU spent on empty answers.
 *
 * One env var widens it again if funds genuinely move onto another chain. The default is the truth
 * about where the product lives.
 */

function parseChainIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/** The chain Clear itself runs on. Base mainnet in production, Base Sepolia on the demo. */
export function activeChainId(): number {
  const raw = (process.env.ACTIVE_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8453;
}

/**
 * Chains to fetch balances and transfers for.
 *
 * `DATA_CHAIN_IDS=1,8453` widens it. Unset means the active chain alone, which is what the product
 * actually needs.
 */
export function dataChainIds(): number[] {
  const configured = parseChainIds(process.env.DATA_CHAIN_IDS);
  return configured.length > 0 ? configured : [activeChainId()];
}

/**
 * Narrow a caller-supplied chain list to what we are willing to poll.
 *
 * A client asking for eight chains does not get eight chains. The request describes what the wallet
 * connected to; this decides what is worth spending compute units on, and an empty intersection
 * falls back to the active chain rather than to nothing — a member with no data is a blank screen.
 */
export function limitToDataChains(requested: number[] | undefined): number[] {
  const allowed = dataChainIds();
  if (!requested || requested.length === 0) return allowed;
  const narrowed = requested.filter((id) => allowed.includes(id));
  return narrowed.length > 0 ? narrowed : allowed;
}
