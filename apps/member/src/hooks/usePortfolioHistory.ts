import { useCallback, useState } from 'react';

export interface PortfolioSnapshot {
  timestamp: number;
  value: number;
  date: Date;
}

const STORAGE_KEY = 'portfolio_history';
const MAX_SNAPSHOTS = 730; // Keep 2 years of daily data
const SNAPSHOT_INTERVAL = 60 * 60 * 1000; // Take snapshot every hour
const FETCHED_HISTORY_KEY = 'portfolio_fetched_history'; // Track if we've fetched blockchain history

/**
 * Fetch historical portfolio values from blockchain transactions
 * This reconstructs portfolio value over time based on transaction history
 */
async function fetchHistoricalPortfolioValues(
  _address: string, // Address is used for localStorage key in fetchAndMergeHistory
  transactions: Array<{ timestamp?: number; date: string; type: string; amount: number; currency: string }>,
  currentValue: number
): Promise<PortfolioSnapshot[]> {
  if (!transactions || transactions.length === 0) {
    return [];
  }

  // Sort transactions by timestamp (oldest first)
  const sortedTxs = [...transactions]
    .filter(tx => tx.timestamp)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (sortedTxs.length === 0) {
    return [];
  }

  // Reconstruct portfolio value over time
  // Start from the oldest transaction and work forward
  const snapshots: PortfolioSnapshot[] = [];
  let runningValue = 0;

  // Group transactions by day to create daily snapshots
  const dailySnapshots = new Map<number, number>();

  sortedTxs.forEach(tx => {
    if (!tx.timestamp) return;
    
    const txDate = new Date(tx.timestamp);
    const dayStart = new Date(txDate.getFullYear(), txDate.getMonth(), txDate.getDate()).getTime();
    
    // Estimate value change from transaction
    // This is a simplified approach - in production, you'd want to track actual token balances
    if (tx.type === 'deposit' || tx.type === 'mint') {
      runningValue += tx.amount;
    } else if (tx.type === 'withdraw' || tx.type === 'sell') {
      runningValue = Math.max(0, runningValue - tx.amount);
    }
    
    // Store the value at the end of each day
    dailySnapshots.set(dayStart, runningValue);
  });

  // Convert daily snapshots to array
  Array.from(dailySnapshots.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([timestamp, value]) => {
      snapshots.push({
        timestamp,
        value,
        date: new Date(timestamp)
      });
    });

  // Add current value as the latest point
  if (snapshots.length > 0) {
    snapshots.push({
      timestamp: Date.now(),
      value: currentValue,
      date: new Date()
    });
  }

  return snapshots;
}

/**
 * Hook to track and retrieve historical portfolio values
 */
export function usePortfolioHistory() {
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
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

  // Fetch and merge historical data from blockchain
  const fetchAndMergeHistory = useCallback(async (
    address: string,
    transactions: Array<{ timestamp?: number; date: string; type: string; amount: number; currency: string }>,
    currentValue: number
  ) => {
    if (typeof window === 'undefined') return;
    
    // Check if we've already fetched history for this address
    const fetchedKey = `${FETCHED_HISTORY_KEY}_${address}`;
    const hasFetched = localStorage.getItem(fetchedKey);
    
    if (hasFetched) {
      // Already fetched, skip
      return;
    }

    setIsFetchingHistory(true);
    
    try {
      const fetchedSnapshots = await fetchHistoricalPortfolioValues(address, transactions, currentValue);
      
      if (fetchedSnapshots.length > 0) {
        // Merge with existing local history
        const localHistory = getHistory();
        const merged = [...localHistory, ...fetchedSnapshots]
          .sort((a, b) => a.timestamp - b.timestamp)
          // Remove duplicates (same timestamp)
          .filter((snapshot, index, self) => 
            index === 0 || self[index - 1].timestamp !== snapshot.timestamp
          )
          .slice(-MAX_SNAPSHOTS);
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          snapshots: merged,
          lastUpdated: Date.now()
        }));
      }
      
      // Mark as fetched for this address
      localStorage.setItem(fetchedKey, 'true');
    } catch (error) {
      console.error('Error fetching historical portfolio data:', error);
    } finally {
      setIsFetchingHistory(false);
    }
  }, [getHistory]);

  // Clear all history (useful for testing or reset)
  const clearHistory = useCallback(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
    // Also clear fetched flags
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(FETCHED_HISTORY_KEY)) {
        localStorage.removeItem(key);
      }
    });
  }, []);

  return {
    getHistory,
    addSnapshot,
    getSnapshotsForRange,
    fetchAndMergeHistory,
    isFetchingHistory,
    clearHistory
  };
}
