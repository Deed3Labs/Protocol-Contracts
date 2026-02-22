/**
 * API Client for backend server
 * 
 * This utility provides a centralized way to call the backend API
 * with automatic caching and error handling.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const SIWX_AUTH_TOKEN_KEY = '@appkit/siwx-auth-token';
const REOWN_PROJECT_ID = import.meta.env.VITE_APPKIT_PROJECT_ID || '';
const SEND_REOWN_PROJECT_HEADER = import.meta.env.VITE_SEND_REOWN_PROJECT_HEADER === 'true';

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

function getSiwxAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SIWX_AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
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
    const siwxToken = getSiwxAuthToken();
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      signal: timeoutController.signal, // Use timeout signal (user signal will be ignored if provided)
      headers: {
        'Content-Type': 'application/json',
        ...(siwxToken ? { Authorization: `Bearer ${siwxToken}` } : {}),
        ...(SEND_REOWN_PROJECT_HEADER && REOWN_PROJECT_ID
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
  }>('/api/token-balances/portfolio', {
    method: 'POST',
    body: JSON.stringify({
      requests,
      withMetadata: options.withMetadata ?? true,
      withPrices: options.withPrices ?? true,
      includeNativeTokens: options.includeNativeTokens ?? true,
      includeErc20Tokens: options.includeErc20Tokens ?? true,
    }),
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
  if (response.error) return null;
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

/**
 * Check server health (uses cached version to avoid race conditions)
 * @deprecated Use checkServerHealthCached from serverHealth.ts instead
 */
export async function checkServerHealth(): Promise<boolean> {
  // Import dynamically to avoid circular dependencies
  const { checkServerHealthCached } = await import('./serverHealth.js');
  return checkServerHealthCached();
}
