/*
 * Integration client (Bridge / Persona / Plaid).
 *
 * Real calls go through OUR backend — recommended: extend the existing member API that
 * @/utils/apiClient already targets (single backend, shared auth, and Bridge/Persona/Plaid secrets
 * stay server-side; webhooks land there too). The base URL is abstracted here so it can later be
 * pointed at dedicated serverless functions without touching callers.
 *
 * Until that backend + keys exist, every integration function falls back to an in-app MOCK so the
 * prototype/demo keeps working. Turn the real path on with VITE_INTEGRATIONS_LIVE=true (and
 * VITE_API_BASE_URL if the API isn't same-origin).
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

export const INTEGRATIONS_LIVE = env.VITE_INTEGRATIONS_LIVE === 'true';
export const API_BASE = env.VITE_API_BASE_URL ?? '/api';

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
