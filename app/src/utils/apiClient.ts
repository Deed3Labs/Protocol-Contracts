/**
 * API Client for backend server
 * 
 * This utility provides a centralized way to call the backend API
 * with automatic caching and error handling.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

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

/**
 * Generic API request function
 * Handles errors gracefully, including HTML responses (server down, wrong endpoint, etc.)
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

    // Check if response is actually JSON before trying to parse
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      // Try to parse error as JSON, but handle HTML/other responses
      if (isJson) {
        try {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
        } catch (parseError) {
          // If JSON parsing fails, it's likely HTML or other non-JSON response
          throw new Error(`HTTP ${response.status}: ${response.statusText} (Server may be down or endpoint incorrect)`);
        }
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
