import { PAY_OVER_TIME_MIN_CENTS, splitQuote, splitsOffered } from '@clear/domain';
import { JoinBasics, type CodeVerified, type JoinFinished, type JoinHandoff, type JoinState, type JoinWindow } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { STARTER_CENTS } from '../../credit/termLimitRule.js';
import { memberAppUrl } from '../../memberAppUrl.js';
import { getOrder } from '../orders/orderService.js';
import { orderSummary, PayError, payShop } from './links.js';
import { overTimeOnline } from './overTime.js';
import { decryptSecret, encryptSecret, mintPayToken, randomBase62, sha256 } from './secrets.js';
import { ensureSessionOrder, optionsOf, sessionRow, type PaySessionDeps, type SessionRow } from './sessions.js';

/**
 * Joining from the modal (pay spec §3; pay DECISIONS, Phase 1 "Joining" and Phase 6 D2).
 *
 * 1. After the code, a person with no account can join. Step 1 (legal name, date of birth, ZIP, street)
 *    is typed in the modal and kept here, encrypted, for 30 minutes. Never an SSN.
 * 2. Step 2 is the Clear window (`app.useclear.org/join/pay?h=…`), signed in with Privy: it reads step 1
 *    back so nothing is typed twice, takes the SSN, the ID photo and the bank there, and hands back.
 * 3. The modal, polling, gets a member's token for the new wallet, and step 3 is the member's own screen.
 *    A new member's starting term limit covers it when the order fits; otherwise this one is paid by card.
 */

export const JOIN_BASICS_MS = 30 * 60 * 1000;
export const HANDOFF_MS = 15 * 60 * 1000;
const TOKEN_MS = 30 * 60 * 1000;
const HANDOFF = /^[0-9A-Za-z]{24}$/;

export interface JoinDeps extends PaySessionDeps {
  /** The starting term limit, once the identity check has passed; the limit now on the line, or null. */
  grantStarterLimit: (wallet: string) => Promise<{ termLimitCents: number | null }>;
}

type Contact = { channel: 'phone' | 'email'; value: string };
interface JoinRow extends SessionRow {
  join_basics_enc: string | null;
  join_contact_enc: string | null;
  join_contact_hash: string | null;
  join_handoff: string | null;
  join_state: 'waiting' | 'done' | 'failed' | 'expired' | null;
  join_expires_at: Date | string | null;
  join_handoff_expires_at: Date | string | null;
  join_wallet: string | null;
}

const at = (d: Date | string | null) => (d ? new Date(d).getTime() : 0);
export const contactHash = (c: Contact) => sha256(`${c.channel}:${c.value}`);

/** 18 or older on `now`, from a yyyy-mm-dd birthday. */
export function isAdult(dateOfBirth: string, now: Date): boolean {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const eighteen = Date.UTC(y + 18, m - 1, d);
  return eighteen <= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

async function joinRow(db: Db, id: string): Promise<JoinRow> {
  return (await sessionRow(db, id)) as JoinRow;
}

/**
 * What "You're new to Clear" offers: joining, when Clear is a choice here and it's live (test mode has
 * only the test member), and "In 4 is about $48.65 a cycle" when a starting limit covers the order.
 */
export async function joinOffer(db: Db, deps: PaySessionDeps, s: SessionRow, now: Date): Promise<Extract<CodeVerified['person'], { kind: 'new' }>['join']> {
  if (!s.livemode) return null;
  if (s.kind === 'modal' && optionsOf(s).methods && !optionsOf(s).methods!.includes('clear')) return null;
  const order = await getOrder(db, s.merchant, await ensureSessionOrder(db, deps, s, now));
  const total = order.totalCents;
  const link = s.link_id ? (await db.query<{ allow_over_time: boolean }>('SELECT allow_over_time FROM payments.payment_links WHERE id = $1', [s.link_id])).rows[0] : null;
  const canSplit = (s.kind === 'link' ? Boolean(link?.allow_over_time) : true) && overTimeOnline(s.livemode) && total >= PAY_OVER_TIME_MIN_CENTS && total <= STARTER_CENTS;
  const n = canSplit ? (splitsOffered(total, [4]).includes(4) ? 4 : null) : null;
  return { split: n ? { installments: n, perCycleCents: Math.round(splitQuote(total / 100, n, 0.02).perCycle * 100) } : null };
}

/** After the code: a person with no account. Their confirmed contact stays with this session, encrypted. */
export async function keepJoinContact(db: Db, session: string, contact: Contact): Promise<void> {
  await db.query('UPDATE payments.pay_sessions SET join_contact_enc = $2, join_contact_hash = $3 WHERE id = $1 AND join_state IS DISTINCT FROM $4', [
    session,
    encryptSecret(JSON.stringify(contact)),
    contactHash(contact),
    'done',
  ]);
}

/** `POST /api/checkout/:session/join` (a new person's token): step 1, and the window's address. */
export async function startJoin(
  db: Db,
  input: { session: string; claims: { c: string; w: string | null }; request: unknown; now?: Date },
): Promise<JoinHandoff> {
  const now = input.now ?? new Date();
  const s = await joinRow(db, input.session);
  if (at(s.expires_at) <= now.getTime()) throw new PayError('This payment has ended. Start again on the shop’s page.', 'expired');
  if (input.claims.w) throw new PayError('You already have Clear', 'conflict');
  if (!s.livemode) throw new PayError('In test mode, use the test member', 'invalid');
  if (s.join_state === 'done') throw new PayError('You’ve joined already', 'conflict');
  const contact = s.join_contact_enc ? (JSON.parse(decryptSecret(s.join_contact_enc)) as Contact) : null;
  if (!contact || contactHash(contact) !== input.claims.c) throw new PayError('Sign in again', 'forbidden');

  const parsed = JoinBasics.safeParse(input.request);
  if (!parsed.success) throw new PayError(parsed.error.issues[0]?.message ?? 'Check the details', 'invalid');
  if (!isAdult(parsed.data.dateOfBirth, now)) throw new PayError('You need to be 18 or older to join Clear', 'invalid');

  // A new link each time, so an old one (or one that ran out) is never the live one.
  const handoff = randomBase62(24);
  const handoffExpires = new Date(now.getTime() + HANDOFF_MS);
  await db.query(
    `UPDATE payments.pay_sessions
        SET join_basics_enc = $2, join_handoff = $3, join_state = 'waiting', join_expires_at = $4, join_handoff_expires_at = $5
      WHERE id = $1`,
    [s.id, encryptSecret(JSON.stringify(parsed.data)), handoff, new Date(now.getTime() + JOIN_BASICS_MS), handoffExpires],
  );
  return { url: `${memberAppUrl()}/join/pay?h=${handoff}`, expiresAt: handoffExpires.toISOString() };
}

/**
 * `GET /api/checkout/:session/join`: polled while the window is open. Done: a member's token for the new
 * wallet, so step 3 is the member's screen.
 */
export async function joinState(db: Db, input: { session: string; claims: { c: string; w: string | null }; now?: Date }): Promise<JoinState> {
  const now = input.now ?? new Date();
  const s = await joinRow(db, input.session);
  if (!s.join_state || s.join_contact_hash !== input.claims.c) return { state: 'expired', token: null };
  if (s.join_state === 'waiting' && at(s.join_handoff_expires_at) <= now.getTime()) {
    await db.query(`UPDATE payments.pay_sessions SET join_state = 'expired', join_basics_enc = NULL WHERE id = $1 AND join_state = 'waiting'`, [s.id]);
    return { state: 'expired', token: null };
  }
  if (s.join_state !== 'done') return { state: s.join_state, token: null };
  // The member's screen reads their name from their account, so the token needn't carry it.
  const token = mintPayToken({ s: s.id, c: input.claims.c, w: s.join_wallet!.toLowerCase(), n: null, exp: now.getTime() + TOKEN_MS });
  return { state: 'done', token };
}

/** Who's signed in to the window: what Privy verified for them. */
export interface WindowPerson {
  phone?: string | null;
  emails?: string[];
}

/**
 * The window is for the person whose code the modal confirmed: Privy must have verified the same phone
 * or email. Anyone else holding the link reads nothing (step 1 has a birthday and an address in it).
 */
export function sameContact(contact: Contact, who: WindowPerson): boolean {
  if (contact.channel === 'email') return (who.emails ?? []).some((e) => e.trim().toLowerCase() === contact.value);
  const digits = (v: string) => v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return Boolean(who.phone) && digits(who.phone!) === digits(contact.value);
}

function mustBeTheirs(s: JoinRow, who: WindowPerson): Contact {
  const contact = JSON.parse(decryptSecret(s.join_contact_enc!)) as Contact;
  if (!sameContact(contact, who)) {
    throw new PayError(contact.channel === 'email' ? 'Sign in with the email you used at checkout' : 'Sign in with the phone number you used at checkout', 'forbidden');
  }
  return contact;
}

/** The window's view, while the hand-off is waiting and unexpired. */
async function waitingHandoff(db: Db, handoff: string, now: Date): Promise<JoinRow> {
  if (!HANDOFF.test(handoff)) throw new PayError('This link has ended', 'not_found');
  const { rows } = await db.query<JoinRow>('SELECT * FROM payments.pay_sessions WHERE join_handoff = $1', [handoff]);
  const s = rows[0];
  if (!s) throw new PayError('This link has ended', 'not_found');
  if (s.join_state !== 'waiting' || at(s.join_handoff_expires_at) <= now.getTime() || at(s.join_expires_at) <= now.getTime() || !s.join_basics_enc || !s.join_contact_enc) {
    throw new PayError('This link has ended. Start again on the shop’s page.', 'expired');
  }
  return s;
}

/** `GET /api/checkout/join/:handoff`: the window's first screen signed out; step 1 too, signed in as that contact. */
export async function joinWindow(db: Db, deps: PaySessionDeps, input: { handoff: string; who: WindowPerson | null; now?: Date }): Promise<JoinWindow> {
  const now = input.now ?? new Date();
  const s = await waitingHandoff(db, input.handoff, now);
  // Signed out: who's asking, and the contact to sign in with. Step 1 only for that same contact.
  const contact = input.who ? mustBeTheirs(s, input.who) : (JSON.parse(decryptSecret(s.join_contact_enc!)) as Contact);
  const shop = await payShop(db, s.merchant);
  const order = await getOrder(db, s.merchant, await ensureSessionOrder(db, deps, s, now));
  return {
    shop: { name: shop.name, initials: shop.initials },
    order: { totalCents: order.totalCents, summary: orderSummary(order.lines.map((l) => ({ name: l.name, quantity: l.quantity, lineCents: l.lineCents }))) },
    shopHost: s.origin ? new URL(s.origin).host : null,
    basics: input.who ? JoinBasics.parse(JSON.parse(decryptSecret(s.join_basics_enc!))) : null,
    contact,
    expiresAt: new Date(at(s.join_handoff_expires_at)).toISOString(),
  };
}

/**
 * `POST /api/checkout/join/:handoff/done` (signed in): the window finished. The signed-in wallet is the
 * new member; step 1 is dropped, and the starting term limit is granted if the identity check passed.
 * Once only: the hand-off is spent.
 */
export async function finishJoin(db: Db, deps: JoinDeps, input: { handoff: string; wallet: string; who: WindowPerson; now?: Date }): Promise<JoinFinished> {
  const now = input.now ?? new Date();
  const wallet = input.wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new PayError('Sign in again', 'forbidden');
  const s = await waitingHandoff(db, input.handoff, now);
  mustBeTheirs(s, input.who);
  const { rows } = await db.query<{ id: string }>(
    `UPDATE payments.pay_sessions
        SET join_state = 'done', join_wallet = $2, join_basics_enc = NULL, join_contact_enc = NULL
      WHERE id = $1 AND join_state = 'waiting'
      RETURNING id`,
    [s.id, wallet],
  );
  if (!rows[0]) throw new PayError('This link has ended', 'expired');
  const granted = await deps.grantStarterLimit(wallet).catch(() => ({ termLimitCents: null }));
  return { state: 'done', termLimitCents: granted.termLimitCents };
}

