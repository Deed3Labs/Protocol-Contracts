import { registerPlugin } from '@capacitor/core';
import type { BleCentral } from '../ble/central';
import { toBase64 } from '../ble/bytes';
import type { RawTransport } from './native';

/**
 * How the installed app reaches a printer: a raw socket to port 9100 for Wi-Fi printers (Clear's own
 * plugin, `native/socket`), and Bluetooth for the rest. The bytes are the label renderer's, already
 * in the printer's language.
 */

interface ClearSocketPlugin {
  send(o: { host: string; port: number; data: string; timeoutMs?: number }): Promise<void>;
  reachable(o: { host: string; port: number; timeoutMs?: number }): Promise<{ reachable: boolean }>;
  discover(o: { type?: string; timeoutMs?: number }): Promise<{ printers: { name: string; host: string; port: number }[] }>;
}

export const RAW_PORT = 9100;

/** "192.168.1.40:9100", "192.168.1.40" (port 9100), or "[fe80::1]:9100". */
export function hostPort(address: string): { host: string; port: number } {
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(address);
  if (v6) return { host: v6[1]!, port: Number(v6[2] ?? RAW_PORT) };
  const [host, port] = address.split(':');
  return { host: host!, port: Number(port ?? RAW_PORT) };
}

export function socketTransport(plugin: ClearSocketPlugin = registerPlugin<ClearSocketPlugin>('ClearSocket')): RawTransport {
  return {
    send: async (address, bytes) => plugin.send({ ...hostPort(address), data: toBase64(bytes) }),
    reachable: async (address) => (await plugin.reachable({ ...hostPort(address), timeoutMs: 2000 })).reachable,
    discover: async () => (await plugin.discover({ type: '_pdl-datastream._tcp', timeoutMs: 3000 })).printers.map((p) => ({ address: `${p.host}:${p.port}`, model: p.name })),
  };
}

/**
 * Bluetooth printers carry print data on a write characteristic of a vendor service. These are the
 * services label and receipt printers use; the first one a printer has is the one written to.
 */
export const BLE_PRINTER_SERVICES: { service: string; write: string; maker: string }[] = [
  { service: '38eb4a80-c570-11e3-9507-0002a5d5c51b', write: '38eb4a82-c570-11e3-9507-0002a5d5c51b', maker: 'Zebra' },
  { service: '000018f0-0000-1000-8000-00805f9b34fb', write: '00002af1-0000-1000-8000-00805f9b34fb', maker: 'ESC/POS' },
  { service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', write: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', maker: 'ESC/POS' },
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', write: '49535343-8841-43f4-a8d4-ecbe34729bb3', maker: 'Serial' },
];

export function bleTransport(central: () => BleCentral): RawTransport {
  const services = BLE_PRINTER_SERVICES.map((s) => s.service);
  return {
    send: async (address, bytes) => {
      const link = await central().connect(address);
      try {
        const offered = new Set((await link.services()).map((s) => s.uuid.toLowerCase()));
        const pick = BLE_PRINTER_SERVICES.find((s) => offered.has(s.service));
        if (!pick) throw new Error('That isn’t a printer Clear can send to');
        const size = await link.maxWrite();
        // In pieces the link carries; each waits for the last, so the printer's buffer keeps up.
        for (let i = 0; i < bytes.length; i += size) await link.write(pick.service, pick.write, bytes.subarray(i, i + size), { withoutResponse: true });
      } finally {
        await link.disconnect().catch(() => undefined);
      }
    },
    reachable: async (address) => {
      try {
        await (await central().connect(address)).disconnect();
        return true;
      } catch {
        return false;
      }
    },
    discover: async () => (await central().scan({ services, ms: 4000 })).map((d) => ({ address: d.id, model: d.name ?? 'Bluetooth printer' })),
  };
}
