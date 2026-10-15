import { DRAWER_ANSWER_MS, type DrawerService, type DrawerSignal } from './types';

/**
 * The preview's drawer: opens a moment after it's told to and shuts a few seconds later, or, with
 * `&drawerHw=stuck`, never answers, so the change screen's "Drawer didn't open" shows.
 */
export function mockDrawer(opts: { stuck?: boolean } = {}): DrawerService {
  const listeners = new Set<(s: DrawerSignal) => void>();
  const emit = (s: DrawerSignal) => listeners.forEach((l) => l(s));
  const now = () => new Date().toISOString();
  return {
    pair: async () => ({ bluetoothId: 'C1:EA:4F:2A', name: 'Clear Drawer' }),
    open: async () => {
      if (opts.stuck) {
        setTimeout(() => emit({ kind: 'unreachable', at: now(), why: 'No answer' }), DRAWER_ANSWER_MS);
        return;
      }
      setTimeout(() => emit({ kind: 'opened', at: now() }), 300);
      setTimeout(() => emit({ kind: 'shut', at: now() }), 6000);
    },
    events: (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
  };
}
