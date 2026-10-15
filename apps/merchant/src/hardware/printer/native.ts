import type { PrinterSettings } from '@clear/merchant-contracts';
import { printReceipt } from '@/lib/printReceipt';
import { jobBytes } from '../print/printJobs';
import { browserCanvas } from './canvas';
import { PrinterUnavailable, type PrinterService } from './types';

/**
 * Printers from the installed app: a raw socket to port 9100 for Wi-Fi printers and Bluetooth for
 * the rest (the plugins, Phase 6), and the OS print path for the device's own. The bytes are the
 * label renderer's, in the printer's language.
 */
export interface RawTransport {
  send(address: string, bytes: Uint8Array): Promise<void>;
  reachable(address: string): Promise<boolean>;
  discover(): Promise<{ address: string; model: string }[]>;
}

export function nativePrinters(transport: { wifi: RawTransport | null; bluetooth: RawTransport | null }): PrinterService {
  const via = (p: PrinterSettings) => (p.connection === 'wifi' ? transport.wifi : p.connection === 'bluetooth' ? transport.bluetooth : null);
  return {
    discover: async () => {
      const found = [
        {
          address: null as string | null,
          connection: 'os' as const,
          model: 'This tablet’s printer',
        },
      ];
      for (const [connection, t] of [
        ['wifi', transport.wifi],
        ['bluetooth', transport.bluetooth],
      ] as const) {
        if (t)
          for (const p of await t.discover().catch(() => []))
            found.push({
              address: p.address,
              connection: connection as never,
              model: p.model,
            });
      }
      return found;
    },
    print: async (job, printer) => {
      if (printer.connection === 'os' || printer.language === 'os') {
        if (job.kind !== 'receipt') throw new PrinterUnavailable('The print dialog takes receipts; labels need a label printer');
        printReceipt(job.receipt);
        return;
      }
      const t = via(printer);
      if (!t || !printer.address) throw new PrinterUnavailable('Printing straight to a printer comes with the next app update');
      const bytes = jobBytes(job, printer, browserCanvas);
      if (!bytes) throw new PrinterUnavailable('That printer’s language isn’t one Clear speaks');
      await t.send(printer.address, bytes);
    },
    status: async (printer) => {
      const t = via(printer);
      if (!t || !printer.address) return 'unknown';
      return (await t.reachable(printer.address).catch(() => false)) ? 'ready' : 'offline';
    },
  };
}
