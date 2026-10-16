import { merchantApi } from '@/data/merchantApi';
import { merchantTerminalBackend } from './backend';
import { mockReader } from './mock';
import { currentPlatform } from './platform';
import { clearReaderTimings, measureReader, readerTimings, timingSummary } from './timings';
import type { Platform, ReaderService, TerminalBackend } from './types';

export * from './types';
export { currentPlatform, kindsFor, offlineFor, OFFLINE_BUILT, previewPlatform, thisDevice } from './platform';
export { mockReader, mockReaders } from './mock';
export { merchantTerminalBackend, unavailableBackend } from './backend';
export { readerQueue, IDLE_RELEASE_MS, type ReaderQueue, type TableReaderState } from './tables';
export { measureReader, readerTimings, timingSummary, clearReaderTimings, type Timing } from './timings';

/**
 * The one way a screen reaches a card reader. The installed app gets the native plugin, a browser
 * gets Stripe's web SDK, and the preview gets the simulation. Screens never import an SDK.
 */
let live: Promise<ReaderService> | null = null;
/** One simulated reader per previewed platform, so a reader picked stays connected. */
const previews = new Map<string, ReaderService>();

export function readerService(opts: { preview?: { platform: Platform; decline?: boolean }; backend?: TerminalBackend } = {}): Promise<ReaderService> {
  if (opts.preview) {
    const key = `${opts.preview.platform}:${opts.preview.decline ? 'decline' : 'approve'}`;
    if (!previews.has(key)) previews.set(key, mockReader(opts.preview.platform, { decline: opts.preview.decline }));
    return Promise.resolve(previews.get(key)!);
  }
  const backend = opts.backend ?? merchantTerminalBackend(merchantApi());
  if (!live) {
    const platform = currentPlatform();
    live =
      platform === 'web'
        ? import('./web').then((m) => m.webReader(backend))
        : import('./native').then((m) => m.nativeReader(platform, backend));
    // A failed start (no Stripe, no connection) is retried next time rather than remembered.
    live.catch(() => {
      live = null;
    });
  }
  return live;
}

/**
 * The M2 measurement (the Pay case addendum), from the remote inspector on a tablet:
 * `await clearReaderTimings.measure('<serial>', 10)`. Installed app only: a browser has no M2.
 * docs/hardware/m2-timing.md has the steps.
 */
if (typeof window !== 'undefined' && currentPlatform() !== 'web') {
  (window as unknown as { clearReaderTimings: unknown }).clearReaderTimings = {
    measure: async (serial: string, rounds = 10) => measureReader(await readerService(), serial, rounds),
    summary: () => timingSummary(),
    list: readerTimings,
    clear: clearReaderTimings,
  };
}
