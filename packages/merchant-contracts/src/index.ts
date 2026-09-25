/**
 * @clear/merchant-contracts — the seam between the merchant app and the API
 * (card-processing prompt, Phase 2; merchant UI prompt, Phase 3).
 *
 * Types and validation schemas, the order and tender state machines, the card fee rule, and the
 * typed API client interface. The API validates requests with these schemas; the app builds its
 * mock and real clients against `MerchantApi`. Changing anything here changes the other side:
 * flag it in the PR.
 */
export * from './common';
export * from './shop';
export * from './cards';
export * from './catalog';
export * from './orders';
export * from './drawer';
export * from './states';
export * from './fees';
export type { MerchantApi } from './client';
