import type { Queryable } from '../../db/db.js';

/*
 * The sandbox feeds (docs/command-center-plan.md, Phase 6): Plaid, Bridge, Lithic and Stripe, each
 * synced on its own schedule into one row of command.feeds, which the menu's feed-status line, Home's
 * sources and each figure's freshness label read.
 *
 * Sandboxes only, but for the shop (Phase 7a), which is live and read with GETs only (its own
 * restricted key, else the site's secret key). A feed whose keys are for anything else (production
 * Plaid, live Bridge, live Lithic, a live Stripe key) doesn't run: its row says it's off and why.
 */

export type FeedId = 'plaid' | 'bridge' | 'lithic' | 'stripe' | 'shop' | 'catalog' | 'site';
export const FEED_IDS: FeedId[] = ['plaid', 'bridge', 'lithic', 'stripe', 'shop', 'catalog', 'site'];
export const FEED_NAMES: Record<FeedId | 'protocol', string> = {
  plaid: 'Plaid',
  bridge: 'Bridge',
  lithic: 'Lithic',
  stripe: 'Stripe',
  shop: 'Shop orders',
  catalog: 'Shop catalog',
  site: 'Site visits',
  protocol: 'Clear protocol',
};

export interface FeedRun {
  figures: unknown;
  /** The provider's own freshness, when it says (Plaid's last update from the bank). */
  asOf?: Date | null;
  /** Other feeds this run says should sync now (a Stripe payout landing moves the bank balance). */
  wake?: FeedId[];
}
export interface Feed {
  id: FeedId;
  /** How often it syncs on its own. */
  everyMs: number;
  /** Why it can't run (not configured, not a sandbox), or null. */
  off(): string | null;
  sync(db: Queryable, last: FeedRow): Promise<FeedRun>;
}

export interface FeedRow {
  id: FeedId;
  state: 'never' | 'ok' | 'error' | 'off';
  off_reason: string | null;
  synced_at: Date | null;
  tried_at: Date | null;
  as_of: Date | null;
  error: string | null;
  figures: any;
  requested_at: Date | null;
  requested_by: string | null;
}

export async function feedRows(db: Queryable): Promise<Map<FeedId, FeedRow>> {
  const { rows } = await db.query<FeedRow>('SELECT * FROM command.feeds');
  return new Map(rows.map((r) => [r.id, r]));
}

/** A sync asked for: run by the next tick. Asking again while one waits changes nothing. */
export async function requestSync(db: Queryable, id: FeedId, by: string): Promise<void> {
  await db.query('UPDATE command.feeds SET requested_at = coalesce(requested_at, now()), requested_by = coalesce(requested_by, $2) WHERE id = $1', [id, by]);
}

/** The feeds due now: asked for, never run, or older than their schedule. A failed one waits a tenth of it before trying again. */
export function due(feeds: Feed[], rows: Map<FeedId, FeedRow>, now: number): Feed[] {
  return feeds.filter((f) => {
    const r = rows.get(f.id);
    if (!r) return false;
    // asked for: at once, though never twice in a minute however often it's asked
    if (r.requested_at) return !r.tried_at || now - new Date(r.tried_at).getTime() >= 60_000;
    if (r.state === 'error' && r.tried_at) return now - new Date(r.tried_at).getTime() >= Math.max(60_000, f.everyMs / 10);
    return !r.synced_at || now - new Date(r.synced_at).getTime() >= f.everyMs;
  });
}

/** Runs one feed and records what happened. */
export async function runFeed(db: Queryable, f: Feed, now = new Date()): Promise<'ok' | 'error' | 'off'> {
  const rows = await feedRows(db);
  const last = rows.get(f.id)!;
  const off = f.off();
  if (off) {
    await db.query(`UPDATE command.feeds SET state = 'off', off_reason = $2, tried_at = $3, requested_at = NULL, requested_by = NULL WHERE id = $1`, [f.id, off, now]);
    return 'off';
  }
  try {
    const r = await f.sync(db, last);
    await db.query(
      `UPDATE command.feeds SET state = 'ok', off_reason = NULL, synced_at = $2, tried_at = $2, as_of = $3, error = NULL, figures = $4, requested_at = NULL, requested_by = NULL WHERE id = $1`,
      [f.id, now, r.asOf ?? now, JSON.stringify(r.figures ?? null)],
    );
    for (const w of r.wake ?? []) await requestSync(db, w, f.id);
    return 'ok';
  } catch (e) {
    await db.query(`UPDATE command.feeds SET state = 'error', off_reason = NULL, tried_at = $2, error = $3, requested_at = NULL, requested_by = NULL WHERE id = $1`, [
      f.id,
      now,
      String((e as Error)?.message ?? e).slice(0, 500),
    ]);
    return 'error';
  }
}

// ── What the pages read ─────────────────────────────────────────────────────

export interface FeedStatus {
  id: FeedId | 'protocol';
  name: string;
  /** synced, behind, failing, off, or never run. */
  health: 'synced' | 'behind' | 'failing' | 'off' | 'never';
  /** How old its data is, in ms, when it has any. */
  behindMs: number | null;
  syncedAt: number | null;
  asOf: number | null;
  error: string | null;
  offReason: string | null;
}

/** A feed is behind once its data is older than twice its schedule. */
export async function feedStatus(db: Queryable, feeds: Feed[], now: number): Promise<{ feeds: FeedStatus[]; line: { headline: string; rest: string; worst: FeedId | 'protocol' | null } }> {
  const rows = await feedRows(db);
  const out: FeedStatus[] = feeds.map((f) => {
    const r = rows.get(f.id)!;
    const asOf = r.as_of ? new Date(r.as_of).getTime() : null;
    const behindMs = asOf == null ? null : Math.max(0, now - asOf);
    const health: FeedStatus['health'] =
      r.state === 'off' ? 'off' : r.state === 'never' ? 'never' : r.state === 'error' ? 'failing' : behindMs != null && behindMs > 2 * f.everyMs ? 'behind' : 'synced';
    return { id: f.id, name: FEED_NAMES[f.id], health, behindMs, syncedAt: r.synced_at ? new Date(r.synced_at).getTime() : null, asOf, error: r.error, offReason: r.off_reason };
  });
  // the chain, as the indexer has it (Phase 5a), on the same line
  const { rows: cur } = await db.query<{ ran_at: Date; error: string | null; head: string | null; indexed_to: string }>('SELECT ran_at, error, head, indexed_to FROM command.chain_cursor ORDER BY ran_at DESC LIMIT 1');
  if (cur.length) {
    const ran = new Date(cur[0].ran_at).getTime();
    const lag = cur[0].head == null ? 0 : (Number(cur[0].head) - Number(cur[0].indexed_to)) * 2000;
    const behindMs = Math.max(0, now - ran) + lag;
    out.push({ id: 'protocol', name: FEED_NAMES.protocol, health: cur[0].error ? 'failing' : behindMs > 15 * 60_000 ? 'behind' : 'synced', behindMs, syncedAt: ran, asOf: ran - lag, error: cur[0].error, offReason: null });
  }
  return { feeds: out, line: statusLine(out) };
}

export const ago = (ms: number) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : ms < 36 * 3600e3 ? `${Math.round(ms / 3600e3)}h` : `${Math.round(ms / 86_400e3)} days`);

/** The menu's line: the worst feed first ("Plaid is 3h behind"), then how the others are. */
export function statusLine(list: FeedStatus[]): { headline: string; rest: string; worst: FeedId | 'protocol' | null } {
  const rank = { failing: 0, behind: 1, never: 2, synced: 3, off: 4 } as const;
  const on = list.filter((f) => f.health !== 'off');
  if (!on.length) return { headline: 'No feeds yet', rest: `${list.length} off`, worst: null };
  const worst = [...on].sort((a, b) => rank[a.health] - rank[b.health] || (b.behindMs ?? 0) - (a.behindMs ?? 0))[0];
  const others = on.filter((f) => f !== worst);
  const ok = others.filter((f) => f.health === 'synced').length;
  const word = (n: number) => `${n} other feed${n === 1 ? '' : 's'}`;
  const rest = others.length === 0 ? '' : ok === others.length ? `${word(ok)} synced` : `${ok} of ${word(others.length)} synced`;
  if (worst.health === 'synced') return { headline: `${on.length === 1 ? worst.name : 'Every feed'} synced`, rest: on.length === 1 ? '' : `${on.length} feeds`, worst: null };
  const headline =
    worst.health === 'failing'
      ? `${worst.name} isn’t syncing`
      : worst.health === 'never'
        ? `${worst.name} hasn’t synced yet`
        : `${worst.name} is ${ago(worst.behindMs ?? 0)} behind`;
  return { headline, rest, worst: worst.id };
}
