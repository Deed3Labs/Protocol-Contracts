import { SEED_FIGURES } from '@clear/command-types';
import members from '@clear/command-types/src/fixtures/members.json';
import type { Db, Queryable } from '../../db/db.js';

/**
 * The seed: every row and figure the prototype draws, so a database with nothing live behind it
 * draws exactly the design (docs/command-center-plan.md, Phase 3). The rows come from
 * packages/command-types/src/fixtures, written from the prototype's own data.
 *
 * Each table is filled only when it's empty, and each figure only when it isn't there yet, so running
 * it again changes nothing and never overwrites what a live job wrote.
 */

const iso = (ms: number | undefined | null) => (ms == null ? null : new Date(ms).toISOString());
const FUND: Record<string, string> = { Bank: 'bank', $5: 'five', Deposit: 'deposit' };

async function empty(db: Queryable, table: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n === 0;
}

export async function seedCommand(db: Db): Promise<string[]> {
  const done: string[] = [];
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(SEED_FIGURES)) {
      const r = await tx.query(`INSERT INTO command.figures (key, value, source) VALUES ($1, $2, 'seed') ON CONFLICT (key) DO NOTHING RETURNING key`, [
        key,
        JSON.stringify(value),
      ]);
      if (r.rows.length) done.push(`figure ${key}`);
    }

    if (await empty(tx, 'command.members')) {
      for (const m of members.members as Array<Record<string, any>>) {
        await tx.query(
          `INSERT INTO command.members (id, number, first_name, last_name, batch, joined_at, invited_at, city, source, poster, status,
             opened_at, funded_with, active_at, first_spend_shop, first_spend_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            m.id,
            m.no,
            m.first,
            m.last,
            m.batch,
            iso(m.joined),
            iso(m.invited),
            m.city,
            m.src === 'Poster' ? 'poster' : 'website',
            m.poster,
            m.status,
            iso(m.opened),
            m.fund ? FUND[m.fund] : null,
            iso(m.activeAt),
            m.spend ?? null,
            iso(m.spentAt),
            iso(m.last_),
          ],
        );
      }
      done.push(`${members.members.length} members`);
    }

    if (await empty(tx, 'command.batches')) {
      for (const b of members.batches) {
        await tx.query(`INSERT INTO command.batches (number, size, status, sent_at) VALUES ($1, $2, 'sent', $3)`, [b.number, b.size, iso(b.sentAt)]);
      }
      const p = members.proposed;
      await tx.query(
        `INSERT INTO command.batches (number, size, status, proposed_by, joined_from, joined_to, from_posters, from_website, window_ends)
         VALUES ($1, $2, 'proposed', $3, $4, $5, $6, $7, $8)`,
        [p.number, p.size, p.proposedBy, iso(p.joinedFrom), iso(p.joinedTo), p.fromPosters, p.fromWebsite, iso(p.windowEnds)],
      );
      done.push(`${members.batches.length + 1} batches`);
    }
  });
  return done;
}
