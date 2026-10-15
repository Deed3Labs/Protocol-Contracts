import { capacitorCentral } from '../ble/central';
import { currentPlatform } from '@/reader/platform';
import { bleDrawer } from './ble';
import { indexedDbVault, secureStorageVault } from './keys';
import { mockDrawer } from './mock';
import type { DrawerService } from './types';

export * from './types';

let live: DrawerService | null = null;
const previews = new Map<string, DrawerService>();
let enrollment: string | null = null;
let kick: ((printerId: string) => Promise<void>) | undefined;

/** This tablet's enrollment, so drawer keys are kept for it alone (set by the sign-in provider). */
export function setDrawerEnrollment(id: string | null): void {
  enrollment = id;
}

/** How a drawer cabled to a printer is opened (set by the counter, which knows the printers). */
export function setDrawerKick(fn: ((printerId: string) => Promise<void>) | undefined): void {
  kick = fn;
}

const COUNTER = 'clear.drawer.counter';

/**
 * The one way a screen reaches the cash drawer. The preview gets the simulation (`&drawerHw=stuck`
 * for one that never answers); everywhere else Bluetooth (the app's, or Chrome's Web Bluetooth).
 */
export function drawerService(opts: { preview?: boolean; stuck?: boolean } = {}): DrawerService {
  if (opts.preview) {
    const k = opts.stuck ? 'stuck' : 'ok';
    if (!previews.has(k)) previews.set(k, mockDrawer({ stuck: opts.stuck }));
    return previews.get(k)!;
  }
  const platform = currentPlatform();
  return (live ??= bleDrawer({
    central: () => capacitorCentral(platform),
    vault: platform === 'web' ? indexedDbVault() : secureStorageVault(),
    enrollment: () => enrollment,
    counter: {
      // Not a secret: a counter that only goes up. Lost, it starts again from the clock.
      last: () => Number(globalThis.localStorage?.getItem(COUNTER) ?? '0') || 0,
      save: (n) => {
        try {
          localStorage.setItem(COUNTER, String(n));
        } catch {
          // Private windows: the next open starts from the clock, which the drawer still takes.
        }
      },
    },
    kick: (printerId) => (kick ? kick(printerId) : Promise.reject(new Error('No printer to pulse'))),
  }));
}

/** Signed out, or removed: no drawer key stays on this tablet. */
export async function forgetDrawerKeys(): Promise<void> {
  await (currentPlatform() === 'web' ? indexedDbVault() : secureStorageVault()).forget().catch(() => undefined);
}
