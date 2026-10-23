import { DAY, SEED_FIGURES, SEED_TODAY } from '@clear/command-types';
import field from '@clear/command-types/src/fixtures/field.json';
import growth from '@clear/command-types/src/fixtures/growth.json';
import members from '@clear/command-types/src/fixtures/members.json';
import merch from '@clear/command-types/src/fixtures/merchants.json';
import moneyFx from '@clear/command-types/src/fixtures/money.json';
import shopFx from '@clear/command-types/src/fixtures/shop.json';
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

    if (await empty(tx, 'command.accounts')) {
      const cents = (v: number) => Math.round(v * 100);
      for (const [i, a] of moneyFx.accounts.entries()) {
        await tx.query('INSERT INTO command.accounts (id, position, name, purpose, owner_group, source, swatch) VALUES ($1, $2, $3, $4, $5, $6, $7)', [a.id, i, a.name, a.why, a.group, a.source, a.swatch]);
        for (const [w, bal] of (a.weeks as number[]).entries()) {
          await tx.query('INSERT INTO command.account_snapshots (account_id, as_of, balance_cents) VALUES ($1, $2, $3)', [a.id, iso(moneyFx.weeks[w]), cents(bal)]);
        }
        for (const e of (moneyFx.entries as Record<string, Array<{ at: number; what: string; detail: string; amount: number }>>)[a.id] ?? []) {
          await tx.query('INSERT INTO command.account_entries (account_id, at, what, detail, amount_cents) VALUES ($1, $2, $3, $4, $5)', [a.id, iso(e.at), e.what, e.detail, cents(e.amount)]);
        }
      }
      for (const [id, face, issued, matures, term, rate, holder] of moneyFx.bonds as Array<[string, number, string, string, number, number, string]>) {
        // a bond matures `term` months after it's issued, so its year follows from that
        const iss = dayMonth(issued);
        const mat = Date.UTC(2026, new Date(iss).getUTCMonth() + term, Number(matures.split(' ')[0]));
        await tx.query('INSERT INTO command.bonds (id, face_cents, issued_on, matures_on, term_months, rate_pct, holder) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, cents(face), iso(iss), iso(mat), term, rate, holder]);
      }
      for (const [i, [dep, value, first, pledged]] of (moneyFx.depositors as Array<[string, number, string, number]>).entries()) {
        await tx.query('INSERT INTO command.yield_positions (depositor, assets_cents, first_deposit, pledged_cents, position) VALUES ($1, $2, $3, $4, $5)', [dep, cents(value), iso(dayMonth(first)), cents(pledged), i]);
      }
      done.push(`${moneyFx.accounts.length} accounts`, `${moneyFx.bonds.length} bonds`, `${moneyFx.depositors.length} yield positions`);
    }

    if (await empty(tx, 'command.shop_products')) {
      const cents = (v: number) => Math.round(v * 100);
      const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
      type Product = { id: string; n: string; v: string; line: string; g: string; price: number; c?: number[]; st: string; cols: string[]; lead?: number; slug: string; why?: string; dep?: number };
      const products = shopFx.products as Product[];
      for (const [i, p] of products.entries()) {
        await tx.query(
          `INSERT INTO command.shop_products (id, position, name, variant, line, glyph, price_cents, cost_cents, status, options, lead_weeks, slug, why, deposit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [p.id, i, p.n, p.v, p.line, p.g, cents(p.price), p.c ? p.c.map(cents) : null, p.st, p.cols, p.lead ?? null, p.slug, p.why ?? null, !!p.dep],
        );
      }
      for (const [id, opts] of Object.entries(shopFx.stock as Record<string, Record<string, number[]>>)) {
        for (const [oi, [opt, sizes]] of Object.entries(opts).entries()) {
          for (const [si, n] of sizes.entries()) {
            await tx.query('INSERT INTO command.shop_stock (product_id, option, option_pos, size, size_pos, on_hand) VALUES ($1, $2, $3, $4, $5, $6)', [id, opt, oi, sizes.length === 1 ? '' : SIZES[si], si, n]);
          }
        }
      }
      for (const [id, ev] of Object.entries(shopFx.shelf as unknown as Record<string, Array<[string, number | null, number | null]>>)) {
        for (const [i, [state, from, to]] of ev.entries()) {
          await tx.query('INSERT INTO command.shop_shelf (product_id, position, state, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)', [id, i, state, iso(from), iso(to)]);
        }
      }
      // newest first, as the product panel lists them; inserted oldest first so the ids keep that order
      for (const [id, hist] of Object.entries(shopFx.history as unknown as Record<string, Array<[number, string, string]>>)) {
        for (const [at, what, who] of [...hist].reverse()) await tx.query('INSERT INTO command.shop_history (product_id, at, what, who) VALUES ($1, $2, $3, $4)', [id, iso(at), what, who]);
      }
      for (const [id, at, buyer, member, items, paid, how, partner, state, city] of shopFx.orders as Array<[string, number, string, number, unknown[], string, string, string, string, string]>) {
        await tx.query(
          'INSERT INTO command.shop_orders (id, paid_at, buyer, member, items, paid_with, fulfilment, pickup_at, state, city) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [id, iso(at), buyer, !!member, JSON.stringify(items), paid, how, partner, state, city],
        );
      }
      for (const [id, shop, pid, opt, units, state, at] of shopFx.preorders as Array<[string, string, string, string, number, string, number]>) {
        await tx.query('INSERT INTO command.shop_preorders (id, shop, product_id, option, units, state, placed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, shop, pid, opt, units, state, iso(at)]);
      }
      for (const [i, [what, units, stages, lands, pid]] of (shopFx.incoming as Array<[string, string, unknown[], string, string]>).entries()) {
        await tx.query('INSERT INTO command.shop_incoming (position, what, units_label, stages, lands, product_id) VALUES ($1, $2, $3, $4, $5, $6)', [i, what, units, JSON.stringify(stages), lands, pid]);
      }
      type Return = { order: string; item: string; reason: string; returned: number; condition: string; proposedBy: string; proposedAt: number; second: string | null; refundedAt: number | null; amount: number | null };
      for (const r of shopFx.returns as Return[]) {
        await tx.query(
          `INSERT INTO command.shop_returns (order_id, item, reason, returned_on, condition, proposed_by, proposed_at, second_person, refunded_at, amount_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [r.order, r.item, r.reason, iso(r.returned), r.condition, r.proposedBy, iso(r.proposedAt), r.second, iso(r.refundedAt), r.amount == null ? null : cents(r.amount)],
        );
      }
      done.push(`${products.length} products`, `${shopFx.orders.length} orders`, `${shopFx.preorders.length} pre-orders`);
    }
  });
  return done;
}
