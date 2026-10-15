import { currentPlatform } from '@/reader/platform';
import { mockDrawer } from './mock';
import { nativeDrawer } from './native';
import type { DrawerService } from './types';
import { webDrawer } from './web';

export * from './types';

let live: DrawerService | null = null;
const previews = new Map<string, DrawerService>();

/**
 * The one way a screen reaches the cash drawer. The preview gets the simulation (`&drawerHw=stuck`
 * for one that never answers); the installed app the Bluetooth plugin; a browser Web Bluetooth.
 */
export function drawerService(
  opts: {
    preview?: boolean;
    stuck?: boolean;
    drawerId?: () => string | null;
    key?: () => Promise<Uint8Array | null>;
  } = {},
): DrawerService {
  if (opts.preview) {
    const k = opts.stuck ? 'stuck' : 'ok';
    if (!previews.has(k)) previews.set(k, mockDrawer({ stuck: opts.stuck }));
    return previews.get(k)!;
  }
  if (!live) {
    let counter = Number(globalThis.localStorage?.getItem('clear.drawer.counter') ?? '0') || 0;
    live =
      currentPlatform() === 'web'
        ? webDrawer({
            drawerId: opts.drawerId ?? (() => null),
            key: opts.key ?? (async () => null),
            counter: () => {
              counter += 1;
              try {
                localStorage.setItem('clear.drawer.counter', String(counter));
              } catch {
                // Private windows: the drawer still takes a counter that only goes up this session.
              }
              return counter;
            },
          })
        : nativeDrawer();
  }
  return live;
}
