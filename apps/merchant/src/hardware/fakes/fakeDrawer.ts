import { sameBytes, text } from '../ble/bytes';
import { DRAWER_CLOCK_SKEW_S, DRAWER_COMMAND, DRAWER_PAIR, DRAWER_SERVICE, DRAWER_STATE, MAC_BYTES, OP_OPEN, OP_PAIR, macOf } from '../drawer/protocol';
import { FakePeripheral } from './peripheral';

/**
 * A Clear Drawer, as its firmware behaves (docs/hardware/drawer-protocol.md): it takes an id and a
 * key once, then opens for a command signed with that key whose counter is past the last one and
 * whose time is within five minutes of its own clock. Anything else does nothing. It says it opened,
 * and shuts after `shutAfterMs` (a hand pushing the till closed).
 */
export interface FakeDrawer {
  peripheral: FakePeripheral;
  /** Why the last command did nothing, for tests: 'unpaired' | 'short' | 'mac' | 'replay' | 'stale' | null. */
  lastRefusal: string | null;
  opens: number;
  /** Hold the button: forget the key, take a new pairing. */
  reset(): void;
  /** Shut it now (the till pushed closed). */
  shut(): void;
}

export function fakeDrawer(opts: { bluetoothId?: string; now?: () => number; shutAfterMs?: number | null } = {}): FakeDrawer {
  const now = opts.now ?? Date.now;
  let paired: { id: string; key: Uint8Array } | null = null;
  let lastCounter = 0;
  let clockOffsetS = 0;
  let open = false;
  const peripheral = new FakePeripheral(opts.bluetoothId ?? 'C1:EA:4F:2A', 'Clear Drawer', [DRAWER_SERVICE]);
  const nowS = () => Math.floor(now() / 1000) + clockOffsetS;
  const setOpen = (o: boolean) => {
    open = o;
    peripheral.notify(DRAWER_STATE, new Uint8Array([o ? 1 : 0]));
  };
  const drawer: FakeDrawer = {
    peripheral,
    lastRefusal: null,
    opens: 0,
    reset: () => {
      paired = null;
      lastCounter = 0;
    },
    shut: () => setOpen(false),
  };
  const refuse = (why: string) => void (drawer.lastRefusal = why);

  peripheral.add(DRAWER_SERVICE, {
    uuid: DRAWER_PAIR,
    write: (v) => {
      // Keyed already: a GATT error, so the tablet can say to reset it.
      if (paired) throw new Error('Already paired');
      if (v[0] !== OP_PAIR || v.length < 10) throw new Error('Not a pairing message');
      const dv = new DataView(v.buffer, v.byteOffset, v.byteLength);
      const idLen = v[9]!;
      const id = text(v.slice(10, 10 + idLen));
      const key = v.slice(10 + idLen);
      if (key.length !== 32) throw new Error('A key is 32 bytes');
      clockOffsetS = Number(dv.getBigUint64(1)) - Math.floor(now() / 1000);
      paired = { id, key };
      lastCounter = 0;
    },
  });
  peripheral.add(DRAWER_SERVICE, {
    uuid: DRAWER_COMMAND,
    write: async (v) => {
      drawer.lastRefusal = null;
      if (!paired) return refuse('unpaired');
      if (v.length !== 13 + MAC_BYTES || v[0] !== OP_OPEN) return refuse('short');
      const body = v.slice(0, 13);
      if (!sameBytes(await macOf(paired.key, paired.id, body), v.slice(13))) return refuse('mac');
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const counter = dv.getUint32(1);
      const at = Number(dv.getBigUint64(5));
      if (counter <= lastCounter) return refuse('replay');
      if (Math.abs(at - nowS()) > DRAWER_CLOCK_SKEW_S) return refuse('stale');
      lastCounter = counter;
      drawer.opens += 1;
      setOpen(true);
      if (opts.shutAfterMs !== null) setTimeout(() => open && setOpen(false), opts.shutAfterMs ?? 50);
    },
  });
  peripheral.add(DRAWER_SERVICE, { uuid: DRAWER_STATE, read: () => new Uint8Array([open ? 1 : 0]) });
  return drawer;
}
