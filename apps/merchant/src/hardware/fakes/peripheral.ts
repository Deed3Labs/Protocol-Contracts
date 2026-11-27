import type { BleCentral, BleLink, FoundDevice } from '../ble/central';
import { USER_DESCRIPTION } from '../ble/central';
import { utf8 } from '../ble/bytes';

/**
 * A Bluetooth peripheral in memory, for the fake drawer, the fake Point and a fake printer: the same
 * GATT shape a real one has (services, characteristics, a user description), so the tablet's code
 * runs against it unchanged through `memoryCentral`.
 */

export interface FakeCharacteristic {
  uuid: string;
  description?: string;
  /** What a read returns. */
  read?: () => Uint8Array | Promise<Uint8Array>;
  /** What a write does. Throwing is the GATT error a refused write gets. */
  write?: (value: Uint8Array) => void | Promise<void>;
}

export class FakePeripheral {
  readonly services = new Map<string, Map<string, FakeCharacteristic>>();
  private readonly subscribers = new Map<string, Set<(v: Uint8Array) => void>>();
  /** Every write, in order, for a test to look at. */
  readonly writes: { characteristic: string; value: Uint8Array }[] = [];
  connected = false;

  readonly id: string;
  readonly name: string;
  readonly advertises: string[];
  readonly mtu: number;

  constructor(id: string, name: string, advertises: string[], mtu = 185) {
    this.id = id;
    this.name = name;
    this.advertises = advertises;
    this.mtu = mtu;
  }

  add(service: string, c: FakeCharacteristic): this {
    if (!this.services.has(service)) this.services.set(service, new Map());
    this.services.get(service)!.set(c.uuid, c);
    return this;
  }

  /** Tell whoever is subscribed. */
  notify(characteristic: string, value: Uint8Array): void {
    this.subscribers.get(characteristic)?.forEach((s) => s(value));
  }

  link(): BleLink {
    const char = (s: string, c: string) => {
      const found = this.services.get(s)?.get(c);
      if (!found) throw new Error(`No characteristic ${c}`);
      return found;
    };
    return {
      id: this.id,
      services: async () =>
        [...this.services].map(([uuid, cs]) => ({
          uuid,
          characteristics: [...cs.values()].map((c) => ({ uuid: c.uuid, descriptors: c.description ? [USER_DESCRIPTION] : [] })),
        })),
      read: async (s, c) => {
        const r = char(s, c).read;
        if (!r) throw new Error('Not readable');
        return r();
      },
      readDescriptor: async (s, c, d) => {
        if (d !== USER_DESCRIPTION) throw new Error('No such descriptor');
        return utf8(char(s, c).description ?? '');
      },
      write: async (s, c, v) => {
        const w = char(s, c).write;
        if (!w) throw new Error('Not writable');
        if (v.length > this.mtu - 3) throw new Error(`Longer than the link takes (${v.length} > ${this.mtu - 3})`);
        this.writes.push({ characteristic: c, value: v });
        await w(v);
      },
      notify: async (_s, c, on) => {
        if (!this.subscribers.has(c)) this.subscribers.set(c, new Set());
        this.subscribers.get(c)!.add(on);
        return async () => void this.subscribers.get(c)?.delete(on);
      },
      maxWrite: async () => this.mtu - 3,
      disconnect: async () => void (this.connected = false),
    };
  }
}

/** A central that finds only these peripherals. */
export function memoryCentral(peripherals: FakePeripheral[]): BleCentral {
  const matches = (p: FakePeripheral, o: { services?: string[]; namePrefix?: string }) =>
    (!o.namePrefix || p.name.startsWith(o.namePrefix)) && (!o.services?.length || o.services.some((s) => p.advertises.includes(s)));
  const found = (p: FakePeripheral): FoundDevice => ({ id: p.id, name: p.name, rssi: -50 });
  return {
    request: async (o) => {
      const p = peripherals.find((x) => matches(x, o));
      if (!p) throw new Error('No device found');
      return found(p);
    },
    scan: async (o) => peripherals.filter((x) => matches(x, o)).map(found),
    connect: async (id) => {
      const p = peripherals.find((x) => x.id === id);
      if (!p) throw new Error('Not in range');
      p.connected = true;
      return p.link();
    },
  };
}
