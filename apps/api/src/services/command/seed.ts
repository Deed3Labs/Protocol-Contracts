import { DAY, SEED_FIGURES, SEED_TODAY } from '@clear/command-types';
import field from '@clear/command-types/src/fixtures/field.json';
import growth from '@clear/command-types/src/fixtures/growth.json';
import members from '@clear/command-types/src/fixtures/members.json';
import merch from '@clear/command-types/src/fixtures/merchants.json';
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

    if (await empty(tx, 'command.merchants')) {
      const cents = (v: number) => Math.round(v * 100);
      const where = merch.cities as unknown as Record<string, [number, number, string]>;
      const board = merch.board as Array<Record<string, any>>;
      for (const [i, t] of (merch.tx as any[][]).entries()) {
        const [id, name, kind, city, founding, fee, terms, cap, hits, orig, lost, oct, octN, sept, hw] = t;
        await tx.query(
          `INSERT INTO command.merchants (id, position, name, kind, city, lng, lat, status, founding, fee_pct, terms, cap_cents, hardware)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'transacting', $8, $9, $10, $11, $12)`,
          [id, i, name, kind, city, where[city]?.[0] ?? null, where[city]?.[1] ?? null, !!founding, fee, terms, cents(cap), hw],
        );
        await tx.query('INSERT INTO command.merchant_stats (merchant_id, cap_hits_7d, originations, losses) VALUES ($1, $2, $3, $4)', [id, hits, orig, lost]);
        await tx.query('INSERT INTO command.merchant_months (merchant_id, month, cleared_cents, sales) VALUES ($1, $2, $3, $4), ($1, $5, $6, 0)', [id, '2026-10-01', cents(oct), octN, '2026-09-01', cents(sept)]);
      }
      for (const [i, sg] of (merch.signed as string[][]).entries()) {
        const [id, name, kind, city, st] = sg;
        await tx.query(
          `INSERT INTO command.merchants (id, position, name, kind, city, lng, lat, status, founding) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, 100 + i, name, kind, city, where[city]?.[0] ?? null, where[city]?.[1] ?? null, st === 'signing' ? 'signing' : 'signed', !!board.find((c) => c.id === id)?.founding],
        );
      }
      for (const [id, v] of Object.entries(merch.owed as Record<string, number>)) {
        await tx.query('INSERT INTO command.redemptions_owed (merchant_id, owed_cents) VALUES ($1, $2)', [id, cents(v)]);
      }
      for (const [i, c] of board.entries()) {
        await tx.query(
          `INSERT INTO command.merchant_stage (id, merchant_id, position, name, kind, city, stage, owner, per_month_cents, next_step, due_on, last_contact_at, contact, source, address, flag, founding, posters)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [c.id, c.m ?? null, i, c.name, c.kind, c.city, c.stage, c.owner ?? null, c.val != null ? cents(c.val) : null, c.next ?? null, iso(c.due), iso(c.last), JSON.stringify(c.contact), c.source, c.addr ?? '', !!c.flag, !!c.founding, c.posters ?? null],
        );
      }
      for (const [i, [id, kinds, issue, last]] of (merch.fleet as Array<[string, Record<string, string[]>, string, string]>).entries()) {
        for (const [kind, list] of Object.entries(kinds)) {
          for (const [seq, status] of list.entries()) await tx.query('INSERT INTO command.device_fleet (merchant_id, kind, seq, status) VALUES ($1, $2, $3, $4)', [id, kind, seq, status]);
        }
        await tx.query('INSERT INTO command.fleet_checkins (merchant_id, position, issue, last_seen) VALUES ($1, $2, $3, $4)', [id, i, issue, last]);
      }
      done.push(`${merch.tx.length + merch.signed.length} merchants`, `${board.length} board cards`);
    }
  });
  return done;
}
