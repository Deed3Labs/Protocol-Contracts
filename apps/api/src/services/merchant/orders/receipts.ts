import { randomBytes } from 'node:crypto';
import { EmailReceipt, type Receipt, SendReceipt } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { crockford } from '../terminal/codes.js';

/**
 * Receipts (card-processing prompt, Phase 6): text, email or none, plus print. A receipt shows the
 * lines, the discount, tax, tip and each tender, and is built from the order whenever it's read,
 * so a refund made later shows on it. The link carries an unguessable token and nothing else.
 */

export class ReceiptError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'invalid' | 'not_paid' | 'too_many',
  ) {
    super(message);
    this.name = 'ReceiptError';
  }
}

/** How receipts leave: the real one is the notification service (Twilio SMS, or the email webhook). */
export interface ReceiptNotifier {
  send(input: { by: 'text' | 'email'; to: string; merchantName: string; total: string; url: string }): Promise<boolean>;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function buildReceipt(q: Queryable, merchant: string, orderId: string): Promise<Receipt> {
  const { rows: orders } = await q.query<{
    number: number | null;
    business_date: Date | string;
    subtotal_cents: string | number;
    discount_cents: string | number;
    tax_cents: string | number;
    tax_included: boolean;
    tip_cents: string | number;
    total_cents: string | number;
    updated_at: Date | string;
    name: string;
    address_line1: string | null;
    address_city: string | null;
    address_region: string | null;
  }>(
    `SELECT o.*, p.name, p.address_line1, p.address_city, p.address_region FROM commerce.orders o JOIN merchant.profiles p ON p.merchant = o.merchant
      WHERE o.id = $1 AND o.merchant = $2`,
    [orderId, merchant],
  );
  const o = orders[0];
  if (!o) throw new ReceiptError('No such order', 'not_found');
  const { rows: lines } = await q.query<{ name: string; quantity: number; options: Array<{ name: string }> | string; note: string | null; line_cents: string | number; discount_cents: string | number }>(
    'SELECT name, quantity, options, note, line_cents, discount_cents FROM commerce.order_lines WHERE order_id = $1 AND removed_at IS NULL ORDER BY position, id',
    [orderId],
  );
  const { rows: discount } = await q.query<{ label: string; amount_cents: string | number }>('SELECT label, amount_cents FROM commerce.order_discounts WHERE order_id = $1 AND removed_at IS NULL', [orderId]);
  const { rows: tenders } = await q.query<{ method: Receipt['tenders'][number]['method']; amount_cents: string | number; tip_cents: string | number; card_brand: string | null; card_last4: string | null; change_cents: string | number | null; status: Receipt['tenders'][number]['status']; refunded_cents: string | number }>(
    `SELECT method, amount_cents, tip_cents, card_brand, card_last4, change_cents, status, refunded_cents FROM payments.tenders
      WHERE order_id = $1 AND status NOT IN ('pending','declined','cancelled') ORDER BY created_at, id`,
    [orderId],
  );
  const address = o.address_line1 && o.address_city ? `${o.address_line1}, ${o.address_city}${o.address_region ? `, ${o.address_region}` : ''}` : null;
  return {
    shop: { name: o.name, address },
    orderNumber: o.number,
    businessDate: typeof o.business_date === 'string' ? o.business_date.slice(0, 10) : o.business_date.toISOString().slice(0, 10),
    issuedAt: new Date(o.updated_at).toISOString(),
    lines: lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      options: (typeof l.options === 'string' ? JSON.parse(l.options) : l.options).map((x: { name: string }) => x.name),
      note: l.note,
      lineCents: Number(l.line_cents),
      discountCents: Number(l.discount_cents),
    })),
    discount: discount[0] ? { label: discount[0].label, amountCents: Number(discount[0].amount_cents) } : null,
    subtotalCents: Number(o.subtotal_cents),
    discountCents: Number(o.discount_cents),
    taxCents: Number(o.tax_cents),
    taxIncluded: o.tax_included,
    tipCents: Number(o.tip_cents),
    totalCents: Number(o.total_cents),
    tenders: tenders.map((t) => ({
      method: t.method,
      amountCents: Number(t.amount_cents),
      tipCents: Number(t.tip_cents),
      card: t.card_last4 ? `${cap(t.card_brand ?? 'card')} ending ${t.card_last4}` : null,
      changeCents: t.change_cents === null ? null : Number(t.change_cents),
      status: t.status,
    })),
    refundedCents: tenders.reduce((s, t) => s + Number(t.refunded_cents), 0),
    table: await tableLabel(q, orderId),
    code: await receiptCode(q, orderId),
  };
}

/** "Table 12, back patio", for a table's tab. */
async function tableLabel(q: Queryable, orderId: string): Promise<string | null> {
  const { rows } = await q.query<{ number: number; label: string | null; area: string | null }>(
    'SELECT t.number, t.label, t.area FROM commerce.orders o JOIN merchant.tables t ON t.id = o.table_id WHERE o.id = $1',
    [orderId],
  );
  const t = rows[0];
  return t ? `${t.label ?? `Table ${t.number}`}${t.area ? `, ${t.area}` : ''}` : null;
}

async function receiptCode(q: Queryable, orderId: string): Promise<string | null> {
  const { rows } = await q.query<{ code: string }>('SELECT code FROM payments.receipts WHERE order_id = $1 AND code IS NOT NULL', [orderId]);
  return rows[0]?.code ?? null;
}

/**
 * The receipt's own code, made the first time a paid order's receipt is read to print (the sticker's
 * QR) and kept for good. Random: the order number is on the paper already and says nothing secret,
 * but a guessable link would show anyone's.
 */
export async function ensureReceiptCode(db: Db, input: { merchant: string; orderId: string; staffId: string | null }): Promise<string | null> {
  const existing = await receiptCode(db, input.orderId);
  if (existing) return existing;
  const { rows: paid } = await db.query("SELECT 1 FROM payments.tenders WHERE order_id = $1 AND merchant = $2 AND status NOT IN ('pending','declined','cancelled') LIMIT 1", [
    input.orderId,
    input.merchant,
  ]);
  if (!paid[0]) return null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crockford(10);
    const { rows } = await db.query<{ code: string }>(
      `INSERT INTO payments.receipts (token, merchant, order_id, channel, sent_by, code, delivered) VALUES ($1,$2,$3,'link',$4,$5,true)
       ON CONFLICT DO NOTHING RETURNING code`,
      [randomBytes(16).toString('hex'), input.merchant, input.orderId, input.staffId, code],
    );
    if (rows[0]) return rows[0].code;
    const raced = await receiptCode(db, input.orderId);
    if (raced) return raced;
  }
  throw new Error('could not make a receipt code');
}

/** `GET /api/r/:code`: the sticker receipt. Nothing but the code finds it. */
export async function receiptByCode(q: Queryable, code: string): Promise<Receipt> {
  const c = code.toUpperCase();
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(c)) throw new ReceiptError('No such receipt', 'not_found');
  const { rows } = await q.query<{ merchant: string; order_id: string }>('SELECT merchant, order_id FROM payments.receipts WHERE code = $1', [c]);
  if (!rows[0]) throw new ReceiptError('No such receipt', 'not_found');
  return buildReceipt(q, rows[0].merchant, rows[0].order_id);
}

/** "Email me this receipt", from the paid page: three emails an hour for a receipt at most. */
export async function emailReceiptByCode(db: Db, notifier: ReceiptNotifier, input: { code: string; request: unknown; receiptBaseUrl: string }): Promise<void> {
  const parsed = EmailReceipt.safeParse(input.request);
  if (!parsed.success) throw new ReceiptError('That isn’t an email address', 'invalid');
  const c = input.code.toUpperCase();
  const { rows } = await db.query<{ merchant: string; order_id: string }>('SELECT merchant, order_id FROM payments.receipts WHERE code = $1', [c]);
  if (!rows[0]) throw new ReceiptError('No such receipt', 'not_found');
  const { rows: recent } = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM payments.receipts WHERE order_id = $1 AND channel = 'email' AND sent_by IS NULL AND created_at > now() - interval '1 hour'`,
    [rows[0].order_id],
  );
  if (Number(recent[0]?.n ?? 0) >= 3) throw new ReceiptError('That receipt has been emailed a few times already. Try again later', 'too_many');
  const receipt = await buildReceipt(db, rows[0].merchant, rows[0].order_id);
  const url = `${input.receiptBaseUrl.replace(/\/+$/, '')}/${c}`;
  const token = randomBytes(16).toString('hex');
  await db.query("INSERT INTO payments.receipts (token, merchant, order_id, channel, sent_to) VALUES ($1,$2,$3,'email',$4)", [token, rows[0].merchant, rows[0].order_id, parsed.data.email]);
  const paid = receipt.tenders.reduce((s, t) => s + t.amountCents + t.tipCents, 0);
  const ok = await notifier.send({ by: 'email', to: parsed.data.email, merchantName: receipt.shop.name, total: usd(paid), url }).catch(() => false);
  await db.query('UPDATE payments.receipts SET delivered = $2 WHERE token = $1', [token, ok]);
}

/** The public receipt behind a link. Nothing but the token finds it. */
export async function receiptByToken(q: Queryable, token: string): Promise<Receipt> {
  if (!/^[a-z0-9]{16,64}$/.test(token)) throw new ReceiptError('No such receipt', 'not_found');
  const { rows } = await q.query<{ merchant: string; order_id: string }>('SELECT merchant, order_id FROM payments.receipts WHERE token = $1', [token]);
  if (!rows[0]) throw new ReceiptError('No such receipt', 'not_found');
  return buildReceipt(q, rows[0].merchant, rows[0].order_id);
}

const PHONE = /^\+?[0-9 ()-]{10,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends the receipt by text or email, or not at all. Only for an order that took money. The link's
 * token is new each time, so a receipt sent to the wrong number can be followed by a right one
 * without the wrong one showing anything else.
 */
export async function sendReceipt(
  db: Db,
  notifier: ReceiptNotifier,
  input: { merchant: string; orderId: string; staffId: string; request: unknown; receiptBaseUrl: string },
): Promise<{ sent: boolean; url: string | null }> {
  const parsed = SendReceipt.safeParse(input.request);
  if (!parsed.success) throw new ReceiptError('Text, email or none, and where to', 'invalid');
  const { by, to } = parsed.data;
  if (by === 'none') return { sent: false, url: null };
  if (!to || (by === 'text' ? !PHONE.test(to) : !EMAIL.test(to))) throw new ReceiptError(by === 'text' ? 'That isn’t a phone number' : 'That isn’t an email address', 'invalid');

  const receipt = await buildReceipt(db, input.merchant, input.orderId);
  if (receipt.tenders.length === 0) throw new ReceiptError('Nothing has been paid on this order yet', 'not_paid');
  const token = randomBytes(16).toString('hex');
  const url = `${input.receiptBaseUrl.replace(/\/+$/, '')}/${token}`;
  await db.query('INSERT INTO payments.receipts (token, merchant, order_id, channel, sent_to, sent_by) VALUES ($1,$2,$3,$4,$5,$6)', [token, input.merchant, input.orderId, by, to, input.staffId]);
  const paid = receipt.tenders.reduce((s, t) => s + t.amountCents + t.tipCents, 0);
  let ok = false;
  let error: string | null = null;
  try {
    ok = await notifier.send({ by, to, merchantName: receipt.shop.name, total: usd(paid), url });
    if (!ok) error = 'the message could not be sent';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await db.query('UPDATE payments.receipts SET delivered = $2, error = $3 WHERE token = $1', [token, ok, error]);
  return { sent: ok, url };
}
