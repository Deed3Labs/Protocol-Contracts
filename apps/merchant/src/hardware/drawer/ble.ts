import type { BleCentral, BleLink } from '../ble/central';
import { fromBase64 } from '../ble/bytes';
import type { DrawerKeyVault } from './keys';
import { DRAWER_COMMAND, DRAWER_PAIR, DRAWER_SERVICE, DRAWER_STATE, nextCounter, pairingMessage, signedOpen, stateOf } from './protocol';
import { DrawerUnavailable, type DrawerService, type DrawerSignal, type DrawerTarget } from './types';

/**
 * A Clear Drawer over Bluetooth: the installed app's own Bluetooth, or Web Bluetooth in Chrome (the
 * same plugin). The tablet signs every `open` with the drawer's key, which it keeps for its
 * enrollment, so a sale opens the drawer with no connection. A drawer cabled to a printer gets the
 * printer's pulse instead.
 */
export interface BleDrawerDeps {
  central: () => BleCentral;
  vault: DrawerKeyVault;
  /** This tablet's enrollment (`AuthValue.device.id`). Keys are kept per enrollment. */
  enrollment: () => string | null;
  /** The last counter this tablet sent, kept across restarts. */
  counter: { last(): number; save(n: number): void };
  /** The printer's drawer pulse, for a drawer cabled to it. */
  kick?: (printerId: string) => Promise<void>;
  now?: () => number;
}

export function bleDrawer(deps: BleDrawerDeps): DrawerService {
  const listeners = new Set<(s: DrawerSignal) => void>();
  const now = deps.now ?? Date.now;
  const emit = (s: DrawerSignal) => listeners.forEach((l) => l(s));
  const at = () => new Date(now()).toISOString();
  let target: DrawerTarget | null = null;
  let link: Promise<BleLink> | null = null;
  let linkedTo: string | null = null;

  function connect(bluetoothId: string): Promise<BleLink> {
    if (link && linkedTo === bluetoothId) return link;
    linkedTo = bluetoothId;
    link = (async () => {
      const l = await deps.central().connect(bluetoothId, () => {
        link = null;
        linkedTo = null;
      });
      await l.notify(DRAWER_SERVICE, DRAWER_STATE, (v) => emit({ kind: stateOf(v), at: at() }));
      return l;
    })();
    link.catch(() => {
      link = null;
      linkedTo = null;
    });
    return link;
  }

  return {
    pair: async () => {
      const d = await deps.central().request({ services: [DRAWER_SERVICE] });
      return { bluetoothId: d.id, name: d.name ?? 'Clear Drawer' };
    },
    keyDrawer: async (t, keyBase64) => {
      if (!t.bluetoothId) throw new DrawerUnavailable('That drawer is cabled to a printer, so it has no key');
      const enrollment = deps.enrollment();
      if (!enrollment) throw new DrawerUnavailable('Set up this tablet first');
      const l = await connect(t.bluetoothId);
      try {
        await l.write(DRAWER_SERVICE, DRAWER_PAIR, pairingMessage({ drawerId: t.id, key: fromBase64(keyBase64), at: now() }));
      } catch {
        throw new DrawerUnavailable('That drawer is paired to another shop. Hold its button for 10 seconds to reset it, then try again');
      }
      await deps.vault.put(enrollment, t.id, keyBase64);
    },
    rememberKey: async (t, keyBase64) => {
      const enrollment = deps.enrollment();
      if (enrollment) await deps.vault.put(enrollment, t.id, keyBase64);
    },
    use: (t) => {
      target = t;
    },
    open: async () => {
      try {
        const t = target;
        if (!t) throw new DrawerUnavailable('No drawer is set up for this tablet');
        if (t.cabledToPrinter) {
          if (!t.printerId || !deps.kick) throw new DrawerUnavailable('Pick the printer it’s cabled to');
          await deps.kick(t.printerId);
          return;
        }
        const enrollment = deps.enrollment();
        const key = enrollment ? await deps.vault.get(enrollment, t.id) : null;
        if (!t.bluetoothId || !key) throw new DrawerUnavailable('This drawer isn’t paired to this tablet');
        const counter = nextCounter(deps.counter.last(), now());
        deps.counter.save(counter);
        const l = await connect(t.bluetoothId);
        await l.write(DRAWER_SERVICE, DRAWER_COMMAND, await signedOpen({ drawerId: t.id, key, counter, at: now() }));
      } catch (error) {
        emit({ kind: 'unreachable', at: at(), why: error instanceof Error ? error.message : 'No answer' });
      }
    },
    events: (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
  };
}
