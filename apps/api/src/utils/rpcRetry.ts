import { ethers } from 'ethers';

/**
 * Retry configuration for RPC calls
 */
interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  retryableErrors?: string[];
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  retryableErrors: [
    'rate limit',
    'over rate limit',
    'too many requests',
    'timeout',
    'network',
    'ECONNRESET',
    'ETIMEDOUT',
    'no response',
    'CALL_EXCEPTION',
    'filter not found',
    'decode',
  ],
};

/**
 * Check if an error is retryable
 */
function isRetryableError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = (error.message || error.toString() || '').toLowerCase();
  const errorCode = error.code || error.error?.code || '';
  
  // Check error message
  for (const retryableError of DEFAULT_CONFIG.retryableErrors) {
    if (errorMessage.includes(retryableError.toLowerCase())) {
      return true;
    }
  }
  
  // Check error codes
  const retryableCodes = [-32016, -32603, -32000, 'ECONNRESET', 'ETIMEDOUT', 'CALL_EXCEPTION'];
  if (retryableCodes.includes(errorCode)) {
    return true;
  }
  
  // Check if it's a rate limit error
  if (errorCode === -32016 || error.error?.code === -32016) {
    return true;
  }
  
  return false;
}

/**
 * Calculate exponential backoff delay
 */
function calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * 0.3 * delay; // Up to 30% jitter
  return delay + jitter;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay } = { ...DEFAULT_CONFIG, ...config };
  
  let lastError: any = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }
      
      // Only retry if error is retryable
      if (!isRetryableError(error)) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = calculateDelay(attempt, baseDelay, maxDelay);
      
      // Log retry attempt (only in development or for specific errors)
      const errorMessage = (error?.message || error?.error?.message || '').toLowerCase();
      const isCriticalError = error?.error?.code === -32016 || errorMessage.includes('filter not found');
      if (process.env.NODE_ENV === 'development' || isCriticalError) {
        console.warn(`[RPC Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${Math.round(delay)}ms:`, 
          error?.message || error?.error?.message || 'Unknown error');
      }
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Create a provider with retry logic
 * Handles network detection failures by using static network when chainId is provided
 */
export function createRetryProvider(rpcUrl: string, chainId?: number): ethers.JsonRpcProvider {
  // Create provider with static network to avoid network detection issues
  // This prevents "JsonRpcProvider failed to detect network" errors
  let provider: ethers.JsonRpcProvider;
  
  if (chainId) {
    try {
      // Try to create with static network first
      const network = ethers.Network.from(chainId);
      provider = new ethers.JsonRpcProvider(rpcUrl, network, {
        staticNetwork: network,
      });
    } catch (error) {
      // Fallback: create without static network if chainId is invalid
      provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  } else {
    provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  
  // Override the send method to add retry logic
  const originalSend = provider.send.bind(provider);
  provider.send = async function(method: string, params: any[]) {
    return withRetry(
      () => originalSend(method, params),
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
      }
    );
  };
  
  return provider;
}
