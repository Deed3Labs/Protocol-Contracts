/**
 * API Client for backend server
 * 
 * This utility provides a centralized way to call the backend API
 * with automatic caching and error handling.
 */
import type {
  ClaimPayoutResponse,
  ClaimSession,
  ConfirmSendTransferLockRequest,
  ConfirmSendTransferLockResponse,
  PrepareSendTransferRequest,
  PrepareSendTransferResponse,
  SendTransferSummary,
  VerifyClaimOtpResponse,
} from '@/types/send';
import type {
  CreateSavingsIntentRequest,
  CreateSavingsIntentResponse,
  FinalizeSavingsIntentResponse,
  RefundSavingsIntentResponse,
} from '@/types/savings';
import { getAccessToken } from '@privy-io/react-auth';
import { clearSiwxAuthToken, getActiveWallet, notifyAuthExpired } from './authSession';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const REOWN_PROJECT_ID = import.meta.env.VITE_APPKIT_PROJECT_ID || '';

// Log API base URL in development to help debug
if (import.meta.env.DEV) {
  console.log('[apiClient] API_BASE_URL:', API_BASE_URL);
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
  cached?: boolean;
  timestamp?: number;
}

interface RequestInitWithTimeout extends RequestInit {
  timeout?: number; // Custom timeout in milliseconds (overrides default 30s)
}

/**
 * Generic API request function
 * Handles errors gracefully, including HTML responses (server down, wrong endpoint, etc.)
 * Includes timeout and abort handling to prevent resource exhaustion
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInitWithTimeout = {}
): Promise<ApiResponse<T>> {
  // Create abort controller for timeout
  const timeoutController = new AbortController();
  const timeoutMs = options.timeout || 30000; // Default 30 seconds, longer for NFT requests
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    const { timeout: _, ...fetchOptions } = options; // Remove timeout from fetch options
    const authToken = await getAccessToken().catch(() => null);
    const activeWallet = getActiveWallet();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      signal: timeoutController.signal, // Use timeout signal (user signal will be ignored if provided)
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(activeWallet ? { 'X-Wallet-Address': activeWallet } : {}),
        ...(REOWN_PROJECT_ID
          ? { 'X-Reown-Project-Id': REOWN_PROJECT_ID }
          : {}),
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    // Check if response is actually JSON before trying to parse
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      if (response.status === 401) {
        clearSiwxAuthToken();
        notifyAuthExpired({ endpoint, status: response.status });
        throw new Error('Authentication expired. Please reconnect and sign in again.');
      }

      // Try to parse error as JSON, but handle HTML/other responses
      if (isJson) {
        const errorData = await response.json().catch(() => null);
        if (errorData && typeof errorData === 'object') {
          const message = (errorData as { message?: unknown }).message;
          const plaidCode = (errorData as { plaid_error_code?: unknown }).plaid_error_code;
          if (typeof message === 'string' && message.length > 0) {
            if (typeof plaidCode === 'string' && plaidCode.length > 0) {
              throw new Error(`${message} (${plaidCode})`);
            }
            throw new Error(message);
          }
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } else {
        // Non-JSON response (likely HTML error page)
        throw new Error(`HTTP ${response.status}: Server returned non-JSON response (Server may be down or endpoint incorrect)`);
      }
    }

    // Parse response as JSON only if content-type indicates JSON
    if (!isJson) {
      // If we expected JSON but got something else, it's likely an error
      const text = await response.text();
      // Check if it's HTML (common when server is down or wrong endpoint)
      if (text.trim().startsWith('<!doctype') || text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
        throw new Error('Server returned HTML instead of JSON (Server may be down or endpoint incorrect)');
      }
      throw new Error(`Server returned non-JSON response: ${contentType || 'unknown'}`);
    }

    const data = await response.json();
    return { data: data as T, cached: data.cached, timestamp: data.timestamp };
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Handle abort errors gracefully
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        error: 'Request timeout - the server took too long to respond',
      };
    }
    
    // Log errors in development and production for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (import.meta.env.DEV) {
      console.warn('[apiClient] Request failed:', {
        endpoint,
        error: errorMessage,
        apiBaseUrl: API_BASE_URL
      });
    } else if (import.meta.env.PROD) {
      // In production, log errors to help diagnose issues
      console.error('[apiClient] Production API request failed:', {
        endpoint,
        error: errorMessage,
        apiBaseUrl: API_BASE_URL || 'NOT SET - Check VITE_API_BASE_URL environment variable'
      });
    }
    
    return {
      error: errorMessage,
    };
  }
}

/**
 * Get token price from server
 */
export async function getTokenPrice(
  chainId: number,
  tokenAddress: string
): Promise<{ price: number; cached: boolean } | null> {
  const response = await apiRequest<{ price: number; cached: boolean }>(
    `/api/prices/${chainId}/${tokenAddress}`
  );

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * Get multiple token prices in batch
 */
export async function getTokenPricesBatch(
  prices: Array<{ chainId: number; tokenAddress: string }>
): Promise<Array<{ chainId: number; tokenAddress: string; price: number | null; cached: boolean }>> {
  const response = await apiRequest<{
    results: Array<{ chainId: number; tokenAddress: string; price: number | null; cached: boolean }>;
  }>('/api/prices/batch', {
    method: 'POST',
    body: JSON.stringify({ prices }),
  });

  if (response.error || !response.data) {
    return prices.map((p) => ({ ...p, price: null, cached: false }));
  }

  return response.data.results;
}

/**
 * Get balance from server
 */
export async function getBalance(
  chainId: number,
  address: string
): Promise<{ balance: string; balanceWei: string; cached: boolean } | null> {
  const response = await apiRequest<{ balance: string; balanceWei: string; cached: boolean }>(
    `/api/balances/${chainId}/${address}`
  );

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * Get multiple balances in batch
 */
export async function getBalancesBatch(
  balances: Array<{ chainId: number; address: string }>
): Promise<Array<{ chainId: number; address: string; balance: string | null; balanceWei: string | null; cached: boolean; error?: string }>> {
  const response = await apiRequest<{
    results: Array<{ chainId: number; address: string; balance: string | null; balanceWei: string | null; cached: boolean; error?: string }>;
  }>('/api/balances/batch', {
    method: 'POST',
    body: JSON.stringify({ balances }),
  });

  if (response.error || !response.data) {
    return balances.map((b) => ({ ...b, balance: null, balanceWei: null, cached: false }));
  }

  return response.data.results;
}

/**
 * Get NFTs from server
 * 
 * @param chainId - Chain ID
 * @param address - User address
 * @param contractAddress - Optional contract address. If provided with type='general', fetches general NFTs.
 *                          If not provided, fetches T-Deeds (DeedNFT protocol contracts).
 * @param type - Optional. 't-deed' or 'general'. Defaults based on contractAddress.
 */
export async function getNFTs(
  chainId: number,
  address: string,
  contractAddress?: string,
  type?: 't-deed' | 'general'
): Promise<{ nfts: any[]; cached: boolean } | null> {
  const params = new URLSearchParams();
  if (contractAddress) {
    params.append('contractAddress', contractAddress);
  }
  if (type) {
    params.append('type', type);
  }
  // Note: If contractAddress is provided but no type, server will default based on contractAddress
  // For T-Deeds, explicitly pass type='t-deed'
  // For general NFTs, explicitly pass type='general'
  
  const query = params.toString() ? `?${params.toString()}` : '';
  // NFT requests can take longer, use 60 second timeout
  const response = await apiRequest<{ nfts: any[]; cached: boolean }>(
    `/api/nfts/${chainId}/${address}${query}`,
    { timeout: 60000 }
  );

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * Get multiple NFT lists in batch
 */
export async function getNFTsBatch(
  requests: Array<{ chainId: number; address: string; contractAddress?: string }>
): Promise<Array<{ chainId: number; address: string; nfts: any[]; cached: boolean; error?: string }>> {
  // Batch NFT requests can take even longer, use 90 second timeout
  const response = await apiRequest<{
    results: Array<{ chainId: number; address: string; nfts: any[]; cached: boolean; error?: string }>;
  }>('/api/nfts/batch', {
    method: 'POST',
    body: JSON.stringify({ requests }),
    timeout: 90000, // 90 seconds for batch requests
  });

  if (response.error || !response.data) {
    return requests.map((r) => ({ ...r, nfts: [], cached: false }));
  }

  return response.data.results;
}

/**
 * Get transactions from server
 */
export async function getTransactions(
  chainId: number,
  address: string,
  limit: number = 20
): Promise<{ transactions: any[]; cached: boolean } | null> {
  const response = await apiRequest<{ transactions: any[]; cached: boolean }>(
    `/api/transactions/${chainId}/${address}?limit=${limit}`
  );

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * Get multiple transaction lists in batch
 */
export async function getTransactionsBatch(
  requests: Array<{ chainId: number; address: string; limit?: number }>
): Promise<Array<{ chainId: number; address: string; transactions: any[]; cached: boolean; error?: string }>> {
  const response = await apiRequest<{
    results: Array<{ chainId: number; address: string; transactions: any[]; cached: boolean; error?: string }>;
  }>('/api/transactions/batch', {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });

  if (response.error || !response.data) {
    return requests.map((r) => ({ ...r, transactions: [], cached: false }));
  }

  return response.data.results;
}

/**
 * Get token balance from server
 */
export async function getTokenBalance(
  chainId: number,
  userAddress: string,
  tokenAddress: string
): Promise<{ address: string; symbol: string; name: string; decimals: number; balance: string; balanceRaw: string; cached: boolean } | null> {
  const response = await apiRequest<{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    balance: string;
    balanceRaw: string;
    cached: boolean;
  }>(`/api/token-balances/${chainId}/${userAddress}/${tokenAddress}`);

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * Get multiple token balances in batch
 */
export async function getTokenBalancesBatch(
  requests: Array<{ chainId: number; tokenAddress: string; userAddress: string }>
): Promise<Array<{ chainId: number; tokenAddress: string; userAddress: string; data: any | null; cached: boolean; error?: string }>> {
  const response = await apiRequest<{
    results: Array<{ chainId: number; tokenAddress: string; userAddress: string; data: any | null; cached: boolean; error?: string }>;
  }>('/api/token-balances/batch', {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });

  if (response.error || !response.data) {
    return requests.map((r) => ({ ...r, data: null, cached: false }));
  }

  return response.data.results;
}

/**
 * Get ALL ERC20 token balances for an address using Alchemy API
 * This is more efficient than checking individual tokens
 */
export async function getAllTokenBalances(
  chainId: number,
  userAddress: string
): Promise<Array<{ address: string; symbol: string; name: string; decimals: number; balance: string; balanceRaw: string }>> {
  const response = await apiRequest<{
    tokens: Array<{ address: string; symbol: string; name: string; decimals: number; balance: string; balanceRaw: string }>;
    cached: boolean;
    timestamp: number;
    fallback?: string;
  }>(`/api/token-balances/all/${chainId}/${userAddress}`, {
    timeout: 60000, // Increased to 60 seconds for fetching all tokens
  });

  if (response.error || !response.data) {
    return [];
  }

  return response.data.tokens || [];
}

/**
 * Get ALL token balances for multiple chains in batch
 */
export async function getAllTokenBalancesBatch(
  requests: Array<{ chainId: number; userAddress: string }>
): Promise<Array<{ chainId: number; userAddress: string; tokens: Array<{ address: string; symbol: string; name: string; decimals: number; balance: string; balanceRaw: string }>; cached: boolean; error?: string }>> {
  const response = await apiRequest<{
    results: Array<{ chainId: number; userAddress: string; tokens: any[]; cached: boolean; error?: string }>;
  }>('/api/token-balances/all/batch', {
    method: 'POST',
    body: JSON.stringify({ requests }),
    timeout: 60000, // 60 second timeout for batch fetching all tokens
  });

  if (response.error || !response.data) {
    return requests.map((r) => ({ ...r, tokens: [], cached: false }));
  }

  return response.data.results;
}

/**
 * Get tokens (ERC20, Native, SPL) across multiple chains using Alchemy Portfolio API
 * This is the most efficient way to fetch tokens across multiple chains
 * 
 * @param requests - Array of { address, chainIds[] } to fetch tokens for
 *                   Maximum 2 addresses, 5 networks per address
 * @param options - Optional parameters
 * @returns Map of address -> chainId -> tokens (Portfolio API format)
 */
export async function getTokensByAddressPortfolio(
  requests: Array<{ address: string; chainIds: number[] }>,
  options: {
    withMetadata?: boolean;
    withPrices?: boolean;
    includeNativeTokens?: boolean;
    includeErc20Tokens?: boolean;
    skipCache?: boolean;
  } = {}
): Promise<{
  results: Array<{
    address: string;
    chainId: number;
    tokens: any[]; // Portfolio API format - includes metadata, prices, logos
    cached: boolean;
    error?: string;
  }>;
}> {
  const response = await apiRequest<{
    results: Array<{
      address: string;
      chainId: number;
      tokens: any[];
      cached: boolean;
      error?: string;
    }>;
  }>(`/api/token-balances/portfolio${options.skipCache ? `?refresh=1&_t=${Date.now()}` : ''}`, {
    method: 'POST',
    body: JSON.stringify({
      requests,
      withMetadata: options.withMetadata ?? true,
      withPrices: options.withPrices ?? true,
      includeNativeTokens: options.includeNativeTokens ?? true,
      includeErc20Tokens: options.includeErc20Tokens ?? true,
    }),
    ...(options.skipCache && { cache: 'no-store' as RequestCache }),
    timeout: 60000, // 60 second timeout
  });

  if (response.error || !response.data) {
    return { results: [] };
  }

  return response.data;
}

/**
 * Get NFTs (ERC721, ERC1155) across multiple chains using Alchemy Portfolio API
 * This is the most efficient way to fetch NFTs across multiple chains
 * 
 * @param requests - Array of { address, chainIds[] } to fetch NFTs for
 *                   Maximum 2 addresses, 15 networks per address
 * @param options - Optional parameters
 * @returns Map of address -> chainId -> { nfts, totalCount?, pageKey? } (Portfolio API format)
 */
export async function getNFTsByAddressPortfolio(
  requests: Array<{ address: string; chainIds: number[] }>,
  options: {
    withMetadata?: boolean;
    pageKey?: string;
    pageSize?: number;
    orderBy?: 'transferTime';
    sortOrder?: 'asc' | 'desc';
    excludeFilters?: Array<'SPAM' | 'AIRDROPS'>;
    includeFilters?: Array<'SPAM' | 'AIRDROPS'>;
    spamConfidenceLevel?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  } = {}
): Promise<{
  results: Array<{
    address: string;
    chainId: number;
    nfts: any[]; // Portfolio API format - includes full metadata, images, attributes
    totalCount?: number;
    pageKey?: string;
    cached: boolean;
    error?: string;
  }>;
}> {
  const response = await apiRequest<{
    results: Array<{
      address: string;
      chainId: number;
      nfts: any[];
      totalCount?: number;
      pageKey?: string;
      cached: boolean;
      error?: string;
    }>;
  }>('/api/nfts/portfolio', {
    method: 'POST',
    body: JSON.stringify({
      requests,
      withMetadata: options.withMetadata ?? true,
      pageKey: options.pageKey,
      pageSize: options.pageSize,
      orderBy: options.orderBy,
      sortOrder: options.sortOrder,
      excludeFilters: options.excludeFilters,
      includeFilters: options.includeFilters,
      spamConfidenceLevel: options.spamConfidenceLevel,
    }),
    timeout: 90000, // 90 second timeout for NFT requests
  });

  if (response.error || !response.data) {
    return { results: [] };
  }

  return response.data;
}

/**
 * Get unified portfolio data (balances, tokens, NFTs, cash balance)
 * This is an optimized endpoint that fetches everything in one call
 * Note: This endpoint may not be available on all server versions
 */
export async function getPortfolio(
  address: string
): Promise<{
  holdings: any[];
  cashBalance: {
    totalCash: number;
    usdcBalance: number;
    otherStablecoinsBalance: number;
  };
  totalValueUSD: number;
  cached: boolean;
} | null> {
  const response = await apiRequest<{
    holdings: any[];
    cashBalance: {
      totalCash: number;
      usdcBalance: number;
      otherStablecoinsBalance: number;
    };
    totalValueUSD: number;
    cached: boolean;
  }>(`/api/portfolio/${address}`);

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * Create a Stripe crypto onramp session
 */
export async function createStripeOnrampSession(params: {
  wallet_addresses?: Record<string, string>;
  customer_ip_address?: string;
  source_currency?: string;
  destination_currency?: string;
  destination_network?: string;
  destination_amount?: string;
  source_amount?: string;
  destination_currencies?: string[];
  destination_networks?: string[];
}): Promise<{
  id: string;
  client_secret: string;
  status: string;
  transaction_details: any;
} | null> {
  const response = await apiRequest<{
    id: string;
    client_secret: string;
    status: string;
    transaction_details: any;
  }>('/api/stripe/create-onramp-session', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

export async function createStripeOnrampSessionDetailed(params: {
  wallet_addresses?: Record<string, string>;
  customer_ip_address?: string;
  source_currency?: string;
  destination_currency?: string;
  destination_network?: string;
  destination_amount?: string;
  source_amount?: string;
  destination_currencies?: string[];
  destination_networks?: string[];
}): Promise<{
  session: {
    id: string;
    client_secret: string;
    status: string;
    transaction_details: any;
  } | null;
  error?: string;
}> {
  const response = await apiRequest<{
    id: string;
    client_secret: string;
    status: string;
    transaction_details: any;
  }>('/api/stripe/create-onramp-session', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  if (response.error || !response.data) {
    return {
      session: null,
      error: response.error || 'Failed to create Stripe onramp session.',
    };
  }

  return { session: response.data };
}

/**
 * Plaid: create link token for Plaid Link (bank linking)
 */
export async function getPlaidLinkToken(walletAddress: string): Promise<{ link_token: string } | null> {
  const response = await apiRequest<{ link_token: string }>('/api/plaid/link-token', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

/**
 * Plaid: exchange public token for access token (after user completes Link)
 */
export async function exchangePlaidToken(
  walletAddress: string,
  publicToken: string
): Promise<{ success: boolean } | null> {
  const response = await apiRequest<{ success: boolean }>('/api/plaid/exchange-token', {
    method: 'POST',
    body: JSON.stringify({ walletAddress, publicToken }),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

export interface BankAccountBalance {
  account_id: string;
  name: string;
  mask?: string;
  current: number | null;
  available: number | null;
  /** Credit limit for liability accounts when provided by institution */
  limit?: number | null;
  /** Plaid item id for this connection (for optional per-institution disconnect) */
  item_id?: string;
  /** Plaid account type: depository, credit, loan, investment, other */
  type?: string;
  /** Plaid account subtype e.g. checking, savings, credit card, brokerage */
  subtype?: string;
}

export interface BankBalancesResponse {
  accounts: BankAccountBalance[];
  totalBankBalance: number;
  linked: boolean;
}

/**
 * Plaid: get linked bank account balances for a wallet address.
 * Server caches responses; pass skipCache: true to force a fresh Plaid call (e.g. on manual refresh).
 */
export async function getBankBalances(
  walletAddress: string,
  options?: { skipCache?: boolean }
): Promise<BankBalancesResponse | null> {
  const encoded = encodeURIComponent(walletAddress);
  const qs = options?.skipCache ? `&refresh=1&_t=${Date.now()}` : '';
  const response = await apiRequest<BankBalancesResponse>(`/api/plaid/balances?walletAddress=${encoded}${qs}`, {
    ...(options?.skipCache && { cache: 'no-store' as RequestCache }),
  });
  if (response.error) {
    throw new Error(response.error);
  }
  if (response.data) return response.data;
  return { accounts: [], totalBankBalance: 0, linked: false };
}

/**
 * Plaid: disconnect (remove stored access token) for a wallet address
 */
/**
 * Disconnect one or all Plaid connections for a wallet.
 * - Omit itemId to disconnect all linked institutions.
 * - Pass itemId (from account.item_id) to disconnect only that institution.
 */
export async function disconnectPlaid(
  walletAddress: string,
  itemId?: string
): Promise<{ success: boolean } | null> {
  const response = await apiRequest<{ success: boolean }>('/api/plaid/disconnect', {
    method: 'POST',
    body: JSON.stringify({ walletAddress, ...(itemId != null && { itemId }) }),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

/** Plaid investment holding (from /investments/holdings/get, normalized by server) */
export interface PlaidInvestmentHolding {
  holding_id: string;
  account_id: string;
  security_id: string;
  name: string;
  ticker_symbol: string | null;
  security_type: string | null;
  quantity: number;
  institution_value: number;
  cost_basis: number | null;
  institution_price: number;
  iso_currency_code: string | null;
  item_id: string;
}

export interface PlaidInvestmentsHoldingsResponse {
  holdings: PlaidInvestmentHolding[];
  linked: boolean;
  cached?: boolean;
}

/**
 * Plaid: get investment holdings for linked brokerage accounts.
 * Server caches responses; pass skipCache: true to force refresh.
 */
export async function getPlaidInvestmentsHoldings(
  walletAddress: string,
  options?: { skipCache?: boolean }
): Promise<PlaidInvestmentsHoldingsResponse | null> {
  const encoded = encodeURIComponent(walletAddress);
  const qs = options?.skipCache ? `&refresh=1&_t=${Date.now()}` : '';
  const response = await apiRequest<PlaidInvestmentsHoldingsResponse>(
    `/api/plaid/investments/holdings?walletAddress=${encoded}${qs}`,
    { ...(options?.skipCache && { cache: 'no-store' as RequestCache }) }
  );
  if (response.error) return null;
  if (response.data) return response.data;
  return { holdings: [], linked: false };
}

/**
 * Plaid: trigger on-demand refresh of investment data (holdings/transactions).
 * See https://plaid.com/docs/investments/#investmentsrefresh
 */
export async function plaidInvestmentsRefresh(walletAddress: string): Promise<{ success: boolean } | null> {
  const response = await apiRequest<{ success: boolean }>('/api/plaid/investments/refresh', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

export interface PlaidLiabilityAccount {
  account_id: string;
  item_id: string;
  liability_type: 'credit' | 'mortgage' | 'student';
  apr_percentage: number | null;
  is_overdue: boolean | null;
  last_payment_amount: number | null;
  last_payment_date: string | null;
  last_statement_balance: number | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
  origination_principal_amount: number | null;
  loan_term: string | null;
}

export interface PlaidLiabilitiesResponse {
  accounts: PlaidLiabilityAccount[];
  linked: boolean;
  cached?: boolean;
}

/**
 * Plaid: get liability details (credit/mortgage/student) for linked accounts.
 * Server caches responses; pass skipCache: true to force refresh.
 */
export async function getPlaidLiabilities(
  walletAddress: string,
  options?: { skipCache?: boolean }
): Promise<PlaidLiabilitiesResponse | null> {
  const encoded = encodeURIComponent(walletAddress);
  const qs = options?.skipCache ? `&refresh=1&_t=${Date.now()}` : '';
  const response = await apiRequest<PlaidLiabilitiesResponse>(
    `/api/plaid/liabilities?walletAddress=${encoded}${qs}`,
    { ...(options?.skipCache && { cache: 'no-store' as RequestCache }) }
  );
  if (response.error) return null;
  if (response.data) return response.data;
  return { accounts: [], linked: false };
}

export interface PlaidInvestmentAccountSummary {
  account_id: string;
  item_id: string;
  name: string;
  mask?: string;
  subtype?: string;
  current: number | null;
  available: number | null;
  iso_currency_code: string | null;
  holdings_count: number;
  holdings_value: number;
  security_types: string[];
}

export interface PlaidInvestmentAccountsResponse {
  accounts: PlaidInvestmentAccountSummary[];
  linked: boolean;
  cached?: boolean;
}

/**
 * Plaid: get investment account summaries (account metadata + aggregated holdings).
 * Server caches responses; pass skipCache: true to force refresh.
 */
export async function getPlaidInvestmentAccounts(
  walletAddress: string,
  options?: { skipCache?: boolean }
): Promise<PlaidInvestmentAccountsResponse | null> {
  const encoded = encodeURIComponent(walletAddress);
  const qs = options?.skipCache ? `&refresh=1&_t=${Date.now()}` : '';
  const response = await apiRequest<PlaidInvestmentAccountsResponse>(
    `/api/plaid/investments/accounts?walletAddress=${encoded}${qs}`,
    { ...(options?.skipCache && { cache: 'no-store' as RequestCache }) }
  );
  if (response.error) return null;
  if (response.data) return response.data;
  return { accounts: [], linked: false };
}

/** Recurring stream from Plaid /transactions/recurring/get (normalized by server) */
export interface RecurringStream {
  stream_id: string;
  name: string;
  amount: number;
  day: number;
  iso_currency_code: string | null;
}

export interface PlaidRecurringResponse {
  inflowStreams: RecurringStream[];
  outflowStreams: RecurringStream[];
  linked: boolean;
  /** True when Plaid reports product data is still warming up (PRODUCT_NOT_READY). */
  notReady?: boolean;
  cached?: boolean;
}

/**
 * Plaid: get recurring transaction streams (inflow = deposits, outflow = subscriptions/expenses).
 * Server caches responses; pass refresh: true to force a fresh Plaid call.
 * Only call when user has linked accounts to avoid unnecessary requests.
 */
export async function getPlaidRecurringTransactions(
  walletAddress: string,
  options?: { refresh?: boolean }
): Promise<PlaidRecurringResponse | null> {
  const encoded = encodeURIComponent(walletAddress);
  const qs = options?.refresh ? `&refresh=1&_t=${Date.now()}` : '';
  const response = await apiRequest<PlaidRecurringResponse>(
    `/api/plaid/recurring-transactions?walletAddress=${encoded}${qs}`,
    { ...(options?.refresh && { cache: 'no-store' as RequestCache }) }
  );
  if (response.error) return null;
  if (response.data) return response.data;
  return { inflowStreams: [], outflowStreams: [], linked: false };
}

export interface PlaidRecentTransaction {
  transaction_id: string;
  account_id: string | null;
  account_name: string;
  account_mask: string | null;
  item_id: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  signed_amount: number;
  direction: 'inflow' | 'outflow';
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  date: string;
  authorized_date: string | null;
  pending: boolean;
  category_primary: string | null;
  category_detailed: string | null;
  payment_channel: string | null;
}

export interface PlaidRecentTransactionsResponse {
  transactions: PlaidRecentTransaction[];
  linked: boolean;
  /** True when Plaid reports product data is still warming up (PRODUCT_NOT_READY). */
  notReady?: boolean;
  cached?: boolean;
}

/**
 * Plaid: get recent bank transactions (rolling 90 days) across all linked items.
 * Returns newest first. Pass refresh: true to bypass cache.
 */
export async function getPlaidRecentTransactions(
  walletAddress: string,
  options?: { refresh?: boolean; limit?: number }
): Promise<PlaidRecentTransactionsResponse | null> {
  const search = new URLSearchParams();
  search.set('walletAddress', walletAddress);
  if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
    search.set('limit', String(Math.floor(options.limit)));
  }
  if (options?.refresh) {
    search.set('refresh', '1');
    search.set('_t', String(Date.now()));
  }

  const response = await apiRequest<PlaidRecentTransactionsResponse>(
    `/api/plaid/transactions/recent?${search.toString()}`,
    { ...(options?.refresh && { cache: 'no-store' as RequestCache }) }
  );
  if (response.error) return null;
  if (response.data) return response.data;
  return { transactions: [], linked: false };
}

export interface PlaidHistoricalTransactionsResponse {
  transactions: PlaidRecentTransaction[];
  linked: boolean;
  /** True when Plaid reports product data is still warming up (PRODUCT_NOT_READY). */
  notReady?: boolean;
  cached?: boolean;
}

/**
 * Plaid: get historical bank transactions (last 2 years) across linked items.
 * Returns newest first. Pass refresh: true to bypass cache.
 */
export async function getPlaidHistoricalTransactions(
  walletAddress: string,
  options?: { refresh?: boolean; limit?: number }
): Promise<PlaidHistoricalTransactionsResponse | null> {
  const search = new URLSearchParams();
  search.set('walletAddress', walletAddress);
  if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
    search.set('limit', String(Math.floor(options.limit)));
  }
  if (options?.refresh) {
    search.set('refresh', '1');
    search.set('_t', String(Date.now()));
  }

  const response = await apiRequest<PlaidHistoricalTransactionsResponse>(
    `/api/plaid/transactions/historical?${search.toString()}`,
    { ...(options?.refresh && { cache: 'no-store' as RequestCache }) }
  );
  if (response.error) return null;
  if (response.data) return response.data;
  return { transactions: [], linked: false };
}

export interface PortfolioHistoryPoint {
  date: string; // YYYY-MM-DD
  onchainUsd: number;
  bankUsd: number;
  totalUsd: number;
}

/**
 * Portfolio value history (daily): on-chain stablecoins + Plaid bank. Auth-protected; backed by
 * the server's snapshot store (first call backfills from transaction flows).
 */
export async function getPortfolioHistory(
  walletAddress: string,
  range: string = 'All'
): Promise<{ points: PortfolioHistoryPoint[]; configured: boolean } | null> {
  const enc = encodeURIComponent(walletAddress);
  const response = await apiRequest<{ points: PortfolioHistoryPoint[]; configured: boolean }>(
    `/api/portfolio/history?walletAddress=${enc}&range=${encodeURIComponent(range)}`
  );
  if (response.error || !response.data) return null;
  return response.data;
}

/** Spend-by-day: day of month (1–31) -> total outflows for that day */
export type SpendingByDay = Record<number, number>;

export interface PlaidSpendResponse {
  spendingByDay: SpendingByDay;
  totalSpent: number;
  linked: boolean;
  /** True when Plaid reports product data is still warming up (PRODUCT_NOT_READY). */
  notReady?: boolean;
  cached?: boolean;
}

/**
 * Plaid: get spend this month (outflows by day) for SpendTracker.
 * Server caches responses; pass refresh: true to bypass cache.
 */
export async function getPlaidSpend(
  walletAddress: string,
  options?: { refresh?: boolean }
): Promise<PlaidSpendResponse | null> {
  const encoded = encodeURIComponent(walletAddress);
  const qs = options?.refresh ? `&refresh=1&_t=${Date.now()}` : '';
  const response = await apiRequest<PlaidSpendResponse>(
    `/api/plaid/transactions/spend?walletAddress=${encoded}${qs}`,
    { ...(options?.refresh && { cache: 'no-store' as RequestCache }) }
  );
  if (response.error) return null;
  if (response.data) return response.data;
  return { spendingByDay: {}, totalSpent: 0, linked: false };
}

/**
 * Bridge: get URL to open Bridge onboarding flow for direct deposit setup
 */
export interface BridgeOnboardingResponse {
  url: string;
  source?: 'existing_customer' | 'new_customer' | 'configured_url';
  customerId?: string | null;
  kycUrl?: string | null;
  tosUrl?: string | null;
}

export async function getBridgeOnboardingUrl(
  walletAddress: string,
  options?: {
    hasPlaidAccount?: boolean;
    fullName?: string;
    email?: string;
    customerType?: 'individual' | 'business';
  }
): Promise<BridgeOnboardingResponse | null> {
  const response = await apiRequest<BridgeOnboardingResponse>('/api/bridge/onboarding-url', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress,
      ...(options?.hasPlaidAccount != null ? { hasPlaidAccount: options.hasPlaidAccount } : {}),
      ...(options?.fullName ? { fullName: options.fullName } : {}),
      ...(options?.email ? { email: options.email } : {}),
      ...(options?.customerType ? { customerType: options.customerType } : {}),
    }),
  });
  if (response.error || !response.data?.url) return null;
  return response.data;
}

/**
 * Bridge: get URL to open Bridge funding flow (ACH/wire) with wallet, amount, destination currency and network
 */
export async function getBridgeFundingUrl(
  walletAddress: string,
  amount: string,
  destinationCurrency: string,
  destinationNetwork: string
): Promise<string | null> {
  const response = await apiRequest<{ url: string }>('/api/bridge/funding-url', {
    method: 'POST',
    body: JSON.stringify({
      walletAddress,
      amount,
      destinationCurrency,
      destinationNetwork,
    }),
  });
  if (response.error || !response.data?.url) return null;
  return response.data.url;
}

export async function prepareSendTransfer(
  payload: PrepareSendTransferRequest
): Promise<PrepareSendTransferResponse | null> {
  const response = await apiRequest<PrepareSendTransferResponse>('/api/send/transfers/prepare', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * Record a direct (non-escrow) wallet→wallet send so both parties get an immediate in-app
 * notification without waiting on the on-chain watcher. Best-effort — the watcher is the fallback.
 */
export async function notifyDirectSend(input: {
  to: string;
  amount: number;
  txHash?: string;
  chainId?: number;
}): Promise<void> {
  try {
    await apiRequest('/api/send/notify-direct', { method: 'POST', body: JSON.stringify(input) });
  } catch {
    // non-fatal; the transfer already happened on-chain
  }
}

export async function confirmSendTransferLock(
  id: number,
  payload: ConfirmSendTransferLockRequest
): Promise<ConfirmSendTransferLockResponse | null> {
  const response = await apiRequest<ConfirmSendTransferLockResponse>(`/api/send/transfers/${id}/confirm-lock`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

export async function listSendTransfers(limit: number = 50): Promise<SendTransferSummary[]> {
  const response = await apiRequest<{ transfers: SendTransferSummary[] }>(`/api/send/transfers?limit=${limit}`);

  if (response.error || !response.data) {
    return [];
  }

  return response.data.transfers;
}

export async function getSendTransferById(id: number): Promise<SendTransferSummary | null> {
  const response = await apiRequest<{ transfer: SendTransferSummary }>(`/api/send/transfers/${id}`);

  if (response.error || !response.data) {
    return null;
  }

  return response.data.transfer;
}

export async function startClaim(claimToken: string): Promise<ClaimSession | null> {
  const response = await apiRequest<ClaimSession>('/api/send/claim/start', {
    method: 'POST',
    body: JSON.stringify({ claimToken }),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

export async function verifyClaimOtp(
  claimSessionId: number,
  otp: string
): Promise<VerifyClaimOtpResponse | null> {
  const response = await apiRequest<VerifyClaimOtpResponse>('/api/send/claim/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ claimSessionId, otp }),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

export async function resendClaimOtp(
  claimSessionId: number
): Promise<{ success: boolean; resendCount: number; otpExpiresAt: string; resendCooldownSeconds: number } | null> {
  const response = await apiRequest<{
    success: boolean;
    resendCount: number;
    otpExpiresAt: string;
    resendCooldownSeconds: number;
  }>('/api/send/claim/resend-otp', {
    method: 'POST',
    body: JSON.stringify({ claimSessionId }),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

export async function claimPayoutDebit(
  claimSessionToken: string,
  options?: { bridgeFullName?: string; bridgeEmail?: string }
): Promise<ClaimPayoutResponse | null> {
  const response = await apiRequest<ClaimPayoutResponse>('/api/send/claim/payout/debit', {
    method: 'POST',
    body: JSON.stringify({
      claimSessionToken,
      ...(options?.bridgeFullName ? { bridgeFullName: options.bridgeFullName } : {}),
      ...(options?.bridgeEmail ? { bridgeEmail: options.bridgeEmail } : {}),
    }),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

export async function claimPayoutBank(
  claimSessionToken: string,
  options?: { bridgeFullName?: string; bridgeEmail?: string }
): Promise<ClaimPayoutResponse | null> {
  const response = await apiRequest<ClaimPayoutResponse>('/api/send/claim/payout/bank', {
    method: 'POST',
    body: JSON.stringify({
      claimSessionToken,
      ...(options?.bridgeFullName ? { bridgeFullName: options.bridgeFullName } : {}),
      ...(options?.bridgeEmail ? { bridgeEmail: options.bridgeEmail } : {}),
    }),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

export async function claimPayoutWallet(
  claimSessionToken: string,
  recipientWallet: string
): Promise<ClaimPayoutResponse | null> {
  const response = await apiRequest<ClaimPayoutResponse>('/api/send/claim/payout/wallet', {
    method: 'POST',
    body: JSON.stringify({ claimSessionToken, recipientWallet }),
  });

  if (response.error || !response.data) {
    return null;
  }

  return response.data;
}

export async function createSavingsIntent(
  payload: CreateSavingsIntentRequest
): Promise<CreateSavingsIntentResponse> {
  const response = await apiRequest<CreateSavingsIntentResponse>('/api/savings/intents/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to create savings intent.');
  }

  return response.data;
}

export async function finalizeSavingsIntent(
  intentToken: string,
  fundingTxHash: string
): Promise<FinalizeSavingsIntentResponse> {
  const response = await apiRequest<FinalizeSavingsIntentResponse>('/api/savings/intents/finalize', {
    method: 'POST',
    body: JSON.stringify({ intentToken, fundingTxHash }),
    timeout: 120000,
  });

  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to finalize savings intent.');
  }

  return response.data;
}

export async function refundSavingsIntent(
  intentToken: string
): Promise<RefundSavingsIntentResponse> {
  const response = await apiRequest<RefundSavingsIntentResponse>('/api/savings/intents/refund', {
    method: 'POST',
    body: JSON.stringify({ intentToken }),
    timeout: 120000,
  });

  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to refund savings intent.');
  }

  return response.data;
}

export interface BridgeVirtualAccount {
  available: boolean;
  bankName?: string | null;
  accountNumber?: string | null;
  routingNumber?: string | null;
  accountLast4?: string | null;
}

/** The user's Bridge virtual account (USDC funding via ACH account/routing). { available:false } if none. */
export async function getBridgeVirtualAccount(email: string): Promise<BridgeVirtualAccount> {
  const r = await apiRequest<BridgeVirtualAccount>(`/api/bridge/virtual-account?email=${encodeURIComponent(email)}`);
  return r.error || !r.data ? { available: false } : r.data;
}

// --- Fully-gasless savings (Cash USDC ↔ Savings CLRUSD) + gasless Send lock ---

export interface Eip712TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  primaryType: string;
  types: Record<string, { name: string; type: string }[]>;
  message: Record<string, string>;
}

export interface PrepareGaslessSavingsResponse {
  chainId: number;
  action: 'deposit' | 'redeem';
  vaultAddress: string;
  token: string;
  amountMicros: string;
  typedData: Eip712TypedData;
  submit: Record<string, string>;
  approve?: { token: string; spender: string };
}

export async function prepareGaslessSavings(payload: {
  action: 'deposit' | 'redeem';
  ownerWallet: string;
  amount: string;
  chainId?: number;
}): Promise<PrepareGaslessSavingsResponse> {
  const response = await apiRequest<PrepareGaslessSavingsResponse>('/api/savings/gasless/prepare', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to prepare transfer.');
  }
  return response.data;
}

export async function submitGaslessSavings(payload: {
  action: 'deposit' | 'redeem';
  chainId?: number;
  signature: string;
  submit: Record<string, string>;
}): Promise<{ success: boolean; txHash: string; chainId: number; vaultAddress: string }> {
  const response = await apiRequest<{ success: boolean; txHash: string; chainId: number; vaultAddress: string }>(
    '/api/savings/gasless/submit',
    { method: 'POST', body: JSON.stringify(payload), timeout: 120000 },
  );
  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to complete transfer.');
  }
  return response.data;
}

/** Move USDC from a linked external wallet → the Clear smart wallet (gasless, EIP-3009). Prepare the
 *  TransferWithAuthorization the linked wallet signs; the relayer submits it. */
export async function prepareWalletTransfer(payload: {
  fromWallet: string;
  amount: string;
  chainId?: number;
}): Promise<{ chainId: number; token: string; amountMicros: string; typedData: Eip712TypedData; submit: Record<string, string> }> {
  const response = await apiRequest<{ chainId: number; token: string; amountMicros: string; typedData: Eip712TypedData; submit: Record<string, string> }>(
    '/api/savings/gasless/wallet-transfer/prepare',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to prepare wallet transfer.');
  }
  return response.data;
}

export async function submitWalletTransfer(payload: {
  chainId?: number;
  signature: string;
  submit: Record<string, string>;
}): Promise<{ success: boolean; txHash: string; chainId: number }> {
  const response = await apiRequest<{ success: boolean; txHash: string; chainId: number }>(
    '/api/savings/gasless/wallet-transfer/submit',
    { method: 'POST', body: JSON.stringify(payload), timeout: 120000 },
  );
  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to complete wallet transfer.');
  }
  return response.data;
}

/** Record equity credits for an AA-submitted (client-side) savings deposit/redeem, by tx hash. */
export async function recordGaslessSavings(p: {
  action: 'deposit' | 'redeem';
  amount: string;
  txHash: string;
  chainId: number;
}): Promise<void> {
  await apiRequest('/api/savings/gasless/record', { method: 'POST', body: JSON.stringify(p) });
}

export async function prepareSendLockAuthorization(id: number): Promise<{
  transferId: string;
  chainId: number;
  escrowAddress: string;
  typedData: Eip712TypedData;
}> {
  const response = await apiRequest<{ transferId: string; chainId: number; escrowAddress: string; typedData: Eip712TypedData }>(
    `/api/send/transfers/${id}/lock-authorization`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to prepare send.');
  }
  return response.data;
}

export async function submitSendLockAuthorization(
  id: number,
  signature: string,
): Promise<{ claimUrl?: string; relayTxHash: string; transfer: SendTransferSummary }> {
  const response = await apiRequest<{ claimUrl?: string; relayTxHash: string; transfer: SendTransferSummary }>(
    `/api/send/transfers/${id}/submit-authorization`,
    { method: 'POST', body: JSON.stringify({ signature }), timeout: 120000 },
  );
  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to complete send.');
  }
  return response.data;
}

/**
 * Check server health (uses cached version to avoid race conditions)
 * @deprecated Use checkServerHealthCached from serverHealth.ts instead
 */
export async function checkServerHealth(): Promise<boolean> {
  // Import dynamically to avoid circular dependencies
  const { checkServerHealthCached } = await import('./serverHealth.js');
  return checkServerHealthCached();
}

export type MemberStatus =
  | 'ONBOARDING'
  | 'BASIC_ACTIVE'
  | 'VERIFICATION_ELIGIBLE'
  | 'VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'RESTRICTED';

export type MemberVerificationStatus =
  | 'NOT_STARTED'
  | 'ELIGIBLE'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESTRICTED';

export type MemberMembershipStatus = 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type MemberMembershipPlan = 'YEARLY' | 'LIFETIME' | null;

export interface MemberRecordResponse {
  id: number;
  authSubject: string;
  primaryWallet: string;
  reownProfileUuid: string | null;
  status: MemberStatus;
  verificationStatus: MemberVerificationStatus;
  membershipPlan: MemberMembershipPlan;
  membershipStatus: MemberMembershipStatus;
  residencyCountry: string | null;
  settlementCurrency: string | null;
  membershipRegistryMemberId: number | null;
  membershipChainId: number | null;
  membershipTxHash: string | null;
  membershipSyncedAt: string | null;
  membershipMetadataHash: string | null;
  createdAt: string;
  updatedAt: string;
  lastAuthenticatedAt: string;
}

export interface MemberPublicProfileResponse {
  username: string | null;
  displayName: string | null;
  bio: string | null;
  timezone: string | null;
  locale: string | null;
  avatarUrl: string | null;
  notificationsOptIn: boolean;
  updatedAt: string;
}

export interface MemberPrivateProfileResponse {
  legalName: string | null;
  email: string | null;
  phone: string | null;
  cityRegion: string | null;
}

export interface MemberProfileViewResponse {
  publicProfile: MemberPublicProfileResponse;
  privateProfile: MemberPrivateProfileResponse | null;
  privateProfileExists: boolean;
  privateProfileLocked: boolean;
}

export interface MemberOnboardingResponse {
  currentStep: string;
  accessTrack: string;
  accountMethod: string;
  identityModeSelected: string;
  referralSource: string | null;
  inviteCode: string | null;
  incomeSource: string | null;
  reasons: string[];
  goalsNote: string | null;
  recoveryMethod: string | null;
  cardWaitlist: boolean;
  localPools: boolean;
  draftStatus: 'in_progress' | 'submitted' | 'complete';
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface MemberSecuritySettingsResponse {
  signatureLock: boolean;
  sessionReview: boolean;
  biometricAccess: boolean;
  socialDiscovery: boolean;
  transferAlerts: boolean;
  updatedAt: string;
}

export interface MemberVerificationSummaryResponse {
  status: MemberVerificationStatus;
  provider: string | null;
  verificationLevel: string | null;
  providerCustomerId: string | null;
  providerCaseId: string | null;
  requirements: unknown;
  resultSummary: unknown;
  submittedAt: string | null;
  decidedAt: string | null;
  updatedAt: string | null;
}

export interface MemberWalletResponse {
  id: number;
  walletAddress: string;
  label: string | null;
  description: string | null;
  kind: 'PRIMARY' | 'HARDWARE' | 'SMART' | 'EMBEDDED';
  status: 'ACTIVE' | 'REMOVED';
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberWalletLinkChallengeResponse {
  id: number;
  walletAddress: string;
  label: string | null;
  description: string | null;
  kind: 'PRIMARY' | 'HARDWARE' | 'SMART' | 'EMBEDDED';
  message: string;
  expiresAt: string;
  createdAt: string;
}

export interface MemberWalletLinkHandoffResponse {
  token: string;
  label: string | null;
  description: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface MemberSocialAccountResponse {
  id: number;
  platform: string;
  handle: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  status: 'CONNECTED' | 'PENDING' | 'REMOVED';
  createdAt: string;
  updatedAt: string;
}

export interface MemberCapabilitiesResponse {
  canEditProfile: boolean;
  canJoinWaitlists: boolean;
  canStartVerification: boolean;
  canUsePlaid: boolean;
  canUseBridge: boolean;
  canAccessDirectDeposit: boolean;
  canAccessCard: boolean;
  canUseRegulatedTransfers: boolean;
}

export interface MemberTermsSummaryItemResponse {
  documentType: string;
  documentVersion: string;
  acceptedAt: string;
}

export interface MemberBillingCustomerResponse {
  memberId: number;
  stripeCustomerId: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberBillingCheckoutSessionResponse {
  memberId: number;
  stripeSessionId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: 'YEARLY' | 'LIFETIME';
  mode: 'payment' | 'subscription';
  status: string | null;
  paymentStatus: string | null;
  checkoutUrl: string | null;
  createdAt: string;
  completedAt: string | null;
  payload: unknown;
}

export interface MemberBillingSubscriptionResponse {
  memberId: number;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  plan: 'YEARLY' | 'LIFETIME';
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastInvoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberBillingPaymentResponse {
  id: number;
  memberId: number;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripeCheckoutSessionId: string | null;
  plan: 'YEARLY' | 'LIFETIME';
  amountTotal: number | null;
  currency: string | null;
  status: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface MemberBillingSummaryResponse {
  customer: MemberBillingCustomerResponse | null;
  latestCheckoutSession: MemberBillingCheckoutSessionResponse | null;
  subscription: MemberBillingSubscriptionResponse | null;
  latestPayment: MemberBillingPaymentResponse | null;
}

export interface MemberAccountCenterResponse {
  member: MemberRecordResponse;
  profile: MemberProfileViewResponse;
  onboarding: MemberOnboardingResponse;
  security: MemberSecuritySettingsResponse;
  verification: MemberVerificationSummaryResponse;
  wallets: MemberWalletResponse[];
  socialAccounts: MemberSocialAccountResponse[];
  capabilities: MemberCapabilitiesResponse;
  terms: MemberTermsSummaryItemResponse[];
}

export async function bootstrapMemberAccount(): Promise<{
  member: MemberRecordResponse;
  onboarding: MemberOnboardingResponse;
  capabilities: MemberCapabilitiesResponse;
} | null> {
  const response = await apiRequest<{
    member: MemberRecordResponse;
    onboarding: MemberOnboardingResponse;
    capabilities: MemberCapabilitiesResponse;
  }>('/api/members/me/bootstrap', {
    method: 'PUT',
    body: JSON.stringify({}),
  });

  if (response.error || !response.data) return null;
  return response.data;
}

/** Save my XMTP messaging address (the embedded EOA) so peers can resolve it from my wallet. */
export async function saveMyXmtpAddress(xmtpAddress: string): Promise<boolean> {
  const r = await apiRequest<{ ok: boolean }>('/api/members/me/xmtp-address', {
    method: 'POST',
    body: JSON.stringify({ xmtpAddress }),
  });
  return !r.error;
}

/** Resolve a member's XMTP messaging address (embedded EOA) from a wallet address, for starting a DM. */
export async function resolveXmtpAddress(walletAddress: string): Promise<string | null> {
  const r = await apiRequest<{ xmtpAddress: string | null }>(`/api/members/xmtp-address/${walletAddress.toLowerCase()}`);
  return r.error || !r.data ? null : r.data.xmtpAddress;
}

export async function getMemberAccountCenter(): Promise<MemberAccountCenterResponse | null> {
  const response = await apiRequest<MemberAccountCenterResponse>('/api/members/me/account-center');
  if (response.error || !response.data) return null;
  return response.data;
}

export async function getMemberCapabilities(): Promise<MemberCapabilitiesResponse | null> {
  const response = await apiRequest<{ capabilities: MemberCapabilitiesResponse }>('/api/members/me/capabilities');
  if (response.error || !response.data) return null;
  return response.data.capabilities;
}

export async function updateMemberOnboarding(
  payload: Partial<{
    currentStep: string | null;
    accessTrack: string | null;
    accountMethod: string | null;
    identityModeSelected: string | null;
    referralSource: string | null;
    inviteCode: string | null;
    incomeSource: string | null;
    reasons: string[] | null;
    goalsNote: string | null;
    recoveryMethod: string | null;
    residencyCountry: string | null;
    settlementCurrency: string | null;
    membershipPlan: MemberMembershipPlan;
    cardWaitlist: boolean;
    localPools: boolean;
  }>
): Promise<{ onboarding: MemberOnboardingResponse; capabilities: MemberCapabilitiesResponse | null } | null> {
  const response = await apiRequest<{
    onboarding: MemberOnboardingResponse;
    capabilities: MemberCapabilitiesResponse | null;
  }>('/api/members/me/onboarding', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

export async function submitMemberOnboarding(): Promise<MemberAccountCenterResponse | null> {
  const response = await apiRequest<MemberAccountCenterResponse>('/api/members/me/onboarding/submit', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

export async function updateMemberProfile(
  payload: Partial<{
    username: string | null;
    displayName: string | null;
    bio: string | null;
    timezone: string | null;
    locale: string | null;
    avatarUrl: string | null;
    notificationsOptIn: boolean;
    residencyCountry: string | null;
    settlementCurrency: string | null;
    legalName: string | null;
    email: string | null;
    phone: string | null;
    cityRegion: string | null;
  }>
): Promise<{ profile: MemberProfileViewResponse; capabilities: MemberCapabilitiesResponse | null } | null> {
  const response = await apiRequest<{
    profile: MemberProfileViewResponse;
    capabilities: MemberCapabilitiesResponse | null;
  }>('/api/members/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

/** Upload the member's avatar (compressed data URL). Returns the served avatar URL. */
export async function uploadMemberAvatar(dataUrl: string): Promise<{ avatarUrl: string } | null> {
  const response = await apiRequest<{ avatarUrl: string }>('/api/members/me/avatar', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

export async function deleteMemberAvatar(): Promise<boolean> {
  const response = await apiRequest<{ ok: boolean }>('/api/members/me/avatar', { method: 'DELETE' });
  return !response.error;
}

export async function updateMemberSecurity(
  payload: Partial<{
    signatureLock: boolean;
    sessionReview: boolean;
    biometricAccess: boolean;
    socialDiscovery: boolean;
    transferAlerts: boolean;
  }>
): Promise<MemberSecuritySettingsResponse | null> {
  const response = await apiRequest<{ security: MemberSecuritySettingsResponse }>('/api/members/me/security', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) return null;
  return response.data.security;
}

export async function acceptMemberTerms(documentType: string, documentVersion: string): Promise<{
  terms: MemberTermsSummaryItemResponse[];
  capabilities: MemberCapabilitiesResponse | null;
} | null> {
  const response = await apiRequest<{
    terms: MemberTermsSummaryItemResponse[];
    capabilities: MemberCapabilitiesResponse | null;
  }>('/api/members/me/terms/accept', {
    method: 'POST',
    body: JSON.stringify({ documentType, documentVersion }),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

export async function createMemberWallet(payload: {
  label?: string | null;
  description?: string | null;
  walletAddress: string;
  kind?: 'PRIMARY' | 'HARDWARE' | 'SMART' | 'EMBEDDED';
  status?: 'ACTIVE' | 'REMOVED';
}): Promise<MemberWalletResponse[] | null> {
  const response = await apiRequest<{ wallets: MemberWalletResponse[] }>('/api/members/me/wallets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) return null;
  return response.data.wallets;
}

export async function createMemberWalletLinkHandoff(payload: {
  label: string;
  description?: string | null;
}): Promise<MemberWalletLinkHandoffResponse | null> {
  const response = await apiRequest<{ handoff: MemberWalletLinkHandoffResponse }>(
    '/api/members/me/wallet-link-handoffs',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  if (response.error || !response.data) return null;
  return response.data.handoff;
}

export async function updateMemberWallet(
  walletId: number,
  payload: Partial<{
    label: string | null;
    description: string | null;
    walletAddress: string | null;
    kind: 'PRIMARY' | 'HARDWARE' | 'SMART' | 'EMBEDDED';
    status: 'ACTIVE' | 'REMOVED';
  }>
): Promise<MemberWalletResponse[] | null> {
  const response = await apiRequest<{ wallets: MemberWalletResponse[] }>(`/api/members/me/wallets/${walletId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) return null;
  return response.data.wallets;
}

export async function deleteMemberWallet(walletId: number): Promise<MemberWalletResponse[] | null> {
  const response = await apiRequest<{ wallets: MemberWalletResponse[] }>(`/api/members/me/wallets/${walletId}`, {
    method: 'DELETE',
  });
  if (response.error || !response.data) return null;
  return response.data.wallets;
}

export async function createMemberWalletLinkChallenge(payload: {
  walletAddress: string;
  label?: string | null;
  description?: string | null;
  kind?: 'PRIMARY' | 'HARDWARE' | 'SMART' | 'EMBEDDED';
}): Promise<MemberWalletLinkChallengeResponse | null> {
  const response = await apiRequest<{ challenge: MemberWalletLinkChallengeResponse }>(
    '/api/members/me/wallet-links/challenge',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  if (response.error || !response.data) return null;
  return response.data.challenge;
}

export async function prepareMemberWalletLinkHandoff(payload: {
  token: string;
  walletAddress: string;
}): Promise<{
  message: string;
  handoff: Omit<MemberWalletLinkHandoffResponse, 'token'>;
} | null> {
  const response = await apiRequest<{
    message: string;
    handoff: Omit<MemberWalletLinkHandoffResponse, 'token'>;
  }>('/api/member-links/wallet-link-handoffs/prepare', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) return null;
  return response.data;
}

export async function completeMemberWalletLinkHandoff(payload: {
  token: string;
  walletAddress: string;
  signature: string;
  kind?: 'PRIMARY' | 'HARDWARE' | 'SMART' | 'EMBEDDED';
}): Promise<MemberWalletResponse[] | null> {
  const response = await apiRequest<{ wallets: MemberWalletResponse[] }>(
    '/api/member-links/wallet-link-handoffs/complete',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  if (response.error || !response.data) return null;
  return response.data.wallets;
}

export async function verifyMemberWalletLink(payload: {
  challengeId: number;
  signature: string;
}): Promise<MemberWalletResponse[] | null> {
  const response = await apiRequest<{ wallets: MemberWalletResponse[] }>(
    '/api/members/me/wallet-links/verify',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  if (response.error || !response.data) return null;
  return response.data.wallets;
}

export async function createMemberSocialAccount(payload: {
  platform: string;
  handle: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
  status?: 'CONNECTED' | 'PENDING' | 'REMOVED';
}): Promise<MemberSocialAccountResponse[] | null> {
  const response = await apiRequest<{ socialAccounts: MemberSocialAccountResponse[] }>('/api/members/me/socials', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) return null;
  return response.data.socialAccounts;
}

export async function updateMemberSocialAccount(
  socialId: number,
  payload: Partial<{
    platform: string | null;
    handle: string | null;
    visibility: 'PUBLIC' | 'PRIVATE';
    status: 'CONNECTED' | 'PENDING' | 'REMOVED';
  }>
): Promise<MemberSocialAccountResponse[] | null> {
  const response = await apiRequest<{ socialAccounts: MemberSocialAccountResponse[] }>(`/api/members/me/socials/${socialId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (response.error || !response.data) return null;
  return response.data.socialAccounts;
}

export async function deleteMemberSocialAccount(socialId: number): Promise<MemberSocialAccountResponse[] | null> {
  const response = await apiRequest<{ socialAccounts: MemberSocialAccountResponse[] }>(`/api/members/me/socials/${socialId}`, {
    method: 'DELETE',
  });
  if (response.error || !response.data) return null;
  return response.data.socialAccounts;
}

export async function getMemberMembershipSummary(): Promise<{
  member: MemberRecordResponse;
  billing: MemberBillingSummaryResponse;
} | null> {
  const response = await apiRequest<{
    member: MemberRecordResponse;
    billing: MemberBillingSummaryResponse;
  }>('/api/members/me/membership');
  if (response.error || !response.data) return null;
  return response.data;
}

export async function createMemberMembershipCheckout(payload: {
  plan: 'YEARLY' | 'LIFETIME';
  successUrl: string;
  cancelUrl: string;
}): Promise<{
  session: { url: string; sessionId: string };
  billing: MemberBillingSummaryResponse | null;
} | null> {
  const response = await apiRequest<{
    session: { url: string; sessionId: string };
    billing: MemberBillingSummaryResponse | null;
  }>('/api/members/me/membership/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (response.error) {
    throw new Error(response.error);
  }
  if (!response.data) return null;
  return response.data;
}

// ---- Clear Pay (rent/bill → equity-credit ledger) ----

export type PayBillerType = 'rent' | 'utility' | 'subscription' | 'card' | 'phone' | 'other';

export interface PayBiller {
  id: string;
  name: string;
  payee: string | null;
  type: PayBillerType;
  defaultAmount: number;
  dueDay: number | null;
  source: 'manual' | 'plaid';
  plaidStreamId: string | null;
  payable: boolean;
  payoutLast4: string | null;
  payoutBank: string | null;
  bridgeExternalAccountId: string | null;
}

export interface PaySummary {
  dueThisMonth: number;
  paid30: number;
  totalEquity: number;
  vestedEquity: number;
  pendingEquity: number;
  equityThisMonth: number;
  streak: number;
  sources: { match: number; rent: number; bills: number };
  series: { label: string; rent: number; equity: number }[];
}

export async function getPaySummary(wallet: string): Promise<PaySummary | null> {
  const r = await apiRequest<PaySummary>(`/api/pay/${wallet.toLowerCase()}/summary`);
  return r.error || !r.data ? null : r.data;
}

export async function getPayBillers(wallet: string): Promise<PayBiller[]> {
  const r = await apiRequest<{ billers: PayBiller[] }>(`/api/pay/${wallet.toLowerCase()}/billers`);
  return r.error || !r.data ? [] : r.data.billers;
}

export async function addPayBiller(
  wallet: string,
  b: { name: string; payee?: string; type: PayBillerType; defaultAmount: number; dueDay?: number | null },
): Promise<PayBiller | null> {
  const r = await apiRequest<{ biller: PayBiller }>(`/api/pay/${wallet.toLowerCase()}/billers`, { method: 'POST', body: JSON.stringify(b) });
  return r.error || !r.data ? null : r.data.biller;
}

export async function updatePayBiller(
  wallet: string,
  id: string,
  b: { name: string; payee?: string; type: PayBillerType; defaultAmount: number; dueDay?: number | null },
): Promise<PayBiller | null> {
  const r = await apiRequest<{ biller: PayBiller }>(`/api/pay/${wallet.toLowerCase()}/billers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(b),
  });
  return r.error || !r.data ? null : r.data.biller;
}

export async function setPayBillerPayout(
  wallet: string,
  id: string,
  p: { accountNumber: string; routingNumber: string; bankName?: string },
): Promise<PayBiller | null> {
  const r = await apiRequest<{ biller: PayBiller }>(`/api/pay/${wallet.toLowerCase()}/billers/${id}/payout`, {
    method: 'POST',
    body: JSON.stringify(p),
  });
  return r.error || !r.data ? null : r.data.biller;
}

export async function payBiller(
  wallet: string,
  p: { billerId: string; amount: number; source?: 'usdc' | 'bank'; email?: string },
): Promise<{ success: boolean; providerReference?: string; status?: string; message?: string }> {
  const r = await apiRequest<{ success: boolean; providerReference?: string; status?: string }>(
    `/api/pay/${wallet.toLowerCase()}/pay`,
    { method: 'POST', body: JSON.stringify(p), timeout: 120000 },
  );
  if (r.error || !r.data) return { success: false, message: r.error || 'Payment failed.' };
  return r.data;
}

// --- Autopay (recurring gasless Cash→Savings deposits via a ZeroDev session) ---

export interface AutopayRule {
  id: string;
  wallet: string;
  chainId: number;
  kind: 'savings_deposit';
  amountUsdc: number;
  cadence: 'weekly' | 'monthly';
  nextRunAt: string;
  runsLeft: number | null;
  status: 'active' | 'paused' | 'cancelled' | 'exhausted' | 'expired';
  lastRunAt: string | null;
  lastTx: string | null;
  lastError: string | null;
  createdAt: string;
}

export async function listAutopayRules(wallet: string): Promise<AutopayRule[]> {
  const r = await apiRequest<{ rules: AutopayRule[] }>(`/api/autopay/${wallet.toLowerCase()}`);
  return r.error || !r.data ? [] : r.data.rules;
}

export interface AutopayMandate {
  depositor: string;
  token: string;
  amountPerRun: string;
  interval: number;
  maxRuns: number;
  startAt: number;
  expiry: number;
  nonce: string;
  signature: string;
}

export async function createAutopayRule(
  wallet: string,
  p: {
    chainId: number;
    amountUsdc: number;
    cadence: 'weekly' | 'monthly';
    runs?: number;
    mandate: AutopayMandate;
    permit?: { value: string; deadline: number; v: number; r: string; s: string };
  },
): Promise<AutopayRule> {
  const r = await apiRequest<{ rule: AutopayRule }>(`/api/autopay/${wallet.toLowerCase()}`, {
    method: 'POST',
    body: JSON.stringify(p),
  });
  if (r.error || !r.data) throw new Error(r.error || 'Could not set up Auto-save.');
  return r.data.rule;
}

export async function cancelAutopayRule(wallet: string, id: string): Promise<boolean> {
  const r = await apiRequest<{ ok: boolean }>(`/api/autopay/${wallet.toLowerCase()}/${id}`, { method: 'DELETE' });
  return !r.error;
}

/** Execute one autopay deposit immediately (verification / "run now"). */
export async function runAutopayRule(
  wallet: string,
  id: string,
): Promise<{ ok: boolean; txHash?: string; message?: string }> {
  const r = await apiRequest<{ ok: boolean; txHash?: string }>(`/api/autopay/${wallet.toLowerCase()}/${id}/run`, {
    method: 'POST',
    timeout: 120000,
  });
  if (r.error || !r.data) return { ok: false, message: r.error || 'Run failed.' };
  return r.data;
}

/** Withdraw (cash-out): USDC on Base → a Plaid-linked bank via Bridge off-ramp. */
export async function withdrawToBank(
  wallet: string,
  p: { amount: number; plaidAccountId: string; email?: string },
): Promise<{ success: boolean; providerReference?: string; status?: string; message?: string }> {
  const r = await apiRequest<{ success: boolean; providerReference?: string; status?: string }>(
    `/api/withdraw/${wallet.toLowerCase()}`,
    { method: 'POST', body: JSON.stringify(p), timeout: 120000 },
  );
  if (r.error || !r.data) return { success: false, message: r.error || 'Withdrawal failed.' };
  return r.data;
}

export async function deletePayBiller(wallet: string, id: string): Promise<boolean> {
  const r = await apiRequest<{ ok: boolean }>(`/api/pay/${wallet.toLowerCase()}/billers/${id}`, { method: 'DELETE' });
  return !r.error;
}

export async function syncPlaidBillers(
  wallet: string,
  streams: { streamId: string; name: string; amount: number; dueDay: number; type: PayBillerType }[],
): Promise<PayBiller[]> {
  const r = await apiRequest<{ billers: PayBiller[] }>(`/api/pay/${wallet.toLowerCase()}/billers/plaid`, {
    method: 'POST',
    body: JSON.stringify({ streams }),
  });
  return r.error || !r.data ? [] : r.data.billers;
}

export async function recordPayment(
  wallet: string,
  payment: { billerId?: string | null; name: string; type: PayBillerType; amount: number; dueDate?: string | null; period: string; source?: 'in_app' | 'detected'; txRef?: string | null },
): Promise<{ creditAwarded: number; onTime: boolean; duplicate: boolean } | null> {
  const r = await apiRequest<{ creditAwarded: number; onTime: boolean; duplicate: boolean }>(`/api/pay/${wallet.toLowerCase()}/payments`, {
    method: 'POST',
    body: JSON.stringify(payment),
  });
  return r.error || !r.data ? null : r.data;
}

/** Detect on-time recurring-bill payments from Plaid + accrue credits; returns the fresh summary. */
export async function reconcilePay(wallet: string): Promise<PaySummary | null> {
  const r = await apiRequest<PaySummary>(`/api/pay/${wallet.toLowerCase()}/reconcile`, { method: 'POST' });
  return r.error || !r.data ? null : r.data;
}

// ---- Contacts + member directory ----

export interface ApiContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  wallet: string | null;
}

export async function getContacts(wallet: string): Promise<ApiContact[]> {
  const r = await apiRequest<{ contacts: ApiContact[] }>(`/api/contacts/${wallet.toLowerCase()}`);
  return r.error || !r.data ? [] : r.data.contacts;
}

export async function addContactApi(
  wallet: string,
  c: { name: string; email?: string | null; phone?: string | null; wallet?: string | null },
): Promise<ApiContact | null> {
  const r = await apiRequest<{ contact: ApiContact }>(`/api/contacts/${wallet.toLowerCase()}`, { method: 'POST', body: JSON.stringify(c) });
  return r.error || !r.data ? null : r.data.contact;
}

export async function updateContactApi(
  wallet: string,
  id: string,
  c: { name?: string; email?: string | null; phone?: string | null; wallet?: string | null },
): Promise<ApiContact | null> {
  const r = await apiRequest<{ contact: ApiContact }>(`/api/contacts/${wallet.toLowerCase()}/${id}`, { method: 'PATCH', body: JSON.stringify(c) });
  return r.error || !r.data ? null : r.data.contact;
}

export async function deleteContactApi(wallet: string, id: string): Promise<boolean> {
  const r = await apiRequest<{ ok: boolean }>(`/api/contacts/${wallet.toLowerCase()}/${id}`, { method: 'DELETE' });
  return !r.error;
}

// ---- In-app notifications (persistent, wallet-scoped) ----
export interface ApiNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}
export async function getNotifications(wallet: string): Promise<{ notifications: ApiNotification[]; unreadCount: number }> {
  const r = await apiRequest<{ notifications: ApiNotification[]; unreadCount: number }>(`/api/notifications/${wallet.toLowerCase()}`);
  return r.error || !r.data ? { notifications: [], unreadCount: 0 } : r.data;
}
export async function markNotificationRead(wallet: string, id: string): Promise<void> {
  await apiRequest(`/api/notifications/${wallet.toLowerCase()}/${id}/read`, { method: 'POST' });
}
export async function markAllNotificationsRead(wallet: string): Promise<void> {
  await apiRequest(`/api/notifications/${wallet.toLowerCase()}/read-all`, { method: 'POST' });
}
export async function archiveNotificationApi(wallet: string, id: string): Promise<void> {
  await apiRequest(`/api/notifications/${wallet.toLowerCase()}/${id}/archive`, { method: 'POST' });
}
export async function savePushSubscription(wallet: string, subscription: unknown): Promise<void> {
  await apiRequest(`/api/notifications/${wallet.toLowerCase()}/subscribe`, { method: 'POST', body: JSON.stringify({ subscription }) });
}

/** Request money from a Clear member — server resolves them by email/phone and notifies them. */
export async function createPaymentRequest(input: { recipientEmail?: string; recipientPhone?: string; amount: number; note?: string }): Promise<boolean> {
  const r = await apiRequest<{ ok: boolean }>('/api/requests', { method: 'POST', body: JSON.stringify(input) });
  return !r.error;
}
/** Send yourself a test notification (verifies the in-app + push pipeline). */
export async function sendTestNotification(wallet: string): Promise<boolean> {
  const r = await apiRequest<{ ok: boolean }>(`/api/notifications/${wallet.toLowerCase()}/test`, { method: 'POST' });
  return !r.error;
}

/** Directory lookup: resolve a wallet from a known email/phone (exact match, opt-out aware). */
export async function lookupDirectory(
  wallet: string,
  q: { email?: string; phone?: string },
): Promise<{ wallet: string | null; matchedOn?: 'email' | 'phone' }> {
  const params = new URLSearchParams();
  if (q.email) params.set('email', q.email);
  if (q.phone) params.set('phone', q.phone);
  const r = await apiRequest<{ wallet: string | null; matchedOn?: 'email' | 'phone' }>(
    `/api/contacts/${wallet.toLowerCase()}/lookup?${params.toString()}`,
  );
  return r.error || !r.data ? { wallet: null } : r.data;
}

/** Directory reverse-lookup: wallet addresses → member display names ({ lowercasedWallet: name }). */
export async function lookupDirectoryNames(wallet: string, wallets: string[]): Promise<Record<string, string>> {
  const list = wallets.map((w) => w.trim()).filter(Boolean);
  if (list.length === 0) return {};
  const params = new URLSearchParams({ wallets: list.join(',') });
  const r = await apiRequest<{ names: Record<string, string> }>(
    `/api/contacts/${wallet.toLowerCase()}/names?${params.toString()}`,
  );
  return r.error || !r.data ? {} : r.data.names;
}

export async function getDirectoryOptout(wallet: string): Promise<boolean> {
  const r = await apiRequest<{ optedOut: boolean }>(`/api/contacts/${wallet.toLowerCase()}/optout`);
  return r.error || !r.data ? false : r.data.optedOut;
}

export async function setDirectoryOptout(wallet: string, optout: boolean): Promise<boolean> {
  const r = await apiRequest<{ optedOut: boolean }>(`/api/contacts/${wallet.toLowerCase()}/optout`, { method: 'PUT', body: JSON.stringify({ optout }) });
  return r.error || !r.data ? optout : r.data.optedOut;
}

// ---- Onramper (fiat → USDC on-ramp) ----

export interface OnramperQuote {
  ramp: string; // provider id
  payout: number; // USDC received (≈ USD)
  paymentMethod?: string;
  networkFee?: number;
  transactionFee?: number;
  rate?: number;
  [k: string]: unknown;
}

/** Aggregated buy quotes (card/Apple Pay) for a fiat amount → USDC on Base. */
export async function getOnramperQuotes(p: {
  amount: number;
  paymentMethod: string;
  walletAddress?: string;
  fiat?: string;
  crypto?: string;
  country?: string;
}): Promise<OnramperQuote[]> {
  const params = new URLSearchParams({ amount: String(p.amount), paymentMethod: p.paymentMethod, country: p.country || 'us' });
  if (p.walletAddress) params.set('walletAddress', p.walletAddress);
  if (p.fiat) params.set('fiat', p.fiat);
  if (p.crypto) params.set('crypto', p.crypto);
  const r = await apiRequest<unknown>(`/api/onramper/quotes?${params.toString()}`);
  const d = r.data as { message?: unknown; quotes?: unknown } | unknown[] | null;
  const arr = Array.isArray(d) ? d : Array.isArray((d as any)?.message) ? (d as any).message : Array.isArray((d as any)?.quotes) ? (d as any).quotes : [];
  return arr as OnramperQuote[];
}

/** Create an Onramper checkout intent → returns the provider checkout URL to redirect to. */
export async function createOnramperCheckout(p: {
  onramp: string;
  amount: number;
  paymentMethod: string;
  walletAddress: string;
  fiat?: string;
  crypto?: string;
  network?: string;
  country?: string;
}): Promise<{ url: string | null }> {
  const r = await apiRequest<{ url: string | null }>(`/api/onramper/checkout`, { method: 'POST', body: JSON.stringify(p) });
  return r.error || !r.data ? { url: null } : r.data;
}

/** Aggregated SELL (off-ramp) quotes: USDC on Base → fiat, payout to a debit card. */
export async function getOnramperSellQuotes(p: {
  amount: number;
  paymentMethod: string;
  walletAddress?: string;
  fiat?: string;
  crypto?: string;
  country?: string;
}): Promise<OnramperQuote[]> {
  const params = new URLSearchParams({ amount: String(p.amount), paymentMethod: p.paymentMethod, country: p.country || 'us' });
  if (p.walletAddress) params.set('walletAddress', p.walletAddress);
  if (p.fiat) params.set('fiat', p.fiat);
  if (p.crypto) params.set('crypto', p.crypto);
  const r = await apiRequest<unknown>(`/api/onramper/sell-quotes?${params.toString()}`);
  const d = r.data as { message?: unknown; quotes?: unknown } | unknown[] | null;
  const arr = Array.isArray(d) ? d : Array.isArray((d as any)?.message) ? (d as any).message : Array.isArray((d as any)?.quotes) ? (d as any).quotes : [];
  return arr as OnramperQuote[];
}

/** Create an Onramper SELL intent → returns the provider URL to complete the cash-out to a debit card. */
export async function createOnramperSellCheckout(p: {
  onramp: string;
  amount: number;
  paymentMethod: string;
  walletAddress: string;
  fiat?: string;
  crypto?: string;
  network?: string;
  country?: string;
}): Promise<{ url: string | null }> {
  const r = await apiRequest<{ url: string | null }>(`/api/onramper/sell-checkout`, { method: 'POST', body: JSON.stringify(p) });
  return r.error || !r.data ? { url: null } : r.data;
}

// ---- Unified ramp (Coinbase Onramp by default; Onramper as an env-selected fallback) ----
// The backend picks the provider (RAMP_PROVIDER); the client just calls /api/ramp/* and gets a
// normalized quote + a hosted checkout URL, so switching providers is a server-side env flip.

export interface RampQuote {
  provider: string;
  fiatAmount: number; // total the user pays (buy) incl. fees
  fiatSubtotal: number;
  cryptoAmount?: number; // USDC received
  coinbaseFee?: number;
  networkFee?: number;
  quoteId?: string;
  asset: string;
  network: string;
}

/** Normalized buy quote (card / Apple Pay → USDC on Base). */
export async function getRampBuyQuote(p: {
  amount: number;
  paymentMethod: string;
  walletAddress?: string;
  country?: string;
  subdivision?: string;
}): Promise<RampQuote | null> {
  const params = new URLSearchParams({ amount: String(p.amount), paymentMethod: p.paymentMethod, country: p.country || 'us' });
  if (p.walletAddress) params.set('walletAddress', p.walletAddress);
  if (p.subdivision) params.set('subdivision', p.subdivision);
  const r = await apiRequest<{ quote: RampQuote | null }>(`/api/ramp/buy/quote?${params.toString()}`);
  return r.error || !r.data ? null : r.data.quote;
}

export interface RampSellStatus {
  status: string | null; // TRANSACTION_STATUS_STARTED | _SUCCESS | _FAILED
  toAddress?: string | null; // Coinbase address to send USDC to (when STARTED)
  amount?: string | null; // sell_amount.value
  currency?: string | null;
  asset?: string | null;
  network?: string | null;
}

/** Start an off-ramp cash-out → { url, partnerUserRef }. Poll getRampSellStatus after the user confirms. */
export async function createRampSellSession(p: { walletAddress: string; redirectUrl?: string }): Promise<{ url: string | null; partnerUserRef: string | null }> {
  const r = await apiRequest<{ url: string | null; partnerUserRef: string | null }>(`/api/ramp/sell/session`, { method: 'POST', body: JSON.stringify(p) });
  return r.error || !r.data ? { url: null, partnerUserRef: null } : r.data;
}

/** Poll an off-ramp transaction's status. On STARTED it returns the toAddress + amount of USDC to send. */
export async function getRampSellStatus(partnerUserRef: string): Promise<RampSellStatus> {
  const r = await apiRequest<RampSellStatus>(`/api/ramp/sell/status?partnerUserRef=${encodeURIComponent(partnerUserRef)}`);
  return r.error || !r.data ? { status: null } : r.data;
}

export interface RampBuyStatus {
  id?: string; // Coinbase transaction id — used as the notification dedupe ref (matches the webhook)
  status: string | null; // TRANSACTION_STATUS_STARTED | _SUCCESS | _FAILED
  purchaseAmount?: string | null;
  currency?: string | null;
  txHash?: string | null;
}

/** Poll an on-ramp (buy) transaction's status to confirm a deposit landed (both redirect + iframe paths). */
export async function getRampBuyStatus(partnerUserRef: string): Promise<RampBuyStatus> {
  const r = await apiRequest<RampBuyStatus>(`/api/ramp/buy/status?partnerUserRef=${encodeURIComponent(partnerUserRef)}`);
  return r.error || !r.data ? { status: null } : r.data;
}

/** Which ramp provider is active + whether it's configured (so the UI can explain an empty quote). */
export async function getRampConfig(): Promise<{ provider: string; configured: boolean }> {
  const r = await apiRequest<{ provider: string; configured: boolean }>(`/api/ramp/config`);
  return r.error || !r.data ? { provider: 'coinbase', configured: false } : r.data;
}

/** Headless buy order (Coinbase Guest Checkout) → an Apple Pay payment-link URL to embed in an iframe. */
export async function createRampBuyOrder(p: {
  amount: number;
  walletAddress: string;
  email: string;
  phone: string;
  paymentMethod?: 'GUEST_CHECKOUT_APPLE_PAY' | 'GUEST_CHECKOUT_CARD';
}): Promise<{ paymentLinkUrl: string | null; orderId?: string; error?: string; code?: string }> {
  const r = await apiRequest<{ paymentLinkUrl: string | null; orderId?: string }>(`/api/ramp/buy/order`, { method: 'POST', body: JSON.stringify(p) });
  if (r.error || !r.data) return { paymentLinkUrl: null, error: r.error || 'Order failed' };
  return { paymentLinkUrl: r.data.paymentLinkUrl, orderId: r.data.orderId };
}

/** Record a ramp order's status + fire a notification (deposit started/complete, cash-out sent, …). */
export async function rampEvent(p: {
  type: 'buy' | 'sell';
  status: 'submitted' | 'completed' | 'failed' | 'canceled';
  amount: number;
  walletAddress: string;
  ref: string;
}): Promise<void> {
  await apiRequest(`/api/ramp/event`, { method: 'POST', body: JSON.stringify(p) }).catch(() => {});
}

/** Create a buy session → hosted checkout URL to redirect the user to. */
export async function createRampBuySession(p: {
  amount: number;
  paymentMethod: string;
  walletAddress: string;
  quoteId?: string;
  redirectUrl?: string;
}): Promise<{ url: string | null }> {
  const r = await apiRequest<{ url: string | null }>(`/api/ramp/buy/session`, { method: 'POST', body: JSON.stringify(p) });
  return r.error || !r.data ? { url: null } : r.data;
}
