import { payShopCalls, type Call } from '@clear/member-kit/pay/payShopCalls';
import type { RewardsSession } from '@clear/merchant-contracts';
import type { ChargeView, RewardsData } from './types';
import { CONSENT_VERSION } from './types';

/**
 * The live app's data, over the API (routes/rewards.ts). Two kinds of credential:
 *
 *   - the Privy session, for minting rewards tokens and for the Clear app's own routes the pay sheet
 *     uses (charges, pay now, balances), exactly as the Clear app calls them;
 *   - rewards tokens: one per shop, which see only that shop, and the hub's, which lists shops.
 *
 * A shop's routes always get that shop's token, so even a bug here can't read another shop's data:
 * the API refuses it (403 `scope`).
 */

export interface LiveDeps {
  apiBase: string;
  /** The Privy access token, or null when signed out. */
  privyToken(): Promise<string | null>;
  /** The member's smart wallet, lowercased. */
  wallet(): string | null;
  /** Sends a sponsored batch from the smart wallet on a chain; resolves to the transaction hash. */
  sendCalls(calls: Call[], chainId: number): Promise<string>;
  /** The chain and USDC the Clear balance is read on (VITE_CLEAR_NETWORK). */
  chain: { id: number; usdc: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function liveData(deps: LiveDeps): RewardsData {
  const tokens = new Map<string, RewardsSession>();
  const fresh = (s: RewardsSession | undefined) => s && new Date(s.expiresAt).getTime() - Date.now() > 60_000;

  async function call<T>(path: string, init: RequestInit & { auth: 'privy' | 'hub' | { shop: string } | 'none' }): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (init.auth === 'privy') {
      const t = await deps.privyToken();
      if (!t) throw new ApiError('Sign in again', 401, 'signed_out');
      headers.set('authorization', `Bearer ${t}`);
      const w = deps.wallet();
      if (w) headers.set('x-wallet-address', w);
    } else if (init.auth !== 'none') {
      headers.set('authorization', `Bearer ${await token(init.auth)}`);
    }
    const r = await fetch(`${deps.apiBase}${path}`, { ...init, headers });
    if (r.status === 204) return undefined as T;
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(body?.message ?? 'That didn’t work. Try again.', r.status, body?.error ?? body?.code ?? null);
    return body as T;
  }

  async function token(scope: 'hub' | { shop: string }): Promise<string> {
    const key = scope === 'hub' ? 'hub' : `shop:${scope.shop}`;
    const have = tokens.get(key);
    if (fresh(have)) return have!.token;
    const s =
      scope === 'hub'
        ? await call<RewardsSession>('/api/rewards/session', { method: 'POST', auth: 'privy' })
        : await call<RewardsSession>(`/api/s/${scope.shop}/session`, { method: 'POST', auth: 'privy' });
    tokens.set(key, s);
    return s.token;
  }

  const shop = (slug: string) => ({ shop: slug });
  const json = (v: unknown) => JSON.stringify(v);

  async function chargeView(code: string): Promise<ChargeView & { orderId: string | null }> {
    const c = await call<{
      code: string;
      merchantName: string;
      amountCents: number;
      status: ChargeView['status'] | 'resolving' | 'refunded' | 'disputed';
      items?: { name: string; quantity: number; cents: number }[] | null;
      taxCents?: number | null;
      discountCents?: number | null;
      table?: string | null;
      orderId?: string | null;
      reward?: { name: string; points: number; appliedBy: 'counter' | 'customer' } | null;
      overTime?: boolean | null;
      online?: { channel: 'online' | 'link'; shopHost: string | null } | null;
    }>(`/api/charges/${encodeURIComponent(code)}`, { auth: 'privy' });
    return {
      code: c.code,
      shopName: c.merchantName,
      table: c.table ?? null,
      amountCents: c.amountCents,
      lines: (c.items ?? []).map((i) => ({ name: i.name, quantity: i.quantity, lineCents: i.cents })),
      taxCents: c.taxCents ?? 0,
      reward: c.reward ? { ...c.reward, amountCents: c.discountCents ?? 0 } : null,
      earnsPoints: null,
      status: c.status === 'resolving' ? 'pending' : c.status === 'refunded' || c.status === 'disputed' ? 'approved' : c.status,
      orderId: c.orderId ?? null,
      overTime: c.overTime ?? null,
      online: c.online ?? null,
    };
  }

  return {
    shop: (slug) => call(`/api/s/${slug}`, { auth: 'none' }),
    me: (slug) => call(`/api/s/${slug}/me`, { auth: shop(slug) }),
    async balanceCents() {
      const w = deps.wallet();
      if (!w) return null;
      const r = await call<{ balance: string } | null>(`/api/token-balances/${deps.chain.id}/${w}/${deps.chain.usdc}`, { auth: 'privy' }).catch(() => null);
      return r ? Math.round(Number(r.balance) * 100) : null;
    },
    person: () => call('/api/rewards/me', { auth: 'hub' }),
    createPerson: (firstName) => call('/api/rewards/me', { method: 'POST', auth: 'hub', body: json({ firstName }) }),
    deletePerson: () => call('/api/rewards/me', { method: 'DELETE', auth: 'hub' }),
    identityCode: () => call('/api/rewards/me/code', { method: 'POST', auth: 'hub' }),
    myShops: () => call('/api/rewards/me/shops', { auth: 'hub' }),
    partners: (near) => call(`/api/partners${near ? `?near=${near.lat.toFixed(4)},${near.lng.toFixed(4)}` : ''}`, { auth: 'hub' }),
    join: (slug, input) => call(`/api/s/${slug}/join`, { method: 'POST', auth: shop(slug), body: json({ texts: input.texts, birthMonth: null, consentVersion: CONSENT_VERSION, ref: input.ref ?? null, orderId: input.orderId ?? null }) }),
    updateMembership: (slug, input) => call(`/api/s/${slug}/membership`, { method: 'PATCH', auth: shop(slug), body: json(input) }),
    leave: (slug) => call(`/api/s/${slug}/membership`, { method: 'DELETE', auth: shop(slug) }),
    claim: (slug, rewardId) => call(`/api/s/${slug}/rewards/${encodeURIComponent(rewardId)}/claim`, { method: 'POST', auth: shop(slug) }),
    activity: (slug) => call(`/api/s/${slug}/activity`, { auth: shop(slug) }),
    pointShop: async (point) => (await call<{ shop: { slug?: string } }>(`/api/p/${encodeURIComponent(point)}`, { auth: 'none' })).shop.slug ?? null,
    bill: (slug, point) => call(`/api/s/${slug}/bill/${encodeURIComponent(point)}`, { auth: shop(slug) }),
    pay: (slug, point, input) => call(`/api/p/${encodeURIComponent(point)}/pay`, { method: 'POST', auth: shop(slug), body: json(input) }),
    paid: (slug, orderId) => call(`/api/s/${slug}/paid/${encodeURIComponent(orderId)}`, { auth: shop(slug) }),
    charge: chargeView,
    // The Clear app's own onboarding routes, with the same Privy session: Clear's account, not the shop's.
    onboarding: {
      bootstrapMemberAccount: () => call('/api/members/me/bootstrap', { method: 'PUT', auth: 'privy', body: '{}' }).catch(() => null),
      updateMemberOnboarding: (input) => call('/api/members/me/onboarding', { method: 'PATCH', auth: 'privy', body: json(input) }).catch(() => null),
      updateMemberProfile: (input) => call('/api/members/me/profile', { method: 'PATCH', auth: 'privy', body: json(input) }).catch(() => null),
      acceptMemberTerms: (documentType, documentVersion) => call('/api/members/me/terms/accept', { method: 'POST', auth: 'privy', body: json({ documentType, documentVersion }) }).catch(() => null),
      submitMemberOnboarding: () => call('/api/members/me/onboarding/submit', { method: 'POST', auth: 'privy', body: '{}' }).catch(() => null),
    },
    async approve(code, mode) {
      const before = await chargeView(code);
      if (mode === 'over_time') {
        await call(`/api/charges/${encodeURIComponent(code)}/approve`, { method: 'POST', auth: 'privy', body: json({ installments: 4 }) });
        return { orderId: before.orderId };
      }
      // Hold, pay from the wallet, confirm: the Clear app's own three steps, the same calls.
      const held = await call<{ pay?: { chainId: number; token: string; shop: { to: string; units: string }; fee: { to: string; units: string } } }>(
        `/api/charges/${encodeURIComponent(code)}/pay-now`,
        { method: 'POST', auth: 'privy' },
      );
      if (!held.pay) throw new ApiError('We couldn’t get this ready. Nothing was charged.', 409, null);
      const p = held.pay;
      const tx = await deps.sendCalls(
        payShopCalls({ token: p.token as `0x${string}`, shop: { to: p.shop.to as `0x${string}`, units: BigInt(p.shop.units) }, fee: { to: p.fee.to as `0x${string}`, units: BigInt(p.fee.units) } }),
        p.chainId,
      );
      await call(`/api/charges/${encodeURIComponent(code)}/pay-now/confirm`, { method: 'POST', auth: 'privy', body: json({ txHash: tx }) });
      return { orderId: before.orderId };
    },
  };
}
