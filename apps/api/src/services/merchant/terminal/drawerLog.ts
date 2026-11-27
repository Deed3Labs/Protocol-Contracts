import { randomUUID } from 'node:crypto';
import { ApproveNoSale, DrawerEventBatch, type DrawerDay, type DrawerEventsSaved, type NoSaleApproval, type Role } from '@clear/merchant-contracts';
import { seesMoney } from '@clear/domain';
import type { Db, Queryable } from '../../../db/db.js';
import { audit } from '../security/audit.js';
import { getSettings } from '../shop/shopService.js';
import { TerminalError } from './errors.js';

/**
 * The drawer's log (terminal reference, sections 5 and 6). The tablet opens the drawer itself and
 * tells the server afterwards, in order, as soon as it can: so the log takes events the tablet made,
 * with its ids and its times, and a repeat is a duplicate, never a second open.
 */

export type PinCheck = (merchant: string, pin: string) => Promise<{ id: string; role: Role } | null>;

/** An approval is used by the open it allowed, within two minutes. */
const APPROVAL_MS = 2 * 60_000;

/**
 * A No sale's reason and PIN, before the drawer opens. With "everyone on shift" allowed, the counter's
 * own PIN; otherwise a manager's or owner's (the refunds' override). With PINs off, someone allowed
 * needs none. It needs the connection: PINs are checked here.
 */
export async function approveNoSale(
  db: Db,
  pinCheck: PinCheck,
  input: { merchant: string; staff: { id: string; role: Role }; request: unknown; now?: Date },
): Promise<NoSaleApproval> {
  const parsed = ApproveNoSale.safeParse(input.request);
  if (!parsed.success) throw new TerminalError(parsed.error.issues[0]?.message ?? 'A reason, and a PIN', 'invalid');
  const r = parsed.data;
  if (r.reason === 'other' && !r.note) throw new TerminalError('Say what it was for', 'invalid');
  const settings = await getSettings(db, input.merchant);
  const everyone = settings.drawerNoSaleRoles === 'anyone';
  const allowed = (role: Role) => everyone || seesMoney(role);
  const needsPin = settings.noSaleNeedsPin !== false;

  let approvedBy: string | null = null;
  if (!needsPin && allowed(input.staff.role)) {
    approvedBy = null;
  } else {
    if (!r.pin) throw new TerminalError(everyone ? 'Your PIN' : 'A manager’s or owner’s PIN', 'forbidden');
    const who = await pinCheck(input.merchant, r.pin);
    if (!who) throw new TerminalError('That PIN isn’t right', 'forbidden');
    const ownPin = who.id === input.staff.id;
    if (everyone ? !(ownPin || seesMoney(who.role)) : !seesMoney(who.role)) throw new TerminalError('That needs a manager’s or owner’s PIN', 'forbidden');
    approvedBy = ownPin && !seesMoney(who.role) ? null : who.id;
  }

  const now = input.now ?? new Date();
  const id = `nsa_${randomUUID()}`;
  const expiresAt = new Date(now.getTime() + APPROVAL_MS);
  await db.transaction(async (tx) => {
    await tx.query(
      'INSERT INTO payments.no_sale_approvals (id, merchant, requested_by, approved_by, reason, note, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, input.merchant, input.staff.id, approvedBy, r.reason, r.note, now, expiresAt],
    );
    await audit(tx, { merchant: input.merchant, actor: input.staff.id, approver: approvedBy, action: 'drawer.no_sale_approved', ref: { type: 'no_sale', id }, detail: { reason: r.reason, note: r.note } });
  });
  return { approvalId: id, approvedBy, expiresAt: expiresAt.toISOString() };
}

/** The drawer session open at a moment, by the tablet's clock. */
async function sessionAt(q: Queryable, merchant: string, at: string): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `SELECT id FROM payments.drawer_sessions WHERE merchant = $1 AND opened_at <= $2 AND (closed_at IS NULL OR closed_at > $2)
      ORDER BY opened_at DESC LIMIT 1`,
    [merchant, at],
  );
  return rows[0]?.id ?? null;
}

/**
 * `POST /drawer/events`: in the order they happened, once each. The whole batch is checked before
 * any of it is kept, so a queue never half-syncs; events already kept are counted as duplicates.
 */
export async function saveDrawerEvents(db: Db, input: { merchant: string; staffId: string; batch: unknown }): Promise<DrawerEventsSaved> {
  const parsed = DrawerEventBatch.safeParse(input.batch);
  if (!parsed.success) throw new TerminalError(parsed.error.issues[0]?.message ?? 'Those drawer events aren’t valid', 'invalid');
  return db.transaction(async (tx) => {
    let saved = 0;
    let duplicates = 0;
    for (const e of parsed.data.events) {
      const { rows: seen } = await tx.query('SELECT 1 FROM payments.drawer_events WHERE merchant = $1 AND client_id = $2', [input.merchant, e.clientId]);
      if (seen[0]) {
        duplicates += 1;
        continue;
      }
      const { rows: drawer } = await tx.query(`SELECT 1 FROM merchant.hardware WHERE id = $1 AND merchant = $2 AND kind = 'drawer'`, [e.drawerId, input.merchant]);
      if (!drawer[0]) throw new TerminalError('That drawer isn’t one of the shop’s', 'invalid');
      const { rows: staff } = await tx.query('SELECT 1 FROM merchant.staff WHERE id = $1 AND merchant = $2', [e.staffId, input.merchant]);
      if (!staff[0]) throw new TerminalError('That person isn’t on the shop’s staff', 'invalid');
      let approvedBy: string | null = null;
      if (e.kind === 'opened') {
        if (e.orderId) {
          const { rows } = await tx.query('SELECT 1 FROM commerce.orders WHERE id = $1 AND merchant = $2', [e.orderId, input.merchant]);
          if (!rows[0]) throw new TerminalError('That order isn’t one of the shop’s', 'invalid');
        }
        if (e.reason === 'no_sale') {
          if (!e.noSale || !e.approvalId) throw new TerminalError('A No sale needs its reason and approval', 'invalid');
          const { rows } = await tx.query<{ requested_by: string; approved_by: string | null; expires_at: Date | string; reason: string }>(
            'SELECT requested_by, approved_by, expires_at, reason FROM payments.no_sale_approvals WHERE id = $1 AND merchant = $2',
            [e.approvalId, input.merchant],
          );
          const a = rows[0];
          if (!a || a.requested_by !== e.staffId) throw new TerminalError('That No sale wasn’t approved', 'forbidden');
          if (new Date(a.expires_at).getTime() < Date.parse(e.at)) throw new TerminalError('That No sale’s approval ran out before the drawer opened', 'expired');
          const { rows: used } = await tx.query('SELECT 1 FROM payments.drawer_events WHERE approval_id = $1', [e.approvalId]);
          if (used[0]) throw new TerminalError('That approval opened the drawer already', 'conflict');
          approvedBy = a.approved_by;
        }
      }
      const session = await sessionAt(tx, input.merchant, e.at);
      const opened = e.kind === 'opened' ? e : null;
      await tx.query(
        `INSERT INTO payments.drawer_events (id, merchant, client_id, drawer_id, session_id, kind, reason, order_id, no_sale_reason, no_sale_note, approval_id, staff_id, approved_by, at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          `dre_${randomUUID()}`,
          input.merchant,
          e.clientId,
          e.drawerId,
          session,
          e.kind,
          opened?.reason ?? null,
          opened?.orderId ?? null,
          opened?.reason === 'no_sale' ? opened.noSale!.reason : null,
          opened?.reason === 'no_sale' ? opened.noSale!.note : null,
          opened?.reason === 'no_sale' ? opened.approvalId : null,
          e.staffId,
          approvedBy,
          e.at,
        ],
      );
      if (opened && opened.reason !== 'sale') {
        // A sale's open is the sale; the rest are what an owner wants to see.
        await audit(tx, {
          merchant: input.merchant,
          actor: e.staffId,
          approver: approvedBy,
          action: `drawer.opened_${opened.reason}`,
          ref: opened.orderId ? { type: 'order', id: opened.orderId } : { type: 'drawer', id: e.drawerId },
          detail: { at: e.at, syncedBy: input.staffId, ...(opened.noSale ? { reason: opened.noSale.reason, note: opened.noSale.note } : {}) },
        });
      }
      saved += 1;
    }
    return { saved, duplicates };
  });
}

/** Close the day › the drawer: every open in the session. */
export async function drawerDay(q: Queryable, input: { merchant: string; sessionId: string }): Promise<DrawerDay> {
  const { rows: s } = await q.query('SELECT 1 FROM payments.drawer_sessions WHERE id = $1 AND merchant = $2', [input.sessionId, input.merchant]);
  if (!s[0]) throw new TerminalError('No such drawer', 'not_found');
  const { rows } = await q.query<{
    reason: string;
    at: Date | string;
    staff_id: string;
    no_sale_reason: DrawerDay['noSales'][number]['reason'] | null;
    no_sale_note: string | null;
    approved_by: string | null;
    order_id: string | null;
    number: number | null;
  }>(
    `SELECT e.reason, e.at, e.staff_id, e.no_sale_reason, e.no_sale_note, e.approved_by, e.order_id, o.number
       FROM payments.drawer_events e LEFT JOIN commerce.orders o ON o.id = e.order_id
      WHERE e.session_id = $1 AND e.kind = 'opened' ORDER BY e.at, e.seq`,
    [input.sessionId],
  );
  const iso = (d: Date | string) => new Date(d).toISOString();
  return {
    // The drawer's own opens: with the key it didn't open, and those are listed apart (section 6).
    opens: rows.filter((r) => r.reason !== 'key').length,
    withSale: rows.filter((r) => r.reason === 'sale' || r.reason === 'refund').length,
    noSales: rows
      .filter((r) => r.reason === 'no_sale')
      .map((r) => ({ at: iso(r.at), staffId: r.staff_id, reason: r.no_sale_reason!, note: r.no_sale_note, approvedBy: r.approved_by })),
    withKey: rows.filter((r) => r.reason === 'key').map((r) => ({ at: iso(r.at), orderId: r.order_id, orderNumber: r.number })),
  };
}
