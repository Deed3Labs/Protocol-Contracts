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

/** Committed Clear contract addresses per chain — used by the client-side AA (batched) flows. */
export interface ClearContracts {
  esaVault: `0x${string}`;
  clrusd: `0x${string}`;
  usdc: `0x${string}`;
}
const CONTRACTS: Record<number, ClearContracts> = {
  8453: {
    esaVault: '0x0CfE6aFB053474cE4Ff744a1fe864C82c173a1C1',
    clrusd: '0xa7a257f411e4Fe98e1D1FaA36C84B864c3336583',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  84532: {
    esaVault: '0x7bA87Eb0DC8ADF4a6CbE9f90d05A782De0F740cD',
    clrusd: '0x56195066D4ada8D371254061047f76FA2BBd0Ae3',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
};
export const clearContracts = (chainId: number): ClearContracts | null => CONTRACTS[chainId] ?? null;
