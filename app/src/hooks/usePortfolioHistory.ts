import { useEffect, useCallback } from 'react';

export interface PortfolioSnapshot {
  timestamp: number;
  value: number;
  date: Date;
}

const STORAGE_KEY = 'portfolio_history';
const MAX_SNAPSHOTS = 730; // Keep 2 years of daily data
const SNAPSHOT_INTERVAL = 60 * 60 * 1000; // Take snapshot every hour

/**
 * Hook to track and retrieve historical portfolio values
 */
export function usePortfolioHistory() {
  // Get all historical snapshots
  const getHistory = useCallback((): PortfolioSnapshot[] => {
    if (typeof window === 'undefined') return [];
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      
      const data = JSON.parse(stored);
      return (data.snapshots || []).map((s: any) => ({
        ...s,
        date: new Date(s.timestamp)
      }));
    } catch (error) {
      console.error('Error reading portfolio history:', error);
      return [];
    }
  }, []);

  // Add a new snapshot
  const addSnapshot = useCallback((value: number) => {
    if (typeof window === 'undefined') return;
    
    try {
      const history = getHistory();
      const now = Date.now();
      
      // Check if we should add a new snapshot (avoid duplicates within interval)
      const lastSnapshot = history[history.length - 1];
      if (lastSnapshot && (now - lastSnapshot.timestamp) < SNAPSHOT_INTERVAL) {
        // Update the last snapshot instead of adding a new one
        history[history.length - 1] = {
          timestamp: now,
          value,
          date: new Date(now)
        };
      } else {
        // Add new snapshot
        history.push({
          timestamp: now,
          value,
          date: new Date(now)
        });
      }
      
      // Keep only the most recent snapshots
      const trimmed = history
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-MAX_SNAPSHOTS);
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        snapshots: trimmed,
        lastUpdated: now
      }));
    } catch (error) {
      console.error('Error saving portfolio history:', error);
    }
  }, [getHistory]);

  // Get snapshots for a specific time range
  const getSnapshotsForRange = useCallback((range: string, currentValue: number): PortfolioSnapshot[] => {
    const history = getHistory();
    const now = Date.now();
    
    // Calculate the start time based on range
    let startTime = now;
    switch (range) {
      case '1D':
        startTime = now - 24 * 60 * 60 * 1000;
        break;
      case '1W':
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '1M':
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case '3M':
        startTime = now - 90 * 24 * 60 * 60 * 1000;
        break;
      case '6M':
        startTime = now - 180 * 24 * 60 * 60 * 1000;
        break;
      case 'YTD': {
        const yearStart = new Date(new Date().getFullYear(), 0, 1);
        startTime = yearStart.getTime();
        break;
      }
      case '1Y':
        startTime = now - 365 * 24 * 60 * 60 * 1000;
        break;
      case 'All':
        startTime = 0;
        break;
      default:
        startTime = now - 24 * 60 * 60 * 1000;
    }
    
    // Filter snapshots within range
    const filtered = history.filter(s => s.timestamp >= startTime);
    
    // If we have no history, return empty array (will be handled by chart generator)
    if (filtered.length === 0) {
      return [];
    }
    
    // Add current value as the latest point
    const result = [...filtered];
    if (result.length === 0 || result[result.length - 1].timestamp < now - SNAPSHOT_INTERVAL) {
      result.push({
        timestamp: now,
        value: currentValue,
        date: new Date(now)
      });
    } else {
      // Update the last snapshot with current value
      result[result.length - 1].value = currentValue;
    }
    
    return result;
  }, [getHistory]);

  // Clear all history (useful for testing or reset)
  const clearHistory = useCallback(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    getHistory,
    addSnapshot,
    getSnapshotsForRange,
    clearHistory
  };
}
