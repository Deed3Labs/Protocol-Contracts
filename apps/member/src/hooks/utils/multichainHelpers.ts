/**
 * Shared utilities for multichain hooks
 * Provides common functionality to reduce code duplication
 */

/**
 * Detects if the current device is a mobile device
 * @returns true if the device is mobile, false otherwise
 */
export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

/**
 * Wraps a promise with a timeout
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds (default: 3000)
 * @returns The promise result or throws timeout error
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number = 3000
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    ),
  ]);
};

/**
 * Fetches data sequentially with delays (for mobile devices)
 * @param items - Array of items to fetch
 * @param fetchFn - Function to fetch data for each item
 * @param delayMs - Delay between fetches in milliseconds (default: 300)
 * @returns Array of all fetched results
 */
export const fetchSequentially = async <T, I>(
  items: I[],
  fetchFn: (item: I) => Promise<T[]>,
  delayMs: number = 300
): Promise<T[]> => {
  const results: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const itemResults = await fetchFn(items[i]);
    results.push(...itemResults);
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return results;
};

/**
 * Fetches data in parallel with concurrency limit (for desktop devices)
 * Limits the number of simultaneous requests to prevent browser resource exhaustion
 * @param items - Array of items to fetch
 * @param fetchFn - Function to fetch data for each item
 * @param concurrency - Maximum number of parallel requests (default: 3)
 * @returns Array of all fetched results
 */
export const fetchInParallel = async <T, I>(
  items: I[],
  fetchFn: (item: I) => Promise<T[]>,
  concurrency: number = 3
): Promise<T[]> => {
  const results: T[] = [];
  
  // Process items in batches to limit concurrent requests
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(item => fetchFn(item));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.flat());
  }
  
  return results;
};

/**
 * Fetches data with mobile/desktop optimization
 * Uses sequential fetching by default to prevent browser resource exhaustion (ERR_INSUFFICIENT_RESOURCES)
 * Can be configured for limited parallel fetching if needed
 * @param items - Array of items to fetch
 * @param fetchFn - Function to fetch data for each item
 * @param delayMs - Delay between fetches (default: 200ms to balance speed and resource usage)
 * @param useParallel - Whether to use limited parallel fetching (default: false for safety)
 * @param concurrency - Maximum parallel requests if useParallel is true (default: 2)
 * @returns Array of all fetched results
 */
export const fetchWithDeviceOptimization = async <T, I>(
  items: I[],
  fetchFn: (item: I) => Promise<T[]>,
  delayMs: number = 200,
  useParallel: boolean = false,
  concurrency: number = 2
): Promise<T[]> => {
  if (isMobileDevice() || !useParallel) {
    // Sequential fetching is safer and prevents ERR_INSUFFICIENT_RESOURCES
    return fetchSequentially(items, fetchFn, delayMs);
  } else {
    // Limited parallel fetching with very low concurrency
    return fetchInParallel(items, fetchFn, concurrency);
  }
};

/**
 * Handles errors in multichain operations
 * @param error - The error that occurred
 * @param chainId - The chain ID where the error occurred
 * @param chainName - The chain name for logging
 * @param silent - Whether to suppress error logging (default: true)
 * @returns Error message or null
 */
export const handleMultichainError = (
  error: unknown,
  chainId: number,
  chainName: string,
  silent: boolean = true
): string | null => {
  const errorMessage = error instanceof Error 
    ? error.message 
    : 'Unknown error';
  
  if (!silent) {
    console.error(`Error fetching data for ${chainName} (${chainId}):`, error);
  }
  
  return errorMessage;
};

/**
 * Creates a delay promise
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after the delay
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};
