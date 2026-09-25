import { type TerminalBackend, ReaderUnavailable } from './types';

/**
 * The server's half of a card payment, until the app's data layer wires the real client (merchant
 * UI prompt, Phase 3). The endpoints exist (/api/merchant/cards/…, /api/merchant/tenders/…); this
 * stand-in keeps a live shop's card screen saying cards aren't ready rather than pretending.
 */
const notYet = (): never => {
  throw new ReaderUnavailable('Card payments aren’t switched on for this shop yet.');
};

export const unavailableBackend: TerminalBackend = {
  connectionToken: async () => notYet(),
  readers: async () => [],
  recordReader: async () => notYet(),
  startCardTender: async () => notYet(),
  present: async () => notYet(),
  sync: async () => notYet(),
  cancelTender: async () => notYet(),
};
