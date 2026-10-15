import { currentPlatform } from '@/reader/platform';
import { capacitorCentral } from '../ble/central';
import { bleTransport, socketTransport } from './transports';
import { mockPrinters } from './mock';
import { nativePrinters } from './native';
import type { PrinterService } from './types';
import { webPrinters } from './web';

export * from './types';

let live: PrinterService | null = null;
let preview: ReturnType<typeof mockPrinters> | null = null;

/** The one way a screen prints: the preview's, a browser's print dialog, or the app's socket and Bluetooth. */
export function printerService(opts: { preview?: boolean } = {}): PrinterService {
  if (opts.preview) return (preview ??= mockPrinters());
  const platform = currentPlatform();
  return (live ??= platform === 'web' ? webPrinters() : nativePrinters({ wifi: socketTransport(), bluetooth: bleTransport(() => capacitorCentral(platform)) }));
}
