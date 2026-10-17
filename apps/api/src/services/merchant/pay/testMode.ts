import { randomBytes } from 'node:crypto';
import { TEST_MEMBER } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import type { ClearCharges } from '../orders/payments.js';
import { joinShop } from '../rewards/customerApp.js';
import type { PersonRow } from '../rewards/people.js';

/**
 * Pay with Clear's test mode (rule 11): test keys never move money. A test payment's Clear charge is a
 * row here, not a charge on the chain, and the only person who can sign in is the test member,
 * (555) 010-0100 with code 000000, who always approves. That member exists in test mode alone.
 */

export const TEST_MEMBER_WALLET = '0x00000000000000000000000000000000c1ea0100';
export const TEST_MEMBER_FIRST_NAME = 'Test';
/** The test member's credit, and the bank their cycles would clear from. */
export const TEST_MEMBER_LIMIT_CENTS = 500_000;
export const TEST_MEMBER_BANK = 'Test Bank •••• 0000';

export const isTestMemberPhone = (e164: string) => e164 === TEST_MEMBER.e164;

/** Test mode's Clear side: charges kept in `payments.test_charges`, answered by the test member. */
export function testClearCharges(db: Db): ClearCharges {
  return {
    async raise({ merchant, amountCents }) {
      const code = `TEST${randomBytes(4).toString('hex').toUpperCase()}`;
      await db.query('INSERT INTO payments.test_charges (code, merchant, amount_cents) VALUES ($1,$2,$3)', [code, merchant, amountCents]);
      return { ok: true, code };
    },
    async status(code) {
      const { rows } = await db.query<{ status: 'pending' | 'approved' | 'declined' | 'cancelled' }>('SELECT status FROM payments.test_charges WHERE code = $1', [code]);
      return rows[0]?.status ?? null;
    },
    async payer(code) {
      const { rows } = await db.query<{ member_wallet: string | null }>('SELECT member_wallet FROM payments.test_charges WHERE code = $1', [code]);
      return rows[0]?.member_wallet ?? null;
    },
    async cancel(code) {
      const { rows } = await db.query(`UPDATE payments.test_charges SET status = 'cancelled' WHERE code = $1 AND status = 'pending' RETURNING code`, [code]);
      return Boolean(rows[0]);
    },
    async sendTo() {
      return { ok: true, label: 'the test member' };
    },
  };
}

/** The test member approves: in full, or in installments. */
export async function approveTestCharge(db: Db, input: { code: string; wallet: string; installments: number }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { rows } = await db.query(
    `UPDATE payments.test_charges SET status = 'approved', member_wallet = $2, installments = $3 WHERE code = $1 AND status = 'pending' RETURNING code`,
    [input.code, input.wallet, input.installments],
  );
  return rows[0] ? { ok: true } : { ok: false, reason: 'That test charge isn’t waiting' };
}

export async function testChargeInstallments(db: Db, code: string): Promise<number | null> {
  const { rows } = await db.query<{ installments: number | null }>('SELECT installments FROM payments.test_charges WHERE code = $1', [code]);
  return rows[0]?.installments ?? null;
}

/**
 * The test member at this shop's rewards, so a test payment shows what it earns (pay prompt, Phase 5:
 * "earning 256 points"). Made the first time it's needed, joined, and named "Test" so the shop can
 * tell. Only the test member earns on a test payment; nothing else about it reaches the books.
 */
export async function ensureTestMemberAt(db: Db, merchant: string, now = new Date()): Promise<void> {
  const { rows: app } = await db.query<{ slug: string }>('SELECT slug FROM rewards.shop_apps WHERE merchant = $1 AND enabled', [merchant]);
  if (!app[0]) return;
  const { rows } = await db.query<PersonRow>(
    `INSERT INTO rewards.people (id, privy_did, wallet, first_name, last_initial, phone_hash, member_subject)
     VALUES ('rwp_test_member', 'did:clear:test-member', $1, $2, NULL, NULL, NULL)
     ON CONFLICT (privy_did) DO UPDATE SET wallet = EXCLUDED.wallet RETURNING *`,
    [TEST_MEMBER_WALLET, TEST_MEMBER_FIRST_NAME],
  );
  await joinShop(db, { slug: app[0].slug, person: rows[0]!, body: { texts: 'codes', birthMonth: null, consentVersion: 'test-mode', ref: null, orderId: null }, now }).catch(() => undefined);
}
