import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { RewardsData } from './types';

export const DataContext = createContext<RewardsData | null>(null);

export function useData(): RewardsData {
  const d = useContext(DataContext);
  if (!d) throw new Error('useData needs a data provider');
  return d;
}

/** A read, with its loading and error, that runs again when its key changes. */
export function useRead<T>(read: (d: RewardsData) => Promise<T>, key: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const d = useData();
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    read(d).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: Error) => live && setState({ data: null, error: e.message, loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, tick, ...key]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
