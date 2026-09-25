import { type TerminalBackend, ReaderUnavailable } from './types';

/**
 * The server's half of a card payment, until it exists.
 *
 * Connection tokens, create, capture and cancel, and reader registration are the backend prompt's
 * Phase 5, typed in `packages/merchant-contracts`. Neither exists yet, so a live shop's card screen
 * says cards aren't ready rather than pretending. When the endpoints land, this is the one file
 * that changes: each method calls its endpoint.
 */
const notYet = (): never => {
  throw new ReaderUnavailable('Card payments aren’t switched on for this shop yet.');
};

export const unavailableBackend: TerminalBackend = {
  connectionToken: async () => notYet(),
  createPayment: async () => notYet(),
  capture: async () => notYet(),
  cancel: async () => notYet(),
  registerReader: async () => notYet(),
  locationId: async () => null,
};
