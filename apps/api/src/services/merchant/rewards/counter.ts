import { createHash, randomInt, randomUUID } from 'node:crypto';
import {
  AddCustomer,
  CLAIM_MINUTES,
  claimCodeLabel,
  CounterCustomer,
  type CounterConfirm,
  type OrderCustomerState,
  type ReadyReward,
  type Reward,
  type RewardClaim,
} from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { phoneE164 } from '../orders/payments.js';
import type { ClearSide } from './clearSide.js';
import { RewardsError } from './errors.js';
import { balance, heldPoints, membershipOf, previewEarn } from './ledger.js';
import { personById, personByWallet, phoneHash, type PersonRow } from './people.js';
import { rewardById, rewardsFor, shopAppRow, toShopApp } from './shopApp.js';
import { linkToken, walletFromIdentityCode } from './tokens.js';

/**
 * The counter's side (rewards spec, section 9): a member is added to an order once, at the cart, by
 * their own code or by a phone number they confirm; from then the order knows who it's for. The
 * counter sees their name, points here, ready rewards and whether Clear can be sent to them, and
 * never their balance or anything from another shop.
 */

export interface RewardsNotifier {
  /** A text, from Clear's number. */
  text(to: string, message: string): Promise<boolean>;
  /** In their app (and Web Push), by wallet. */
  app(wallet: string, n: { title: string; body: string; url: string; dedupeKey: string }): Promise<void>;
}

export interface CounterDeps {
  clear: ClearSide;
  notify: RewardsNotifier;
  /** Where the rewards app lives: `https://rewards.useclear.org`. */
  rewardsUrl: string;
}

const TAKEN_STATUSES = ['paid', 'partly_refunded', 'refunded'];

// ---- Matching a reward to an order --------------------------------------------------------------

export interface CartLine {
  id: string;
  itemId: string | null;
  name: string;
  quantity: number;
  unitCents: number;
  lineCents: number;
  category: string | null;
}

export async function cartLines(q: Queryable, orderId: string): Promise<CartLine[]> {
  const { rows } = await q.query<{ id: string; item_id: string | null; name: string; quantity: number; unit_cents: string | number; line_cents: string | number; category: string | null }>(
    `SELECT l.id, l.item_id, l.name, l.quantity, l.unit_cents, l.line_cents, i.category FROM commerce.order_lines l LEFT JOIN commerce.catalog_items i ON i.id = l.item_id
      WHERE l.order_id = $1 AND l.removed_at IS NULL ORDER BY l.position, l.id`,
    [orderId],
  );
  return rows.map((r) => ({ id: r.id, itemId: r.item_id, name: r.name, quantity: r.quantity, unitCents: Number(r.unit_cents), lineCents: Number(r.line_cents), category: r.category }));
}

/**
 * What a reward takes off these lines. An item reward is one of its items, the dearest on the order
 * (options included), up to its cap; ties go to the item the reward lists first. An amount or a
 * percent comes off the lines it covers, never more than they come to.
 */
export function matchReward(reward: Pick<Reward, 'gives'>, lines: CartLine[]): { amountCents: number; lineId: string | null; label: string } | null {
  const g = reward.gives;
  if (g.kind === 'item') {
    const rank = (itemId: string | null) => (itemId ? g.itemIds.indexOf(itemId) : -1);
    const fits = lines.filter((l) => rank(l.itemId) >= 0).sort((a, b) => b.unitCents - a.unitCents || rank(a.itemId) - rank(b.itemId));
    const line = fits[0];
    if (!line) return null;
    const amount = g.maxCents === null ? line.unitCents : Math.min(line.unitCents, g.maxCents);
    return amount > 0 ? { amountCents: amount, lineId: line.id, label: `1 × ${line.name}` } : null;
  }
  const covered = lines.filter((l) => g.categories === null || (l.category !== null && g.categories.includes(l.category)));
  const base = covered.reduce((s, l) => s + l.lineCents, 0);
  if (base <= 0) return null;
  const amount = g.kind === 'amount' ? Math.min(base, g.amountCents) : Math.floor((base * g.percent) / 100);
  if (amount <= 0) return null;
  const label = g.categories === null ? 'this order' : covered.length === 1 ? `1 × ${covered[0]!.name}` : `${g.categories.join(', ')} on this order`;
  return { amountCents: amount, lineId: covered.length === 1 ? covered[0]!.id : null, label };
}

/** Points this person can spend here now: their balance less what open orders already promised. */
export async function spendable(q: Queryable, merchant: string, personId: string, exceptOrderId?: string): Promise<number> {
  return (await balance(q, merchant, personId)) - (await heldPoints(q, merchant, personId, exceptOrderId));
}

/** Within the reward's limit per customer (once a day, once a week), by what they've redeemed. */
async function withinLimit(q: Queryable, merchant: string, personId: string, reward: Reward, now: Date): Promise<boolean> {
  if (reward.limit === 'none') return true;
  const since = new Date(now.getTime() - (reward.limit === 'daily' ? 1 : 7) * 86_400_000).toISOString();
  const { rows } = await q.query(
    `SELECT 1 FROM rewards.loyalty_entries WHERE merchant = $1 AND person_id = $2 AND reward_id = $3 AND kind = 'redeem' AND at > $4
       AND NOT EXISTS (SELECT 1 FROM rewards.loyalty_entries v WHERE v.dedupe_key = 'void:' || rewards.loyalty_entries.id) LIMIT 1`,
    [merchant, personId, reward.id, since],
  );
  return !rows[0];
}

export interface RewardSpec {
  rewardId: string;
  points: number;
  name: string;
  percent: number | null;
  amountCents: number | null;
  categories: string[] | null;
  claimId: string | null;
}

/**
 * Checks a reward can go on this order for the person on it, and how it comes off. The order's one
 * discount rule is the caller's (orderService); this is everything about the reward.
 */
export async function rewardSpecFor(q: Queryable, input: { merchant: string; orderId: string; personId: string; rewardId: string; claimId?: string | null; now?: Date }): Promise<RewardSpec> {
  const now = input.now ?? new Date();
  const reward = await rewardById(q, input.merchant, input.rewardId);
  if (!reward) throw new RewardsError('That reward isn’t on offer here', 'not_found');
  if (!(await membershipOf(q, input.merchant, input.personId))) throw new RewardsError('They haven’t joined this shop’s rewards', 'not_joined');
  const person = await personById(q, input.personId);
  if (reward.clearMembersOnly && !person?.member_subject) throw new RewardsError(`${reward.name} is for Clear members`, 'forbidden');
  if ((await spendable(q, input.merchant, input.personId, input.orderId)) < reward.cost) throw new RewardsError(`Not enough points for ${reward.name}`, 'not_enough');
  if (!(await withinLimit(q, input.merchant, input.personId, reward, now))) throw new RewardsError(`${reward.name} is ${reward.limit === 'daily' ? 'once a day' : 'once a week'}`, 'limit');
  const lines = await cartLines(q, input.orderId);
  const match = matchReward(reward, lines);
  if (!match) throw new RewardsError(`${reward.name} doesn’t fit anything on this order`, 'invalid');
  const g = reward.gives;
  return {
    rewardId: reward.id,
    points: reward.cost,
    name: reward.name,
    percent: g.kind === 'percent' ? g.percent : null,
    // An item reward is a fixed amount, spread across the order's lines like any discount, so the
    // tax on what's left is what it would be (rewards DECISIONS, Figures).
    amountCents: g.kind === 'percent' ? null : match.amountCents,
    categories: g.kind === 'item' ? null : g.categories,
    claimId: input.claimId ?? null,
  };
}

/** A reward already on an order, worked out again on its current lines (an item reward follows the cart). */
export async function rewardAmountNow(q: Queryable, merchant: string, orderId: string, rewardId: string): Promise<{ amountCents: number | null; percent: number | null; categories: string[] | null }> {
  const { rows } = await q.query<{ gives: Reward['gives'] | string }>('SELECT gives FROM rewards.rewards WHERE id = $1 AND merchant = $2', [rewardId, merchant]);
  const g = rows[0] ? (typeof rows[0].gives === 'string' ? JSON.parse(rows[0].gives) : rows[0].gives) as Reward['gives'] : null;
  if (!g) return { amountCents: 0, percent: null, categories: null };
  if (g.kind === 'percent') return { amountCents: null, percent: g.percent, categories: g.categories };
  const match = matchReward({ gives: g }, await cartLines(q, orderId));
  return { amountCents: match?.amountCents ?? 0, percent: null, categories: g.kind === 'item' ? null : g.categories };
}

// ---- Who the order is for -----------------------------------------------------------------------

async function lockOpenOrder(q: Queryable, merchant: string, orderId: string): Promise<{ id: string; member_person: string | null; status: string }> {
  const { rows } = await q.query<{ id: string; member_person: string | null; status: string }>('SELECT id, member_person, status FROM commerce.orders WHERE id = $1 AND merchant = $2 FOR UPDATE', [orderId, merchant]);
  const o = rows[0];
  if (!o) throw new RewardsError('No such order', 'not_found');
  if (!['open', 'paying'].includes(o.status)) throw new RewardsError('This order is paid already', 'conflict');
  return o;
}

export async function setOrderMember(q: Queryable, input: { merchant: string; orderId: string; personId: string; by: string | null; via: 'code' | 'phone' | 'claim' | 'app' }): Promise<void> {
  const o = await lockOpenOrder(q, input.merchant, input.orderId);
  if (o.member_person && o.member_person !== input.personId) throw new RewardsError('Someone else is on this order. Remove them first', 'conflict');
  await q.query(
    `UPDATE commerce.orders SET member_person = $3, member_added_by = $4, member_added_via = $5, member_added_at = now(), updated_at = now() WHERE id = $1 AND merchant = $2`,
    [input.orderId, input.merchant, input.personId, input.by, input.via],
  );
}

/**
 * A Clear charge approved by someone nobody added: they go on the order, so its points can count
 * (they earn if they've joined; otherwise the paid screen offers to). Only someone with rewards.
 */
export async function addPayer(q: Queryable, input: { orderId: string; wallet: string }): Promise<void> {
  const person = await personByWallet(q, input.wallet);
  if (!person) return;
  await q.query(`UPDATE commerce.orders SET member_person = $2, member_added_via = 'app', member_added_at = now() WHERE id = $1 AND member_person IS NULL`, [input.orderId, person.id]);
}

/** Their first name and last initial, from rewards or from the name they use in Clear. */
async function nameOf(person: PersonRow, clear: ClearSide): Promise<{ first: string; initial: string | null; member: Awaited<ReturnType<ClearSide['member']>> }> {
  const member = person.member_subject || person.wallet ? await clear.member({ did: person.privy_did, wallet: person.wallet }) : null;
  return { first: person.first_name, initial: person.last_initial, member };
}

/** The customer as this shop's counter sees them. Never a balance. */
export async function counterCustomer(q: Queryable, deps: Pick<CounterDeps, 'clear'>, input: { merchant: string; personId: string; orderId: string | null }): Promise<CounterCustomer> {
  const person = await personById(q, input.personId);
  if (!person) throw new RewardsError('No such customer', 'not_found');
  const { first, initial, member } = await nameOf(person, deps.clear);
  const m = await membershipOf(q, input.merchant, person.id);
  const last = await q.query<{ created_at: Date | string; number: number | null }>(
    `SELECT o.created_at, t.number FROM commerce.orders o LEFT JOIN merchant.tables t ON t.id = o.table_id
      WHERE o.merchant = $1 AND o.member_person = $2 AND o.status = ANY($3::text[]) AND o.id <> COALESCE($4, '') ORDER BY o.created_at DESC LIMIT 1`,
    [input.merchant, person.id, TAKEN_STATUSES, input.orderId],
  );
  let membership: CounterCustomer['membership'] = null;
  if (m) {
    const points = await spendable(q, input.merchant, person.id, input.orderId ?? undefined);
    const rewards = await rewardsFor(q, input.merchant);
    const lines = input.orderId ? await cartLines(q, input.orderId) : [];
    const isClear = Boolean(member);
    const ready: ReadyReward[] = rewards
      .filter((r) => r.cost <= points)
      .map((r) => {
        const match = input.orderId ? matchReward(r, lines) : null;
        return { rewardId: r.id, name: r.name, cost: r.cost, amountCents: match?.amountCents ?? null, matches: match && match.lineId ? { lineId: match.lineId, label: match.label } : null, locked: r.clearMembersOnly && !isClear };
      })
      // What fits the cart first, then the dearest.
      .sort((a, b) => Number(Boolean(b.matches)) - Number(Boolean(a.matches)) || b.cost - a.cost);
    const next = rewards.filter((r) => r.cost > points).sort((a, b) => a.cost - b.cost)[0];
    membership = { points, joinedAt: new Date(m.joined_at).toISOString(), readyRewards: ready, nextReward: next ? { rewardId: next.id, name: next.name, toGo: next.cost - points } : null };
  }
  return CounterCustomer.parse({
    firstName: first,
    lastInitial: initial,
    isClearMember: Boolean(member),
    canPayWithClear: Boolean(member?.canPayWithClear && person.wallet),
    membership,
    lastVisit: last.rows[0] ? { at: new Date(last.rows[0].created_at).toISOString(), table: last.rows[0].number ? `Table ${last.rows[0].number}` : null } : null,
  });
}

/** What the counter sees about the order's customer: nobody, waiting on their phone, or them. */
export async function orderCustomerState(q: Queryable, deps: Pick<CounterDeps, 'clear'>, input: { merchant: string; orderId: string; now?: Date }): Promise<OrderCustomerState> {
  const now = input.now ?? new Date();
  const { rows } = await q.query<{ member_person: string | null }>('SELECT member_person FROM commerce.orders WHERE id = $1 AND merchant = $2', [input.orderId, input.merchant]);
  if (!rows[0]) throw new RewardsError('No such order', 'not_found');
  const personId = rows[0].member_person;
  if (personId) {
    const customer = await counterCustomer(q, deps, { merchant: input.merchant, personId, orderId: input.orderId });
    const earns = customer.membership ? await previewEarn(q, input.merchant, input.orderId, personId, { now }) : null;
    return { status: 'added', customer, earnsPoints: earns };
  }
  const { rows: pending } = await q.query<{ expires_at: Date | string }>(
    `SELECT expires_at FROM rewards.counter_confirms WHERE order_id = $1 AND merchant = $2 AND status = 'pending' AND expires_at > $3 ORDER BY created_at DESC LIMIT 1`,
    [input.orderId, input.merchant, now.toISOString()],
  );
  if (pending[0]) return { status: 'pending', expiresAt: new Date(pending[0].expires_at).toISOString() };
  return { status: 'none' };
}

const CONFIRM_MINUTES = 10;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * `POST /api/merchant/orders/:id/customer`. By code: their own code, signed, adds them at once. By
 * phone: a text with a link to confirm, and nothing shows until they do. The answer is `pending`
 * whether or not the number is anyone's, so typing a number never reveals an account.
 */
export async function addCustomer(q: Queryable, deps: CounterDeps, input: { merchant: string; orderId: string; staffId: string; body: unknown; now?: Date }): Promise<OrderCustomerState> {
  const now = input.now ?? new Date();
  const parsed = AddCustomer.safeParse(input.body);
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'A code or a phone number', 'invalid');
  await lockOpenOrder(q, input.merchant, input.orderId);
  const b = parsed.data;

  if (b.via === 'code') {
    const read = walletFromIdentityCode(b.code, now);
    if ('error' in read) {
      throw new RewardsError(
        read.error === 'not_a_code' ? 'That isn’t a member’s code' : read.error === 'unsigned' ? 'Ask them to open the code again: that one can’t add them' : 'That code has run out. Ask them to open it again',
        'invalid',
      );
    }
    const person = await personForWallet(q, deps.clear, read.wallet);
    if (!person) throw new RewardsError('That code isn’t a member’s', 'not_found');
    await setOrderMember(q, { merchant: input.merchant, orderId: input.orderId, personId: person.id, by: input.staffId, via: 'code' });
    return orderCustomerState(q, deps, { merchant: input.merchant, orderId: input.orderId, now });
  }

  const e164 = phoneE164(b.phone);
  if (!e164) throw new RewardsError('That isn’t a phone number we can text', 'invalid');
  const hash = phoneHash(e164)!;
  const { rows: p } = await q.query<{ id: string }>('SELECT id FROM rewards.people WHERE phone_hash = $1 LIMIT 1', [hash]);
  const token = linkToken();
  const expires = new Date(now.getTime() + CONFIRM_MINUTES * 60_000);
  await q.query(`UPDATE rewards.counter_confirms SET status = 'expired' WHERE order_id = $1 AND status = 'pending'`, [input.orderId]);
  await q.query(
    `INSERT INTO rewards.counter_confirms (id, token_hash, merchant, order_id, staff_id, phone_hash, person_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [`rcc_${randomUUID()}`, sha(token), input.merchant, input.orderId, input.staffId, hash, p[0]?.id ?? null, expires.toISOString()],
  );
  const { rows: shop } = await q.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  await deps.notify.text(e164, `${shop[0]?.name ?? 'A Clear shop'} would like to add you to your order. Confirm it's you: ${deps.rewardsUrl}/confirm/${token}`);
  return { status: 'pending', expiresAt: expires.toISOString() };
}

/** The person for a wallet: already in rewards, or a Clear member seen at a counter for the first time. */
async function personForWallet(q: Queryable, clear: ClearSide, wallet: string): Promise<PersonRow | null> {
  const found = await personByWallet(q, wallet);
  if (found) return found;
  const member = await clear.member({ did: '', wallet });
  if (!member) return null;
  const parts = (member.displayName ?? '').replace(/^@/, '').trim().split(/\s+/).filter(Boolean);
  const { rows } = await q.query<PersonRow>(
    `INSERT INTO rewards.people (id, privy_did, wallet, first_name, last_initial, member_subject) VALUES ($1,$2,$3,$4,$5,$2)
     ON CONFLICT (privy_did) DO UPDATE SET wallet = COALESCE(rewards.people.wallet, EXCLUDED.wallet) RETURNING *`,
    [`rwp_${randomUUID()}`, member.subject, wallet.toLowerCase(), parts[0] ?? 'Clear member', parts[1]?.charAt(0).toUpperCase() ?? null],
  );
  return rows[0]!;
}

export async function removeCustomer(q: Queryable, input: { merchant: string; orderId: string; staffId: string }): Promise<void> {
  await lockOpenOrder(q, input.merchant, input.orderId);
  const { rows } = await q.query(`SELECT 1 FROM commerce.order_discounts WHERE order_id = $1 AND kind = 'reward' AND removed_at IS NULL`, [input.orderId]);
  if (rows[0]) throw new RewardsError('Undo their reward first', 'conflict');
  await q.query(`UPDATE commerce.orders SET member_person = NULL, member_added_by = NULL, member_added_via = NULL, member_added_at = NULL, updated_at = now() WHERE id = $1 AND merchant = $2`, [input.orderId, input.merchant]);
  await q.query(`UPDATE rewards.counter_confirms SET status = 'expired' WHERE order_id = $1 AND status = 'pending'`, [input.orderId]);
}

/** Ask them to join: a prompt in their app. Joining before they pay counts this order. */
export async function inviteCustomer(q: Queryable, deps: CounterDeps, input: { merchant: string; orderId: string; now?: Date }): Promise<{ sentAt: string }> {
  const now = input.now ?? new Date();
  const { rows } = await q.query<{ member_person: string | null }>('SELECT member_person FROM commerce.orders WHERE id = $1 AND merchant = $2', [input.orderId, input.merchant]);
  const personId = rows[0]?.member_person;
  if (!personId) throw new RewardsError('Add them to the charge first', 'conflict');
  if (await membershipOf(q, input.merchant, personId)) throw new RewardsError('They’ve joined already', 'conflict');
  const person = await personById(q, personId);
  const app = await shopAppRow(q, input.merchant);
  if (!person?.wallet || !app) throw new RewardsError('They can’t be asked from here', 'conflict');
  const { rows: shop } = await q.query<{ name: string }>('SELECT name FROM merchant.profiles WHERE merchant = $1', [input.merchant]);
  await deps.notify.app(person.wallet, {
    title: `Join ${shop[0]?.name ?? 'this shop'} Rewards?`,
    body: 'Join now and this visit earns points.',
    url: `${deps.rewardsUrl}/s/${toShopApp(app).slug}/join?order=${encodeURIComponent(input.orderId)}`,
    dedupeKey: `rewards-invite:${input.orderId}`,
  });
  return { sentAt: now.toISOString() };
}

// ---- The customer's side of a typed-in number ---------------------------------------------------

async function confirmByToken(q: Queryable, token: string, now: Date) {
  const { rows } = await q.query<{ id: string; merchant: string; order_id: string; staff_id: string; phone_hash: string; person_id: string | null; status: string; expires_at: Date | string }>(
    'SELECT * FROM rewards.counter_confirms WHERE token_hash = $1',
    [sha(token)],
  );
  const c = rows[0];
  if (!c) throw new RewardsError('That link isn’t one of ours', 'not_found');
  if (c.status !== 'pending' || new Date(c.expires_at) <= now) throw new RewardsError('That link has run out', 'expired');
  return c;
}

export async function counterConfirmView(q: Queryable, token: string, now = new Date()): Promise<CounterConfirm> {
  const c = await confirmByToken(q, token, now);
  const { rows } = await q.query<{ shop: string; staff: string }>(
    'SELECT p.name AS shop, s.name AS staff FROM merchant.profiles p JOIN merchant.staff s ON s.id = $2 WHERE p.merchant = $1',
    [c.merchant, c.staff_id],
  );
  return { shopName: rows[0]?.shop ?? 'A Clear shop', staffFirstName: (rows[0]?.staff ?? '').split(/\s+/)[0] ?? '', expiresAt: new Date(c.expires_at).toISOString() };
}

/**
 * Confirm or decline. The link proves the text reached the phone; confirming also needs them signed
 * in as the person whose number it is, so a forwarded link can't add someone else.
 */
export async function answerCounterConfirm(q: Queryable, input: { token: string; answer: 'confirm' | 'decline'; person: PersonRow | null; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const c = await confirmByToken(q, input.token, now);
  if (input.answer === 'decline') {
    await q.query(`UPDATE rewards.counter_confirms SET status = 'declined' WHERE id = $1`, [c.id]);
    return;
  }
  if (!input.person) throw new RewardsError('Sign in to confirm', 'forbidden');
  if (input.person.phone_hash !== c.phone_hash) throw new RewardsError('That number isn’t on your account', 'forbidden');
  await setOrderMember(q, { merchant: c.merchant, orderId: c.order_id, personId: input.person.id, by: c.staff_id, via: 'phone' });
  await q.query(`UPDATE rewards.counter_confirms SET status = 'confirmed', person_id = $2 WHERE id = $1`, [c.id, input.person.id]);
}

// ---- Claiming a reward for the counter ----------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export async function claimReward(q: Queryable, input: { merchant: string; personId: string; rewardId: string; host: string; now?: Date }): Promise<RewardClaim> {
  const now = input.now ?? new Date();
  const reward = await rewardById(q, input.merchant, input.rewardId);
  if (!reward) throw new RewardsError('That reward isn’t on offer here', 'not_found');
  if (!(await membershipOf(q, input.merchant, input.personId))) throw new RewardsError('Join first', 'not_joined');
  const person = await personById(q, input.personId);
  if (reward.clearMembersOnly && !person?.member_subject) throw new RewardsError(`${reward.name} is for Clear members`, 'forbidden');
  if ((await spendable(q, input.merchant, input.personId)) < reward.cost) throw new RewardsError(`Not enough points for ${reward.name}`, 'not_enough');
  if (!(await withinLimit(q, input.merchant, input.personId, reward, now))) throw new RewardsError(`${reward.name} is ${reward.limit === 'daily' ? 'once a day' : 'once a week'}`, 'limit');
  const expires = new Date(now.getTime() + CLAIM_MINUTES * 60_000);
  for (let tries = 0; tries < 5; tries += 1) {
    const code = Array.from({ length: 6 }, () => CROCKFORD[randomInt(CROCKFORD.length)]).join('');
    // A code is the shop's for good once used; an old one that ran out unused can be drawn again.
    await q.query(`DELETE FROM rewards.reward_claims WHERE merchant = $1 AND code = $2 AND order_id IS NULL AND expires_at < $3`, [input.merchant, code, now.toISOString()]);
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO rewards.reward_claims (id, merchant, person_id, reward_id, code, expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (merchant, code) DO NOTHING RETURNING id`,
      [`rcl_${randomUUID()}`, input.merchant, input.personId, reward.id, code, expires.toISOString()],
    );
    if (rows[0]) {
      return { id: rows[0].id, code, qr: `${input.host.replace(/\/+$/, '')}/k/${code}`, rewardId: reward.id, rewardName: reward.name, cost: reward.cost, expiresAt: expires.toISOString(), status: 'open', orderId: null };
    }
  }
  throw new RewardsError('Try that again', 'conflict');
}

/** A claim scanned or typed at the counter, still good: who it's for and what. */
export async function openClaim(q: Queryable, input: { merchant: string; code: string; orderId: string; now?: Date }): Promise<{ id: string; personId: string; rewardId: string }> {
  const now = input.now ?? new Date();
  const code = input.code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  const { rows } = await q.query<{ id: string; person_id: string; reward_id: string; expires_at: Date | string; order_id: string | null; used_at: Date | null }>(
    'SELECT * FROM rewards.reward_claims WHERE merchant = $1 AND code = $2',
    [input.merchant, code],
  );
  const c = rows[0];
  if (!c) throw new RewardsError(`${claimCodeLabel(code)} isn’t a code here`, 'not_found');
  if (c.used_at || (c.order_id && c.order_id !== input.orderId)) throw new RewardsError('That code has been used', 'conflict');
  if (new Date(c.expires_at) <= now) throw new RewardsError('That code has run out. They can get a new one in their app', 'expired');
  return { id: c.id, personId: c.person_id, rewardId: c.reward_id };
}
