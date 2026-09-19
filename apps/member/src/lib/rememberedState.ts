import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/*
 * State a page gets back when the member returns to it -- including after closing the app.
 *
 * Every page mounts fresh, so state that started as `null` drew the page's empty figures -- zeros,
 * a sample card -- until its reads came back. This keeps each page's last value, starts from it,
 * and lets its reads refresh it behind: the way a banking app opens on your last balance.
 *
 * Kept in memory for the session and on the device (localStorage) across sessions, keyed by the
 * caller -- always include the wallet -- and under a versioned prefix so a shape change can never
 * hand a page last month's structure. Entries older than MAX_AGE are ignored. Everything is dropped
 * on sign-out. What is stored is what the screens show (figures, a card's last four), never a card
 * number, a key or a token; the app lock stands in front of all of it.
 */
const PREFIX = 'clear:rem:v1:';
const LAST_WALLET = `${PREFIX}lastWallet`;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const memory = new Map<string, unknown>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // private mode, or storage blocked: memory only
  }
}

function readStored<T>(key: string): { hit: boolean; value?: T } {
  if (memory.has(key)) return { hit: true, value: memory.get(key) as T };
  const raw = storage()?.getItem(PREFIX + key);
  if (!raw) return { hit: false };
  try {
    const { v, at } = JSON.parse(raw) as { v: T; at: number };
    if (typeof at !== 'number' || Date.now() - at > MAX_AGE_MS) return { hit: false };
    memory.set(key, v);
    return { hit: true, value: v };
  } catch {
    return { hit: false };
  }
}

function writeStored(key: string, value: unknown, device: boolean): void {
  memory.set(key, value);
  if (!device) return;
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify({ v: value, at: Date.now() }));
  } catch {
    // Full or blocked: the session copy still works.
  }
}

/** Whether a page has anything remembered under this key -- memory or device. */
export function hasRemembered(key: string): boolean {
  return readStored(key).hit;
}

export function useRemembered<T>(
  key: string,
  initial: T,
  /** `device: false` keeps it for this session only -- for anything beyond what a screen shows at a glance. */
  options: { device?: boolean } = {},
): [T, Dispatch<SetStateAction<T>>] {
  const device = options.device !== false;
  const [value, setValue] = useState<T>(() => {
    const stored = readStored<T>(key);
    return stored.hit ? (stored.value as T) : initial;
  });

  // A different key (another wallet, or the wallet resolving) starts from its own memory.
  useEffect(() => {
    const stored = readStored<T>(key);
    setValue(stored.hit ? (stored.value as T) : initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        writeStored(key, resolved, device);
        return resolved;
      }),
    [key, device],
  );
  return [value, set];
}

/**
 * The wallet to key remembered state by: the signed-in one, or -- while sign-in is still restoring
 * on a cold start -- the last one this device saw. That is what lets a reopened app draw its last
 * figures before the wallet provider has answered, and keeps the key the same once it does.
 */
export function walletKey(address: string | undefined | null): string {
  const s = storage();
  if (address) {
    const lower = address.toLowerCase();
    try {
      if (s && s.getItem(LAST_WALLET) !== lower) s.setItem(LAST_WALLET, lower);
    } catch {
      /* memory-only device */
    }
    return lower;
  }
  try {
    return s?.getItem(LAST_WALLET) ?? '';
  } catch {
    return '';
  }
}

/** Forget everything remembered, here and on the device: on sign-out, so the next member starts clean. */
export function forgetRemembered(): void {
  memory.clear();
  const s = storage();
  if (!s) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) s.removeItem(k);
  } catch {
    /* nothing to clear */
  }
}
