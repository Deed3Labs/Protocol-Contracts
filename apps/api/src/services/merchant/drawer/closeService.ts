import { randomUUID } from 'node:crypto';
import { type BankDeposit, type CountsView, type DayReport, type Role, SaveCount, SignOff, type TenderMethod } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { captureDue } from '../cards/cardTenders.js';
import type { CardConnectorProvider } from '../cards/connector.js';
import { tipsPayable } from '../ledger/accounts.js';
import { balance, post } from '../ledger/ledgerService.js';
import * as postings from '../ledger/postings.js';
import type { PinCheck } from '../orders/orderService.js';
import { getSettings } from '../shop/shopService.js';
import { type CountRow, countsView } from './countsView.js';
import { audit } from '../security/audit.js';
import { sendDaySummary, type SummaryMailer } from './daySummary.js';

/**
 * Counting the drawer and Close the day (card-processing prompt, Phase 7; the app's drawer sheets).
 *
 *   counts     blind: the first, then a second by someone else. Neither sees the other's figure or
 *              the expected total until both are in (the projection in countsView.ts is the only
 *              way a count leaves the database). With two counts off, one.
 *   recount    the two disagree: one of the two counts again, replacing their own count. The old
 *              count is kept, superseded, not edited.
 *   sign-off   they agree but differ from what the drawer should hold: an owner or manager who
 *              wasn't the first counter signs, with a note (the database enforces who, too).
 *   close      blocked while a difference is unsigned or an order is half-paid. Captures the day's
 *              cards; books the difference; pays cash tips out of the drawer (card tips are owed and
 *              paid with payroll); leaves tomorrow's float; sends the rest to the bank; writes the
 *              day report, which nothing edits after.
 *   deposit    "Mark deposited" moves it from in transit to the bank.
 *
 * What the drawer should hold is the ledger's drawer cash: the float, cash taken, change given,
 * cash refunds and tips paid out, all booked as they happened.
 */

export class CloseError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'invalid'
      | 'closed'
      | 'both_counted'
      | 'someone_else'
      | 'not_compared'
      | 'counts_disagree'
      | 'no_difference'
      | 'signer_invalid'
      | 'unsigned'
      | 'orders_open'
      | 'counts_needed',
  ) {
    super(message);
    this.name = 'CloseError';
  }
}

interface SessionRow {
  id: string;
  merchant: string;
  business_date: Date | string;
  opened_by: string;
  starting_cash_cents: string | number;
  status: 'open' | 'counting' | 'closed';
}

const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

async function lockSession(tx: Queryable, merchant: string, sessionId: string): Promise<SessionRow> {
  const { rows } = await tx.query<SessionRow>('SELECT * FROM payments.drawer_sessions WHERE id = $1 AND merchant = $2 FOR UPDATE', [sessionId, merchant]);
  if (!rows[0]) throw new CloseError('No such drawer', 'not_found');
  return rows[0];
}

async function liveCounts(q: Queryable, sessionId: string): Promise<CountRow[]> {
  const { rows } = await q.query<CountRow>(
    'SELECT id, counter, method, notes, total_cents, second, saved_at FROM payments.drawer_counts WHERE session_id = $1 AND superseded_at IS NULL ORDER BY second',
    [sessionId],
  );
  return rows;
}

async function signedOff(q: Queryable, sessionId: string): Promise<{ signed_by: string } | null> {
  const { rows } = await q.query<{ signed_by: string }>('SELECT signed_by FROM payments.drawer_signoffs WHERE session_id = $1', [sessionId]);
  return rows[0] ?? null;
}

/** What the viewer may see of the counts: their own until both are in, then everything. */
export async function counts(db: Queryable, input: { merchant: string; sessionId: string; viewer: string }): Promise<CountsView> {
  const { rows } = await db.query<SessionRow>('SELECT * FROM payments.drawer_sessions WHERE id = $1 AND merchant = $2', [input.sessionId, input.merchant]);
  if (!rows[0]) throw new CloseError('No such drawer', 'not_found');
  const settings = await getSettings(db, input.merchant);
  const live = await liveCounts(db, input.sessionId);
  // Read only if the projection decides the counts are all in.
  let expected: number | null = null;
  if (live.length >= (settings.twoCounts ? 2 : 1)) expected = await balance(db, input.merchant, 'drawer_cash');
  return countsView({
    live,
    viewer: input.viewer,
    twoCounts: settings.twoCounts,
    expectedCents: () => expected!,
    signed: Boolean(await signedOff(db, input.sessionId)),
  });
}

const NOTES = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1];

/**
 * Saves a count. It fills the first slot, then the second; the second is someone other than the
 * first counter. The viewer gets back only what they may see.
 */
export async function saveCount(db: Db, input: { merchant: string; sessionId: string; staffId: string; count: unknown }): Promise<CountsView> {
  const parsed = SaveCount.safeParse(input.count);
  if (!parsed.success) throw new CloseError('A count is notes by denomination, or a total in cents', 'invalid');
  const c = parsed.data;
  const total = c.method === 'total' ? c.totalCents : NOTES.reduce((s, n) => s + n * (c.notes[String(n) as keyof typeof c.notes] ?? 0), 0);
  await db.transaction(async (tx) => {
    const session = await lockSession(tx, input.merchant, input.sessionId);
    if (session.status === 'closed') throw new CloseError('This drawer is closed', 'closed');
    const settings = await getSettings(tx, input.merchant);
    const live = await liveCounts(tx, input.sessionId);
    const first = live.find((r) => !r.second);
    const second = live.find((r) => r.second);
    if (first && (second || !settings.twoCounts)) throw new CloseError('The drawer has been counted. If the counts disagree, one of you counts again.', 'both_counted');
    if (first && first.counter === input.staffId) throw new CloseError('The second count is someone else’s', 'someone_else');
    if (!first && second && second.counter === input.staffId) throw new CloseError('The other count is someone else’s', 'someone_else');
    await tx.query(
      `INSERT INTO payments.drawer_counts (id, session_id, counter, method, notes, total_cents, second) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`cnt_${randomUUID()}`, input.sessionId, input.staffId, c.method, c.method === 'notes' ? JSON.stringify(c.notes) : null, total, Boolean(first)],
    );
    // Owners read the audit trail; counters never do, so a blind count stays blind to them.
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'drawer.counted', ref: { type: 'drawer_session', id: input.sessionId }, amountCents: total, detail: { second: Boolean(first), method: c.method } });
    if (session.status === 'open') await tx.query(`UPDATE payments.drawer_sessions SET status = 'counting' WHERE id = $1`, [session.id]);
  });
  return counts(db, { merchant: input.merchant, sessionId: input.sessionId, viewer: input.staffId });
}

/**
 * The two counts disagree: one of the two counts again. Their count is set aside (kept, superseded)
 * and they save a new one. Only while the counts disagree, and only the person whose count it is.
 */
export async function recount(db: Db, input: { merchant: string; sessionId: string; staffId: string; which: 'first' | 'second' }): Promise<CountsView> {
  await db.transaction(async (tx) => {
    const session = await lockSession(tx, input.merchant, input.sessionId);
    if (session.status === 'closed') throw new CloseError('This drawer is closed', 'closed');
    const live = await liveCounts(tx, input.sessionId);
    const target = live.find((r) => r.second === (input.which === 'second'));
    const other = live.find((r) => r.second !== (input.which === 'second'));
    if (!target || !other) throw new CloseError('Both counts are needed before one is counted again', 'not_compared');
    if (Number(target.total_cents) === Number(other.total_cents)) throw new CloseError('The counts agree; nothing to count again', 'invalid');
    if (target.counter !== input.staffId) throw new CloseError('Whoever made that count counts again', 'someone_else');
    await tx.query('UPDATE payments.drawer_counts SET superseded_at = now() WHERE id = $1', [target.id]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'drawer.recount', ref: { type: 'drawer_session', id: input.sessionId }, amountCents: Number(target.total_cents), detail: { which: input.which } });
  });
  return counts(db, { merchant: input.merchant, sessionId: input.sessionId, viewer: input.staffId });
}

/**
 * The counts agree but differ from what the drawer should hold: an owner or manager who wasn't the
 * first counter signs it off with a note, by PIN at the counter.
 */
export async function signOff(db: Db, deps: { pinCheck: PinCheck }, input: { merchant: string; sessionId: string; staffId: string; signOff: unknown }): Promise<CountsView> {
  const parsed = SignOff.safeParse(input.signOff);
  if (!parsed.success) throw new CloseError('A sign-off needs a note and a PIN', 'invalid');
  const signer = await deps.pinCheck(input.merchant, parsed.data.pin);
  if (!signer || (signer.role as Role) === 'counter') throw new CloseError('A difference is signed off by a manager or owner', 'signer_invalid');
  const view = await counts(db, { merchant: input.merchant, sessionId: input.sessionId, viewer: signer.id });
  if (view.state === 'disagree') throw new CloseError('The counts disagree: one of you counts again first', 'counts_disagree');
  if (view.state !== 'compared') throw new CloseError('Both counts come first', 'not_compared');
  if (view.differenceCents === 0) throw new CloseError('The drawer matches; nothing to sign', 'no_difference');
  if (view.counts[0].counter === signer.id) throw new CloseError('Someone other than the first counter signs it off', 'signer_invalid');
  await db.transaction(async (tx) => {
    await lockSession(tx, input.merchant, input.sessionId);
    await tx.query(
      `INSERT INTO payments.drawer_signoffs (id, session_id, difference_cents, note, signed_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (session_id) DO NOTHING`,
      [`sgn_${randomUUID()}`, input.sessionId, view.differenceCents, parsed.data.note, signer.id],
    );
    await audit(tx, {
      merchant: input.merchant,
      actor: input.staffId,
      approver: signer.id,
      action: 'drawer.signed_off',
      ref: { type: 'drawer_session', id: input.sessionId },
      amountCents: view.differenceCents,
      detail: { note: parsed.data.note },
    });
  });
  return counts(db, { merchant: input.merchant, sessionId: input.sessionId, viewer: input.staffId });
}

// ---- Close the day -----------------------------------------------------------------------------

interface ReportTender {
  method: TenderMethod;
  status: string;
  amount_cents: string | number;
  tip_cents: string | number;
  tip_staff_id: string | null;
  created_by: string;
  drawer_session_id: string | null;
}

/** The day's figures, from its orders and tenders. */
async function dayFigures(q: Queryable, merchant: string, date: string, sessionId: string) {
  const { rows: tenders } = await q.query<ReportTender>(
    `SELECT t.method, t.status, t.amount_cents, t.tip_cents, t.tip_staff_id, t.created_by, t.drawer_session_id FROM payments.tenders t
       JOIN commerce.orders o ON o.id = t.order_id
      WHERE o.merchant = $1 AND o.business_date = $2 AND t.status IN ('authorised','approved','captured','partly_refunded','refunded')`,
    [merchant, date],
  );
  const byMethod = { clear: { count: 0, cents: 0 }, card: { count: 0, cents: 0 }, cash: { count: 0, cents: 0 } } as DayReport['byMethod'];
  const tipMap = new Map<string, { staffId: string; cents: number; how: 'card' | 'cash' }>();
  for (const t of tenders) {
    const m = byMethod[t.method]!;
    m.count += 1;
    m.cents += Number(t.amount_cents) + Number(t.tip_cents);
    if (Number(t.tip_cents) > 0) {
      // Clear tips are paid like card tips: with payroll. Cash tips come out of the drawer.
      const how = t.method === 'cash' ? 'cash' : 'card';
      const staffId = t.tip_staff_id ?? t.created_by;
      const k = `${staffId}:${how}`;
      const e = tipMap.get(k) ?? { staffId, cents: 0, how };
      e.cents += Number(t.tip_cents);
      tipMap.set(k, e);
    }
  }
  const { rows: totals } = await q.query<{ tax: string | number; discounts: string | number }>(
    `SELECT COALESCE(sum(tax_cents), 0) AS tax, COALESCE(sum(discount_cents), 0) AS discounts FROM commerce.orders
      WHERE merchant = $1 AND business_date = $2 AND status IN ('paid','refunded','partly_refunded')`,
    [merchant, date],
  );
  const { rows: refunds } = await q.query<{ cents: string | number }>(
    `SELECT COALESCE(sum(f.amount_cents), 0) AS cents FROM payments.refunds f WHERE f.merchant = $1 AND f.status = 'succeeded' AND (f.drawer_session_id = $2 OR (f.updated_at AT TIME ZONE 'UTC')::date = $3::date)`,
    [merchant, sessionId, date],
  );
  const tipsByStaff = [...tipMap.values()];
  return {
    byMethod,
    takenCents: Object.values(byMethod).reduce((s, m) => s + m.cents, 0),
    tipsCents: tipsByStaff.reduce((s, t) => s + t.cents, 0),
    tipsByStaff,
    taxCents: Number(totals[0]!.tax),
    discountsCents: Number(totals[0]!.discounts),
    refundsCents: Number(refunds[0]!.cents),
  };
}

export interface CloseResult {
  report: DayReport;
  /** Cards that didn't capture; the safety job keeps trying. */
  captureFailures: Array<{ tenderId: string; error: string }>;
}

/** Close the day: see the top of this file. Idempotent: closing a closed drawer returns its report. */
export async function closeDay(db: Db, deps: { card: CardConnectorProvider | null; mail?: SummaryMailer }, input: { merchant: string; sessionId: string; staffId: string }): Promise<CloseResult> {
  const { rows: existing } = await db.query<{ report: DayReport | string }>('SELECT report FROM payments.day_reports WHERE session_id = $1', [input.sessionId]);
  if (existing[0]) return { report: typeof existing[0].report === 'string' ? JSON.parse(existing[0].report) : existing[0].report, captureFailures: [] };

  const { rows: session } = await db.query<SessionRow>('SELECT * FROM payments.drawer_sessions WHERE id = $1 AND merchant = $2', [input.sessionId, input.merchant]);
  if (!session[0]) throw new CloseError('No such drawer', 'not_found');
  const date = day(session[0].business_date);
  // First: a half-paid order's cash is in the drawer but not yet in the books, so it would show as a
  // difference. Finishing or voiding it is the answer, not signing that difference off.
  const { rows: halfPaid } = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM commerce.orders WHERE merchant = $1 AND status = 'paying'`, [input.merchant]);
  if (Number(halfPaid[0]!.n) > 0) throw new CloseError(`${halfPaid[0]!.n} order(s) are part-paid: finish or void them first`, 'orders_open');

  const view = await counts(db, { merchant: input.merchant, sessionId: input.sessionId, viewer: input.staffId });
  if (view.state === 'disagree') throw new CloseError('The counts disagree: one of you counts again first', 'counts_disagree');
  if (view.state !== 'compared') throw new CloseError('Count the drawer first (two counts, blind)', 'counts_needed');
  if (view.signoffNeeded) throw new CloseError(`The drawer is ${view.differenceCents < 0 ? 'short' : 'over'}: a manager or owner signs it off first`, 'unsigned');


  // The day's cards, at their final amounts. A failure doesn't hold the close: the safety job retries.
  const captured = deps.card ? await captureDue(db, deps.card, { merchant: input.merchant, actor: input.staffId }) : { captured: [], failed: [] };

  const settings = await getSettings(db, input.merchant);
  const report = await db.transaction(async (tx) => {
    const s = await lockSession(tx, input.merchant, input.sessionId);
    if (s.status === 'closed') throw new CloseError('This drawer is closed', 'closed');
    const expected = view.expectedCents;
    const counted = view.counts[view.counts.length - 1].totalCents;
    const difference = counted - expected;

    const diff = postings.drawerDifference({ merchant: input.merchant, sessionId: s.id, differenceCents: difference, createdBy: input.staffId });
    if (diff) await post(tx, diff);

    const figures = await dayFigures(tx, input.merchant, date, s.id);
    // Cash tips come out of the drawer now, each person's in one entry.
    for (const t of figures.tipsByStaff.filter((x) => x.how === 'cash')) {
      await post(tx, postings.tipPaidOut({ merchant: input.merchant, payoutId: `${s.id}:${t.staffId}`, staffId: t.staffId, sessionId: s.id, cents: t.cents, createdBy: input.staffId }));
    }
    const cashTips = figures.tipsByStaff.filter((x) => x.how === 'cash').reduce((sum, t) => sum + t.cents, 0);
    const leaves = Math.max(0, counted - cashTips);
    const leave = Math.min(settings.startingCashCents, leaves);
    const toBank = leaves - leave;

    let depositId: string | null = null;
    if (toBank > 0) {
      depositId = `dep_${randomUUID()}`;
      await tx.query('INSERT INTO payments.bank_deposits (id, merchant, session_id, amount_cents) VALUES ($1,$2,$3,$4)', [depositId, input.merchant, s.id, toBank]);
      await post(tx, postings.depositLeftDrawer({ merchant: input.merchant, depositId, amountCents: toBank, createdBy: input.staffId }));
    }
    // What's left in the drawer is exactly tomorrow's float.
    const inDrawer = await balance(tx, input.merchant, 'drawer_cash');
    if (inDrawer !== leave) throw new Error(`The drawer books ${inDrawer} but ${leave} is left in it`);

    const signoff = await signedOff(tx, s.id);
    const closedAt = new Date().toISOString();
    const r: DayReport = {
      id: `rpt_${randomUUID()}`,
      shop: input.merchant,
      businessDate: date,
      takenCents: figures.takenCents,
      byMethod: figures.byMethod,
      tipsCents: figures.tipsCents,
      tipsByStaff: figures.tipsByStaff,
      taxCents: figures.taxCents,
      discountsCents: figures.discountsCents,
      refundsCents: figures.refundsCents,
      drawer: { startingCashCents: Number(s.starting_cash_cents), expectedCents: expected, countedCents: counted, differenceCents: difference, leaveCents: leave, toBankCents: toBank, signedOffBy: signoff?.signed_by ?? null },
      closedBy: input.staffId,
      closedAt,
    };
    await tx.query('INSERT INTO payments.day_reports (id, merchant, session_id, business_date, report, closed_by, closed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      r.id,
      input.merchant,
      s.id,
      date,
      JSON.stringify(r),
      input.staffId,
      closedAt,
    ]);
    await tx.query(`UPDATE payments.drawer_sessions SET status = 'closed', closed_by = $2, closed_at = $3 WHERE id = $1`, [s.id, input.staffId, closedAt]);
    await audit(tx, {
      merchant: input.merchant,
      actor: input.staffId,
      action: 'day.closed',
      ref: { type: 'drawer_session', id: s.id },
      amountCents: r.drawer.countedCents,
      detail: { businessDate: date, dayReportId: r.id, captured: captured.captured.length, captureFailures: captured.failed.map((f) => f.tenderId) },
    });
    return r;
  });
  // The end-of-day summary, now its figures are final. Never holds up the close.
  await sendDaySummary(db, deps.mail, { merchant: input.merchant, report, captureFailures: captured.failed.length }).catch(() => undefined);
  return { report, captureFailures: captured.failed };
}

// ---- Deposits and reports ----------------------------------------------------------------------

interface DepositRow {
  id: string;
  session_id: string;
  amount_cents: string | number;
  marked_by: string | null;
  marked_at: Date | string | null;
}
const toDeposit = (r: DepositRow): BankDeposit => ({
  id: r.id,
  sessionId: r.session_id,
  amountCents: Number(r.amount_cents),
  markedBy: r.marked_by,
  markedAt: r.marked_at ? new Date(r.marked_at).toISOString() : null,
});

/** Unmarked first (the Payouts row is amber until someone marks it), then the most recent. */
export async function bankDeposits(q: Queryable, merchant: string): Promise<BankDeposit[]> {
  const { rows } = await q.query<DepositRow>('SELECT * FROM payments.bank_deposits WHERE merchant = $1 ORDER BY (marked_at IS NULL) DESC, created_at DESC LIMIT 100', [merchant]);
  return rows.map(toDeposit);
}

/** Someone took the cash to the bank: in transit becomes in the bank. Marking twice is harmless. */
export async function markDeposited(db: Db, input: { merchant: string; depositId: string; staffId: string }): Promise<BankDeposit> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<DepositRow>('SELECT * FROM payments.bank_deposits WHERE id = $1 AND merchant = $2 FOR UPDATE', [input.depositId, input.merchant]);
    const d = rows[0];
    if (!d) throw new CloseError('No such deposit', 'not_found');
    if (d.marked_at) return toDeposit(d);
    await post(tx, postings.depositMarked({ merchant: input.merchant, depositId: d.id, amountCents: Number(d.amount_cents), createdBy: input.staffId }));
    const { rows: out } = await tx.query<DepositRow>('UPDATE payments.bank_deposits SET marked_by = $2, marked_at = now() WHERE id = $1 RETURNING *', [d.id, input.staffId]);
    return toDeposit(out[0]!);
  });
}

export async function dayReports(q: Queryable, input: { merchant: string; from: string; to: string }): Promise<DayReport[]> {
  const { rows } = await q.query<{ report: DayReport | string }>(
    'SELECT report FROM payments.day_reports WHERE merchant = $1 AND business_date BETWEEN $2 AND $3 ORDER BY business_date DESC, closed_at DESC',
    [input.merchant, input.from, input.to],
  );
  return rows.map((r) => (typeof r.report === 'string' ? JSON.parse(r.report) : r.report));
}

/** What a person is owed in tips, for "Your tips today" and payroll: their tips account's balance. */
export async function tipsOwed(q: Queryable, merchant: string, staffId: string): Promise<number> {
  return balance(q, merchant, tipsPayable(staffId));
}
