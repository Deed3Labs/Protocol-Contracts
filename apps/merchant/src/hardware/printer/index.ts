import { currentPlatform } from '@/reader/platform';
import { mockPrinters } from './mock';
import { nativePrinters } from './native';
import type { PrinterService } from './types';
import { webPrinters } from './web';

export * from './types';

let live: PrinterService | null = null;
let preview: ReturnType<typeof mockPrinters> | null = null;

/** The one way a screen prints. The raw-socket and Bluetooth transports arrive with the plugins (Phase 6). */
export function printerService(opts: { preview?: boolean } = {}): PrinterService {
  if (opts.preview) return (preview ??= mockPrinters());
  return (live ??= currentPlatform() === 'web' ? webPrinters() : nativePrinters({ wifi: null, bluetooth: null }));
}
