import { getPayPool } from '../../config/postgres.js';

/*
 * The app lock, kept by the server.
 *
 * The app locks itself after five minutes idle or away, but it keeps that clock in the browser, so
 * anyone holding the phone could wind it back. The server keeps its own: each sign-in session (the
 * Privy session id, so one device locking does not lock another) records when the member last used
 * it, and a session left idle past SESSION_LOCK_AFTER_MS is refused until it is opened again.
 *
 * "Used" means the member touched the app -- the app reports that at most once a minute. The reads
 * a page makes on its own do not count, so an app left open on a table still locks.
 *
 * Two ways back in, and neither is the app's word: Face ID the server verified (routes/stepUp), or
 * signing in again, which is a new session.
 *
 * A session the server has not seen is new, and starts active: signing in is how one begins.
 */

/** The app locks at five; a minute more here covers its once-a-minute report. */
export const SESSION_LOCK_AFTER_MS = 6 * 60 * 1000;
/** A report inside this of the last one written is not written again. */
const WRITE_EVERY_MS = 60 * 1000;

const TABLE = 'member_sessions';

let ensured = false;
async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      last_active TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_active_idx ON ${TABLE} (last_active);
    ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);
  ensured = true;
}

/** This process's view. The table is the truth; this saves a read on every request. */
const seen = new Map<string, { lastActive: number; written: number; seenWritten: number; looked: number }>();

/*
 * last_seen: the session made any request at all, used or not. Written at most daily. Only a session
 * quiet in BOTH senses is ever deleted -- deleting one that is still being used by a device left open
 * would make it "new", and new sessions start open, which would be a way round the lock.
 */
const SEEN_EVERY_MS = 24 * 60 * 60 * 1000;

async function readLastActive(sessionId: string, userId: string): Promise<number> {
  const pool = getPayPool();
  if (!pool) return Date.now();
  await ensureTable();
  // New sessions are inserted as active; an existing one returns what it had.
  const { rows } = await pool.query<{ last_active: Date }>(
    `INSERT INTO ${TABLE} (session_id, user_id) VALUES ($1, $2)
     ON CONFLICT (session_id) DO UPDATE SET last_seen = NOW()
     RETURNING last_active`,
    [sessionId, userId],
  );
  const at = rows[0]?.last_active?.getTime() ?? Date.now();
  seen.set(sessionId, { lastActive: at, written: at, seenWritten: Date.now(), looked: Date.now() });
  return at;
}

/** Remembered in this process for an hour after its last request; past that, the table answers again. */
const FORGET_IN_MEMORY_MS = 60 * 60 * 1000;
/** Sessions neither used nor making any request for this long are deleted from the table. */
export const DELETE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const sessionLock = {
  available(): boolean {
    return Boolean(getPayPool());
  },

  /** Whether this session has sat idle past the lock. */
  async locked(sessionId: string, userId: string, now = Date.now()): Promise<boolean> {
    const known = seen.get(sessionId);
    // Reading from the table also stamps last_seen, so a session in use daily is never deleted.
    let at = known && now - known.seenWritten < SEEN_EVERY_MS ? known.lastActive : await readLastActive(sessionId, userId);
    // Before refusing, check the table: another instance may have heard from the member since.
    if (now - at >= SESSION_LOCK_AFTER_MS && known) at = await readLastActive(sessionId, userId);
    const entry = seen.get(sessionId);
    if (entry) entry.looked = now;
    return now - at >= SESSION_LOCK_AFTER_MS;
  },

  /**
   * Drop sessions from this process's view that have made no request for an hour. Safe: a dropped
   * session is read back from the table the next time it is seen. Returns how many were dropped.
   */
  forgetIdle(now = Date.now()): number {
    let dropped = 0;
    for (const [id, entry] of seen) {
      if (now - entry.looked >= FORGET_IN_MEMORY_MS) {
        seen.delete(id);
        dropped++;
      }
    }
    return dropped;
  },

  /** Delete sessions neither used nor seen for DELETE_AFTER_MS. Returns how many went. */
  async deleteStale(now = Date.now()): Promise<number> {
    const pool = getPayPool();
    if (!pool) return 0;
    await ensureTable();
    const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE last_active < to_timestamp($1 / 1000.0) AND last_seen < to_timestamp($1 / 1000.0)`, [
      now - DELETE_AFTER_MS,
    ]);
    return rowCount ?? 0;
  },

  /** How many sessions this process is holding in memory (for tests and the memory monitor). */
  heldInMemory(): number {
    return seen.size;
  },

  /** The member used the app (or proved it was them). Written at most once a minute unless `force`. */
  async touch(sessionId: string, userId: string, force = false, now = Date.now()): Promise<void> {
    const known = seen.get(sessionId);
    if (!force && known && now - known.written < WRITE_EVERY_MS) {
      known.lastActive = now;
      return;
    }
    seen.set(sessionId, { lastActive: now, written: now, seenWritten: known?.seenWritten ?? 0, looked: now });
    const pool = getPayPool();
    if (!pool) return;
    await ensureTable();
    await pool.query(
      `INSERT INTO ${TABLE} (session_id, user_id, last_active) VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (session_id) DO UPDATE SET last_active = GREATEST(${TABLE}.last_active, EXCLUDED.last_active)`,
      [sessionId, userId, now],
    );
  },
};
