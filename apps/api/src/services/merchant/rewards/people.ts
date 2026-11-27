import { createHash, randomUUID } from 'node:crypto';
import { CreatePerson, type Person } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { phoneE164 } from '../orders/payments.js';
import type { ClearSide } from './clearSide.js';
import { RewardsError } from './errors.js';

/**
 * A person in rewards: a Clear member, or someone with only a phone number (rewards DECISIONS,
 * Phase 1). Keyed by their Privy DID, so the same person signs in from any shop's app or the hub.
 */

export interface PersonRow {
  id: string;
  privy_did: string;
  wallet: string | null;
  first_name: string;
  last_initial: string | null;
  phone_hash: string | null;
  member_subject: string | null;
  created_at: Date | string;
}

/** Who is asking: from the Privy session, or from a rewards token minted from one. */
export interface Caller {
  did: string;
  wallet: string;
  /** From the Privy session only: the number they signed in with. */
  phone?: string | null;
  email?: string | null;
}

/** sha256 of the E.164 number, so "(909) 555-0142" and "+19095550142" are the same person. */
export function phoneHash(raw: string | null | undefined): string | null {
  const e164 = raw ? phoneE164(raw) : null;
  return e164 ? createHash('sha256').update(e164).digest('hex') : null;
}

export function displayPhone(raw: string | null | undefined): string | null {
  const e164 = raw ? phoneE164(raw) : null;
  if (!e164) return null;
  return e164.startsWith('+1') && e164.length === 12 ? `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}` : e164;
}

export async function personByDid(q: Queryable, did: string): Promise<PersonRow | null> {
  const { rows } = await q.query<PersonRow>('SELECT * FROM rewards.people WHERE privy_did = $1', [did]);
  return rows[0] ?? null;
}

export async function personByWallet(q: Queryable, wallet: string): Promise<PersonRow | null> {
  const { rows } = await q.query<PersonRow>('SELECT * FROM rewards.people WHERE wallet = $1', [wallet.toLowerCase()]);
  return rows[0] ?? null;
}

export async function personById(q: Queryable, id: string): Promise<PersonRow | null> {
  const { rows } = await q.query<PersonRow>('SELECT * FROM rewards.people WHERE id = $1', [id]);
  return rows[0] ?? null;
}

function splitName(display: string | null): { first: string; initial: string | null } | null {
  const parts = (display ?? '').replace(/^@/, '').trim().split(/\s+/).filter(Boolean);
  if (!parts[0]) return null;
  const initial = parts[1]?.charAt(0).toUpperCase() ?? null;
  return { first: parts[0].slice(0, 40), initial: initial && /\p{L}/u.test(initial) ? initial : null };
}

async function insertPerson(q: Queryable, caller: Caller, name: { first: string; initial: string | null }, memberSubject: string | null): Promise<PersonRow> {
  const { rows } = await q.query<PersonRow>(
    `INSERT INTO rewards.people (id, privy_did, wallet, first_name, last_initial, phone_hash, member_subject)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (privy_did) DO UPDATE SET wallet = COALESCE(rewards.people.wallet, EXCLUDED.wallet)
     RETURNING *`,
    [`rwp_${randomUUID()}`, caller.did, caller.wallet.toLowerCase() || null, name.first, name.initial, phoneHash(caller.phone), memberSubject],
  );
  return rows[0]!;
}

/**
 * The caller's person. A Clear member never signs up: the first time they open rewards they're made
 * one from their Clear name. Anyone else is null until Welcome (`createPerson`).
 */
export async function resolvePerson(q: Queryable, clear: ClearSide, caller: Caller): Promise<PersonRow | null> {
  const found = await personByDid(q, caller.did);
  if (found) {
    // Signing in with a phone fills in a number they didn't have here, and links a membership made since.
    const hash = phoneHash(caller.phone);
    if ((hash && !found.phone_hash) || !found.member_subject) {
      const member = found.member_subject ? null : await clear.member({ did: caller.did, wallet: caller.wallet, phone: caller.phone, email: caller.email });
      if ((hash && !found.phone_hash) || member) {
        const { rows } = await q.query<PersonRow>(
          'UPDATE rewards.people SET phone_hash = COALESCE(phone_hash, $2), member_subject = COALESCE(member_subject, $3) WHERE id = $1 RETURNING *',
          [found.id, hash, member?.subject ?? null],
        );
        return rows[0]!;
      }
    }
    return found;
  }
  // Seen at a counter before they ever opened rewards (by their Clear code): the same person.
  const byWallet = caller.wallet ? await personByWallet(q, caller.wallet) : null;
  if (byWallet) {
    const { rows } = await q.query<PersonRow>('UPDATE rewards.people SET privy_did = $2, phone_hash = COALESCE(phone_hash, $3) WHERE id = $1 RETURNING *', [byWallet.id, caller.did, phoneHash(caller.phone)]);
    return rows[0]!;
  }
  const member = await clear.member({ did: caller.did, wallet: caller.wallet, phone: caller.phone, email: caller.email });
  if (!member) return null;
  return insertPerson(q, caller, splitName(member.displayName) ?? { first: 'Clear member', initial: null }, member.subject);
}

/** Welcome: a first name, and nothing to verify. */
export async function createPerson(q: Queryable, clear: ClearSide, caller: Caller, body: unknown): Promise<PersonRow> {
  const parsed = CreatePerson.safeParse(body);
  if (!parsed.success) throw new RewardsError(parsed.error.issues[0]?.message ?? 'Your first name', 'invalid');
  const existing = await resolvePerson(q, clear, caller);
  if (existing) return existing;
  return insertPerson(q, caller, { first: parsed.data.firstName, initial: null }, null);
}

export async function requirePerson(q: Queryable, clear: ClearSide, caller: Caller): Promise<PersonRow> {
  const p = await resolvePerson(q, clear, caller);
  if (!p) throw new RewardsError('Tell us your first name first', 'not_found');
  return p;
}

export function toPerson(p: PersonRow, caller: Caller): Person {
  return { id: p.id, firstName: p.first_name, lastInitial: p.last_initial, phone: displayPhone(caller.phone), isClearMember: Boolean(p.member_subject) };
}

/**
 * Delete my rewards account: every shop's points, memberships, claims and consents. Orders keep
 * their figures, with no one on them. A Clear account is closed in Clear.
 */
export async function deletePerson(q: Queryable, personId: string): Promise<void> {
  await q.query('UPDATE commerce.orders SET member_person = NULL WHERE member_person = $1', [personId]);
  await q.query('DELETE FROM rewards.loyalty_entries WHERE person_id = $1', [personId]);
  await q.query('DELETE FROM rewards.reward_claims WHERE person_id = $1 AND used_at IS NULL', [personId]);
  await q.query('DELETE FROM rewards.loyalty_memberships WHERE person_id = $1', [personId]);
  await q.query('DELETE FROM rewards.people WHERE id = $1', [personId]);
}
