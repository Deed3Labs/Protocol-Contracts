/**
 * Compute Unit Tracker for Alchemy API
 * Tracks compute unit consumption per user/session to monitor usage
 */

interface ComputeUnitLog {
  timestamp: number;
  endpoint: string;
  chainId?: number;
  address?: string;
  computeUnits: number;
  method: string;
}

/** Per-user 24h CU alert threshold (optional env ALCHEMY_CU_ALERT_THRESHOLD). */
function getPerUserAlertThreshold(): number {
  const v = process.env.ALCHEMY_CU_ALERT_THRESHOLD;
  if (v == null || v === '') return 100_000;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 100_000 : n;
}

/** Global 24h CU alert threshold (optional env ALCHEMY_CU_DAILY_ALERT_THRESHOLD). When set, log warning if 24h total exceeds this. */
function getDailyAlertThreshold(): number | null {
  const v = process.env.ALCHEMY_CU_DAILY_ALERT_THRESHOLD;
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

class ComputeUnitTracker {
  private logs: ComputeUnitLog[] = [];
  private userUsage: Map<string, number> = new Map(); // address -> total compute units
  private endpointUsage: Map<string, number> = new Map(); // endpoint -> total compute units
  private readonly MAX_LOGS = 10000; // Keep last 10k logs

  /**
   * Log an Alchemy API call with estimated compute units.
   * Tracks request-based usage only (HTTP/custom API calls). Alchemy compute units vary by endpoint:
   * - Transfers API: ~30-50 units per call
   * - Portfolio API: ~20-40 units per call
   * - Prices API: ~10-20 units per call
   * - Token Balances: ~15-25 units per call
   * - NFT API: ~25-35 units per call
   *
   * Not tracked here: Subscription API (WebSocket eth_subscribe for logs/newHeads). We use it in
   * EventListenerService for 4 chains (Ethereum, Polygon, Arbitrum, Base); that usage is
   * connection-based (long-lived WebSocket + subscription), not per-request, so it isn't logged
   * in this tracker. Alchemy may meter WebSocket usage separately; check your dashboard.
   */
  logApiCall(
    endpoint: string,
    method: string,
    options: {
      chainId?: number;
      address?: string;
      estimatedUnits?: number;
    } = {}
  ): void {
    const { chainId, address, estimatedUnits } = options;
    
    // Estimate compute units based on endpoint type
    let units = estimatedUnits || this.estimateComputeUnits(endpoint, method);
    
    const log: ComputeUnitLog = {
      timestamp: Date.now(),
      endpoint,
      chainId,
      address: address?.toLowerCase(),
      computeUnits: units,
      method,
    };

    // Add to logs
    this.logs.push(log);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift(); // Remove oldest log
    }

    // Track per-user usage
    if (address) {
      const normalizedAddress = address.toLowerCase();
      const current = this.userUsage.get(normalizedAddress) || 0;
      this.userUsage.set(normalizedAddress, current + units);
    }

    // Track per-endpoint usage
    const currentEndpoint = this.endpointUsage.get(endpoint) || 0;
    this.endpointUsage.set(endpoint, currentEndpoint + units);

    // Per-user alert checked in hourly summary (24h window) instead of here
  }

  /**
   * Estimate compute units based on endpoint and method
   */
  private estimateComputeUnits(endpoint: string, method: string): number {
    // Transfers API is most expensive
    if (endpoint.includes('getAssetTransfers') || method.includes('transfer')) {
      return 40;
    }
    
    // Portfolio API
    if (endpoint.includes('portfolio') || endpoint.includes('data/v1')) {
      return 30;
    }
    
    // NFT API
    if (endpoint.includes('nft') || method.includes('nft')) {
      return 30;
    }
    
    // Token Balances
    if (endpoint.includes('getTokenBalances') || method.includes('balance')) {
      return 20;
    }
    
    // Prices API
    if (endpoint.includes('prices') || method.includes('price')) {
      return 15;
    }
    
    // Default estimate
    return 25;
  }

  /**
   * Get total compute units for a user (last 24 hours)
   */
  getUserUsage(address: string, hours: number = 24): number {
    const normalizedAddress = address.toLowerCase();
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    
    return this.logs
      .filter(log => 
        log.address === normalizedAddress && 
        log.timestamp >= cutoff
      )
      .reduce((sum, log) => sum + log.computeUnits, 0);
  }

  /**
   * Get total compute units for all users (last 24 hours)
   */
  getTotalUsage(hours: number = 24): number {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    
    return this.logs
      .filter(log => log.timestamp >= cutoff)
      .reduce((sum, log) => sum + log.computeUnits, 0);
  }

  /**
   * Get usage by endpoint
   */
  getEndpointUsage(hours: number = 24): Map<string, number> {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const usage = new Map<string, number>();
    
    this.logs
      .filter(log => log.timestamp >= cutoff)
      .forEach(log => {
        const current = usage.get(log.endpoint) || 0;
        usage.set(log.endpoint, current + log.computeUnits);
      });
    
    return usage;
  }

  /**
   * Get top users by compute unit usage
   */
  getTopUsers(limit: number = 10, hours: number = 24): Array<{ address: string; units: number }> {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const userMap = new Map<string, number>();
    
    this.logs
      .filter(log => log.address && log.timestamp >= cutoff)
      .forEach(log => {
        const current = userMap.get(log.address!) || 0;
        userMap.set(log.address!, current + log.computeUnits);
      });
    
    return Array.from(userMap.entries())
      .map(([address, units]) => ({ address, units }))
      .sort((a, b) => b.units - a.units)
      .slice(0, limit);
  }

  /**
   * Reset user usage (call daily)
   */
  resetUserUsage(): void {
    this.userUsage.clear();
  }

  /**
   * Get summary statistics
   */
  getSummary(hours: number = 24): {
    totalUnits: number;
    totalCalls: number;
    topEndpoints: Array<{ endpoint: string; units: number; calls: number }>;
    topUsers: Array<{ address: string; units: number }>;
  } {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const recentLogs = this.logs.filter(log => log.timestamp >= cutoff);
    
    const endpointMap = new Map<string, { units: number; calls: number }>();
    recentLogs.forEach(log => {
      const current = endpointMap.get(log.endpoint) || { units: 0, calls: 0 };
      endpointMap.set(log.endpoint, {
        units: current.units + log.computeUnits,
        calls: current.calls + 1,
      });
    });
    
    return {
      totalUnits: recentLogs.reduce((sum, log) => sum + log.computeUnits, 0),
      totalCalls: recentLogs.length,
      topEndpoints: Array.from(endpointMap.entries())
        .map(([endpoint, data]) => ({ endpoint, ...data }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 10),
      topUsers: this.getTopUsers(10, hours),
    };
  }
}

// Singleton instance
export const computeUnitTracker = new ComputeUnitTracker();

// Log summary every hour and run alerts (24h window)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const summary = computeUnitTracker.getSummary(24);
    console.log('[ComputeUnitTracker] 24h Summary:', {
      totalUnits: summary.totalUnits.toLocaleString(),
      totalCalls: summary.totalCalls.toLocaleString(),
      avgUnitsPerCall: summary.totalCalls > 0
        ? (summary.totalUnits / summary.totalCalls).toFixed(2)
        : 0,
      topEndpoints: summary.topEndpoints.slice(0, 3),
    });

    const dailyThreshold = getDailyAlertThreshold();
    if (dailyThreshold != null && summary.totalUnits > dailyThreshold) {
      console.warn(
        `[ComputeUnitTracker] 24h total (${summary.totalUnits.toLocaleString()}) exceeds ALCHEMY_CU_DAILY_ALERT_THRESHOLD (${dailyThreshold.toLocaleString()})`
      );
    }

    const perUserThreshold = getPerUserAlertThreshold();
    for (const { address, units } of summary.topUsers) {
      if (units > perUserThreshold) {
        console.warn(
          `[ComputeUnitTracker] User ${address} 24h usage (${units.toLocaleString()}) exceeds threshold (${perUserThreshold.toLocaleString()})`
        );
      }
    }
  }, 60 * 60 * 1000); // Every hour
}
