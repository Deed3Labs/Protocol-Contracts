import type { PrinterSettings } from '@clear/merchant-contracts';
import type { PrintJob } from '../print/printJobs';

/**
 * A printer, as a screen sees it (terminal reference, section 4). The tablet draws each label at the
 * printer's own resolution and sends it in the printer's language; the server only stores which
 * printer prints what. Screens never open a socket.
 */

export interface FoundPrinter {
  /** `192.168.1.40:9100`, a Bluetooth id, or null for the device's own print dialog. */
  address: string | null;
  connection: PrinterSettings['connection'];
  /** What it calls itself: "Clear 4-inch", "Rollo". */
  model: string;
}

export type PrinterStatus = 'ready' | 'offline' | 'unknown';

export interface PrinterService {
  /** Printers this tablet can reach (Add a device › Printer). */
  discover(): Promise<FoundPrinter[]>;
  /** Draw and send one job. Rejects with a sentence when it can't. */
  print(job: PrintJob, printer: PrinterSettings): Promise<void>;
  status(printer: PrinterSettings): Promise<PrinterStatus>;
}

export class PrinterUnavailable extends Error {}
