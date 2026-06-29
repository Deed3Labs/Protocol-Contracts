/**
 * Network gating by domain. The live app (app.useclear.org) is mainnet-only — balances and on-chain
 * transactions use Base mainnet. The demo/preview is testnet — it can also surface testnet balances
 * and transacts on Base Sepolia. This keeps real funds off the demo and test funds off production.
 */

export const IS_LIVE_APP =
  typeof window !== 'undefined' && window.location.hostname === 'app.useclear.org';

/** Chain all gasless money flows (deposit/redeem/send) run on, decided by the domain. */
export const ACTIVE_CHAIN_ID = IS_LIVE_APP ? 8453 : 84532;

export const MAINNET_CHAIN_IDS = new Set([1, 10, 8453, 42161, 137, 100]);

export const isMainnetChain = (chainId: number): boolean => MAINNET_CHAIN_IDS.has(chainId);

/** On the live app only mainnet balances count; the demo also shows testnet balances. */
export const includeChainBalance = (chainId: number): boolean =>
  IS_LIVE_APP ? isMainnetChain(chainId) : true;
