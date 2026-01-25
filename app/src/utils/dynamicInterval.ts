/**
 * Dynamic Interval Manager (Client-side)
 * 
 * Adjusts polling intervals between 5-60 minutes based on various conditions
 * to optimize credit consumption while maintaining data freshness.
 * 
 * Conditions that affect interval:
 * - User activity: Active user = more frequent updates (5 min)
 * - Idle state: User idle = less frequent updates (60 min)
 * - WebSocket connection: Connected = less frequent (rely on real-time)
 * - Data change frequency: Frequent changes = more frequent updates
 * - Error rates: High errors = less frequent to avoid wasting credits
 */

export interface DynamicIntervalOptions {
  minInterval: number; // Minimum interval in ms (default: 5 minutes)
  maxInterval: number; // Maximum interval in ms (default: 60 minutes)
  initialInterval?: number; // Starting interval in ms
}

export interface IntervalConditions {
  isUserActive?: boolean; // Whether user is actively interacting
  wsConnected?: boolean; // Whether WebSocket is connected
  errorRate?: number; // Error rate (0-1, where 1 = 100% errors)
  dataChangeFrequency?: number; // Changes per minute
  lastChangeTime?: number; // Timestamp of last data change
  isIdle?: boolean; // Whether user is idle
}

export class DynamicIntervalManager {
  private currentInterval: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callback: () => Promise<void> | void;
  private options: Required<DynamicIntervalOptions>;
  private conditions: IntervalConditions = {};
  private errorCount: number = 0;
  private totalExecutions: number = 0;
  private dataChangeCount: number = 0;
  private idleTimeout: ReturnType<typeof setTimeout> | null = null;

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
    this.setupActivityTracking();
  }

  /**
   * Setup activity tracking to detect user idle state
   */
  private setupActivityTracking() {
    if (typeof window === 'undefined') return;

    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    const idleThreshold = 5 * 60 * 1000; // 5 minutes of inactivity = idle

    const updateActivity = () => {
      this.conditions.isUserActive = true;
      this.conditions.isIdle = false;

      if (this.idleTimeout) {
        clearTimeout(this.idleTimeout);
      }

      this.idleTimeout = setTimeout(() => {
        this.conditions.isIdle = true;
        this.conditions.isUserActive = false;
        this.updateConditions({});
      }, idleThreshold);

      this.updateConditions({});
    };

    events.forEach(event => {
      window.addEventListener(event, updateActivity, { passive: true });
    });

    // Initial activity
    updateActivity();
  }

  /**
   * Calculate optimal interval based on current conditions
   */
  private calculateInterval(): number {
    let interval = this.options.minInterval;

    // Factor 1: WebSocket connection
    // If WebSocket is connected, rely more on real-time updates
    if (this.conditions.wsConnected) {
      interval = interval * 2; // Double the interval if WebSocket is active
    }

    // Factor 2: User activity
    // Active user = more frequent updates
    if (this.conditions.isUserActive) {
      interval = interval * 0.7; // Reduce by 30% for active users
    }

    // Factor 3: Idle state
    // If idle, use maximum interval
    if (this.conditions.isIdle) {
      interval = this.options.maxInterval;
    }

    // Factor 4: Error rate
    // High errors = less frequent to avoid wasting credits
    const errorRate = this.conditions.errorRate ?? this.getErrorRate();
    if (errorRate > 0.3) {
      interval = interval * (1 + errorRate * 2); // Increase by up to 2x
    }

    // Factor 5: Data change frequency
    // Frequent changes = more frequent updates
    if (this.conditions.dataChangeFrequency && this.conditions.dataChangeFrequency > 0) {
      const changeFactor = Math.min(this.conditions.dataChangeFrequency / 10, 1);
      interval = interval * (1 - changeFactor * 0.4); // Reduce by up to 40%
    }

    // Factor 6: Time since last change
    // No changes for a while = less frequent updates
    if (this.conditions.lastChangeTime) {
      const timeSinceChange = Date.now() - this.conditions.lastChangeTime;
      const hoursSinceChange = timeSinceChange / (60 * 60 * 1000);
      if (hoursSinceChange > 1) {
        interval = interval * (1 + hoursSinceChange * 0.2); // Increase by 20% per hour
      }
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
   * Get current error rate
   */
  getErrorRate(): number {
    if (this.totalExecutions === 0) return 0;
    return this.errorCount / this.totalExecutions;
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

    // Don't execute immediately - wait for delay to allow initial data to load
    // This prevents rate limiting on app startup
    if (delayBeforeStart > 0) {
      setTimeout(() => {
        // Set up interval (don't execute immediately)
        this.intervalId = setInterval(execute, this.currentInterval);
      }, delayBeforeStart);
    } else {
      // Set up interval (don't execute immediately)
      this.intervalId = setInterval(execute, this.currentInterval);
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
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
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
  }
}
