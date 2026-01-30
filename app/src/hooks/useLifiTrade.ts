/**
 * Hook for Li.Fi trading functionality
 * Handles quote fetching, route execution, and trade status
 */

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { getQuote, getRoutes, executeRoute, convertQuoteToRoute, type Route, type RouteExtended } from '@lifi/sdk';
import { getToken } from '@lifi/sdk';
import { COMMON_TOKENS } from '@/config/tokens';
import { formatUnits, parseUnits } from 'viem';
// Initialize Li.Fi SDK config
import '@/lib/lifi';

// Use the return type from getQuote
type QuoteResult = Awaited<ReturnType<typeof getQuote>>;

export interface TradeQuote {
  quote: QuoteResult | null;
  route: Route | null;
  isLoading: boolean;
  error: string | null;
  estimatedOutput: string;
  estimatedOutputUSD: number;
  gasEstimate: string;
  executionTime: number; // in seconds
}

export interface TradeExecution {
  route: RouteExtended | null;
  isExecuting: boolean;
  error: string | null;
  status: 'idle' | 'executing' | 'success' | 'failed';
  transactionHashes: string[];
}

/**
 * Returns true when every step that has execution has at least one txHash (approval + main tx both done).
 * Prevents showing success after only the approval/sign step.
 */
function isRouteFullyComplete(route: RouteExtended | null): boolean {
  if (!route?.steps?.length) return false;
  return route.steps.every((step: { execution?: { process?: Array<{ txHash?: string }> } }) => {
    const process = step.execution?.process;
    if (!process?.length) return true; // step doesn't need execution
    return process.some((p) => !!p.txHash);
  });
}

/**
 * Resolve token address from symbol and chain ID
 */
const resolveTokenAddress = async (symbol: string, chainId: number): Promise<string> => {
  // Check common tokens first
  const commonTokens = COMMON_TOKENS[chainId] || [];
  const commonToken = commonTokens.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
  if (commonToken) {
    return commonToken.address;
  }

  // Try to fetch from Li.Fi SDK
  try {
    const token = await getToken(chainId, symbol);
    return token.address;
  } catch (error) {
    console.error(`Failed to resolve token ${symbol} on chain ${chainId}:`, error);
    // Return native token address (0x0000...0000) for native tokens
    if (symbol.toUpperCase() === 'ETH' || symbol.toUpperCase() === 'MATIC' || symbol.toUpperCase() === 'BNB') {
      return '0x0000000000000000000000000000000000000000';
    }
    throw new Error(`Token ${symbol} not found on chain ${chainId}`);
  }
};

/**
 * Hook for Li.Fi trading
 */
export function useLifiTrade() {
  const { address } = useAccount();
  const [quote, setQuote] = useState<TradeQuote>({
    quote: null,
    route: null,
    isLoading: false,
    error: null,
    estimatedOutput: '0',
    estimatedOutputUSD: 0,
    gasEstimate: '0',
    executionTime: 0,
  });

  const [execution, setExecution] = useState<TradeExecution>({
    route: null,
    isExecuting: false,
    error: null,
    status: 'idle',
    transactionHashes: [],
  });

  /**
   * Fetch quote for a trade
   */
  const fetchQuote = useCallback(async (
    fromChainId: number,
    fromTokenSymbol: string,
    fromAmount: string,
    toChainId: number,
    toTokenSymbol: string,
    toAddress?: string
  ) => {
    if (!address) {
      setQuote(prev => ({ ...prev, error: 'Wallet not connected' }));
      return;
    }

    setQuote(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Resolve token addresses
      const fromTokenAddress = await resolveTokenAddress(fromTokenSymbol, fromChainId);
      const toTokenAddress = await resolveTokenAddress(toTokenSymbol, toChainId);

      // Get token decimals for amount conversion
      const fromToken = await getToken(fromChainId, fromTokenAddress);
      const toToken = await getToken(toChainId, toTokenAddress);

      // Convert amount to smallest unit
      const fromAmountWei = parseUnits(fromAmount, fromToken.decimals).toString();

      // Fetch quote
      const quoteResult = await getQuote({
        fromChain: fromChainId,
        fromToken: fromTokenAddress,
        fromAmount: fromAmountWei,
        fromAddress: address,
        toChain: toChainId,
        toToken: toTokenAddress,
        toAddress: toAddress || address,
      });

      // Convert quote to route for execution
      const route = convertQuoteToRoute(quoteResult);

      // Calculate estimated output
      // Li.Fi quote structure can vary, so we check multiple possible locations
      // Type assertion needed because TypeScript types may not match runtime structure
      const quoteResultAny = quoteResult as any;
      const routeAny = route as any;
      
      // Try to get toAmount from multiple possible locations:
      // 1. quoteResult.action.toAmount (direct quote action)
      // 2. route.toAmount (route-level toAmount)
      // 3. route.steps[last].action.toAmount (last step's action)
      // 4. quoteResult.estimate.toAmount (estimate object)
      let toAmount = 
        quoteResultAny.action?.toAmount ||
        routeAny.toAmount ||
        routeAny.steps?.[routeAny.steps?.length - 1]?.action?.toAmount ||
        quoteResultAny.estimate?.toAmount ||
        '0';
      
      // If still not found, log the structure for debugging
      if (!toAmount || toAmount === '0') {
        console.error('Quote structure:', {
          quoteResult: quoteResultAny,
          route: routeAny,
          hasAction: !!quoteResultAny.action,
          hasRouteToAmount: !!routeAny.toAmount,
          hasSteps: !!routeAny.steps,
          lastStep: routeAny.steps?.[routeAny.steps?.length - 1],
        });
        throw new Error('Invalid quote: toAmount is missing or zero');
      }
      
      const estimatedOutput = formatUnits(BigInt(toAmount), toToken.decimals);
      
      // Get token price from multiple possible locations
      const toTokenPrice = 
        quoteResultAny.action?.toToken?.priceUSD ||
        routeAny.steps?.[routeAny.steps?.length - 1]?.action?.toToken?.priceUSD ||
        quoteResultAny.estimate?.toToken?.priceUSD ||
        '0';
      const estimatedOutputUSD = parseFloat(estimatedOutput) * parseFloat(toTokenPrice);
      
      console.log('Quote data:', {
        fromAmount: fromAmount,
        fromAmountFormatted: fromAmount,
        toAmount: toAmount,
        toAmountFormatted: estimatedOutput,
        fromTokenDecimals: fromToken.decimals,
        toTokenDecimals: toToken.decimals,
        fromToken: fromToken,
        toToken: toToken,
        toTokenPrice: toTokenPrice,
        estimatedOutputUSD: estimatedOutputUSD,
        quoteAction: quoteResultAny.action,
        routeSteps: routeAny.steps?.length || 0,
      });

      setQuote({
        quote: quoteResult,
        route,
        isLoading: false,
        error: null,
        estimatedOutput,
        estimatedOutputUSD,
        gasEstimate: quoteResult.estimate.gasCosts?.[0]?.amount || '0',
        executionTime: quoteResult.estimate.executionDuration || 0,
      });
    } catch (error: any) {
      console.error('Failed to fetch quote:', error);
      setQuote(prev => ({
        ...prev,
        isLoading: false,
        error: error?.message || 'Failed to fetch quote',
      }));
    }
  }, [address]);

  /**
   * Fetch routes (multiple options)
   */
  const fetchRoutes = useCallback(async (
    fromChainId: number,
    fromTokenSymbol: string,
    fromAmount: string,
    toChainId: number,
    toTokenSymbol: string,
    toAddress?: string
  ) => {
    if (!address) {
      return { routes: [], error: 'Wallet not connected' };
    }

    try {
      // Resolve token addresses
      const fromTokenAddress = await resolveTokenAddress(fromTokenSymbol, fromChainId);
      const toTokenAddress = await resolveTokenAddress(toTokenSymbol, toChainId);

      // Get token decimals for amount conversion
      const fromToken = await getToken(fromChainId, fromTokenAddress);
      const fromAmountWei = parseUnits(fromAmount, fromToken.decimals).toString();

      // Fetch routes
      const result = await getRoutes({
        fromChainId,
        fromTokenAddress,
        fromAmount: fromAmountWei,
        fromAddress: address,
        toChainId,
        toTokenAddress,
        toAddress: toAddress || address,
      });

      return { routes: result.routes, error: null };
    } catch (error: any) {
      console.error('Failed to fetch routes:', error);
      return { routes: [], error: error?.message || 'Failed to fetch routes' };
    }
  }, [address]);

  /**
   * Execute a trade route
   */
  const executeTrade = useCallback(async (route: Route) => {
    if (!address) {
      setExecution(prev => ({ ...prev, error: 'Wallet not connected' }));
      return;
    }

    setExecution({
      route: null,
      isExecuting: true,
      error: null,
      status: 'executing',
      transactionHashes: [],
    });

    try {
      const executedRoute = await executeRoute(route, {
        updateRouteHook: (updatedRoute) => {
          // Extract transaction hashes from route steps
          const txHashes: string[] = [];
          updatedRoute.steps.forEach((step) => {
            step.execution?.process.forEach((process) => {
              if (process.txHash) {
                txHashes.push(process.txHash);
              }
            });
          });

          const fullyComplete = isRouteFullyComplete(updatedRoute);

          setExecution(prev => ({
            ...prev,
            route: updatedRoute,
            transactionHashes: txHashes,
            // Only mark success when all steps (approval + main tx) have tx hashes
            ...(fullyComplete ? { isExecuting: false, status: 'success' as const } : {}),
          }));
        },
        acceptExchangeRateUpdateHook: async (update) => {
          // Prompt user to accept new exchange rate
          const oldToAmount = update.oldToAmount || '0';
          const newToAmount = update.newToAmount || '0';
          const accepted = window.confirm(
            `Exchange rate has changed. Old: ${oldToAmount}, New: ${newToAmount}. Continue?`
          );
          return accepted;
        },
      });

      // Only mark success when all steps are complete (approval + main tx); SDK may resolve after first sign
      const txHashesFromRoute: string[] = [];
      executedRoute.steps.forEach((step) => {
        step.execution?.process.forEach((process) => {
          if (process.txHash) txHashesFromRoute.push(process.txHash);
        });
      });
      const fullyComplete = isRouteFullyComplete(executedRoute);
      setExecution(prev => ({
        ...prev,
        route: executedRoute,
        transactionHashes: txHashesFromRoute,
        isExecuting: !fullyComplete,
        status: fullyComplete ? 'success' : prev.status,
      }));
    } catch (error: any) {
      console.error('Failed to execute trade:', error);
      setExecution(prev => ({
        ...prev,
        isExecuting: false,
        error: error?.message || 'Failed to execute trade',
        status: 'failed',
      }));
    }
  }, [address]);

  /**
   * Reset execution state
   */
  const resetExecution = useCallback(() => {
    setExecution({
      route: null,
      isExecuting: false,
      error: null,
      status: 'idle',
      transactionHashes: [],
    });
  }, []);

  /**
   * Clear quote
   */
  const clearQuote = useCallback(() => {
    setQuote({
      quote: null,
      route: null,
      isLoading: false,
      error: null,
      estimatedOutput: '0',
      estimatedOutputUSD: 0,
      gasEstimate: '0',
      executionTime: 0,
    });
  }, []);

  return {
    quote,
    execution,
    fetchQuote,
    fetchRoutes,
    executeTrade,
    resetExecution,
    clearQuote,
  };
}
