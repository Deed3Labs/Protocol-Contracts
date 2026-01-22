/**
 * API Client for backend server
 * 
 * This utility provides a centralized way to call the backend API
 * with automatic caching and error handling.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  cached?: boolean;
  timestamp?: number;
}

/**
 * Generic API request function
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return { data: data as T, cached: data.cached, timestamp: data.timestamp };
  } catch (error) {
    console.error(`API request error for ${endpoint}:`, error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
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
 */
export async function getNFTs(
  chainId: number,
  address: string,
  contractAddress?: string
): Promise<{ nfts: any[]; cached: boolean } | null> {
  const query = contractAddress ? `?contractAddress=${contractAddress}` : '';
  const response = await apiRequest<{ nfts: any[]; cached: boolean }>(
    `/api/nfts/${chainId}/${address}${query}`
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
  const response = await apiRequest<{
    results: Array<{ chainId: number; address: string; nfts: any[]; cached: boolean; error?: string }>;
  }>('/api/nfts/batch', {
    method: 'POST',
    body: JSON.stringify({ requests }),
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
 * Check server health (uses cached version to avoid race conditions)
 * @deprecated Use checkServerHealthCached from serverHealth.ts instead
 */
export async function checkServerHealth(): Promise<boolean> {
  // Import dynamically to avoid circular dependencies
  const { checkServerHealthCached } = await import('./serverHealth.js');
  return checkServerHealthCached();
}
