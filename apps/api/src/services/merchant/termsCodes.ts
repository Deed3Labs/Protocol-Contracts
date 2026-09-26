import type { TermsCodeCheck } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../db/db.js';

/**
 * Onboarding › Your terms › Have a code? (migration 0021).
 *
 * Clear gives out codes that put a shop on a tier, founding partners today, each with so many
 * places. Checking one is public (it runs before the shop exists) and says what it would change;
 * claiming one happens when the shop is created, takes a place under a lock so two shops can't
 * take the last one, and sets the shop's tier. A code that's full or unknown leaves the shop on
 * standard terms, which is what the owner was shown.
 *
 * The shop's tier here is Clear's record, and what the app shows. The rate that's charged is set
 * on chain when Clear registers the shop (scripts/register_merchant.ts), from this record.
 */

export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');

type CodeRow = { code: string; tier: string; places: number; paid_now_bps: number; over_time_bps: number; taken: string | number };

async function codeRow(q: Queryable, code: string, lock = false): Promise<CodeRow | null> {
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) return null;
  const { rows } = await q.query<Omit<CodeRow, 'taken'>>(
    `SELECT c.code, c.tier, c.places, t.paid_now_bps, t.over_time_bps FROM merchant.terms_codes c JOIN merchant.clear_tiers t ON t.tier = c.tier
      WHERE c.code = $1 AND c.retired_at IS NULL${lock ? ' FOR UPDATE OF c' : ''}`,
    [code],
  );
  if (!rows[0]) return null;
  const { rows: n } = await q.query<{ taken: string | number }>('SELECT count(*) AS taken FROM merchant.profiles WHERE terms_code = $1', [code]);
  return { ...rows[0], taken: n[0]!.taken };
}

function asCheck(r: CodeRow | null): TermsCodeCheck {
  if (!r) return { state: 'unknown' };
  const left = Math.max(0, Number(r.places) - Number(r.taken));
  if (left === 0) return { state: 'full', code: r.code, tier: r.tier, places: Number(r.places) };
  return { state: 'ok', code: r.code, tier: r.tier, paidNowBps: Number(r.paid_now_bps), overTimeBps: Number(r.over_time_bps), placesLeft: left, places: Number(r.places) };
}

export async function checkCode(q: Queryable, raw: string): Promise<TermsCodeCheck> {
  return asCheck(await codeRow(q, normalizeCode(raw)));
}

/**
 * The new shop takes a place. Once only: a shop that already has a code keeps it (signup is
 * retried, and a code isn't a way to change tier later). Returns what happened.
 */
export async function claimCode(db: Db, merchant: string, raw: string): Promise<TermsCodeCheck> {
  const code = normalizeCode(raw);
  return db.transaction(async (tx) => {
    const { rows: p } = await tx.query<{ terms_code: string | null }>('SELECT terms_code FROM merchant.profiles WHERE merchant = $1 FOR UPDATE', [merchant]);
    if (!p[0]) return { state: 'unknown' } as const;
    if (p[0].terms_code) {
      const had = await codeRow(tx, p[0].terms_code);
      return had ? ({ state: 'ok', code: had.code, tier: had.tier, paidNowBps: Number(had.paid_now_bps), overTimeBps: Number(had.over_time_bps), placesLeft: Math.max(0, Number(had.places) - Number(had.taken)), places: Number(had.places) } as const) : ({ state: 'unknown' } as const);
    }
    const r = await codeRow(tx, code, true);
    const check = asCheck(r);
    if (check.state !== 'ok') return check;
    await tx.query(`UPDATE merchant.profiles SET terms_code = $2, clear_tier = $3, founding = ($3 = 'founding') WHERE merchant = $1`, [merchant, check.code, check.tier]);
    return { ...check, placesLeft: check.placesLeft - 1 };
  });
}

/** Clear adds a code (scripts/terms-code.ts). */
export async function addCode(q: Queryable, input: { code: string; tier: string; places: number; note?: string | null }): Promise<void> {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new Error('A code is 3 to 32 letters, digits or dashes');
  if (!Number.isInteger(input.places) || input.places < 0) throw new Error('Places is a whole number');
  await q.query('INSERT INTO merchant.terms_codes (code, tier, places, note) VALUES ($1,$2,$3,$4)', [code, input.tier, input.places, input.note ?? null]);
}
