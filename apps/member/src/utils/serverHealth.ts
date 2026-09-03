/**
 * Shared Server Health Manager
 * 
 * Prevents multiple simultaneous health checks and caches the result
 * to avoid race conditions and delays on initial page load
 */

let healthCheckPromise: Promise<boolean> | null = null;
let lastHealthCheck: number = 0;
let cachedHealthStatus: boolean = false;
const HEALTH_CHECK_CACHE_MS = 10000; // Cache for 10 seconds
const HEALTH_CHECK_TIMEOUT_MS = 3000; // Reduced timeout to 3 seconds

/**
 * Check server health with caching and deduplication
 */
export async function checkServerHealthCached(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached result if still valid
  if (now - lastHealthCheck < HEALTH_CHECK_CACHE_MS) {
    return cachedHealthStatus;
  }

  // If a health check is already in progress, wait for it
  if (healthCheckPromise) {
    return healthCheckPromise;
  }

  // Start new health check
  healthCheckPromise = performHealthCheck();
  
  try {
    const result = await healthCheckPromise;
    cachedHealthStatus = result;
    lastHealthCheck = now;
    return result;
  } finally {
    // Clear promise after a short delay to allow concurrent requests to use the result
    setTimeout(() => {
      healthCheckPromise = null;
    }, 100);
  }
}

/**
 * Perform the actual health check
 */
async function performHealthCheck(): Promise<boolean> {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
  
  if (!API_BASE_URL) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check if response is actually JSON (not HTML error page)
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return false;
    }

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.status === 'ok';
  } catch (error: any) {
    // Silently fail - server might be down or unreachable
    if (error.name !== 'AbortError') {
      // Only log non-timeout errors in development
      if (import.meta.env.DEV) {
        console.warn('Server health check failed:', error.message || error);
      }
    }
    return false;
  }
}

/**
 * Invalidate the health check cache (force next check to be fresh)
 */
export function invalidateHealthCache(): void {
  lastHealthCheck = 0;
  healthCheckPromise = null;
}

/**
 * Get cached health status without making a request
 */
export function getCachedHealthStatus(): boolean {
  return cachedHealthStatus;
}
