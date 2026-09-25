import { randomUUID } from 'node:crypto';
import type { DrawerSession } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { balance, post } from '../ledger/ledgerService.js';
import * as postings from '../ledger/postings.js';
import { businessDate } from '../orders/orderService.js';
import { getSettings } from '../shop/shopService.js';

/**
 * The cash drawer's session (card-processing prompt, Phase 7 opens it; cash tenders in Phase 6 need
 * it). One open at a time per shop: the first person on opens it with the starting cash, and cash
 * taken goes into it. Counting and closing come with Close the day.
 */

export class DrawerError extends Error {
  constructor(
    message: string,
    readonly code: 'already_open' | 'closed' | 'invalid',
  ) {
    super(message);
    this.name = 'DrawerError';
  }
}

interface SessionRow {
  id: string;
  merchant: string;
  business_date: Date | string;
  opened_by: string;
  starting_cash_cents: string | number;
  opened_at: Date | string;
  closed_at: Date | string | null;
  status: DrawerSession['status'];
}

const toSession = (r: SessionRow): DrawerSession => ({
  id: r.id,
  shop: r.merchant,
  businessDate: typeof r.business_date === 'string' ? r.business_date.slice(0, 10) : r.business_date.toISOString().slice(0, 10),
  openedBy: r.opened_by,
  startingCashCents: Number(r.starting_cash_cents),
  openedAt: new Date(r.opened_at).toISOString(),
  closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
  status: r.status,
});

export async function currentDrawer(q: Queryable, merchant: string): Promise<DrawerSession | null> {
  const { rows } = await q.query<SessionRow>(`SELECT * FROM payments.drawer_sessions WHERE merchant = $1 AND status <> 'closed'`, [merchant]);
  return rows[0] ? toSession(rows[0]) : null;
}

/** The open drawer, locked, for cash going in or out. */
export async function lockOpenDrawer(tx: Queryable, merchant: string): Promise<SessionRow> {
  const { rows } = await tx.query<SessionRow>(`SELECT * FROM payments.drawer_sessions WHERE merchant = $1 AND status = 'open' FOR UPDATE`, [merchant]);
  if (!rows[0]) throw new DrawerError('The drawer isn’t open. Open it with the starting cash first.', 'closed');
  return rows[0];
}

/**
 * Opens the drawer with the starting cash (the shop's setting unless counted otherwise). If that
 * differs from what the ledger says the drawer holds, the difference is booked as float from or to
 * the bank, so the expected total at close starts right.
 */
export async function openDrawer(db: Db, input: { merchant: string; staffId: string; startingCashCents?: number }): Promise<DrawerSession> {
  const settings = await getSettings(db, input.merchant);
  const starting = input.startingCashCents ?? settings.startingCashCents;
  if (!Number.isSafeInteger(starting) || starting < 0) throw new DrawerError('Starting cash is a whole number of cents', 'invalid');
  const { rows: shop } = await db.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  const id = `drw_${randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`drawer:${input.merchant}`]);
    if (await currentDrawer(tx, input.merchant)) throw new DrawerError('The drawer is already open', 'already_open');
    await tx.query(
      `INSERT INTO payments.drawer_sessions (id, merchant, business_date, opened_by, starting_cash_cents) VALUES ($1,$2,$3,$4,$5)`,
      [id, input.merchant, businessDate(shop[0]!.timezone), input.staffId, starting],
    );
    const inDrawer = await balance(tx, input.merchant, 'drawer_cash');
    const float = postings.drawerFloat({ merchant: input.merchant, sessionId: id, changeCents: starting - inDrawer, createdBy: input.staffId });
    if (float) await post(tx, float);
  });
  return (await currentDrawer(db, input.merchant))!;
}
