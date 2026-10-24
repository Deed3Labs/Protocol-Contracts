/** Where the API is, the Privy app (the Clear app's), and whether this is the live app. */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? '';

/**
 * The preview (`?preview=1`, dev only) is the prototype as it was: its simulated sign-in and its demo
 * team. The checks against the prototype run on it. Anything else is the live app.
 */
export const PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1';
export const LIVE = !PREVIEW;

/**
 * Real data only (Phase 9): the live app, or the preview with `&empty=1`, which is the live app's
 * pages with nothing loaded, for checking every page renders empty. Under it the prototype's data never
 * shows: every dataset starts empty and the dates are today's.
 */
export const EMPTY_PREVIEW = PREVIEW && new URLSearchParams(window.location.search).get('empty') === '1';
export const REAL = LIVE || EMPTY_PREVIEW;
