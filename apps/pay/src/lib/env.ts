/** The API, as the merchant app finds it. */
export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:3001').replace(/\/+$/, '');

/**
 * The preview (`?preview=1`): the spec's Mi Casa Tacos on a seeded mock, with no API. Development
 * builds only, so a production page can never be talked into showing made-up figures.
 */
export const PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1';
