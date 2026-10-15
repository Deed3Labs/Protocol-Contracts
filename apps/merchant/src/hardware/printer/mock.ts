import type { PrinterService } from './types';

/** The preview's printers: Mi Casa's two, always ready; printing records what would have gone. */
export function mockPrinters(): PrinterService & { printed: string[] } {
  const printed: string[] = [];
  return {
    printed,
    discover: async () => [
      {
        address: '192.168.1.40:9100',
        connection: 'wifi',
        model: 'Clear 4-inch',
      },
      { address: '192.168.1.41:9100', connection: 'wifi', model: 'Rollo' },
    ],
    print: async (job) => {
      printed.push(job.kind);
    },
    status: async () => 'ready',
  };
}
