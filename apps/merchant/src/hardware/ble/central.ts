import { BleClient } from '@capacitor-community/bluetooth-le';
import { bytesOf, view } from './bytes';

/**
 * Bluetooth Low Energy, as the drawer, the Points and Bluetooth printers use it: one interface over
 * `@capacitor-community/bluetooth-le`, which is the platform's own Bluetooth in the installed app
 * and Web Bluetooth in Chrome. The fakes (`hardware/fakes`) implement the same interface in memory,
 * so the protocols run in tests with no radio.
 */

export interface FoundDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

export interface GattCharacteristic {
  uuid: string;
  /** The user description descriptors (0x2901) say what each is for, where a protocol names them. */
  descriptors: string[];
}

export interface BleLink {
  readonly id: string;
  services(): Promise<{ uuid: string; characteristics: GattCharacteristic[] }[]>;
  read(service: string, characteristic: string): Promise<Uint8Array>;
  readDescriptor(service: string, characteristic: string, descriptor: string): Promise<Uint8Array>;
  write(service: string, characteristic: string, value: Uint8Array, opts?: { withoutResponse?: boolean }): Promise<void>;
  /** Notifications until the returned function is called. */
  notify(service: string, characteristic: string, on: (value: Uint8Array) => void): Promise<() => Promise<void>>;
  /** The largest write this link takes in one go (the ATT MTU less its 3-byte header). */
  maxWrite(): Promise<number>;
  disconnect(): Promise<void>;
}

export interface BleCentral {
  /**
   * One device, chosen: the browser's chooser on the web, the first match of a short scan in the app.
   * `namePrefix` narrows it ("CLEAR-A7K2" for a Point); `services` is what it advertises.
   */
  request(o: { services?: string[]; namePrefix?: string; optionalServices?: string[] }): Promise<FoundDevice>;
  /** Everything matching, for a few seconds. The web can't scan, so it asks for one. */
  scan(o: { services?: string[]; namePrefix?: string; ms?: number }): Promise<FoundDevice[]>;
  connect(id: string, onDisconnect?: () => void): Promise<BleLink>;
}

export class BluetoothUnavailable extends Error {}

/** User description: the name an endpoint goes by (ESP32 provisioning names its characteristics). */
export const USER_DESCRIPTION = '00002901-0000-1000-8000-00805f9b34fb';

let ready: Promise<void> | null = null;
const init = () =>
  (ready ??= BleClient.initialize().catch((e: unknown) => {
    ready = null;
    throw new BluetoothUnavailable(e instanceof Error && /not supported|unavailable/i.test(e.message) ? 'This device can’t use Bluetooth' : 'Turn on Bluetooth to reach it');
  }));

export function capacitorCentral(platform: 'ios' | 'android' | 'web'): BleCentral {
  const central: BleCentral = {
    request: async (o) => {
      await init();
      const d = await BleClient.requestDevice({ services: o.services, namePrefix: o.namePrefix, optionalServices: o.optionalServices });
      return { id: d.deviceId, name: d.name ?? null, rssi: null };
    },
    scan: async (o) => {
      await init();
      if (platform === 'web') return [await central.request(o)];
      const found = new Map<string, FoundDevice>();
      await BleClient.requestLEScan({ services: o.services, namePrefix: o.namePrefix }, (r) =>
        found.set(r.device.deviceId, { id: r.device.deviceId, name: r.localName ?? r.device.name ?? null, rssi: r.rssi ?? null }),
      );
      await new Promise((done) => setTimeout(done, o.ms ?? 4000));
      await BleClient.stopLEScan();
      return [...found.values()];
    },
    connect: async (id, onDisconnect) => {
      await init();
      await BleClient.connect(id, () => onDisconnect?.());
      return {
        id,
        services: async () =>
          (await BleClient.getServices(id)).map((s) => ({
            uuid: s.uuid,
            characteristics: s.characteristics.map((c) => ({ uuid: c.uuid, descriptors: c.descriptors.map((d) => d.uuid) })),
          })),
        read: async (s, c) => bytesOf(await BleClient.read(id, s, c)),
        readDescriptor: async (s, c, d) => bytesOf(await BleClient.readDescriptor(id, s, c, d)),
        write: async (s, c, v, opts) => (opts?.withoutResponse ? BleClient.writeWithoutResponse(id, s, c, view(v)) : BleClient.write(id, s, c, view(v))),
        notify: async (s, c, on) => {
          await BleClient.startNotifications(id, s, c, (v) => on(bytesOf(v)));
          return () => BleClient.stopNotifications(id, s, c);
        },
        // The web reports no MTU; 20 bytes is what every link takes.
        maxWrite: async () => (platform === 'web' ? 20 : Math.max(20, (await BleClient.getMtu(id).catch(() => 23)) - 3)),
        disconnect: () => BleClient.disconnect(id),
      };
    },
  };
  return central;
}
