import { randomInt, timingSafeEqual } from 'node:crypto';
import { PAY_OVER_TIME_MIN_CENTS, splitQuote, splitsOffered } from '@clear/domain';
import {
  ApproveOverTime,
  PayCode,
  PayContact,
  TEST_MEMBER,
  type ApprovalView,
  type CodeVerified,
  type ContactSent,
  type MemberQuote,
  type PaidView,
  type PayStatus,
} from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { memberAppUrl } from '../../memberAppUrl.js';
import { getOrder } from '../orders/orderService.js';
import { createClearTender, syncClearTender } from '../orders/payments.js';
import { membershipOf, balance, previewEarn } from '../rewards/ledger.js';
import { personByWallet } from '../rewards/people.js';
import { rulesAt } from '../rewards/shopApp.js';
import { paymentForOrder, paymentView } from './events.js';
import { payBase, PayError, payShop } from './links.js';
import { overTimeOnline } from './overTime.js';
import { decryptSecret, encryptSecret, mintPayToken, randomBase62, readPayToken, sha256, type PayClaims } from './secrets.js';
import { joinOffer, keepJoinContact, type JoinDeps } from './join.js';
import { clearFor, ensureSessionOrder, optionsOf, sessionRow, type SessionRow } from './sessions.js';
import { approveTestCharge, ensureTestMemberAt, isTestMemberPhone, TEST_MEMBER_BANK, TEST_MEMBER_FIRST_NAME, TEST_MEMBER_LIMIT_CENTS, TEST_MEMBER_WALLET, testChargeInstallments } from './testMode.js';

/**
 * Signing in and approving inside the modal (pay spec §2–§4; pay DECISIONS, Phase 1 and Phase 5).
 *
 * - Everyone who types a phone or an email gets the same answer and the same screen: a code, and a
 *   link to the approval page. A member also gets the request in the Clear app. Nothing says whether
 *   the contact has an account.
 * - The code (6 digits, 5 tries, 10 minutes, kept hashed) gives a payment-scoped token.
 * - A member pays over time in the frame (the server opens the plan) unless they have Face ID, which
 *   the frame can't ask for; then, and for Pay now (their wallet signs), they approve in the Clear
 *   app's window.
 */

export const CODE_MS = 10 * 60 * 1000;
export const TOKEN_MS = 30 * 60 * 1000;
export const RESEND_SECONDS = 60;
const MAX_TRIES = 5;
/** Codes one contact can be sent an hour, and contacts one session can try. */
const CODES_PER_HOUR = 5;
const CONTACTS_PER_SESSION = 5;
const TOKEN_HEADER = 'x-pay-session';
export { TOKEN_HEADER };

/** A member the frame can sign in. */
export interface PayMember {
  wallet: string;
  firstName: string;
  /** Has Face ID for payments (a step-up passkey): approves in the Clear app's window. */
  hasPasskey: boolean;
}

export interface FrameDeps extends JoinDeps {
  /** The member with this verified phone (E.164) or email, if any. */
  findMember: (contact: Contact) => Promise<PayMember | null>;
  /** Their member data by wallet, after the code: what Hi Sofia shows. */
  memberByWallet: (wallet: string) => Promise<PayMember | null>;
  /** The text or email with the code and the link. */
  sendCode: (input: { contact: Contact; code: string; link: string; shopName: string; amount: string }) => Promise<void>;
  /** The request in the Clear app (in-app and push), for a member; never a text (the code's text has the link). */
  notifyApp: (input: { wallet: string; shopName: string; amount: string; link: string; dedupe: string }) => Promise<void>;
  /** Puts a waiting Clear charge on the member. */
  attachCharge: (chargeCode: string, wallet: string) => Promise<boolean>;
  /** Opens the plan: the counter's approval, for a member who confirmed in the frame. */
  approveCharge: (chargeCode: string, wallet: string, installments: number) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** What they can borrow now, in cents; null when it can't be read. */
  creditAvailable: (wallet: string) => Promise<number | null>;
  /** "Chase •••• 4471", where a bank's name is known. */
  bankLabel: (wallet: string) => Promise<string | null>;
  /** A plan's cycles, once it's open: for "The first of 4 cycles … clears Nov 1". */
  planOf: (chargeCode: string) => Promise<{ installments: number | null } | null>;
}

// ---- Contacts ---------------------------------------------------------------------------------------

export type Contact = { channel: 'phone'; value: string } | { channel: 'email'; value: string };

/** A phone (US numbers without +1 are US) or an email, as the code goes to it, or null. */
export function parseContact(input: string): Contact | null {
  const t = input.trim();
  if (t.includes('@')) {
    const e = t.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { channel: 'email', value: e } : null;
  }
  const digits = t.replace(/[^\d+]/g, '');
  const plain = digits.replace(/^\+/, '');
  if (!/^\d+$/.test(plain)) return null;
  if (!digits.startsWith('+') && plain.length === 10) return { channel: 'phone', value: `+1${plain}` };
  if (!digits.startsWith('+') && plain.length === 11 && plain.startsWith('1')) return { channel: 'phone', value: `+${plain}` };
  if (digits.startsWith('+') && plain.length >= 8 && plain.length <= 15) return { channel: 'phone', value: `+${plain}` };
  return null;
}

/** "(909) •••-0188", "s•••@gmail.com". */
export function maskContact(c: Contact): string {
  if (c.channel === 'email') {
    const [user, domain] = c.value.split('@');
    return `${user![0]}•••@${domain}`;
  }
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(c.value);
  return us ? `(${us[1]}) •••-${us[3]}` : `•••${c.value.slice(-4)}`;
}

/** "(909) 555-0188": a US number as people write it. */
export function showContact(c: Contact): string {
  const us = c.channel === 'phone' ? /^\+1(\d{3})(\d{3})(\d{4})$/.exec(c.value) : null;
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : c.value;
}

const contactHash = (c: Contact) => sha256(`${c.channel}:${c.value}`);
const codeHash = (session: string, code: string) => sha256(`pay-code:${session}:${code}:${process.env.PAY_CODE_PEPPER ?? ''}`);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ---- The session --------------------------------------------------------------------------------------

async function openSession(db: Db, id: string, now: Date): Promise<SessionRow> {
  const s = await sessionRow(db, id);
  if (new Date(s.expires_at).getTime() <= now.getTime()) throw new PayError('This payment has ended. Start again on the shop’s page.', 'expired');
  return s;
}

/** The session's waiting Clear charge, raised now if there isn't one: what the approval page and the app open. */
export async function ensureClearCharge(db: Db, deps: FrameDeps, s: SessionRow, now: Date): Promise<string> {
  const orderId = await ensureSessionOrder(db, deps, s, now);
  const { rows } = await db.query<{ clear_charge_code: string }>(
    `SELECT clear_charge_code FROM payments.tenders WHERE order_id = $1 AND method = 'clear' AND status = 'pending' AND clear_charge_code IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  if (rows[0]) return rows[0].clear_charge_code;
  const order = await getOrder(db, s.merchant, orderId);
  if (order.status === 'paid') throw new PayError('This has been paid', 'conflict');
  if (order.remainingCents <= 0) throw new PayError('This is being paid already', 'conflict');
  const tender = await createClearTender(db, clearFor(db, deps, s), {
    merchant: s.merchant,
    orderId,
    staffId: null,
    tender: { amountCents: order.remainingCents, tipCents: 0, idempotencyKey: `${s.kind === 'link' ? 'link' : 'online'}:${s.id}:clear` },
    source: s.kind === 'link' ? 'link' : 'online',
  });
  if (!tender.clearChargeCode) throw new PayError('Clear couldn’t take this one', 'unavailable');
  return tender.clearChargeCode;
}

async function approvalId(db: Db, s: SessionRow): Promise<string> {
  if (s.approval_id) return s.approval_id;
  const id = randomBase62(24);
  const { rows } = await db.query<{ approval_id: string }>('UPDATE payments.pay_sessions SET approval_id = COALESCE(approval_id, $2) WHERE id = $1 RETURNING approval_id', [s.id, id]);
  s.approval_id = rows[0]!.approval_id;
  return s.approval_id;
}

const approvalUrl = (id: string) => `${memberAppUrl().replace(/\/+$/, '')}/approve/${id}`;

// ---- Contact and code -------------------------------------------------------------------------------

/**
 * `POST /api/checkout/:session/contact`: a code to the phone or email, and a link to the approval
 * page, the same for everyone. A member also gets the request in the Clear app. In test mode only the
 * test member signs in, and nothing is sent.
 */
export async function sendContact(db: Db, deps: FrameDeps, input: { session: string; request: unknown; now?: Date }): Promise<ContactSent> {
  const now = input.now ?? new Date();
  const parsed = PayContact.safeParse(input.request);
  const contact = parsed.success ? parseContact(parsed.data.contact) : null;
  if (!contact) throw new PayError('Type an email or a phone number', 'invalid');
  const s = await openSession(db, input.session, now);
  if (!s.livemode && !(contact.channel === 'phone' && isTestMemberPhone(contact.value))) {
    throw new PayError(`In test mode, use the test member: ${TEST_MEMBER.phone}`, 'invalid');
  }
  const hash = contactHash(contact);
  // A minute between codes to one contact in this session; five an hour to it, across sessions; and
  // five contacts a session.
  const { rows: recent } = await db.query<{ n: number; last: Date | string | null; sessions: number }>(
    `SELECT count(*)::int AS n,
            max(sent_at) FILTER (WHERE session_id = $2) AS last,
            (SELECT count(DISTINCT contact_hash)::int FROM payments.pay_codes WHERE session_id = $2) AS sessions
       FROM payments.pay_codes WHERE contact_hash = $1 AND sent_at > $3`,
    [hash, s.id, new Date(now.getTime() - 3600_000)],
  );
  const r = recent[0]!;
  if (r.last && now.getTime() - new Date(r.last).getTime() < RESEND_SECONDS * 1000) {
    return { channel: contact.channel, to: maskContact(contact), resendInSeconds: Math.ceil((RESEND_SECONDS * 1000 - (now.getTime() - new Date(r.last).getTime())) / 1000) };
  }
  if (r.n >= CODES_PER_HOUR || r.sessions >= CONTACTS_PER_SESSION) throw new PayError('Too many codes for now. Try again in an hour, or pay by card.', 'too_many');

  const code = s.livemode ? String(randomInt(0, 1_000_000)).padStart(6, '0') : TEST_MEMBER.code;
  await db.query(
    `INSERT INTO payments.pay_codes (id, session_id, channel, contact_hash, code_hash, contact_enc, sent_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [`pc_${randomBase62(20)}`, s.id, contact.channel, hash, codeHash(s.id, code), encryptSecret(JSON.stringify(contact)), now, new Date(now.getTime() + CODE_MS)],
  );
  if (s.livemode) {
    const view = await getOrder(db, s.merchant, await ensureSessionOrder(db, deps, s, now));
    const shop = await payShop(db, s.merchant);
    const link = approvalUrl(await approvalId(db, s));
    const member = await deps.findMember(contact).catch(() => null);
    if (member) {
      // The request goes to their phone too: the approval page, in the app, with nothing to type.
      const chargeCode = await ensureClearCharge(db, deps, s, now);
      await deps.attachCharge(chargeCode, member.wallet).catch(() => false);
      await deps.notifyApp({ wallet: member.wallet, shopName: shop.name, amount: usd(view.totalCents), link, dedupe: `pay:${s.id}` }).catch(() => undefined);
    }
    await deps.sendCode({ contact, code, link, shopName: shop.name, amount: usd(view.totalCents) });
  }
  return { channel: contact.channel, to: maskContact(contact), resendInSeconds: RESEND_SECONDS };
}

/** `POST /api/checkout/:session/code`: the code typed, a token for this payment. */
export async function verifyCode(db: Db, deps: FrameDeps, input: { session: string; request: unknown; now?: Date }): Promise<CodeVerified> {
  const now = input.now ?? new Date();
  const parsed = PayCode.safeParse(input.request);
  if (!parsed.success) throw new PayError('The code is six digits', 'invalid');
  const s = await openSession(db, input.session, now);
  const { rows } = await db.query<{ id: string; channel: 'phone' | 'email'; contact_hash: string; code_hash: string; contact_enc: string; attempts: number; expires_at: Date | string }>(
    `SELECT * FROM payments.pay_codes WHERE session_id = $1 AND used_at IS NULL ORDER BY sent_at DESC LIMIT 1`,
    [s.id],
  );
  const c = rows[0];
  if (!c || new Date(c.expires_at).getTime() <= now.getTime()) throw new PayError('That code has run out. Send a new one.', 'expired');
  if (c.attempts >= MAX_TRIES) throw new PayError('Too many tries. Send a new code.', 'too_many');
  await db.query('UPDATE payments.pay_codes SET attempts = attempts + 1 WHERE id = $1', [c.id]);
  const want = Buffer.from(c.code_hash, 'hex');
  const got = Buffer.from(codeHash(s.id, parsed.data.code), 'hex');
  if (!timingSafeEqual(want, got)) {
    throw new PayError(c.attempts + 1 >= MAX_TRIES ? 'Too many tries. Send a new code.' : 'That code isn’t right', c.attempts + 1 >= MAX_TRIES ? 'too_many' : 'invalid');
  }
  await db.query('UPDATE payments.pay_codes SET used_at = $2 WHERE id = $1', [c.id, now]);
  // Who it is, now that they've shown it's their phone or email. The code's copy of the contact goes;
  // for someone with no account it stays on the session, encrypted, until they join or it ends.
  const contact = JSON.parse(decryptSecret(c.contact_enc)) as Contact;
  await db.query(`UPDATE payments.pay_codes SET contact_enc = '' WHERE id = $1`, [c.id]);
  const member = !s.livemode
    ? { wallet: TEST_MEMBER_WALLET, firstName: TEST_MEMBER_FIRST_NAME, hasPasskey: false }
    : await deps.findMember(contact).catch(() => null);
  const claims: PayClaims = { s: s.id, c: c.contact_hash, w: member?.wallet ?? null, n: member?.firstName ?? null, exp: now.getTime() + TOKEN_MS };
  if (member) return { token: mintPayToken(claims), person: { kind: 'member', firstName: member.firstName } };
  // No account: they may join, and the window signs up with the contact they just confirmed.
  await keepJoinContact(db, s.id, contact);
  return { token: mintPayToken(claims), person: { kind: 'new', contact: showContact(contact), join: await joinOffer(db, deps, s, now) } };
}

// ---- Who's paying ------------------------------------------------------------------------------------

export function claimsFrom(session: string, token: string | undefined, now = new Date()): PayClaims {
  const claims = readPayToken(token, session, now.getTime());
  if (!claims) throw new PayError('Sign in again', 'forbidden');
  return claims;
}

/** `GET /api/checkout/:session/member`: Hi Sofia, the choices and their figures. The shop never sees this. */
export async function memberQuote(db: Db, deps: FrameDeps, input: { session: string; token: string | undefined; now?: Date }): Promise<MemberQuote> {
  const now = input.now ?? new Date();
  const s = await openSession(db, input.session, now);
  const claims = claimsFrom(s.id, input.token, now);
  if (!claims.w) throw new PayError('This number or email isn’t on a Clear account', 'forbidden');
  const orderId = await ensureSessionOrder(db, deps, s, now);
  const order = await getOrder(db, s.merchant, orderId);
  const total = order.totalCents;
  const test = !s.livemode;
  const member = test ? { wallet: TEST_MEMBER_WALLET, firstName: TEST_MEMBER_FIRST_NAME, hasPasskey: false } : await deps.memberByWallet(claims.w);
  if (test) await ensureTestMemberAt(db, s.merchant, now);
  if (!member) throw new PayError('This Clear account can’t pay here', 'forbidden');
  const available = test ? TEST_MEMBER_LIMIT_CENTS : await deps.creditAvailable(member.wallet).catch(() => null);
  const view = await paymentForOrder(db, orderId).then((p) => (p ? paymentView(db, p) : null));
  const clearAllowed = !view || view.methods.includes('clear');
  const link = s.link_id ? (await db.query<{ allow_over_time: boolean }>('SELECT allow_over_time FROM payments.payment_links WHERE id = $1', [s.link_id])).rows[0] : null;
  const overTime = clearAllowed && (s.kind === 'link' ? Boolean(link?.allow_over_time) : true) && overTimeOnline(s.livemode) && total >= PAY_OVER_TIME_MIN_CENTS && available !== null && available >= total;
  const RATE_BPS = 200;
  const splits = overTime
    ? splitsOffered(total, [1, 2, 4, 12]).map((n) => {
        const q = splitQuote(total / 100, n, RATE_BPS / 10_000);
        return { installments: n, perCycleCents: Math.round(q.perCycle * 100), carryCents: Math.round(q.carry * 100), totalCents: Math.round(q.total * 100), ratePerCycleBps: RATE_BPS };
      })
    : [];
  return {
    firstName: member.firstName,
    totalCents: total,
    canPayNow: clearAllowed,
    splits,
    clearsFrom: test ? TEST_MEMBER_BANK : await deps.bankLabel(member.wallet).catch(() => null),
    points: await pointsLine(db, s.merchant, orderId, member.wallet, now),
    approveIn: member.hasPasskey ? 'window' : 'frame',
  };
}

/** "Earns 256 points at Mi Casa · 1.5× for paying with Clear", for a member who has joined the shop. */
async function pointsLine(db: Db, merchant: string, orderId: string, wallet: string, now: Date): Promise<MemberQuote['points']> {
  const person = await personByWallet(db, wallet);
  if (!person || !(await membershipOf(db, merchant, person.id))) return null;
  const rules = await rulesAt(db, merchant, now);
  const earns = await previewEarn(db, merchant, orderId, person.id, { clear: true, now });
  const before = await balance(db, merchant, person.id);
  const { rows } = await db.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [merchant]);
  const words = (rows[0]?.name ?? '').split(/\s+/).filter(Boolean);
  const shopName = (words.length >= 3 ? words.slice(0, -1) : words).join(' ');
  const m = Number(rules.clearMultiplier);
  return { earns, shopName, multiplierLabel: m > 1 ? `${m}× for paying with Clear` : null, before, after: before + earns };
}

// ---- Approving -------------------------------------------------------------------------------------

/**
 * `POST /api/checkout/:session/approve`: over time, in the frame, for a member without Face ID. The
 * server opens the plan, as when the Clear app approves.
 */
export async function approveInFrame(db: Db, deps: FrameDeps, input: { session: string; token: string | undefined; request: unknown; now?: Date }): Promise<PaidView> {
  const now = input.now ?? new Date();
  const parsed = ApproveOverTime.safeParse(input.request);
  if (!parsed.success) throw new PayError('Choose how many payments', 'invalid');
  const s = await openSession(db, input.session, now);
  const claims = claimsFrom(s.id, input.token, now);
  if (!claims.w) throw new PayError('This number or email isn’t on a Clear account', 'forbidden');
  const quote = await memberQuote(db, deps, { session: s.id, token: input.token, now });
  if (quote.approveIn === 'window') throw new PayError('Approve this one in the Clear app, with Face ID', 'conflict');
  if (!quote.splits.some((x) => x.installments === parsed.data.installments)) throw new PayError('That split isn’t offered on this one', 'invalid');
  const code = await ensureClearCharge(db, deps, s, now);
  const result = s.livemode
    ? await (async () => {
        await deps.attachCharge(code, claims.w!).catch(() => false);
        return deps.approveCharge(code, claims.w!, parsed.data.installments);
      })()
    : await approveTestCharge(db, { code, wallet: claims.w, installments: parsed.data.installments });
  if (!result.ok) throw new PayError(result.reason, 'conflict');
  const status = await frameStatus(db, deps, { session: s.id, now });
  if (!status.paid) throw new PayError('Approved. It’s going through now.', 'conflict');
  return status.paid;
}

/**
 * `POST /api/checkout/:session/approval`: the approval page in the Clear app, which the frame opens
 * with `window.open`: "Approve with Clear" on a phone, and Pay now (the member's wallet signs there).
 */
export async function approvalPage(db: Db, deps: FrameDeps, input: { session: string; now?: Date }): Promise<{ url: string }> {
  const now = input.now ?? new Date();
  const s = await openSession(db, input.session, now);
  await ensureClearCharge(db, deps, s, now);
  return { url: approvalUrl(await approvalId(db, s)) };
}

/** `GET /api/checkout/approval/:id`: what the approval page reads. No sign-in; the id is unguessable. */
export async function approvalView(db: Db, deps: FrameDeps, input: { id: string; now?: Date }): Promise<ApprovalView> {
  const now = input.now ?? new Date();
  if (!/^[0-9A-Za-z]{24}$/.test(input.id)) throw new PayError('This payment has ended', 'not_found');
  const { rows } = await db.query<SessionRow>('SELECT * FROM payments.pay_sessions WHERE approval_id = $1', [input.id]);
  const s = rows[0];
  if (!s || new Date(s.expires_at).getTime() <= now.getTime()) throw new PayError('This payment has ended', 'not_found');
  const order = await getOrder(db, s.merchant, await ensureSessionOrder(db, deps, s, now));
  if (['paid', 'partly_refunded', 'refunded'].includes(order.status)) throw new PayError('This has been paid', 'conflict');
  const lines = order.lines.map((l) => ({ name: l.name, quantity: l.quantity, lineCents: l.lineCents }));
  return {
    id: input.id,
    shop: await payShop(db, s.merchant),
    order: { lines, subtotalCents: order.subtotalCents, taxCents: order.taxCents, totalCents: order.totalCents, summary: lines.map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name)).join(', ') },
    channel: s.kind === 'link' ? 'link' : 'online',
    returnUrl: s.origin,
    chargeCode: await ensureClearCharge(db, deps, s, now),
  };
}

// ---- Where it stands ---------------------------------------------------------------------------------

/** The 1st of next month in the shop's time: when a plan's first cycle clears (pay DECISIONS, Phase 5). */
export function firstCycleDate(now: Date, timeZone: string): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number) as [number, number];
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-01`;
}

/**
 * `GET /api/checkout/:session/status`, polled while a screen waits (the texted link, the approval
 * window, a card): where it stands, and once paid, "You're all set" with its figures.
 */
export async function frameStatus(db: Db, deps: FrameDeps, input: { session: string; now?: Date }): Promise<PayStatus> {
  const now = input.now ?? new Date();
  const s = await sessionRow(db, input.session);
  if (!s.order_id) return { state: new Date(s.expires_at).getTime() <= now.getTime() ? 'expired' : 'waiting', paid: null };
  // A Clear charge answered since the last look: the tender catches up now, not at the next sweep.
  const { rows: waiting } = await db.query<{ id: string }>(`SELECT id FROM payments.tenders WHERE order_id = $1 AND method = 'clear' AND status = 'pending'`, [s.order_id]);
  for (const t of waiting) await syncClearTender(db, clearFor(db, deps, s), { merchant: s.merchant, tenderId: t.id, actor: null }).catch(() => undefined);
  const order = await getOrder(db, s.merchant, s.order_id);
  if (order.status === 'voided') return { state: 'canceled', paid: null };
  if (!['paid', 'partly_refunded', 'refunded'].includes(order.status)) return { state: new Date(s.expires_at).getTime() <= now.getTime() ? 'expired' : 'waiting', paid: null };
  const payment = await paymentForOrder(db, s.order_id);
  const view = payment ? await paymentView(db, payment) : null;
  const { rows: clear } = await db.query<{ clear_charge_code: string; amount_cents: string }>(
    `SELECT clear_charge_code, amount_cents FROM payments.tenders WHERE order_id = $1 AND method = 'clear' AND status = 'approved' LIMIT 1`,
    [s.order_id],
  );
  const code = clear[0]?.clear_charge_code ?? null;
  const installments = code ? (s.livemode ? ((await deps.planOf(code).catch(() => null))?.installments ?? null) : await testChargeInstallments(db, code)) : null;
  const { rows: tz } = await db.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [s.merchant]);
  const quote = installments && installments > 1 ? splitQuote(order.totalCents / 100, installments, 0.02) : null;
  // The payer: Clear's member, or for a card, whoever the order was put on (a signed-in member).
  const clearPayer = code ? await personByWallet(db, (await clearFor(db, deps, s).payer?.(code).catch(() => null)) ?? '') : null;
  const { rows: onOrder } = await db.query<{ member_person: string | null }>('SELECT member_person FROM commerce.orders WHERE id = $1', [s.order_id]);
  const person = clearPayer ?? (onOrder[0]?.member_person ? { id: onOrder[0].member_person } : null);
  const { rows: earned } = person
    ? await db.query<{ points: string | number }>(`SELECT COALESCE(sum(points), 0) AS points FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2 AND order_id = $3 AND kind = 'earn'`, [s.merchant, person.id, s.order_id]).catch(() => ({ rows: [] as Array<{ points: string | number }> }))
    : { rows: [] as Array<{ points: string | number }> };
  const points = person && earned[0] ? { earned: Number(earned[0].points), now: await balance(db, s.merchant, person.id) } : null;
  return {
    state: 'paid',
    paid: {
      method: view?.method === 'card' ? 'card' : 'clear',
      installments: view?.method === 'card' ? null : (installments ?? 1),
      firstCycle: quote ? { amountCents: Math.round(quote.perCycle * 100), on: firstCycleDate(now, tz[0]?.timezone ?? 'America/Los_Angeles') } : null,
      points: points && points.earned > 0 ? points : null,
      // A card payer may have no Clear account: their card statement is the record, and the shop's.
      receipt: view?.method === 'card' ? (person ? 'In Clear' : 'On your card statement') : 'In Clear and by email',
    },
  };
}

/** Which website may frame this session (`frame-ancestors`): its own origin, and only while it's open. */
export async function frameOrigin(db: Db, input: { session: string; now?: Date }): Promise<{ origin: string | null }> {
  const now = input.now ?? new Date();
  const s = await sessionRow(db, input.session).catch(() => null);
  if (!s || s.kind !== 'modal' || new Date(s.expires_at).getTime() <= now.getTime()) return { origin: null };
  return { origin: s.origin };
}

export const payFrameUrl = (session: string) => `${payBase()}/m/${session}`;
export { optionsOf };
