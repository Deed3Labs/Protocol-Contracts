import { describe, expect, test } from 'bun:test';
import { concat } from '../ble/bytes';
import { FakePeripheral, memoryCentral } from '../fakes/peripheral';
import { BLE_PRINTER_SERVICES, bleTransport, hostPort, socketTransport } from './transports';

describe('reaching a printer from the app', () => {
  test('addresses: host and port, port 9100 when there is none, IPv6 in brackets', () => {
    expect(hostPort('192.168.1.40:9100')).toEqual({ host: '192.168.1.40', port: 9100 });
    expect(hostPort('192.168.1.41')).toEqual({ host: '192.168.1.41', port: 9100 });
    expect(hostPort('[fe80::1]:6101')).toEqual({ host: 'fe80::1', port: 6101 });
  });

  test('Wi-Fi: the bytes go to the socket plugin as base64; found printers become addresses', async () => {
    const sent: unknown[] = [];
    const t = socketTransport({
      send: async (o) => void sent.push(o),
      reachable: async () => ({ reachable: true }),
      discover: async () => ({ printers: [{ name: 'Rollo X1040', host: '192.168.1.41', port: 9100 }] }),
    });
    await t.send('192.168.1.40:9100', new Uint8Array([0x1b, 0x70, 0x00, 25, 250]));
    expect(sent).toEqual([{ host: '192.168.1.40', port: 9100, data: 'G3AAGfo=' }]);
    expect(await t.discover()).toEqual([{ address: '192.168.1.41:9100', model: 'Rollo X1040' }]);
  });

  test('Bluetooth: a label in pieces the link carries, arriving whole and in order', async () => {
    const zebra = BLE_PRINTER_SERVICES[0]!;
    const got: Uint8Array[] = [];
    const printer = new FakePeripheral('zq-1', 'ZQ220', [zebra.service], 23).add(zebra.service, { uuid: zebra.write, write: (v) => void got.push(v) });
    const t = bleTransport(() => memoryCentral([printer]));
    expect(await t.discover()).toEqual([{ address: 'zq-1', model: 'ZQ220' }]);
    const label = new Uint8Array(1000).map((_, i) => i % 251);
    await t.send('zq-1', label);
    expect(got.every((c) => c.length <= 20)).toBe(true);
    expect([...concat(...got)]).toEqual([...label]);
    expect(printer.connected).toBe(false);
  });
});
