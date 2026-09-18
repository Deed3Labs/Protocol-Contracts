import { randomUUID } from 'node:crypto';
import { getPayPool, getPostgresPool } from '../../config/postgres.js';
import { disputeStore, type DisputeRecord } from './disputeStore.js';
import { ensureSettlementColumns, syncCardSettlement } from '../chain/cardSettlementService.js';
import { chargeStore } from '../chargeStore.js';
import { closePlan } from '../refundSettlement.js';
import { reopenPlanAfterDispute } from '../chargeService.js';
import { notificationStore } from '../notificationStore.js';
import { refreshSnapshotsFor } from '../lithic/snapshotService.js';
import { getLithic } from '../lithic/lithicClient.js';

/*
 * What the dispute page promises, made true.
 *
 *   "The amount: held, not spent"      Card: the disputed credit is moved out of the tier accounts
 *   "Your cycle: not counted late"     into `member_credit_disputed_<tier>`. A deposit does not pay
 *                                      it and the cycle does not count it, but it still uses up the
 *                                      tier (see outstandingForSpend), so it is held, not freed.
 *                                      Partner: the plan is unwound -- provisional credit, the way a
 *                                      card dispute works -- and the charge is `disputed`, so the
 *                                      merchant is not paid for it while it is open.
 *                                      Member: the send cannot be claimed while it is disputed.
 *
 *   "You are not charged carry"        Card: a purchase already on chain is taken off it, and one not
 *                                      yet there is not issued. Partner: the plan is closed. Either
 *                                      way there is nothing for carry to accrue on.
 *
 *   "If it goes against you, it        Put back as NEW: a fresh on-chain settlement, a new plan. Carry
 *    returns with the time added"      and the schedule start at the decision, so the time it spent
 *                                      in dispute costs the member nothing.
 *
 *   "Withdraw at any point"            withdrawDispute, which is a loss the member chose: the same
 *                                      putting-back, and the network told when it was a card.
 *
 * Holding is idempotent and retried by the sweep until it lands, because a promise kept only when
 * the first attempt succeeds is not kept. What cannot be held is recorded as `not_held` and the
 * member is told so: a send the other member has already claimed is in their wallet.
 *
 * Carry that accrued on a card purchase BEFORE it was disputed stays owed: it is already on the
 * ledger, owed to whoever funded the tier. From the moment of the dispute, none accrues.
 */

const LEDGER = 'lithic_ledger_entries';
const TIERS = ['savings', 'asset', 'income', 'boost'] as const;
type Tier = (typeof TIERS)[number];

async function tierBalance(wallet: string, account: string): Promise<number> {
  const { rows } = await getPayPool()!.query<{ net: string | null }>(
    `SELECT SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE -amount_cents END) AS net
       FROM ${LEDGER} WHERE wallet = $1 AND account = $2`,
    [wallet, account],
  );
  return Math.max(0, parseInt(rows[0]?.net ?? '0', 10) || 0);
}

/** One balanced move between two of the member's accounts. Idempotent by (event, id, account). */
async function move(
  wallet: string,
  from: string,
  to: string,
  cents: number,
  event: string,
  externalId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (cents <= 0) return;
  await getPayPool()!.query(
    `INSERT INTO ${LEDGER} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
     VALUES ($1, $2, $3, 'credit', $5, 'internal', $6, $7, $8::jsonb),
            ($1, $2, $4, 'debit', $5, 'internal', $6, $7, $8::jsonb)
     ON CONFLICT DO NOTHING`,
    [randomUUID(), wallet, from, to, cents, event, externalId, JSON.stringify(metadata)],
  );
}

// ---- Holding -----------------------------------------------------------------------------------

async function holdCard(dispute: DisputeRecord): Promise<void> {
  await ensureSettlementColumns();
  const pool = getPayPool()!;
  const { rows } = await pool.query<{ draws: unknown }>(
    `UPDATE lithic_auth_decisions SET dispute_token = $2 WHERE transaction_token = $1 RETURNING draws`,
    [dispute.subjectRef, dispute.token],
  );
  const draws = (Array.isArray(rows[0]?.draws) ? rows[0]!.draws : []) as Array<{ source?: string; amountCents?: number }>;

  // Set aside exactly what this purchase still owes on each tier -- no more than the tier holds, so a
  // part the member already paid is not held twice.
  const parked: Record<string, number> = {};
  for (const draw of draws) {
    const tier = String(draw.source ?? '') as Tier;
    if (!TIERS.includes(tier)) continue;
    const owed = await tierBalance(dispute.wallet, `member_credit_${tier}`);
    const cents = Math.min(Math.round(Number(draw.amountCents ?? 0)), owed);
    if (cents <= 0) continue;
    await move(dispute.wallet, `member_credit_${tier}`, `member_credit_disputed_${tier}`, cents, 'dispute_hold', `dispute:${dispute.token}:hold:${tier}`, {
      dispute: dispute.token,
      tier,
    });
    parked[tier] = (parked[tier] ?? 0) + cents;
  }
  await disputeStore.setHold(dispute.token, 'held', { parked });

  // Off the chain, if it is on it. The settlement service is the one writer of card positions.
  void syncCardSettlement(dispute.subjectRef).catch((e) => console.error('[dispute] card sync failed', e));
  await refreshSnapshotsFor(dispute.wallet).catch(() => 0);
}

async function holdPartner(dispute: DisputeRecord): Promise<void> {
  const charge = await chargeStore.get(dispute.subjectRef);
  if (!charge) return;
  if (charge.status === 'approved') await chargeStore.markDisputed(charge.code);
  const unwound = await closePlan(charge, charge.amountCents);
  if (!unwound.ok) {
    // Retried by the sweep; the dispute stands meanwhile, and the charge is already out of payouts.
    console.error(`[dispute] ${dispute.token} could not unwind plan: ${unwound.reason}`);
    await disputeStore.setHold(dispute.token, 'held', { planId: charge.planId, pending: true, error: unwound.reason ?? null });
    return;
  }
  await disputeStore.setHold(dispute.token, 'held', {
    planId: charge.planId,
    unwoundCents: unwound.unwoundCents ?? 0,
    tx: unwound.txHash ?? null,
  });
  // The other side is told, as the page says.
  await notificationStore
    .emit({
      wallet: charge.merchantAddress,
      kind: 'system',
      title: 'A charge is in dispute',
      body: `A member disputed ${charge.code}. It is not paid out while the dispute is open; Clear will ask for your side.`,
      data: { code: charge.code, dispute: dispute.token },
      dedupeKey: `dispute:${dispute.token}:merchant`,
    })
    .catch(() => null);
}

async function holdMember(dispute: DisputeRecord): Promise<void> {
  const pool = getPostgresPool();
  const { rows } = pool
    ? await pool
        .query<{ claimed_at: Date | null; status: string }>(`SELECT claimed_at, status FROM send_transfers WHERE transfer_id = $1`, [
          dispute.subjectRef,
        ])
        .catch(() => ({ rows: [] as Array<{ claimed_at: Date | null; status: string }> }))
    : { rows: [] as Array<{ claimed_at: Date | null; status: string }> };
  const transfer = rows[0];
  // Claimed already: the money is in the other member's wallet and there is nothing to hold.
  if (!transfer || transfer.claimed_at) {
    await disputeStore.setHold(dispute.token, 'not_held', { reason: 'already claimed' });
    return;
  }
  // Held by refusing the claim while the dispute is open -- see sendPayoutService.
  await disputeStore.setHold(dispute.token, 'held', { claimBlocked: true });
}

/** Apply the hold a dispute promises. Safe to call again: every step checks what is already done. */
export async function holdDispute(dispute: DisputeRecord): Promise<void> {
  if (dispute.status !== 'open' && dispute.status !== 'with_network') return;
  if (dispute.holdState === 'held' && !(dispute.heldDetail as { pending?: boolean } | null)?.pending) return;
  if (dispute.holdState === 'not_held') return;
  if (dispute.kind === 'card') return holdCard(dispute);
  if (dispute.kind === 'partner') return holdPartner(dispute);
  return holdMember(dispute);
}

// ---- Deciding ----------------------------------------------------------------------------------

async function releaseCard(dispute: DisputeRecord, memberWon: boolean): Promise<void> {
  await ensureSettlementColumns();
  const parked = ((dispute.heldDetail as { parked?: Record<string, number> } | null)?.parked ?? {}) as Record<string, number>;
  for (const [tier, cents] of Object.entries(parked)) {
    if (memberWon) {
      // Given back: the member no longer owes it. The co-op absorbs it, as with any chargeback won.
      await move(dispute.wallet, `member_credit_disputed_${tier}`, 'coop_dispute_writeoff', cents, 'dispute_won', `dispute:${dispute.token}:won:${tier}`, {
        dispute: dispute.token,
        tier,
      });
    } else {
      // Back into the cycle, as though it had just been spent.
      await move(dispute.wallet, `member_credit_disputed_${tier}`, `member_credit_${tier}`, cents, 'dispute_release', `dispute:${dispute.token}:release:${tier}`, {
        dispute: dispute.token,
        tier,
      });
    }
  }

  const pool = getPayPool()!;
  if (memberWon) {
    // Never to be issued, and nothing left held against it -- so a later event on the purchase
    // cannot release the same money a second time.
    await pool.query(
      `UPDATE lithic_auth_decisions SET dispute_token = NULL, onchain_status = 'waived', net_cents = 0, draws = '[]'::jsonb
        WHERE transaction_token = $1`,
      [dispute.subjectRef],
    );
  } else {
    // Settled again under a fresh ref, now, so carry starts from the decision.
    await pool.query(
      `UPDATE lithic_auth_decisions
          SET dispute_token = NULL, onchain_status = NULL, onchain_cents = NULL, onchain_attempts = 0,
              onchain_ref = $2
        WHERE transaction_token = $1`,
      [dispute.subjectRef, `${dispute.subjectRef}:after-dispute:${dispute.token}`],
    );
    void syncCardSettlement(dispute.subjectRef).catch((e) => console.error('[dispute] card re-issue failed', e));
  }
  await refreshSnapshotsFor(dispute.wallet).catch(() => 0);
}

async function releasePartner(dispute: DisputeRecord, memberWon: boolean): Promise<void> {
  const charge = await chargeStore.get(dispute.subjectRef);
  if (!charge) return;
  if (memberWon) {
    await chargeStore.refundAfterDispute(charge.code);
    return;
  }
  const unwound = Number((dispute.heldDetail as { unwoundCents?: number } | null)?.unwoundCents ?? 0);
  const reopened = await reopenPlanAfterDispute(charge, unwound);
  if (!reopened.ok) {
    console.error(`[dispute] ${dispute.token} plan not reopened: ${reopened.reason}`);
    return;
  }
  await chargeStore.restoreAfterDispute(charge.code, reopened.planId ?? null, reopened.txHash ?? null);
}

/**
 * Decide a dispute. `member` means it went the member's way; `merchant` means it did not. Called by
 * the card network's own decision (through the sweep) or by a person (scripts/resolve-dispute.ts).
 */
export async function resolveDispute(
  token: string,
  resolution: 'member' | 'merchant' | 'withdrawn',
  note: string | null = null,
): Promise<DisputeRecord | null> {
  const before = await disputeStore.get(token);
  if (!before) return null;
  // Closing it first, and only once, is what stops two deciders from both unwinding the hold.
  const decided = await disputeStore.resolve(token, resolution, note);
  if (!decided) return null;

  const memberWon = resolution === 'member';
  if (before.holdState === 'held') {
    if (before.kind === 'card') await releaseCard(before, memberWon);
    else if (before.kind === 'partner') await releasePartner(before, memberWon);
    // Member sends: the claim block lifts with the dispute. A win is refunded by hand -- the escrow
    // only refunds after expiry -- and the note says so.
  }
  await disputeStore.setHold(token, 'released', null);

  await notificationStore
    .emit({
      wallet: before.wallet,
      kind: 'system',
      title: resolution === 'withdrawn' ? 'Dispute withdrawn' : 'Your dispute was decided',
      body:
        resolution === 'withdrawn'
          ? `${before.subjectLabel} is back in your cycle, starting today.`
          : memberWon
            ? `${before.subjectLabel}: decided in your favour. You do not owe it.`
            : `${before.subjectLabel}: decided against you. It is back in your cycle, starting today — the time it was in dispute is not counted.`,
      data: { dispute: token, resolution },
      dedupeKey: `dispute:${token}:resolved`,
    })
    .catch(() => null);

  return decided;
}

/** The member takes it back. At the card network too, when that is where it was. */
export async function withdrawDispute(token: string, wallet: string): Promise<{ ok: boolean; reason?: string }> {
  const dispute = await disputeStore.get(token);
  if (!dispute || dispute.wallet !== wallet.trim().toLowerCase()) return { ok: false, reason: 'not found' };
  if (dispute.status !== 'open' && dispute.status !== 'with_network') return { ok: false, reason: 'already decided' };
  if (dispute.lithicDisputeToken) {
    const lithic = getLithic();
    try {
      await lithic?.disputes.delete(dispute.lithicDisputeToken);
    } catch (error) {
      // A dispute Lithic has already decided cannot be withdrawn there, and then it is not ours to
      // withdraw either: the decision stands.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[dispute] ${token} could not be withdrawn at Lithic: ${message}`);
      return { ok: false, reason: 'The card network would not withdraw it. It may already be decided.' };
    }
  }
  await resolveDispute(token, 'withdrawn', 'withdrawn by the member');
  return { ok: true };
}

// ---- The sweep ---------------------------------------------------------------------------------

/**
 * Keep every promise current: hold what is not yet held, and follow the card network's decisions.
 * Lithic reports CASE_WON (the member won) and CASE_CLOSED (lost, or withdrawn there).
 */
export async function enforceDisputes(): Promise<number> {
  const pool = getPayPool();
  if (!pool || !disputeStore.isConfigured()) return 0;
  let acted = 0;

  const unheld = await pool
    .query<{ token: string }>(
      `SELECT token FROM member_disputes
        WHERE status IN ('open', 'with_network')
          AND (hold_state IS NULL OR (hold_state = 'held' AND (held_detail->>'pending') = 'true'))
        LIMIT 25`,
    )
    .catch(() => ({ rows: [] as Array<{ token: string }> }));
  for (const row of unheld.rows) {
    const dispute = await disputeStore.get(row.token);
    if (dispute) {
      await holdDispute(dispute).catch((e) => console.error('[dispute] hold failed', row.token, e));
      acted += 1;
    }
  }

  const lithic = getLithic();
  if (lithic) {
    for (const dispute of await disputeStore.openAtNetwork()) {
      try {
        const at = await lithic.disputes.retrieve(dispute.lithicDisputeToken!);
        if (at.status === 'CASE_WON') {
          await resolveDispute(dispute.token, 'member', 'won at the card network');
          acted += 1;
        } else if (at.status === 'CASE_CLOSED') {
          await resolveDispute(dispute.token, 'merchant', 'closed at the card network');
          acted += 1;
        }
      } catch (error) {
        console.error('[dispute] network status read failed', dispute.token, error instanceof Error ? error.message : error);
      }
    }
  }
  return acted;
}
