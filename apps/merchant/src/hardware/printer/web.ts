import { printReceipt } from '@/lib/printReceipt';
import { PrinterUnavailable, type PrinterService } from './types';

/**
 * A browser has no sockets and no printer SDK: it prints through the device's own dialog
 * (lib/printReceipt.ts), which reaches a receipt printer the device can see. Labels need the
 * installed app, which sends them to the printer itself.
 */
export function webPrinters(): PrinterService {
  return {
    discover: async () => [{ address: null, connection: 'os', model: 'This tablet’s printer' }],
    print: async (job, printer) => {
      if (job.kind === 'receipt' && (printer.connection === 'os' || printer.language === 'os')) {
        printReceipt(job.receipt);
        return;
      }
      throw new PrinterUnavailable('Labels print from the Clear app on this tablet');
    },
    status: async (printer) => (printer.connection === 'os' ? 'unknown' : 'offline'),
  };
}
