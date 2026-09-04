import { canAuthoriseRefund } from '@clear/domain';
import { randomUUID } from 'node:crypto';
import { refundQuote, toCents } from '@clear/domain';
import { MERCHANT_SCHEMA, ensureMerchantSchema, getMerchantPool } from '../../config/merchantDb.js';
import { chargeStore } from '../chargeStore.js';
import { type StaffRow, staffStore } from './staffStore.js';

/**
 * Refunds, and the transfer of authority they carry.
 *
 * Three steps and two people: a writer requests, an owner approves. **Nothing is said to the
 * customer until the owner approves**, so a request moves no money and touches no plan — it is a
 * row in `requested` and nothing else. That is what lets a declined refund be a conversation
 * between two staff rather than a broken promise to a customer.
 *
 * The figures are computed by `@clear/domain`'s `refundQuote`, the same function the counter
 * tablet and the member's phone use. That import is the reason this service's container now builds
 * from the repository root: a refund that says $99.91 on the tablet and stores $99.90 here is a
 * discrepancy somebody has to reconcile by hand, and one implementation is the only way to be sure
 * it cannot happen.
 *
 * The quoted figures are stored rather than recomputed on read. A refund settled last month must
 * still show the numbers it settled at, even after a rate changes.
 */

export type RefundState = 'requested' | 'approved' | 'declined' | 'settled';

/**
 * How an approval arrived.
 *
 * Not decoration. "Owner code at the counter" proves somebody knew four digits; "approved from
 * the owner's phone" proves possession of the owner's device. Both are acceptable, they are not
 * equal evidence, and a disputed refund six months later turns entirely on which.
 */
export type DecidedVia = 'owner_code' | 'owner_device';

/**
 * What a counter writer may clear with the owner's code — **set by the owner, not by Clear**.
 *
 * Escalate by size, as retail already does: the code clears small refunds so the counter stays
 * fast for the common case, and anything larger goes to the owner's own device where real friction
 * belongs. The genuine risk is not a guessed code — it is a writer refunding to something they
 * control using a code they have watched a hundred times, and no credential strength fixes that.
 * What bounds it is the amount; what catches it is the audit trail.
 *
 * Zero is "Off", and a real answer: every refund waits for the owner's phone.
 *
 * **Changing this requires a signed-in owner and can never be done with the code**, or a writer
 * raises the ceiling with the code and then uses it. The rule is enforced by where the setter
 * lives — behind `requireOwner`, which only a Privy session satisfies — and `/owner-check` issues
 * no session by design. This comment exists so that stays true when somebody later adds a
 * convenience that hands the code path a session.
 */
export const DEFAULT_OWNER_CODE_LIMIT_CENTS = 50_000;

export interface RefundRow {
  id: string;
  chargeCode: string;
  merchant: string;
  amountCents: number;
  memberCents: number;
  carryKeptCents: number;
  clawbackCents: number;
  state: RefundState;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedVia: DecidedVia | null;
}

interface DbRefund {
  id: string;
  charge_code: string;
  merchant: string;
  amount_cents: string;
  member_cents: string;
  carry_kept_cents: string;
  clawback_cents: string;
  state: RefundState;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decided_via: DecidedVia | null;
}

const toRow = (r: DbRefund): RefundRow => ({
  id: r.id,
  chargeCode: r.charge_code,
  merchant: r.merchant,
  amountCents: Number(r.amount_cents),
  memberCents: Number(r.member_cents),
  carryKeptCents: Number(r.carry_kept_cents),
  clawbackCents: Number(r.clawback_cents),
  state: r.state,
  requestedBy: r.requested_by,
  requestedAt: new Date(r.requested_at).toISOString(),
  decidedBy: r.decided_by,
  decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
  decidedVia: r.decided_via,
});

/**
 * The shop's current code limit, in cents. Zero is "Off".
 *
 * Read on every approval rather than cached: an owner who turns it off because of a weekend hire
 * expects that to bite on the next refund, not after a deploy.
 */
export async function ownerCodeLimitFor(merchant: string): Promise<number> {
  const pool = getMerchantPool();
  if (!pool) return 0;
  await ensureMerchantSchema();
  const { rows } = await pool.query<{ owner_code_limit_cents: string | null }>(
    `SELECT owner_code_limit_cents FROM ${MERCHANT_SCHEMA}.profiles WHERE merchant = $1`,
    [merchant.trim().toLowerCase()],
  );
  const raw = rows[0]?.owner_code_limit_cents;
  return raw == null ? DEFAULT_OWNER_CODE_LIMIT_CENTS : Number(raw);
}

export const refundStore = {
  /**
   * A writer starts a refund. Nothing moves.
   *
   * Refused unless the charge is approved and belongs to this shop, and refused if a refund is
   * already open against it — the partial unique index makes that a constraint rather than a
   * check-then-write race between two counter devices.
   */
  async request(input: {
    chargeCode: string;
    merchant: string;
    staff: StaffRow;
    /** The plan's terms, needed to work out the carry already paid. */
    splitInto: number;
    cyclesCleared: number;
    ratePerCycle: number;
    discountRate: number;
    nextPayoutCents: number;
  }): Promise<{ ok: boolean; refund?: RefundRow; reason?: string }> {
    const pool = getMerchantPool();
    if (!pool) return { ok: false, reason: 'not configured' };
    await ensureMerchantSchema();

    const charge = await chargeStore.get(input.chargeCode);
    if (!charge) return { ok: false, reason: 'no such charge' };
    if (charge.merchantAddress !== input.merchant.trim().toLowerCase()) {
      // Not 'forbidden': a shop should not be able to probe another shop's codes by status.
      return { ok: false, reason: 'no such charge' };
    }
    if (charge.status !== 'approved') {
      return { ok: false, reason: `a ${charge.status} charge cannot be refunded` };
    }

    // The same arithmetic the tablet showed the writer before they pressed Send to an owner.
    const quote = refundQuote({
      amount: charge.amountCents / 100,
      splitInto: input.splitInto,
      ratePerCycle: input.ratePerCycle,
      cyclesCleared: input.cyclesCleared,
      discountRate: input.discountRate,
      nextPayout: input.nextPayoutCents / 100,
    });

    try {
      const { rows } = await pool.query<DbRefund>(
        `INSERT INTO ${MERCHANT_SCHEMA}.refunds
           (id, charge_code, merchant, amount_cents, member_cents, carry_kept_cents,
            clawback_cents, state, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8) RETURNING *`,
        [
          `rfd_${randomUUID()}`,
          charge.code,
          charge.merchantAddress,
          charge.amountCents,
          toCents(quote.memberReceives),
          toCents(quote.carryKept),
          toCents(quote.merchantClawback),
          input.staff.id,
        ],
      );
      return { ok: true, refund: toRow(rows[0]) };
    } catch (err) {
      // 23505 is unique_violation — the partial index caught a second open request.
      if ((err as { code?: string }).code === '23505') {
        return { ok: false, reason: 'a refund is already waiting on an owner for this charge' };
      }
      throw err;
    }
  },

  /** What is open against a charge, if anything. The merchant app's waiting step reads this. */
  async openForCharge(chargeCode: string): Promise<RefundRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();
    const { rows } = await pool.query<DbRefund>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.refunds
        WHERE charge_code = $1 AND state IN ('requested','approved') LIMIT 1`,
      [chargeCode.trim().toUpperCase()],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },

  async get(id: string, merchant: string): Promise<RefundRow | null> {
    const pool = getMerchantPool();
    if (!pool) return null;
    await ensureMerchantSchema();
    const { rows } = await pool.query<DbRefund>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.refunds WHERE id = $1 AND merchant = $2`,
      [id, merchant.trim().toLowerCase()],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },

  /**
   * An owner approves. This is the step that moves money and tells the customer.
   *
   * The charge is marked refunded in the same call. Two databases could not do this atomically,
   * which is one of the reasons the merchant schema shares a database with charges rather than
   * living in its own — see the note at the top of `config/merchantDb.ts`.
   *
   * Guarded on `state = 'requested'` in the UPDATE so two owners approving at once produce one
   * settlement, not two.
   */
  async approve(
    id: string,
    owner: StaffRow,
    via: DecidedVia,
  ): Promise<{ ok: boolean; refund?: RefundRow; reason?: string }> {
    const pool = getMerchantPool();
    if (!pool) return { ok: false, reason: 'not configured' };
    await ensureMerchantSchema();

    // The size rule, enforced server-side rather than by hiding the field. A counter that can be
    // talked into showing the code box is still a counter that cannot approve a large refund.
    const existing = await this.get(id, owner.merchant);
    const limit = await ownerCodeLimitFor(owner.merchant);

    // A code typed at the counter is bounded whoever's code it is. The ceiling is there because a
    // code can be watched, borrowed and reused — not because of who owns it.
    if (via === 'owner_code' && existing && (limit <= 0 || existing.amountCents >= limit)) {
      return {
        ok: false,
        reason: 'That one needs approving from the owner’s phone, not a code at the counter.',
      };
    }

    // And a manager is held to the same ceiling on their own device. Without this the threshold
    // would bind counter staff and nobody else, which is not a threshold.
    if (existing && !canAuthoriseRefund(owner.role, existing.amountCents, limit)) {
      return {
        ok: false,
        reason: 'That one is above the refund limit and needs an owner.',
      };
    }

    const { rows } = await pool.query<DbRefund>(
      `UPDATE ${MERCHANT_SCHEMA}.refunds
          SET state = 'settled', decided_by = $2, decided_at = now(), decided_via = $3
        WHERE id = $1 AND state = 'requested'
        RETURNING *`,
      [id, owner.id, via],
    );
    const refund = rows[0];
    if (!refund) return { ok: false, reason: 'that refund is no longer waiting' };

    // The charge is NOT flagged here. Marking it refunded is what claws the payout back, and
    // that must not happen until the member's plan is actually closed -- see settleRefund. This
    // row moving to `settled` is only the decision; the settlement follows it.
    return { ok: true, refund: toRow(refund) };
  },

  /**
   * Put an approved refund back to waiting, when the settlement behind it did not happen.
   *
   * Nothing outside has seen it: the member has not been told and the payout has not moved, so
   * this is a decision being un-made rather than a refund being reversed.
   */
  async reopen(id: string): Promise<boolean> {
    const pool = getMerchantPool();
    if (!pool) return false;
    await ensureMerchantSchema();
    const { rowCount } = await pool.query(
      `UPDATE ${MERCHANT_SCHEMA}.refunds
          SET state = 'requested', decided_by = NULL, decided_at = NULL, decided_via = NULL
        WHERE id = $1 AND state = 'settled'`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },

  /** An owner declines. The charge stands; the writer is told and the customer is not. */
  async decline(
    id: string,
    owner: StaffRow,
    via: DecidedVia,
  ): Promise<{ ok: boolean; refund?: RefundRow; reason?: string }> {
    const pool = getMerchantPool();
    if (!pool) return { ok: false, reason: 'not configured' };
    await ensureMerchantSchema();
    const { rows } = await pool.query<DbRefund>(
      `UPDATE ${MERCHANT_SCHEMA}.refunds
          SET state = 'declined', decided_by = $2, decided_at = now(), decided_via = $3
        WHERE id = $1 AND state = 'requested'
        RETURNING *`,
      [id, owner.id, via],
    );
    return rows[0]
      ? { ok: true, refund: toRow(rows[0]) }
      : { ok: false, reason: 'that refund is no longer waiting' };
  },

  /** The writer withdraws their own request before an owner has ruled on it. */
  async withdraw(id: string, staff: StaffRow): Promise<boolean> {
    const pool = getMerchantPool();
    if (!pool) return false;
    await ensureMerchantSchema();
    const { rowCount } = await pool.query(
      `DELETE FROM ${MERCHANT_SCHEMA}.refunds
        WHERE id = $1 AND state = 'requested' AND (requested_by = $2 OR $3 = 'owner')`,
      [id, staff.id, staff.role],
    );
    return (rowCount ?? 0) > 0;
  },

  /** Refund history for a shop, newest first. */
  async listByMerchant(merchant: string, limit = 100): Promise<RefundRow[]> {
    const pool = getMerchantPool();
    if (!pool) return [];
    await ensureMerchantSchema();
    const { rows } = await pool.query<DbRefund>(
      `SELECT * FROM ${MERCHANT_SCHEMA}.refunds WHERE merchant = $1
        ORDER BY requested_at DESC LIMIT $2`,
      [merchant.trim().toLowerCase(), limit],
    );
    return rows.map(toRow);
  },

  /** Resolve the two names a settled refund keeps. */
  async namesFor(refund: RefundRow): Promise<{ requestedBy: string; decidedBy: string | null }> {
    const [requester, decider] = await Promise.all([
      staffStore.get(refund.requestedBy),
      refund.decidedBy ? staffStore.get(refund.decidedBy) : Promise.resolve(null),
    ]);
    return { requestedBy: requester?.name ?? '—', decidedBy: decider?.name ?? null };
  },
};
