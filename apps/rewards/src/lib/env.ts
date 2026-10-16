/** Where the API is, and which network the Clear balance and payments run on (never the hostname). */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

const MAINNET = { id: 8453, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
const TESTNET = { id: 84532, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' };
export const CLEAR_CHAIN = import.meta.env.VITE_CLEAR_NETWORK === 'mainnet' ? MAINNET : TESTNET;

/** The Clear app, for "Open in Clear". */
export const CLEAR_APP_URL = (import.meta.env.VITE_CLEAR_APP_URL ?? 'https://demo.useclear.org').replace(/\/+$/, '');

/** The preview is dev only. */
export const PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1';
