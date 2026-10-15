import { DrawerUnavailable, type DrawerService, type DrawerSignal } from './types';

/**
 * A Clear Drawer from the installed app, over the Capacitor Bluetooth plugin (Phase 6). Until that
 * plugin is in the app, the drawer says so on the change screen rather than failing silently.
 */
export function nativeDrawer(): DrawerService {
  const listeners = new Set<(s: DrawerSignal) => void>();
  return {
    pair: async () => {
      throw new DrawerUnavailable('Pairing a drawer comes with the next app update');
    },
    open: async () => {
      const at = new Date().toISOString();
      listeners.forEach((l) =>
        l({
          kind: 'unreachable',
          at,
          why: 'Bluetooth drawers come with the next app update',
        }),
      );
    },
    events: (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
  };
}
