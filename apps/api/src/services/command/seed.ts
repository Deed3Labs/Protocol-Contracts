import { DAY, SEED_FIGURES, SEED_TODAY } from '@clear/command-types';
import field from '@clear/command-types/src/fixtures/field.json';
import growth from '@clear/command-types/src/fixtures/growth.json';
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
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Sep" in the prototype's year. */
const dayMonth = (s: string) => {
  const [d, m] = s.split(' ');
  return Date.UTC(2026, MON.indexOf(m), Number(d));
};

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

    if (await empty(tx, 'command.poster_designs')) {
      for (const d of growth.designs) await tx.query('INSERT INTO command.poster_designs (code, name) VALUES ($1, $2)', [d.code, d.name]);
      for (const p of growth.posters as Array<Record<string, any>>) {
        await tx.query(
          `INSERT INTO command.posters (n, place, place_id, city, board, design, scans_30d, hung_at, checked_at, swap_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [p.n, p.shop, p.shopId, p.city, !!p.board, p.design, p.scans, iso(p.hung), iso(p.checked), iso(p.swap), p.status],
        );
      }
      done.push(`${growth.posters.length} posters`);
    }

    if (await empty(tx, 'command.form_submissions')) {
      // the inbox shows clock times from the evening before the prototype's day
      for (const f of growth.forms) {
        const [h, m] = f.when.split(':').map(Number);
        await tx.query(
          `INSERT INTO command.form_submissions (first_name, last_name, email, form, city, source, received_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [f.who[0], f.who[1], f.mail, f.type, f.city, f.src, iso(SEED_TODAY - DAY + (h * 60 + m) * 60_000), f.st],
        );
      }
      done.push(`${growth.forms.length} forms`);
    }

    if (await empty(tx, 'command.routes')) {
      const r = field.route;
      const day = iso(r.day);
      await tx.query(
        'INSERT INTO command.routes (day, staff, staff_key, loaded_at, started_at, miles, back_by, minutes_per_stop) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [day, r.staff, r.staffKey, r.loaded, r.started, r.miles, r.backBy, r.minutesPerStop],
      );
      const info = field.shopInfo as Record<string, string[]>;
      for (const [i, st] of (field.stops as Array<Record<string, any>>).entries()) {
        const [closes, contact, last] = info[st.id] ?? [];
        await tx.query(
          'INSERT INTO command.route_stops (day, id, position, name, city, street, eta, closes, contact, last_visit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [day, st.id, i, st.name, st.city, st.where, st.eta, closes ?? null, contact ?? null, last ? iso(dayMonth(last)) : null],
        );
        for (const [j, t] of (st.tasks as Array<Record<string, any>>).entries()) {
          await tx.query(
            'INSERT INTO command.route_tasks (day, stop_id, position, kind, poster, title, note, done_at, outcome, photo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
            [day, st.id, j, t.kind, t.n ?? null, t.t, t.note ?? null, t.done ?? null, t.out ?? null, !!t.photo],
          );
        }
      }
      for (const l of field.later) {
        await tx.query(
          'INSERT INTO command.route_later (shop, city, note, state, poster, wrong, todo, due, detour, last_visit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          l,
        );
      }
      done.push(`a route of ${field.stops.length} stops`);
    }
  });
  return done;
}
