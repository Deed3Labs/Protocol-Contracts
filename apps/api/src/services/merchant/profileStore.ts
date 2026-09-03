import { randomUUID } from 'node:crypto';
import { merchantPayout, payoutSettlement } from '@clear/domain';
import { MERCHANT_SCHEMA, ensureMerchantSchema, getMerchantPool } from '../../config/merchantDb.js';
import { getPostgresPool } from '../../config/postgres.js';
import { readMerchantTerms } from '../chargeService.js';
import { CHARGE_TABLE_NAME } from '../chargeStore.js';
import { cashAccountCents } from './cashAccount.js';

/**
 * The shop's own record, and what it is owed.
 *
 * **The registry is the authority on terms, not this table.** The rate and the per-charge cap live
 * on chain in `MerchantRegistry`, which is what `chargeService` enforces when a charge is raised.
 * What is stored here is a display copy plus the things a contract has no opinion about — the
 * shop's category, its town, which bank account the payouts go to.
 *
 * Storing the rate twice is a real risk, so `forDisplay` reads the chain when it can and falls
 * back to the copy only when it cannot. A Settings page showing a stale rate is a merchant who
 * believes the wrong number about their own money.
 */

/**
 * The charge table's real name.
 *
 * This said 'charges'. chargeStore — the only thing that creates or writes the table — calls it
 * `charge_requests`, so every query here failed with "relation does not exist": the owner's charge
 * counts and the whole payout position, silently, because the routes had no error handling and the
 * rejection meant Express never answered at all. The Staff page hung rather than failing.
 *
 * Imported from chargeStore rather than retyped, so the two cannot drift again.
 */
const CHARGES_TABLE = CHARGE_TABLE_NAME;
const normalize = (m: string) => m.trim().toLowerCase();

export const merchantProfileStore = {
  async forDisplay(merchant: string, includeMoney: boolean) {
    const pool = getMerchantPool();
    await ensureMerchantSchema();

    const { rows } = pool
      ? await pool.query<{
          merchant: string;
          name: string;
          category: string | null;
          town: string | null;
          payout_account: string | null;
          payout_terms: string;
          partner_since: string | null;
          founding: boolean;
        }>(`SELECT * FROM ${MERCHANT_SCHEMA}.profiles WHERE merchant = $1`, [normalize(merchant)])
      : { rows: [] };

    const profile = rows[0];
    // On-chain first. `readMerchantTerms` returns null when the registry is unreachable rather
    // than throwing, so Settings still renders — it just renders without the rate.
    const chain = await readMerchantTerms(normalize(merchant)).catch(() => null);

    return {
      merchant: normalize(merchant),
      name: profile?.name ?? '',
      category: profile?.category ?? null,
      town: profile?.town ?? null,
      partnerSince: profile?.partner_since ?? null,
      founding: profile?.founding ?? false,
      payoutTerms: profile?.payout_terms ?? 'Net-30',
      // Money is owner-only. The field is absent rather than null for a counter writer, so a bug
      // that forgets to check the role renders nothing instead of rendering a zero.
      ...(includeMoney
        ? {
            discountRate: chain?.discountRate ?? null,
            approvalCapCents: chain?.capCents ?? null,
            payoutAccount: profile?.payout_account ?? null,
            termsSource: chain ? ('chain' as const) : ('unavailable' as const),
          }
        : {}),
    };
  },

  /**
   * What the shop is owed, and how it settles.
   *
   * Derived from the charges themselves rather than a running total. A balance kept as a column is
   * a balance that can drift from the rows that produced it, and the first time a merchant
   * reconciles against their own books the drift is what they find.
   */
  /**
   * Create the shop's profile row. Onboarding's first write.
   *
   * `merchant` is the organization wallet's address, lowercased — the merchant address the
   * registry knows IS that wallet, so identity comes from Privy rather than being chosen. ON
   * CONFLICT DO NOTHING because onboarding is retried by people refreshing a page mid-signup, and
   * a second attempt should land on the shop they already have rather than an error.
   */
  async create(input: {
    merchant: string;
    name: string;
    category?: string | null;
    town?: string | null;
  }): Promise<boolean> {
    const pool = getMerchantPool();
    if (!pool) return false;
    await ensureMerchantSchema();
    const { rowCount } = await pool.query(
      `INSERT INTO ${MERCHANT_SCHEMA}.profiles (merchant, name, category, town, partner_since)
       VALUES ($1,$2,$3,$4,CURRENT_DATE)
       ON CONFLICT (merchant) DO NOTHING`,
      [normalize(input.merchant), input.name.trim(), input.category ?? null, input.town ?? null],
    );
    return (rowCount ?? 0) > 0;
  },

  /** Record Clear's signer on this shop, once the wallet has accepted it. */
  async setClearSigner(merchant: string, quorumId: string, policyId: string): Promise<void> {
    const pool = getMerchantPool();
    if (!pool) return;
    await ensureMerchantSchema();
    await pool.query(
      `UPDATE ${MERCHANT_SCHEMA}.profiles
          SET clear_signer_quorum_id = $2, clear_policy_id = $3
        WHERE merchant = $1`,
      [normalize(merchant), quorumId, policyId],
    );
  },

  /**
   * Ask for what is owed, before it is due — reference section 18.
   *
   * This records a request; it does not move money. Settlement is a separate act and the row says
   * so, sitting at `requested` until it is paid. The screen that reports it has to be equally
   * careful: "on its way" is true of a request that will be settled, and false of a request nobody
   * has picked up, so the honest version names the date rather than implying a transfer.
   *
   * Bounded by what the position says is available today. A merchant cannot ask for more than they
   * are owed, and the pool cap is the credit side's answer rather than something asserted here.
   */
  async requestWithdrawal(input: {
    merchant: string;
    amountCents: number;
    requestedBy: string;
    /** Owed money passes through the cash account; cash-account money goes straight out. */
    source: 'owed' | 'cash';
    destination: 'cash' | 'bank' | 'debit';
  }): Promise<{ ok: boolean; id?: string; reason?: string }> {
    const pool = getMerchantPool();
    if (!pool) return { ok: false, reason: 'not configured' };
    await ensureMerchantSchema();

    const position = await this.payoutPosition(input.merchant);

    /**
     * The cap depends on where the money is coming from — reference section 07b.
     *
     * Owed money is bounded by what the payout pool can free today; cash-account money is bounded
     * only by the balance. Checking one cap for both would either block a merchant from moving
     * their own money or let them draw against a pool that has not released it.
     */
    const cap =
      input.source === 'cash' ? position.cashAccountCents : position.releasedReadyCents;

    if (cap === null) {
      return {
        ok: false,
        reason:
          input.source === 'cash'
            ? 'We cannot read your cash account just now. Try again shortly.'
            : 'We cannot size an early release just now. It arrives on your scheduled payout.',
      };
    }
    if (input.amountCents <= 0 || input.amountCents > cap) {
      return { ok: false, reason: 'That is more than is available from there.' };
    }
    // Cash to cash is not a movement. It drops out of the picker, and is refused here too.
    if (input.source === 'cash' && input.destination === 'cash') {
      return { ok: false, reason: 'That money is already in your cash account.' };
    }

    const id = `pay_${randomUUID()}`;
    await pool.query(
      `INSERT INTO ${MERCHANT_SCHEMA}.payouts
         (id, merchant, amount_cents, charge_count, scheduled_for, status, requested_by, requested_at)
       VALUES ($1,$2,$3,0,CURRENT_DATE,'requested',$4, now())`,
      [id, normalize(input.merchant), Math.round(input.amountCents), input.requestedBy],
    );
    return { ok: true, id };
  },

  async payoutPosition(merchant: string) {
    const pool = getPostgresPool();
    // Same shape as the real return, which it was not: this said `owed`/`clearsBalance`/`toBank`
    // while the success path says `owedCents`/`clearsBalanceCents`/`toBankCents`. A caller reading
    // the documented keys got undefined and rendered it as zero — a wrong number that looks like a
    // quiet day rather than a missing database.
    if (!pool) {
      return {
        owedCents: 0,
        cashAccountCents: null as number | null,
        releasedReadyCents: null as number | null,
        scheduledCents: 0,
        readyToWithdrawCents: null as number | null,
        nextPayoutOn: null as string | null,
        clearsBalanceCents: 0,
        toBankCents: 0,
        availableTodayCents: null as number | null,
        paid: [] as { id: string; amountCents: number; charges: number; on: string; paidAt: string | null }[],
      };
    }

    const m = normalize(merchant);

    // Everything approved and not yet paid out. `payout_cents` is what the shop actually receives,
    // already net of the co-op's fee at the rate that applied when the charge was raised.
    const owedRes = await pool.query<{ owed: string; n: string }>(
      `SELECT COALESCE(SUM(payout_cents),0) AS owed, COUNT(*) AS n
         FROM ${CHARGES_TABLE}
        WHERE merchant_address = $1 AND status = 'approved'`,
      [m],
    );
    const owedCents = Number(owedRes.rows[0]?.owed ?? 0);

    // Settled refunds come straight off what is owed.
    const merchantPool = getMerchantPool();
    let clawbackCents = 0;
    if (merchantPool) {
      await ensureMerchantSchema();
      const r = await merchantPool.query<{ total: string }>(
        `SELECT COALESCE(SUM(clawback_cents),0) AS total FROM ${MERCHANT_SCHEMA}.refunds
          WHERE merchant = $1 AND state = 'settled'`,
        [m],
      );
      clawbackCents = Number(r.rows[0]?.total ?? 0);
    }

    const net = Math.max(0, owedCents - clawbackCents);

    // The shop's own Clear balance clears out of the payout first — it costs them no carry there.
    // Not yet read from the credit contracts; zero until that is wired, which reads as "all of it
    // goes to your bank" rather than as a wrong number.
    const clearBalanceCents = 0;
    const settle = payoutSettlement(net / 100, clearBalanceCents / 100);

    const paidRes = merchantPool
      ? await merchantPool.query<{
          id: string;
          amount_cents: string;
          charge_count: number;
          scheduled_for: string;
          paid_at: string | null;
        }>(
          `SELECT id, amount_cents, charge_count, scheduled_for, paid_at
             FROM ${MERCHANT_SCHEMA}.payouts
            WHERE merchant = $1 AND status = 'paid'
            ORDER BY scheduled_for DESC LIMIT 12`,
          [m],
        )
      : { rows: [] };

    // When the next payout lands. The app showed a fixture date because this was computed but never
    // returned — and a shop's whole relationship to Clear is "you are paid on the 14th", so the
    // date is not decoration. Null when no payout is scheduled yet, which the screen states rather
    // than filling in.
    const nextRes = merchantPool
      ? await merchantPool.query<{ scheduled_for: string }>(
          `SELECT scheduled_for FROM ${MERCHANT_SCHEMA}.payouts
            WHERE merchant = $1 AND status IN ('scheduled','available')
            ORDER BY scheduled_for ASC LIMIT 1`,
          [m],
        )
      : { rows: [] };

    /**
     * Three parallel lines, not one figure — reference section 07.
     *
     *   cashAccountCents   already the merchant's, movable at any hour
     *   releasedReadyCents owed, and free today as far as the pool allows
     *   scheduledCents     owed, and arriving on the scheduled payout
     *
     * "Ready to withdraw" is the first two added together, which is the number a merchant actually
     * asks for — how much can I get right now — and the reason the composition is shown beneath it
     * rather than as two cards they have to add up themselves.
     *
     * The old shape could not express this: it had one owed figure and an availability cap, so
     * money already sitting in the shop's own account was invisible.
     */
    /**
     * How much of what is OWED the pool can free today. Null means unknown, which is not zero —
     * the credit side answers this and nothing here should guess a cap it cannot verify.
     */
    const availableTodayCents: number | null = null;

    const cash = await cashAccountCents(normalize(merchant));
    const releasedReady = availableTodayCents === null ? null : Math.min(availableTodayCents, net);
    const scheduled = releasedReady === null ? net : Math.max(0, net - releasedReady);

    return {
      owedCents: net,
      cashAccountCents: cash,
      releasedReadyCents: releasedReady,
      scheduledCents: scheduled,
      // Null when either half is unknown, so the screen says so rather than understating it.
      // Cash-account money is withdrawable whatever the pool says, so an unknown early-release cap
      // must not hide it. Null only when the balance itself could not be read.
      readyToWithdrawCents: cash === null ? null : cash + (releasedReady ?? 0),
      nextPayoutOn: nextRes.rows[0]?.scheduled_for ?? null,
      clearsBalanceCents: Math.round(settle.clearsBalance * 100),
      toBankCents: Math.round(settle.toBank * 100),
      // The early-withdrawal cap is a pool question the credit side answers. Stated as null rather
      // than guessed: the app says the cap up front, and a made-up cap is worse than none.
      // The early-withdrawal cap is a pool question the credit side answers. Stated as null rather
      // than guessed: a made-up cap is worse than none.
      availableTodayCents,
      paid: paidRes.rows.map((p) => ({
        id: p.id,
        amountCents: Number(p.amount_cents),
        charges: p.charge_count,
        on: p.scheduled_for,
        paidAt: p.paid_at,
      })),
    };
  },

  /** Charges raised per staff member this month — the by-product that shows who is offering it. */
  async chargeCountsByStaff(merchant: string): Promise<Record<string, number>> {
    const pool = getPostgresPool();
    if (!pool) return {};
    const { rows } = await pool.query<{ raised_by: string | null; n: string }>(
      `SELECT raised_by, COUNT(*) AS n FROM ${CHARGES_TABLE}
        WHERE merchant_address = $1
          AND created_at >= date_trunc('month', now())
          AND raised_by IS NOT NULL
        GROUP BY raised_by`,
      [normalize(merchant)],
    );
    const out: Record<string, number> = {};
    for (const r of rows) if (r.raised_by) out[r.raised_by] = Number(r.n);
    return out;
  },

  /**
   * Set the owner-code refund threshold.
   *
   * Callers must already have established that this is a signed-in owner and that the value is
   * within the shop's approval cap — the route does both. Kept dumb on purpose: a store method
   * that re-derives authority is a store method somebody calls from the wrong place.
   */
  async setOwnerCodeLimit(merchant: string, limitCents: number): Promise<void> {
    const pool = getMerchantPool();
    if (!pool) return;
    await ensureMerchantSchema();
    await pool.query(
      `UPDATE ${MERCHANT_SCHEMA}.profiles SET owner_code_limit_cents = $2 WHERE merchant = $1`,
      [normalize(merchant), Math.max(0, Math.round(limitCents))],
    );
  },

  /** What a charge pays out, for a quote before it is raised. */
  quotePayoutCents(amountCents: number, discountRate: number): number {
    return Math.round(merchantPayout(amountCents / 100, discountRate) * 100);
  },
};
