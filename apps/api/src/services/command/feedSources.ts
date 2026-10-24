import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import type { Queryable } from '../../db/db.js';
import { decryptWithEnvelope, encryptWithEnvelope, isEnvelopeEncryptionConfigured, type EncryptedPayload } from '../../utils/envelopeEncryption.js';
import type { Feed, FeedRow } from './feeds.js';

/*
 * The four sandbox feeds (Phase 6a). Each reads only: the one write is Plaid's sandbox-only call that
 * makes the co-op's test bank link, once. Every one refuses keys that aren't a sandbox's.
 *
 *   Plaid   once a day (COMMAND_PLAID_HOURS), and at once when Plaid's webhook says the bank has
 *           news, or a Stripe payout lands: the operating account's balances and transactions.
 *   Bridge  every 5 min: its wallets' balances and the transfers still in flight (the deposit rail).
 *   Lithic  every 5 min: this month's card spend, by merchant.
 *   Stripe  every 5 min: the balance and recent payouts.
 */

type Env = Record<string, string | undefined>;
const MIN = 60_000;
const minutes = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d) * MIN;
const fail = async (r: Response, what: string) => {
  const body = await r.text().catch(() => '');
  return new Error(`${what} ${r.status}: ${body.slice(0, 300)}`);
};

// ── Plaid ───────────────────────────────────────────────────────────────────

const PLAID_ITEM = 'coop';
const PLAID_CONTEXT = 'command:plaid:coop';
/** An encrypted token as JSON: its byte fields in base64, so it reads back as the bytes it was. */
const BYTES = ['ciphertext', 'iv', 'authTag', 'wrappedKeyCiphertext', 'wrappedKeyIv', 'wrappedKeyAuthTag'] as const;
const sealed = (p: EncryptedPayload) => ({ ...p, ...Object.fromEntries(BYTES.map((k) => [k, p[k].toString('base64')])) });
const unsealed = (j: Record<string, string>): EncryptedPayload => ({ ...(j as any), ...Object.fromEntries(BYTES.map((k) => [k, Buffer.from(j[k], 'base64')])) });

export function plaidFeed(env: Env = process.env, f: typeof fetch = fetch): Feed {
  const id = env.PLAID_CLIENT_ID?.trim(),
    secret = env.PLAID_SECRET?.trim();
  const post = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const r = await f(`https://sandbox.plaid.com${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: id, secret, ...body }) });
    if (!r.ok) {
      const j: any = await r.json().catch(() => ({}));
      throw Object.assign(new Error(`Plaid ${path} ${r.status}: ${j.error_code ?? ''} ${j.error_message ?? ''}`.trim()), { code: j.error_code });
    }
    return (await r.json()) as T;
  };
  return {
    id: 'plaid',
    everyMs: (Number(env.COMMAND_PLAID_HOURS) > 0 ? Number(env.COMMAND_PLAID_HOURS) : 24) * 60 * MIN,
    off: () =>
      !id || !secret
        ? 'PLAID_CLIENT_ID and PLAID_SECRET aren’t set'
        : (env.PLAID_ENV || '').trim().toLowerCase() !== 'sandbox'
          ? `PLAID_ENV is ${env.PLAID_ENV || 'unset'}, not sandbox`
          : !isEnvelopeEncryptionConfigured()
            ? 'the envelope key for stored tokens isn’t set'
            : null,
    async sync(db) {
      const token = await plaidToken(db, post, env);
      // the transactions since the last cursor, a page at a time
      const { rows: it } = await db.query<{ sync_cursor: string | null }>('SELECT sync_cursor FROM command.plaid_items WHERE id = $1', [PLAID_ITEM]);
      let cursor = it[0]?.sync_cursor ?? undefined;
      try {
        for (let page = 0; page < 20; page++) {
          const r = await post<any>('/transactions/sync', { access_token: token, cursor, count: 500 });
          for (const t of [...r.added, ...r.modified])
            await db.query(
              `INSERT INTO command.bank_transactions (id, item, account_id, posted_on, name, amount, pending) VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (id) DO UPDATE SET account_id = $3, posted_on = $4, name = $5, amount = $6, pending = $7`,
              [t.transaction_id, PLAID_ITEM, t.account_id, t.date, t.merchant_name || t.name || '—', t.amount, !!t.pending],
            );
          for (const t of r.removed) await db.query('DELETE FROM command.bank_transactions WHERE id = $1', [t.transaction_id]);
          cursor = r.next_cursor;
          await db.query('UPDATE command.plaid_items SET sync_cursor = $2 WHERE id = $1', [PLAID_ITEM, cursor]);
          if (!r.has_more) break;
        }
      } catch (e) {
        // a link made a moment ago has no transactions yet; its balances still count
        if ((e as any).code !== 'PRODUCT_NOT_READY') throw e;
      }
      const [acc, item] = await Promise.all([post<any>('/accounts/get', { access_token: token }), post<any>('/item/get', { access_token: token })]);
      const accounts = acc.accounts.map((a: any) => ({ id: a.account_id, name: a.official_name || a.name, mask: a.mask, type: a.type, subtype: a.subtype, current: a.balances.current, available: a.balances.available }));
      const last = item.status?.transactions?.last_successful_update;
      const checking = accounts.filter((a: any) => a.type === 'depository');
      return {
        asOf: last ? new Date(last) : new Date(),
        figures: { institution: item.item?.institution_id ?? null, accounts, balance: Math.round(checking.reduce((s: number, a: any) => s + (a.current ?? 0), 0) * 100) / 100 },
      };
    },
  };
}

/** The co-op's sandbox bank link: made once with Plaid's sandbox-only call, the token kept encrypted. */
async function plaidToken(db: Queryable, post: <T>(p: string, b: Record<string, unknown>) => Promise<T>, env: Env): Promise<string> {
  const { rows } = await db.query<{ access_token: Record<string, string> }>('SELECT access_token FROM command.plaid_items WHERE id = $1', [PLAID_ITEM]);
  if (rows.length) return decryptWithEnvelope(unsealed(rows[0].access_token), PLAID_CONTEXT);
  const institution = env.COMMAND_PLAID_INSTITUTION?.trim() || 'ins_109508';
  const hook = env.COMMAND_PLAID_WEBHOOK_URL?.trim();
  const pt = await post<{ public_token: string }>('/sandbox/public_token/create', { institution_id: institution, initial_products: ['transactions'], ...(hook ? { options: { webhook: hook } } : {}) });
  const ex = await post<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: pt.public_token });
  await db.query('INSERT INTO command.plaid_items (id, item_id, access_token, institution) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [
    PLAID_ITEM,
    ex.item_id,
    JSON.stringify(sealed(encryptWithEnvelope(ex.access_token, PLAID_CONTEXT))),
    institution,
  ]);
  return ex.access_token;
}

/**
 * Plaid's webhook, checked: an ES256 JWT in Plaid-Verification, signed with a key Plaid serves by
 * its id, issued in the last 5 minutes, over this exact body. Says whether it's for the co-op's link
 * and is news about its transactions or the link itself.
 */
export async function plaidWebhook(
  db: Queryable,
  jwt: string | undefined,
  rawBody: Buffer,
  keyFor: (kid: string) => Promise<JsonWebKey & { expired_at?: number | null }>,
  now = Date.now(),
): Promise<{ ok: false; why: string } | { ok: true; ours: boolean; wake: boolean }> {
  if (!jwt) return { ok: false, why: 'no Plaid-Verification header' };
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) return { ok: false, why: 'not a JWT' };
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  if (header.alg !== 'ES256' || !header.kid) return { ok: false, why: 'not ES256' };
  const jwk = await keyFor(header.kid);
  if (jwk.expired_at) return { ok: false, why: 'key expired' };
  const { expired_at: _e, ...key } = jwk as any;
  const good = verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey({ key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  if (!good) return { ok: false, why: 'bad signature' };
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (!claims.iat || Math.abs(now / 1000 - claims.iat) > 300) return { ok: false, why: 'stale' };
  const sum = Buffer.from(createHash('sha256').update(rawBody).digest('hex'));
  const said = Buffer.from(String(claims.request_body_sha256 ?? ''));
  if (sum.length !== said.length || !timingSafeEqual(sum, said)) return { ok: false, why: 'body changed' };
  const body = JSON.parse(rawBody.toString());
  const { rows } = await db.query('SELECT 1 FROM command.plaid_items WHERE item_id = $1', [body.item_id]);
  return { ok: true, ours: rows.length > 0, wake: rows.length > 0 && ['TRANSACTIONS', 'ITEM'].includes(body.webhook_type) };
}

/** Plaid's key for a webhook's kid, from /webhook_verification_key/get. */
export const plaidWebhookKey = (env: Env = process.env, f: typeof fetch = fetch) => async (kid: string) => {
  const r = await f('https://sandbox.plaid.com/webhook_verification_key/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, key_id: kid }),
  });
  if (!r.ok) throw await fail(r, 'Plaid webhook key');
  return ((await r.json()) as any).key;
};

// ── Bridge ──────────────────────────────────────────────────────────────────

const IN_FLIGHT = new Set(['awaiting_funds', 'funds_received', 'payment_submitted', 'in_review', 'pending']);

export function bridgeFeed(env: Env = process.env, f: typeof fetch = fetch): Feed {
  const key = env.BRIDGE_SANDBOX_API_KEY?.trim();
  const get = async (path: string) => {
    const r = await f(`https://api.sandbox.bridge.xyz/v0${path}`, { headers: { 'Api-Key': key!, Accept: 'application/json' } });
    if (!r.ok) throw await fail(r, `Bridge ${path}`);
    return (await r.json()) as any;
  };
  return {
    id: 'bridge',
    everyMs: minutes(env.COMMAND_FEEDS_MINUTES, 5),
    off: () => ((env.BRIDGE_ENV || '').trim().toLowerCase() !== 'sandbox' ? `BRIDGE_ENV is ${env.BRIDGE_ENV || 'unset'}, not sandbox` : !key ? 'BRIDGE_SANDBOX_API_KEY isn’t set' : null),
    async sync() {
      // an account with no Bridge wallets answers 404 for the list: none, rather than a failure
      const [w, t] = await Promise.all([get('/wallets?limit=100').catch((e) => (/ 404:/.test(e.message) ? { data: [] } : Promise.reject(e))), get('/transfers?limit=100')]);
      const wallets = (w.data ?? []).map((x: any) => ({ id: x.id, chain: x.chain, balances: (x.balances ?? []).map((b: any) => ({ currency: String(b.currency).toLowerCase(), amount: Number(b.balance ?? b.amount ?? 0) })) }));
      const usdc = wallets.flatMap((x: any) => x.balances).filter((b: any) => b.currency === 'usdc').reduce((s: number, b: any) => s + b.amount, 0);
      const flying = (t.data ?? []).filter((x: any) => IN_FLIGHT.has(x.state));
      return {
        figures: {
          wallets,
          usdc: Math.round(usdc * 100) / 100,
          inFlight: { count: flying.length, amount: Math.round(flying.reduce((s: number, x: any) => s + Number(x.amount ?? 0), 0) * 100) / 100 },
          transfers: (t.data ?? []).length,
        },
      };
    },
  };
}

// ── Lithic ──────────────────────────────────────────────────────────────────

export function lithicFeed(env: Env = process.env, f: typeof fetch = fetch, now = () => new Date()): Feed {
  const key = env.LITHIC_API_KEY?.trim();
  return {
    id: 'lithic',
    everyMs: minutes(env.COMMAND_FEEDS_MINUTES, 5),
    off: () => (!key ? 'LITHIC_API_KEY isn’t set' : (env.LITHIC_ENV || 'sandbox').trim().toLowerCase() !== 'sandbox' ? `LITHIC_ENV is ${env.LITHIC_ENV}, not sandbox` : null),
    async sync() {
      const n = now();
      const begin = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
      const list: any[] = [];
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({ begin: begin.toISOString().replace(/\.\d{3}Z$/, 'Z'), page_size: '100', ...(after ? { starting_after: after } : {}) });
        const r = await f(`https://sandbox.lithic.com/v1/transactions?${q}`, { headers: { Authorization: key!, Accept: 'application/json' } });
        if (!r.ok) throw await fail(r, 'Lithic /transactions');
        const j: any = await r.json();
        list.push(...j.data);
        if (!j.has_more || !j.data.length) break;
        after = j.data.at(-1).token;
      }
      // what was spent: settled and pending purchases, not declines or voids
      const spent = list.filter((t) => ['SETTLED', 'PENDING'].includes(t.status));
      const by = new Map<string, { name: string; amount: number; count: number }>();
      for (const t of spent) {
        const name = String(t.merchant?.descriptor ?? 'Unknown').trim();
        const m = by.get(name) ?? { name, amount: 0, count: 0 };
        m.amount += (t.settled_amount || t.amount || 0) / 100;
        m.count++;
        by.set(name, m);
      }
      return {
        figures: {
          month: begin.toISOString().slice(0, 7),
          spent: Math.round(spent.reduce((s, t) => s + (t.settled_amount || t.amount || 0), 0)) / 100,
          count: spent.length,
          declined: list.filter((t) => t.status === 'DECLINED').length,
          merchants: [...by.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, 20).map((m) => ({ ...m, amount: Math.round(m.amount * 100) / 100 })),
        },
      };
    },
  };
}

// ── Stripe ──────────────────────────────────────────────────────────────────

export function stripeFeed(env: Env = process.env, f: typeof fetch = fetch): Feed {
  const key = (env.COMMAND_STRIPE_KEY || env.STRIPE_SECRET_KEY || '').trim();
  const get = async (path: string) => {
    const r = await f(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw await fail(r, `Stripe ${path}`);
    return (await r.json()) as any;
  };
  const usd = (list: any[]) => (list ?? []).filter((b) => b.currency === 'usd').reduce((s, b) => s + b.amount, 0) / 100;
  return {
    id: 'stripe',
    everyMs: minutes(env.COMMAND_FEEDS_MINUTES, 5),
    off: () => (!key ? 'STRIPE_SECRET_KEY isn’t set' : /^(sk|rk)_test_/.test(key) ? null : 'the Stripe key isn’t a test key'),
    async sync(db) {
      const [bal, po] = await Promise.all([get('/balance'), get('/payouts?limit=20')]);
      const payouts = (po.data ?? []).map((p: any) => ({ id: p.id, amount: p.amount / 100, arrival: p.arrival_date * 1000, status: p.status }));
      // a payout that landed since the bank was last read moves the bank balance: read it now
      const { rows } = await db.query<FeedRow>(`SELECT synced_at FROM command.feeds WHERE id = 'plaid'`);
      const bank = rows[0]?.synced_at ? new Date(rows[0].synced_at).getTime() : 0;
      const landed = payouts.some((p: any) => p.status === 'paid' && p.arrival > bank && p.arrival <= Date.now());
      return { figures: { available: usd(bal.available), pending: usd(bal.pending), payouts }, wake: landed && bank ? ['plaid'] : [] };
    },
  };
}



// ── The shop (Phase 7a): live, read-only ────────────────────────────────────

/** The shop's Stripe account, read with a restricted key: GETs only, and an unrestricted key is refused. */
function shopStripe(env: Env, f: typeof fetch) {
  const key = env.COMMAND_SHOP_STRIPE_KEY?.trim() ?? '';
  const off = !key ? 'COMMAND_SHOP_STRIPE_KEY isn’t set' : /^rk_(live|test)_/.test(key) ? null : 'the shop’s key must be a restricted, read-only key (rk_…)';
  const get = async (path: string, q: Record<string, string | string[]> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) for (const x of [v].flat()) qs.append(k, x);
    const r = await f(`https://api.stripe.com/v1${path}${qs.size ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw await fail(r, `Shop Stripe ${path}`);
    return (await r.json()) as any;
  };
  return { off, get };
}

const SIZES = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl']);
const title = (s: string) => s.replace(/(^|-)([a-z])/g, (_m, sep, c) => (sep ? ' ' : '') + c.toUpperCase());
/** A variant id as the page shows it: "black-m" is Black, M; "circle" is Circle, no size. */
export function variantParts(variant: string): [string, string] {
  const parts = variant.split('-');
  const size = SIZES.has(parts.at(-1)!) ? parts.pop()!.toUpperCase() : '';
  return [title(parts.join('-')) || 'One size', size];
}
/** "Ana Ruiz" → "Ana R.": buyers show by first name. */
export const maskBuyer = (name: string | null | undefined) => {
  const [first, ...rest] = String(name ?? '').trim().split(/\s+/);
  return first ? `${first}${rest.length ? ` ${rest.at(-1)![0].toUpperCase()}.` : ''}` : 'A buyer';
};

/**
 * The shop's orders, pre-orders and refunds from its Stripe Checkout. Each completed, paid session is
 * an order (its goods, from the session's items) or a reservation (its hardware, from the payment's
 * reserved lines). Command numbers the orders and keeps their packing; the sync only adds orders and
 * marks refunds. The shipping address is never stored.
 */
export function shopFeed(env: Env = process.env, f: typeof fetch = fetch): Feed {
  const s = shopStripe(env, f);
  return {
    id: 'shop',
    everyMs: minutes(env.COMMAND_FEEDS_MINUTES, 5),
    off: () => s.off,
    async sync(db, last) {
      // a session can complete up to a day after it was opened: ask from a day before the newest
      const since = Math.max(0, Number(last.figures?.since ?? 0) - 86_400);
      const sessions: any[] = [];
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const j = await s.get('/checkout/sessions', { status: 'complete', limit: '100', 'created[gte]': String(since), 'expand[]': ['data.payment_intent'], ...(after ? { starting_after: after } : {}) });
        sessions.push(...j.data);
        if (!j.has_more || !j.data.length) break;
        after = j.data.at(-1).id;
      }
      let orders = 0,
        reserved = 0,
        newest = Number(last.figures?.since ?? 0);
      for (const x of sessions.filter((x) => x.payment_status === 'paid')) {
        newest = Math.max(newest, x.created);
        const pi = typeof x.payment_intent === 'object' ? x.payment_intent : null;
        if (x.metadata?.kind === 'reservation' && pi) {
          for (let n = 1; pi.metadata?.[`r${n}`]; n++) {
            const [slug, variant, qty, , dep] = String(pi.metadata[`r${n}`]).split('/');
            if (!slug || !Number(qty)) continue;
            const status = pi.metadata[`s${n}`] ?? 'reserved';
            const r = await db.query(
              `INSERT INTO command.shop_live_preorders (payment_intent, line, shop, slug, variant, units, deposit_cents, state, placed_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (payment_intent, line) DO UPDATE SET state = $8 RETURNING (xmax = 0) AS added`,
              [pi.id, n, String(pi.metadata.shop || pi.metadata.shop_id || 'A shop'), slug, variant, Number(qty), Number(dep) || 0, status === 'reserved' ? 'held' : status, new Date(x.created * 1000)],
            );
            if (r.rows[0]?.added) reserved++;
          }
        }
        if (x.metadata?.items) {
          const items = String(x.metadata.items)
            .split(',')
            .map((line) => /^([^/]+)\/(.+)x(\d+)$/.exec(line))
            .filter(Boolean)
            .map((m) => [m![1], ...variantParts(m![2]), Number(m![3])]);
          const ship = pi?.shipping ?? x.shipping_details ?? x.collected_information?.shipping_details ?? null;
          const r = await db.query(
            `INSERT INTO command.shop_orders (id, paid_at, buyer, member, items, paid_with, fulfilment, pickup_at, state, city, source, stripe_session, payment_intent, total_cents)
             VALUES (nextval('command.shop_order_number')::text, $1, $2, false, $3, 'card', 'ship', '', 'paid', $4, 'stripe', $5, $6, $7)
             ON CONFLICT (stripe_session) DO NOTHING RETURNING 1`,
            [new Date(x.created * 1000), maskBuyer(ship?.name ?? x.customer_details?.name), JSON.stringify(items), ship?.address?.city ?? x.customer_details?.address?.city ?? '', x.id, pi?.id ?? x.payment_intent ?? null, x.amount_total],
          );
          orders += r.rows.length;
        }
      }
      // refunds since then: each refunded payment's total refunded, as its charge says
      const refunds = await s.get('/refunds', { limit: '100', 'created[gte]': String(since) });
      const touched = [...new Set((refunds.data ?? []).filter((r: any) => r.status === 'succeeded').map((r: any) => String(r.payment_intent)))];
      for (const id of touched) {
        const pi = await s.get(`/payment_intents/${id}`, { 'expand[]': 'latest_charge' });
        const refunded = Number(pi.latest_charge?.amount_refunded ?? 0);
        await db.query(`UPDATE command.shop_orders SET refunded_cents = $2, state = CASE WHEN $2 >= coalesce(total_cents, 0) AND $2 > 0 THEN 'refund' ELSE state END WHERE payment_intent = $1`, [id, refunded]);
      }
      return { figures: { since: newest, orders, reserved, refunds: touched.length } };
    },
  };
}

/** One live order's shipping address, read from Stripe when someone packs it: never stored. */
export async function shopAddress(db: Queryable, orderId: string, env: Env = process.env, f: typeof fetch = fetch) {
  const s = shopStripe(env, f);
  if (s.off) throw new Error(s.off);
  const { rows } = await db.query<{ payment_intent: string | null; stripe_session: string }>(`SELECT payment_intent, stripe_session FROM command.shop_orders WHERE id = $1 AND source = 'stripe'`, [orderId]);
  if (!rows.length) return null;
  const pi = rows[0].payment_intent ? await s.get(`/payment_intents/${rows[0].payment_intent}`) : null;
  const ship = pi?.shipping ?? (await s.get(`/checkout/sessions/${rows[0].stripe_session}`)).shipping_details ?? null;
  if (!ship?.address) return { name: ship?.name ?? null, lines: [] as string[] };
  const a = ship.address;
  return { name: ship.name ?? null, lines: [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', ') + (a.postal_code ? ` ${a.postal_code}` : ''), a.country === 'US' ? '' : a.country].filter(Boolean) as string[] };
}

/** What the shop sells, as the site serves it (clearpath-website /api/shop/catalog); drafts with the shared token. */
export function catalogFeed(env: Env = process.env, f: typeof fetch = fetch): Feed {
  const url = env.COMMAND_SHOP_CATALOG_URL?.trim() || 'https://www.useclear.org/api/shop/catalog';
  const token = env.COMMAND_CATALOG_TOKEN?.trim();
  return {
    id: 'catalog',
    everyMs: minutes(env.COMMAND_FEEDS_MINUTES, 5),
    off: () => (url === 'off' ? 'COMMAND_SHOP_CATALOG_URL is off' : null),
    async sync() {
      const r = await f(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      if (!r.ok) throw await fail(r, 'Shop catalog');
      const j: any = await r.json();
      if (!Array.isArray(j.products)) throw new Error('Shop catalog: no products in the answer');
      return { figures: { products: j.products, moved: j.moved ?? {}, drafts: !!token } };
    },
  };
}

export const liveFeeds = (env: Env = process.env): Feed[] => [plaidFeed(env), bridgeFeed(env), lithicFeed(env), stripeFeed(env), shopFeed(env), catalogFeed(env)];
