import { DRAWER_COMMAND, DRAWER_SERVICE, DRAWER_STATE, signedOpen, stateOf } from './protocol';
import { DrawerUnavailable, type DrawerService, type DrawerSignal } from './types';

/**
 * A Clear Drawer from a browser, over Web Bluetooth (Chrome on Android and desktop; Safari has none,
 * which is why the iPad uses the installed app). The key comes from the server while online and is
 * kept for the tablet's enrollment, so the drawer opens offline too.
 */

interface BluetoothLike {
  requestDevice(o: { filters: { services: string[] }[] }): Promise<{
    id: string;
    name?: string;
    gatt?: { connect(): Promise<GattServer> };
  }>;
}
interface GattServer {
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }>;
}
interface Characteristic {
  writeValueWithResponse(v: Uint8Array): Promise<void>;
  startNotifications(): Promise<Characteristic>;
  addEventListener(type: 'characteristicvaluechanged', fn: (e: { target: { value: DataView } }) => void): void;
}

export function webDrawer(deps: { drawerId: () => string | null; key: () => Promise<Uint8Array | null>; counter: () => number }): DrawerService {
  const listeners = new Set<(s: DrawerSignal) => void>();
  const emit = (s: DrawerSignal) => listeners.forEach((l) => l(s));
  let command: Characteristic | null = null;
  const bluetooth = (): BluetoothLike => {
    const b = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth;
    if (!b) throw new DrawerUnavailable('This browser can’t reach a Bluetooth drawer. Use the Clear app on this tablet.');
    return b;
  };
  async function connect() {
    if (command) return command;
    const device = await bluetooth().requestDevice({
      filters: [{ services: [DRAWER_SERVICE] }],
    });
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(DRAWER_SERVICE);
    command = await service.getCharacteristic(DRAWER_COMMAND);
    const state = await (await service.getCharacteristic(DRAWER_STATE)).startNotifications();
    state.addEventListener('characteristicvaluechanged', (e) => emit({ kind: stateOf(e.target.value), at: new Date().toISOString() }));
    return command;
  }
  return {
    pair: async () => {
      const device = await bluetooth().requestDevice({
        filters: [{ services: [DRAWER_SERVICE] }],
      });
      return { bluetoothId: device.id, name: device.name ?? 'Clear Drawer' };
    },
    open: async () => {
      try {
        const drawerId = deps.drawerId();
        const key = await deps.key();
        if (!drawerId || !key) throw new DrawerUnavailable('This drawer isn’t paired to this tablet');
        const c = await connect();
        await c.writeValueWithResponse(
          await signedOpen({
            drawerId,
            key,
            counter: deps.counter(),
            at: Date.now(),
          }),
        );
      } catch (error) {
        emit({
          kind: 'unreachable',
          at: new Date().toISOString(),
          why: error instanceof Error ? error.message : 'No answer',
        });
      }
    },
    events: (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
  };
}
