import { stepUpDenied } from './stepUp';

/*
 * Spendable account details — the numbers a member gives an employer or another bank.
 *
 * Read from the API (which reads Lithic) each time the surface opens. The masked read carries the
 * account number's last four only. The full number comes from a second read behind re-authentication
 * (Face ID, or for a member without it a sign-in made minutes ago with a code: the server's
 * requireReauth, which never lets the session through on its own), lives in
 * the surface's own React state while it is open, and is dropped when it closes. It never goes to
 * localStorage, sessionStorage, IndexedDB, the service worker's cache or a remembered page state:
 * nothing in this file or the surface writes anywhere but component memory and, on the member's own
 * tap, the clipboard or a download.
 */

// --- Copy -----------------------------------------------------------------------------------------

export const ACCOUNT_DETAILS_TITLE = 'Spendable account details';

export const ACCOUNT_DETAILS_NOTE =
  "Use these for direct deposit or bank transfers. Money that lands here clears what you've used on Clear Credit first, then the rest is spendable. You can change this in Settings › Automatic clearing.";

/**
 * The deposit disclosure (owner's decision, 2026-11-14). Lithic places accounts across several
 * partner banks, so it names Lithic's partner banks rather than one bank. Clear is not a bank and
 * says so. If a single bank is ever named, or the bank asks for different words, change it here.
 */
export const BANK_DISCLOSURE =
  "Deposits are held at Lithic's partner banks, each Member FDIC. Clear is not a bank. Banking services are provided by Lithic's partner banks.";

/** The disclosure shown under the details and on the direct deposit form. */
export function bankDisclosure(): string {
  return BANK_DISCLOSURE;
}

export const DIRECT_DEPOSIT_FORM_ACTION = 'Get direct deposit form';

/** Shown where a value is missing: an em dash, never a blank half-row. */
export const MISSING = '—';

/** Four middle dots and the last four: ····1234. */
export function maskedAccountNumber(last4: string): string {
  return `····${last4}`;
}

// --- Data -----------------------------------------------------------------------------------------

export interface MaskedAccountDetails {
  holderName: string | null;
  bankName: string | null;
  routingNumber: string;
  accountNumberLast4: string;
  accountType: string;
}

export type MaskedRead = { configured: boolean; details: MaskedAccountDetails | null } | { error: string };

/**
 * What the member can do when the server refused the full number for want of re-authentication:
 * `sign_in` -- no Face ID, so sign in again with a code (the app's existing way back, as on the lock
 * screen); `set_up` -- no way to confirm it's them yet, so turn on Face ID.
 */
export type Reauth = 'sign_in' | 'set_up';
export type FullNumberRead = { accountNumber: string } | { error: string; reauth?: Reauth };

export const SIGN_IN_AGAIN_ACTION = 'Send me a code';
export const SET_UP_FACE_ID_ACTION = 'Turn on Face ID';

/** Where the surface reads from. The app's is the API; the preview harness hands in fixtures. */
export interface AccountDetailsSource {
  readMasked(): Promise<MaskedRead>;
  /** The full account number. The server refuses it without a fresh Face ID or a fresh sign-in. */
  readFullNumber(): Promise<FullNumberRead>;
}

/**
 * Face ID first (for a member who has it), then the full number -- or the full number already held,
 * without asking again. A member without Face ID is asked by the server instead (a fresh sign-in),
 * and its refusal comes back with what to do (`reauth`).
 */
export async function obtainFullNumber(
  held: string | null,
  source: AccountDetailsSource,
  gate: () => Promise<string | null> = stepUpDenied,
): Promise<FullNumberRead> {
  if (held) return { accountNumber: held };
  const denied = await gate();
  if (denied) return { error: denied };
  return source.readFullNumber();
}

// --- State ----------------------------------------------------------------------------------------

export interface AccountDetailsState {
  /** Bumped on every open, so an answer that lands after a close (or a reopen) is ignored. */
  session: number;
  status: 'closed' | 'loading' | 'ready' | 'unavailable' | 'error';
  details: MaskedAccountDetails | null;
  /** The full account number, once the member has passed Face ID. Component memory only. */
  fullNumber: string | null;
  /** Whether the full number is on screen. */
  shown: boolean;
  /** Why a reveal did not happen, for the line under the rows. */
  problem: string | null;
  /** What would let it happen: sign in again, or turn on Face ID. */
  reauth: Reauth | null;
}

export type AccountDetailsAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'loaded'; session: number; read: MaskedRead }
  | { type: 'revealed'; session: number; accountNumber: string; show: boolean }
  | { type: 'failed'; session: number; error: string; reauth?: Reauth }
  | { type: 'hide' };

export const CLOSED: AccountDetailsState = {
  session: 0,
  status: 'closed',
  details: null,
  fullNumber: null,
  shown: false,
  problem: null,
  reauth: null,
};

export function accountDetailsReducer(state: AccountDetailsState, action: AccountDetailsAction): AccountDetailsState {
  switch (action.type) {
    case 'open':
      return { ...CLOSED, session: state.session + 1, status: 'loading' };
    case 'close':
      // Everything goes, the full number first among it.
      return { ...CLOSED, session: state.session };
    case 'loaded': {
      if (action.session !== state.session || state.status === 'closed') return state;
      const read = action.read;
      if ('error' in read) return { ...state, status: 'error', details: null };
      if (!read.details) return { ...state, status: 'unavailable', details: null };
      return { ...state, status: 'ready', details: read.details };
    }
    case 'revealed':
      if (action.session !== state.session || state.status !== 'ready') return state;
      return { ...state, fullNumber: action.accountNumber, shown: action.show || state.shown, problem: null, reauth: null };
    case 'failed':
      if (action.session !== state.session || state.status === 'closed') return state;
      return { ...state, problem: action.error, reauth: action.reauth ?? null };
    case 'hide':
      return { ...state, shown: false };
  }
}

/** What the account number row shows: the full number only while revealed, otherwise ····1234. */
export function accountNumberShown(state: AccountDetailsState): string {
  if (state.shown && state.fullNumber) return state.fullNumber;
  return state.details ? maskedAccountNumber(state.details.accountNumberLast4) : MISSING;
}

// --- Clipboard ------------------------------------------------------------------------------------

/**
 * Copy text that may still be on its way.
 *
 * Copying the account number before it has been revealed asks for Face ID first, and by the time
 * that resolves Safari no longer counts the tap as the gesture that allows a write. A ClipboardItem
 * built from a promise is written inside the tap and filled when the promise settles, which Safari
 * and Chrome both accept. Without one, it falls back to writing the text once it is known.
 */
export async function copyText(text: string | Promise<string>): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard) return false;
  try {
    if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined' && clipboard.write) {
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    }
    await clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}
