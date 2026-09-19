import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/*
 * State a page gets back when the member returns to it.
 *
 * Every page mounts fresh on a switch, so state that started as `null` drew the page's empty figures
 * -- zeros -- until its reads came back, on every switch, every time. This keeps the last value in
 * memory for the session and starts from it: the page draws what it showed a moment ago, and its
 * reads refresh it behind. Memory only, keyed by the caller (include the wallet), and dropped on
 * sign-out -- nothing here outlives the tab or crosses accounts.
 */
const memory = new Map<string, unknown>();

export function useRemembered<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial));

  // A different key (another wallet) starts from its own memory, not the last one's.
  useEffect(() => {
    setValue(memory.has(key) ? (memory.get(key) as T) : initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        memory.set(key, resolved);
        return resolved;
      }),
    [key],
  );
  return [value, set];
}

/** Forget everything remembered: on sign-out, so the next account starts clean. */
export function forgetRemembered(): void {
  memory.clear();
}
