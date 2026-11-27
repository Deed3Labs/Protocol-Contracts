import { AddWebhookEndpoint, allowedOrigin, siteLabel, type AllowedSite, type ApiKey, type DevelopersView, type MerchantWebhookEndpoint, type WebhookDelivery } from '@clear/merchant-contracts';

/**
 * Settings › Developers' words and choices (pay spec §6), apart from the pane so they can be tested.
 * The pane's Test/Live switch is its own state: it chooses which keys, endpoints and deliveries
 * show; the websites are the shop's in both modes.
 */

type EventType = MerchantWebhookEndpoint['events'][number];

/** Every event an endpoint can listen for, in the contract's order. */
export const EVENT_CHOICES: readonly EventType[] = AddWebhookEndpoint.shape.events.element.options;
/** What a new endpoint listens for until changed: the drawn endpoint's three. */
export const DEFAULT_EVENTS: EventType[] = ['payment.succeeded', 'payment.failed', 'refund.succeeded'];
export const EVENT_DET: Record<EventType, string> = {
  'payment.succeeded': 'A payment went through',
  'payment.failed': 'A payment didn’t go through',
  'payment.canceled': 'A payment was cancelled before it was made',
  'refund.succeeded': 'A refund went back to the customer',
};

const modeWord = (livemode: boolean) => (livemode ? 'live' : 'test');

/** "clear_pk_live_mc8Q2v…" for a publishable key; "clear_sk_live_…9fA2" for a secret one. */
export function keyShown(k: Pick<ApiKey, 'kind' | 'livemode' | 'token' | 'last4'>): string {
  if (k.kind === 'publishable' && k.token) return `${k.token.slice(0, 'clear_pk_live_'.length + 6)}…`;
  return `clear_${k.kind === 'publishable' ? 'pk' : 'sk'}_${modeWord(k.livemode)}_…${k.last4}`;
}

export const publishableDet = (k: ApiKey) => `${keyShown(k)} · safe in a web page`;
export const secretDet = (k: ApiKey) => `${keyShown(k)} · server only. Shown once when made`;

const dateParts = (iso: string, timeZone: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);
  const md = d.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
  return { day, md, time };
};

/** "10:42am" today in shop time; "Oct 15, 10:42am" on another day. */
export function when(iso: string, nowIso: string, timeZone: string): string {
  const at = dateParts(iso, timeZone);
  return at.day === dateParts(nowIso, timeZone).day ? at.time : `${at.md}, ${at.time}`;
}

/** "Oct 17, 3:04pm", for when a rolled key stops working. */
export const untilLabel = (iso: string, timeZone: string) => {
  const at = dateParts(iso, timeZone);
  return `${at.md}, ${at.time}`;
};

/** A rolled secret key that still works: "clear_sk_live_…9fA2 · works until Oct 17, 3:04pm". */
export const rolledDet = (k: ApiKey, timeZone: string) => `${keyShown(k)} · works until ${k.expiresAt ? untilLabel(k.expiresAt, timeZone) : '—'}`;

/** A website's row: "micasatacos.com" and "Added Oct 12". */
export function siteRow(s: AllowedSite, timeZone: string): { t: string; det: string } {
  const added = `Added ${dateParts(s.addedAt, timeZone).md}`;
  return { t: siteLabel(s.origin), det: s.testOnly ? `${added} · test keys only` : added };
}

/** The head's count: "2", "1 endpoint", "2 endpoints"; an em dash for none. */
export const sitesHead = (n: number) => (n === 0 ? '—' : String(n));
export const endpointsHead = (n: number) => (n === 0 ? '—' : `${n} endpoint${n === 1 ? '' : 's'}`);

export const HEALTH: Record<MerchantWebhookEndpoint['health'], { tone: 'settled' | 'neutral' | 'absent'; label: string }> = {
  healthy: { tone: 'settled', label: 'Healthy' },
  new: { tone: 'neutral', label: 'New' },
  failing: { tone: 'absent', label: 'Failing' },
  disabled: { tone: 'neutral', label: 'Off' },
};

/** One of Recent deliveries: "payment.succeeded · catering-1042 · 10:42am" and its "200". */
export function deliveryRow(d: WebhookDelivery, nowIso: string, timeZone: string): { k: string; v: string; ok: boolean } {
  const k = [d.eventType, d.reference, when(d.at, nowIso, timeZone)].filter(Boolean).join(' · ');
  return { k, v: d.responseCode === null ? '—' : String(d.responseCode), ok: d.status === 'succeeded' };
}

/** How many deliveries the pane lists: the drawing's few, newest first. */
export const DELIVERIES_SHOWN = 5;

/** What the pane shows for one mode. */
export function forMode(view: DevelopersView, livemode: boolean, nowIso: string) {
  const mine = view.keys.filter((k) => k.livemode === livemode);
  const current = (kind: ApiKey['kind']) => mine.find((k) => k.kind === kind && !k.rolledAt) ?? null;
  const endpoints = view.endpoints.filter((e) => e.livemode === livemode);
  const ids = new Set(endpoints.map((e) => e.id));
  return {
    publishable: current('publishable'),
    secret: current('secret'),
    /** Rolled secret keys still working (24 hours after the roll). */
    rolled: mine.filter((k) => k.kind === 'secret' && k.rolledAt && k.expiresAt && Date.parse(k.expiresAt) > Date.parse(nowIso)),
    endpoints,
    deliveries: view.deliveries
      .filter((d) => ids.has(d.endpointId))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, DELIVERIES_SHOWN),
  };
}

/** Add a site: the origin it would add, or why not, and the localhost note. */
export function siteCheck(text: string): { ok: true; origin: string; note: string | null } | { ok: false; reason: string | null } {
  if (!text.trim()) return { ok: false, reason: null };
  const o = allowedOrigin(text);
  if (!o.ok) return { ok: false, reason: o.reason };
  return { ok: true, origin: o.origin, note: o.testOnly ? 'Test keys only: a live key never opens on localhost.' : null };
}

/** Add an endpoint: the request, or why not yet. An empty address says nothing. */
export function endpointCheck(url: string, events: EventType[], livemode: boolean): { ok: true; request: { url: string; events: EventType[]; livemode: boolean } } | { ok: false; reason: string | null } {
  const typed = url.trim();
  if (!typed) return { ok: false, reason: null };
  if (!AddWebhookEndpoint.shape.url.safeParse(typed).success) return { ok: false, reason: 'Use a full https address, like https://example.com/clear/webhook' };
  if (events.length === 0) return { ok: false, reason: 'Choose at least one event' };
  return { ok: true, request: { url: typed, events: EVENT_CHOICES.filter((e) => events.includes(e)), livemode } };
}
