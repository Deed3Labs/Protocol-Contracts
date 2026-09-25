import { unavailableBackend } from './backend';
import { mockReader } from './mock';
import { currentPlatform } from './platform';
import type { Platform, ReaderService, TerminalBackend } from './types';

export * from './types';
export { currentPlatform, kindsFor, offlineFor, OFFLINE_BUILT, previewPlatform, thisDevice } from './platform';
export { mockReader, mockReaders } from './mock';

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
  const backend = opts.backend ?? unavailableBackend;
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
