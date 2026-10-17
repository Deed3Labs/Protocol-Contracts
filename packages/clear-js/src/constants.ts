/**
 * The contract's values, copied rather than imported: `@clear/public-api-contracts` is zod, and the
 * script must stay small. `constants.test.ts` fails if any of these drift from the contract.
 */

/** This package's version. `/v1.<VERSION>.js` is the immutable copy on js.useclear.org. */
export const VERSION = '0.1.0';

/** `Clear-Version` sent with every request (`LATEST_VERSION` in the contract). */
export const CLEAR_VERSION = '2026-10-16';

export const API_BASE = 'https://api.useclear.org';

/** Where the modal's frame lives (`PAY_ORIGIN`). */
export const PAY_ORIGIN = 'https://pay.useclear.org';

/** Every frame message carries `protocol: PROTOCOL` (`PROTOCOL`). */
export const PROTOCOL = 'clear.v1';

/** The frame's error codes (`MODAL_ERROR_CODES`). */
export const MODAL_ERROR_CODES = ['session_expired', 'origin_not_allowed', 'unavailable'] as const;

/** The contract's id rules (`ID_PREFIXES`, `prefixed`). */
export const PAYMENT_ID = /^pay_[A-Za-z0-9]{1,64}$/;
export const PRICE_ID = /^price_[A-Za-z0-9]{1,64}$/;

/** A publishable key. The API checks the rest. */
export const PUBLISHABLE_KEY = /^clear_pk_(test|live)_[A-Za-z0-9]+$/;

/** The options the API takes besides the target (`ModalOptions`). Anything else never leaves the page. */
export const MODAL_OPTIONS = ['accent', 'logo', 'locale', 'methods', 'email'] as const;

/** How long the modal waits, from the click, for the frame's `ready` before giving up. */
export const READY_TIMEOUT_MS = 20_000;
