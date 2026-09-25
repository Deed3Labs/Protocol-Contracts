import { serverSmartReaders } from './server';
import type { ReaderInfo, ReaderService, TerminalBackend } from './types';

/**
 * The browser's readers: Stripe smart readers, driven from the server (./server.ts). The M2 and
 * Tap to Pay need the installed app, so a browser never lists them.
 *
 * No Stripe SDK loads in the browser. Stripe's web SDK would need this device and the reader on the
 * same local network; sent from the server, the reader only needs the internet.
 */
export async function webReader(backend: TerminalBackend): Promise<ReaderService> {
  const smart = serverSmartReaders(backend);
  let current: ReaderInfo | null = null;

  return {
    platform: 'web',
    kinds: ['smart'],
    discover: async (kind) => (kind === 'smart' ? smart.discover() : []),
    // Nothing to connect to: the server addresses the reader by its id each time.
    async connect(reader) {
      current = reader;
    },
    connected: () => current,
    async collect(amountCents, onEvent, order) {
      if (!current) throw new Error('Choose a reader first');
      return smart.collect(current, amountCents, onEvent, order);
    },
    cancel: () => smart.cancel(),
    async disconnect() {
      current = null;
    },
  };
}
