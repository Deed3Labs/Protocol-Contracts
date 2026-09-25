import type { MerchantApi } from '@clear/merchant-contracts';
import { request } from '../apiClient';
import { createMockMerchantApi, type MockMerchantApi, type MockSwitches } from './mock';
import { realMerchantApi } from './real';

/**
 * The one place the app chooses its merchant API (UI prompt, Phase 3). Screens call `merchantApi()`
 * (or `useMerchantApi()`); they never import the mock or the real client.
 *
 *   VITE_MERCHANT_API=real | mock   says which, for a build
 *   otherwise                       the dev preview (`?preview=1`) gets the mock; everything else, real
 *
 * The mock reads its switches from the URL, so a state in the reference files is a link:
 * `&stripe=not_connected`, `&drawer=open|balanced|short|disagree|closed`, `&card=decline`,
 * `&clear=approve|decline|wait`, `&delay=800`.
 */

export type MerchantApiMode = 'mock' | 'real';

export function merchantApiMode(): MerchantApiMode {
  const set = (import.meta.env.VITE_MERCHANT_API as string | undefined)?.trim();
  if (set === 'mock' || set === 'real') return set;
  if (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1') return 'mock';
  return 'real';
}

function switchesFromUrl(): Partial<MockSwitches> {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  const pick = <T extends string>(k: string, allowed: readonly T[]) => (allowed.includes(q.get(k) as T) ? { [k]: q.get(k) as T } : {});
  const delay = Number(q.get('delay'));
  return {
    ...pick('stripe', ['connected', 'not_connected'] as const),
    ...pick('drawer', ['open', 'balanced', 'short', 'disagree', 'closed'] as const),
    ...pick('card', ['approve', 'decline'] as const),
    ...pick('clear', ['approve', 'decline', 'wait'] as const),
    ...(Number.isFinite(delay) && q.has('delay') ? { delayMs: delay } : {}),
  };
}

let current: { mode: MerchantApiMode; api: MerchantApi; mock: MockMerchantApi | null } | null = null;

export function merchantApi(): MerchantApi {
  if (!current) {
    const mode = merchantApiMode();
    const mock = mode === 'mock' ? createMockMerchantApi(switchesFromUrl()) : null;
    current = { mode, api: mock ? mock.api : realMerchantApi(request), mock };
  }
  return current.api;
}

/** The mock's controls (who's on shift, switches, a failure), or null against the real API. */
export function mockControls(): MockMerchantApi['controls'] | null {
  merchantApi();
  return current!.mock?.controls ?? null;
}

export const useMerchantApi = (): MerchantApi => merchantApi();
