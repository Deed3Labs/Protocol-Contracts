/**
 * Dynamic Interval Manager
 * 
 * Adjusts polling intervals between 5-60 minutes based on various conditions
 * to optimize credit consumption while maintaining data freshness.
 * 
 * Conditions that affect interval:
 * - Active connections: More connections = more frequent updates (5 min)
 * - Idle state: No activity = less frequent updates (60 min)
 * - Error rates: High errors = less frequent to avoid wasting credits
 * - Data change frequency: Frequent changes = more frequent updates
 * - Cache hit rate: High cache hits = less frequent updates
 */

export interface DynamicIntervalOptions {
  minInterval: number; // Minimum interval in ms (default: 5 minutes)
  maxInterval: number; // Maximum interval in ms (default: 60 minutes)
  initialInterval?: number; // Starting interval in ms
}

export interface IntervalConditions {
  activeConnections?: number; // Number of active connections/clients
  errorRate?: number; // Error rate (0-1, where 1 = 100% errors)
  dataChangeFrequency?: number; // Changes per minute (higher = more frequent polling)
  cacheHitRate?: number; // Cache hit rate (0-1, where 1 = 100% cache hits)
  lastChangeTime?: number; // Timestamp of last data change
  isIdle?: boolean; // Whether system is idle
}

export class DynamicIntervalManager {
  private currentInterval: number;
  private intervalId: NodeJS.Timeout | null = null;
  private callback: () => Promise<void> | void;
  private options: Required<DynamicIntervalOptions>;
  private conditions: IntervalConditions = {};
  private lastExecutionTime: number = 0;
  private errorCount: number = 0;
  private totalExecutions: number = 0;
  private dataChangeCount: number = 0;
  private cacheHitCount: number = 0;
  private cacheMissCount: number = 0;

  constructor(
    callback: () => Promise<void> | void,
    options: DynamicIntervalOptions
  ) {
    this.callback = callback;
    this.options = {
      minInterval: options.minInterval || 5 * 60 * 1000, // 5 minutes
      maxInterval: options.maxInterval || 60 * 60 * 1000, // 60 minutes
      initialInterval: options.initialInterval || options.minInterval || 5 * 60 * 1000,
    };
    this.currentInterval = this.options.initialInterval;
  }

  /**
   * Calculate optimal interval based on current conditions
   */
  private calculateInterval(): number {
    let interval = this.options.minInterval;

    // Factor 1: Active connections
    // More connections = more frequent updates (but cap at reasonable level)
    if (this.conditions.activeConnections) {
      const connectionFactor = Math.min(this.conditions.activeConnections / 10, 1);
      interval = interval * (1 - connectionFactor * 0.3); // Reduce by up to 30%
    }

    // Factor 2: Error rate
    // High errors = less frequent to avoid wasting credits
    const errorRate = this.conditions.errorRate ?? this.getErrorRate();
    if (errorRate > 0.3) {
      interval = interval * (1 + errorRate * 2); // Increase by up to 2x
    }

    // Factor 3: Data change frequency
    // Frequent changes = more frequent updates
    if (this.conditions.dataChangeFrequency && this.conditions.dataChangeFrequency > 0) {
      const changeFactor = Math.min(this.conditions.dataChangeFrequency / 10, 1);
      interval = interval * (1 - changeFactor * 0.4); // Reduce by up to 40%
    }

    // Factor 4: Cache hit rate
    // High cache hits = less frequent updates (data is fresh from cache)
    const cacheHitRate = this.conditions.cacheHitRate ?? this.getCacheHitRate();
    if (cacheHitRate > 0.7) {
      interval = interval * (1 + (cacheHitRate - 0.7) * 2); // Increase for high cache hits
    }

    // Factor 5: Time since last change
    // No changes for a while = less frequent updates
    if (this.conditions.lastChangeTime) {
      const timeSinceChange = Date.now() - this.conditions.lastChangeTime;
      const hoursSinceChange = timeSinceChange / (60 * 60 * 1000);
      if (hoursSinceChange > 1) {
        interval = interval * (1 + hoursSinceChange * 0.2); // Increase by 20% per hour
      }
    }

    // Factor 6: Idle state
    // If idle, use maximum interval
    if (this.conditions.isIdle) {
      interval = this.options.maxInterval;
    }

    // Clamp to min/max bounds
    interval = Math.max(this.options.minInterval, Math.min(this.options.maxInterval, interval));

    return Math.round(interval);
  }

  /**
   * Update conditions and recalculate interval
   */
  updateConditions(conditions: Partial<IntervalConditions>) {
    this.conditions = { ...this.conditions, ...conditions };
    const newInterval = this.calculateInterval();

    if (Math.abs(newInterval - this.currentInterval) > 60000) {
      // Only restart if difference is significant (>1 minute)
      this.currentInterval = newInterval;
      this.restart();
    } else {
      this.currentInterval = newInterval;
    }
  }

  /**
   * Record an execution (success or error)
   */
  recordExecution(success: boolean) {
    this.totalExecutions++;
    if (!success) {
      this.errorCount++;
    }
    this.lastExecutionTime = Date.now();
  }

  /**
   * Record a data change
   */
  recordDataChange() {
    this.dataChangeCount++;
    this.conditions.lastChangeTime = Date.now();
    // Recalculate interval after data change
    this.updateConditions({});
  }

  /**
   * Record a cache hit/miss
   */
  recordCacheAccess(hit: boolean) {
    if (hit) {
      this.cacheHitCount++;
    } else {
      this.cacheMissCount++;
    }
  }

  /**
   * Get current error rate
   */
  getErrorRate(): number {
    if (this.totalExecutions === 0) return 0;
    return this.errorCount / this.totalExecutions;
  }

  /**
   * Get current cache hit rate
   */
  getCacheHitRate(): number {
    const total = this.cacheHitCount + this.cacheMissCount;
    if (total === 0) return 0;
    return this.cacheHitCount / total;
  }

  /**
   * Start the interval
   * @param delayBeforeStart - Delay in ms before starting (to allow initial data to load)
   */
  start(delayBeforeStart: number = 0) {
    if (this.intervalId) {
      this.stop();
    }

    const execute = async () => {
      try {
        await this.callback();
        this.recordExecution(true);
      } catch (error) {
        console.error('[DynamicInterval] Error in callback:', error);
        this.recordExecution(false);
      }
    };

    // Don't execute immediately - wait for delay to allow initial setup
    // This prevents rate limiting on server startup
    if (delayBeforeStart > 0) {
      setTimeout(() => {
        // Set up interval (don't execute immediately)
        this.intervalId = setInterval(execute, this.currentInterval) as unknown as NodeJS.Timeout;
      }, delayBeforeStart);
    } else {
      // Set up interval (don't execute immediately)
      this.intervalId = setInterval(execute, this.currentInterval) as unknown as NodeJS.Timeout;
    }
  }

  /**
   * Restart the interval with current settings
   */
  restart(delayBeforeStart: number = 0) {
    this.stop();
    this.start(delayBeforeStart);
  }

  /**
   * Stop the interval
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Get current interval in milliseconds
   */
  getCurrentInterval(): number {
    return this.currentInterval;
  }

  /**
   * Get current interval in minutes (for logging)
   */
  getCurrentIntervalMinutes(): number {
    return Math.round(this.currentInterval / (60 * 1000));
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.errorCount = 0;
    this.totalExecutions = 0;
    this.dataChangeCount = 0;
    this.cacheHitCount = 0;
    this.cacheMissCount = 0;
  }
}
