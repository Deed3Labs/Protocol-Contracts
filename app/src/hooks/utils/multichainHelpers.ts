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
 * Fetches data in parallel (for desktop devices)
 * @param items - Array of items to fetch
 * @param fetchFn - Function to fetch data for each item
 * @returns Array of all fetched results
 */
export const fetchInParallel = async <T, I>(
  items: I[],
  fetchFn: (item: I) => Promise<T[]>
): Promise<T[]> => {
  const promises = items.map(item => fetchFn(item));
  const results = await Promise.all(promises);
  return results.flat();
};

/**
 * Fetches data with mobile/desktop optimization
 * Automatically chooses sequential (mobile) or parallel (desktop) fetching
 * @param items - Array of items to fetch
 * @param fetchFn - Function to fetch data for each item
 * @param delayMs - Delay between fetches for mobile (default: 300)
 * @returns Array of all fetched results
 */
export const fetchWithDeviceOptimization = async <T, I>(
  items: I[],
  fetchFn: (item: I) => Promise<T[]>,
  delayMs: number = 300
): Promise<T[]> => {
  if (isMobileDevice()) {
    return fetchSequentially(items, fetchFn, delayMs);
  } else {
    return fetchInParallel(items, fetchFn);
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
