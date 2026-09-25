import type { MerchantApi } from '@clear/merchant-contracts';
import { type TerminalBackend, ReaderUnavailable } from './types';

/**
 * The server's half of a card payment: the merchant API's card endpoints (UI Phase 6, step 5).
 * The reader layer calls these and nothing else; which API (the real one, or the mock in the
 * preview) is the data layer's choice (data/merchantApi).
 */
export function merchantTerminalBackend(api: MerchantApi): TerminalBackend {
  return {
    connectionToken: () => api.connectionToken(),
    readers: () => api.readers(),
    recordReader: (input) => api.recordReader(input),
    startCardTender: (orderId, input) => api.createCardTender(orderId, input),
    present: async (tenderId) => {
      await api.presentTender(tenderId);
    },
    sync: (tenderId) => api.syncTender(tenderId),
    cancelTender: async (tenderId) => {
      await api.cancelTender(tenderId);
    },
  };
}

/** For tests and a build without the data layer: every call says cards aren't ready. */
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
