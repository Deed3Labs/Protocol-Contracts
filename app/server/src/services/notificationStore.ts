import crypto from 'crypto';
import { getPostgresPool } from '../config/postgres.js';
import { websocketService } from './websocketService.js';
import { pushService } from './pushService.js';

// Kinds worth a Web Push (arrive when the app is closed); noisy/low-value ones stay in-app only.
const PUSH_KINDS = new Set<NotificationKind>(['received', 'credit', 'milestone', 'due', 'kyc', 'request']);

/*
 * Persistent in-app notifications, scoped by owner wallet (same scoping as contacts / pay_credits, and
 * matches how producers + the WebSocket already target addresses). Producers call `emit()` with a
 * stable `dedupeKey` so the same event can't create duplicates; new rows are pushed live over the
 * WebSocket as `notification:new`. The client fetches, marks read, and archives via /api/notifications.
 */
const TABLE = 'notifications';
let ensured = false;

export type NotificationKind =
  | 'received' | 'sent' | 'card' | 'pending' | 'credit' | 'milestone' | 'due' | 'kyc' | 'request' | 'system';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

interface DbRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

const normalizeWallet = (w: string) => w.trim().toLowerCase();

async function ensureTables(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id TEXT PRIMARY KEY,
      owner_wallet TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data JSONB,
      dedupe_key TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON ${TABLE} (owner_wallet, dedupe_key);
    CREATE INDEX IF NOT EXISTS notifications_owner_created_idx ON ${TABLE} (owner_wallet, created_at DESC);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      owner_wallet TEXT NOT NULL,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS push_subs_wallet_idx ON push_subscriptions (owner_wallet);
  `);
  ensured = true;
}

const toRow = (r: DbRow): NotificationRow => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  data: r.data,
  read: r.read_at != null,
  createdAt: r.created_at,
});

export interface EmitInput {
  wallet: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /** Stable key so the same event never duplicates (e.g. `tx:0xabc`, `credit:2026-06`). */
  dedupeKey: string;
  /** Force (or suppress) Web Push regardless of kind. Defaults to whether the kind is push-worthy. */
  push?: boolean;
}

export const notificationStore = {
  isConfigured(): boolean {
    return !!getPostgresPool();
  },

  /** Create a notification (idempotent by dedupeKey) and push it live over the WebSocket if new. */
  async emit(input: EmitInput): Promise<NotificationRow | null> {
    const pool = getPostgresPool();
    if (!pool) return null;
    await ensureTables();
    const wallet = normalizeWallet(input.wallet);
    const id = crypto.randomUUID();
    const result = await pool.query<DbRow>(
      `INSERT INTO ${TABLE} (id, owner_wallet, kind, title, body, data, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (owner_wallet, dedupe_key) DO NOTHING
       RETURNING id, kind, title, body, data, read_at, created_at`,
      [id, wallet, input.kind, input.title, input.body, input.data ?? null, input.dedupeKey],
    );
    const row = result.rows[0];
    if (!row) return null; // deduped — already existed
    const notif = toRow(row);
    try {
      await websocketService.broadcastToAddress(wallet, 'notification:new', notif);
    } catch {
      /* realtime is best-effort */
    }
    // Web Push for important kinds (or when explicitly forced) so it lands even when the app is closed.
    if (input.push ?? PUSH_KINDS.has(notif.kind)) {
      void pushService.sendToWallet(wallet, { title: notif.title, body: notif.body, data: notif.data, tag: notif.id }).catch(() => {});
    }
    return notif;
  },

  /** Register/refresh a Web Push subscription for a wallet (keyed by endpoint). */
  async saveSubscription(wallet: string, subscription: { endpoint?: string } & Record<string, unknown>): Promise<void> {
    const pool = getPostgresPool();
    if (!pool || !subscription?.endpoint) return;
    await ensureTables();
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, owner_wallet, subscription)
         VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, subscription = EXCLUDED.subscription`,
      [subscription.endpoint, normalizeWallet(wallet), subscription],
    );
  },

  async list(wallet: string, limit = 40): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
    const pool = getPostgresPool();
    if (!pool) return { notifications: [], unreadCount: 0 };
    await ensureTables();
    const w = normalizeWallet(wallet);
    const [rows, counts] = await Promise.all([
      pool.query<DbRow>(
        `SELECT id, kind, title, body, data, read_at, created_at FROM ${TABLE}
           WHERE owner_wallet = $1 AND archived_at IS NULL
           ORDER BY created_at DESC LIMIT $2`,
        [w, Math.min(Math.max(limit, 1), 100)],
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${TABLE} WHERE owner_wallet = $1 AND archived_at IS NULL AND read_at IS NULL`,
        [w],
      ),
    ]);
    return { notifications: rows.rows.map(toRow), unreadCount: Number(counts.rows[0]?.count ?? 0) };
  },

  async markRead(wallet: string, id: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE ${TABLE} SET read_at = now() WHERE owner_wallet = $1 AND id = $2 AND read_at IS NULL`, [normalizeWallet(wallet), id]);
  },

  async markAllRead(wallet: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE ${TABLE} SET read_at = now() WHERE owner_wallet = $1 AND read_at IS NULL`, [normalizeWallet(wallet)]);
  },

  async archive(wallet: string, id: string): Promise<void> {
    const pool = getPostgresPool();
    if (!pool) return;
    await ensureTables();
    await pool.query(`UPDATE ${TABLE} SET archived_at = now() WHERE owner_wallet = $1 AND id = $2`, [normalizeWallet(wallet), id]);
  },
};
