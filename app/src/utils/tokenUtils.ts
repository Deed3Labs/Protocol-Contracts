/**
 * Utility functions for token classification and calculations
 */

/**
 * List of stablecoin symbols (case-insensitive)
 * USDC is prioritized as the primary stablecoin
 */
const STABLECOIN_SYMBOLS = [
  'USDC', // Priority stablecoin
  'USDT',
  'DAI',
  'BUSD',
  'TUSD',
  'USDP',
  'USDD',
  'FRAX',
  'LUSD',
  'sUSD',
  'GUSD',
  'HUSD',
  'USDX',
  'OUSD',
  'USDN',
  'USDS',
  'EURS',
  'EURT',
  'PAXG', // Gold-backed, but often treated as stable
] as const;

/**
 * Check if a token symbol represents a stablecoin
 * @param symbol Token symbol (case-insensitive)
 * @returns true if the token is a stablecoin
 */
export function isStablecoin(symbol: string): boolean {
  if (!symbol) return false;
  const upperSymbol = symbol.toUpperCase();
  return STABLECOIN_SYMBOLS.includes(upperSymbol as any);
}

/**
 * Check if a token is USDC (the priority stablecoin)
 * @param symbol Token symbol (case-insensitive)
 * @returns true if the token is USDC
 */
export function isUSDC(symbol: string): boolean {
  if (!symbol) return false;
  return symbol.toUpperCase() === 'USDC';
}

/**
 * Calculate cash balance from holdings
 * Cash = all stablecoins exclusively (USDC prioritized)
 * @param holdings Array of token holdings
 * @returns Object with cash balance breakdown
 */
export function calculateCashBalance(
  holdings: Array<{ asset_symbol: string; balanceUSD: number; type: string }>
): {
  totalCash: number;
  usdcBalance: number;
  otherStablecoinsBalance: number;
} {
  // Filter to only token holdings (exclude NFTs)
  const tokenHoldings = holdings.filter(h => h.type === 'token' || h.type !== 'nft');
  
  // Separate USDC from other stablecoins
  let usdcBalance = 0;
  let otherStablecoinsBalance = 0;
  
  tokenHoldings.forEach(holding => {
    if (isUSDC(holding.asset_symbol)) {
      usdcBalance += holding.balanceUSD || 0;
    } else if (isStablecoin(holding.asset_symbol)) {
      otherStablecoinsBalance += holding.balanceUSD || 0;
    }
  });
  
  const totalCash = usdcBalance + otherStablecoinsBalance;
  
  return {
    totalCash,
    usdcBalance,
    otherStablecoinsBalance,
  };
}

/**
 * Calculate crypto balance (non-stablecoin tokens)
 * @param holdings Array of token holdings
 * @returns Total value of crypto tokens (excluding stablecoins and NFTs)
 */
export function calculateCryptoBalance(
  holdings: Array<{ asset_symbol: string; balanceUSD: number; type: string }>
): number {
  // Filter to only token holdings (exclude NFTs)
  const tokenHoldings = holdings.filter(h => h.type === 'token' || h.type !== 'nft');
  
  return tokenHoldings.reduce((sum, holding) => {
    // Exclude stablecoins - only count crypto tokens
    if (!isStablecoin(holding.asset_symbol)) {
      return sum + (holding.balanceUSD || 0);
    }
    return sum;
  }, 0);
}
