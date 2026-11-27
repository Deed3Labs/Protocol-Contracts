import { kindsFor, thisDevice } from './platform';
import type { CollectEvent, CollectResult, Platform, ReaderInfo, ReaderKind, ReaderService } from './types';

/**
 * The preview's readers: what a shop with an M2, Tap to Pay and a smart reader would see, on the
 * platform being previewed. Collecting walks the card screen through the SDK's own sequence
 * (ready, then reading when the card touches, then approved or declined) on a timer.
 */
const READERS = (platform: Platform): ReaderInfo[] => [
  { id: 'm2', kind: 'bluetooth', label: 'Stripe Reader M2', detail: 'Chip, tap and swipe · Bluetooth to this tablet' },
  { id: 'ttp', kind: 'tapToPay', label: `Tap to Pay on ${thisDevice(platform === 'web' ? 'ios' : platform)}`, detail: 'Tap only · online only' },
  { id: 'wpe', kind: 'smart', label: 'WisePOS E · Counter', detail: 'Smart reader · on your network' },
];

export function mockReader(platform: Platform, opts: { decline?: boolean; step?: number } = {}): ReaderService {
  const step = opts.step ?? 2500;
  const all = READERS(platform);
  const kinds = kindsFor(platform);
  let current: ReaderInfo | null = all.find((r) => kinds.includes(r.kind)) ?? null;
  let stop: (() => void) | null = null;

  const wait = (ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(true), ms);
      stop = () => {
        clearTimeout(t);
        resolve(false);
      };
    });

  return {
    platform,
    kinds,
    discover: async (kind: ReaderKind) => all.filter((r) => r.kind === kind && kinds.includes(kind)),
    connect: async (reader) => {
      current = reader;
    },
    connected: () => current,
    async collect(_amountCents: number, onEvent: (e: CollectEvent) => void): Promise<CollectResult> {
      onEvent({ state: 'ready' });
      if (!(await wait(step))) return { outcome: 'cancelled' };
      onEvent({ state: 'reading' });
      if (!(await wait(step))) return { outcome: 'cancelled' };
      if (opts.decline) {
        onEvent({ state: 'declined', message: 'Declined' });
        return { outcome: 'declined', card: 'Visa ending 4242' };
      }
      onEvent({ state: 'approved', card: 'Visa ending 4242' });
      return { outcome: 'approved', card: 'Visa ending 4242' };
    },
    cancel: async () => {
      stop?.();
    },
    disconnect: async () => {
      current = null;
    },
  };
}

/** Every reader a platform could list, for Settings and "Use another reader". */
export function mockReaders(platform: Platform): ReaderInfo[] {
  const kinds = kindsFor(platform);
  return READERS(platform).filter((x) => kinds.includes(x.kind));
}
