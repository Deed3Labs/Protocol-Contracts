import { ethers } from 'ethers';
import { z } from 'zod';
import type { Queryable } from '../../db/db.js';
import { batch, remainderBatches, type DeskAddresses } from '../settlementFunding/desk.js';
import { clearDeskHalt, deskOverview, deskStore, recordMarginAdvance, stopDesk } from '../settlementFunding/store.js';
import { ActionError } from './actionError.js';

/*
 * Card settlement's manual funding (decision 54, the redesign). Every money move is two people (L-01 §6.4, C-01 §6.14):
 * these are Money actions, so they go through /actions/money/:kind → command.proposals → /proposals/:id/approve as
 * Money's other moves do, and what they do happens on approve. The page prefills the amount from the card's verdict.
 *
 *   settlement-book     a book transfer, Collection Account → CSA: a planned `book` move, which the desk carries out at
 *                       its next check (Clear Financial books it as servicer: a Lithic book transfer between the two).
 *   settlement-deploy   a two-person `deploy(amount, ref)` beyond the lane: the Safe batches (`remainderBatches`). The
 *                       desk forwards it when it lands.
 *   settlement-margin   a Savings-Backed Margin advance against this cut-off (`recordMarginAdvance`, which a script also
 *                       runs); restored within two business days.
 *   settlement-restart  clears the desk's halt and prepares the two-signer `setSettlementFunder` call.
 *
 * Stopping the desk and running it now are one person's, at Money Approve: routes in routes/command.ts.
 */

const UNIT = 1_000_000;
export const toUnits = (v: number) => BigInt(Math.round(v * UNIT));
const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const funderIface = new ethers.Interface(['function setSettlementFunder(address funder, uint256 capPerPeriod, uint64 periodSeconds)', 'function stopSettlementFunder()']);

/** The desk as its last check saw it: the pool it funds, its addresses, the settlement ref, the lane and the Collection Account. */
export async function deskNow(db: Queryable) {
  const o = (await deskOverview(db, 4).catch(() => []))[0];
  if (!o || !o.lastCheck) throw new ActionError(409, 'NO_DESK', 'The settlement funding desk hasn’t checked yet, so there’s nothing to fund against');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (o.lastCheck.snapshot ?? {}) as any;
  const a = (s.addresses ?? {}) as DeskAddresses;
  if (!a.pool) throw new ActionError(409, 'NO_DESK', 'The desk’s last check has no pool address');
  return {
    chainId: o.chainId,
    pool: o.pool,
    addresses: a,
    ref: s.ref ? String(s.ref) : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lane: (s.lane ?? {}) as Record<string, any>,
    collection: s.collection == null ? null : BigInt(String(s.collection)),
    halted: o.halted,
  };
}

/** The stop call for the signer's own wallet: `stopSettlementFunder()` on the pool. */
export const stopCall = (pool: string) => ({ to: pool, value: '0', data: funderIface.encodeFunctionData('stopSettlementFunder', []) });

/** Stops the desk: its halt now, so nothing moves while the chain call is pending, and the call to send. */
export async function stopTheDesk(db: Queryable, by: string, why: string) {
  const d = await deskNow(db);
  const id = await stopDesk(db, d.chainId, d.pool, by, why);
  return { id, chainId: d.chainId, call: stopCall(d.addresses.pool) };
}

const amount = z.number().positive().max(1_000_000);
type Person = { name?: string | null; email?: string | null };
const named = (p: Person) => p.name || p.email || 'Someone';

/* the four two-person actions, merged into Money's (actions.ts); each waits for a second person and runs on approve */
export function settlementActions() {
  return {
    'settlement-book': {
      body: z.object({ amount, note: z.string().trim().max(300).default('') }),
      summary: (b: { amount: number }) => `Book ${usd(b.amount)} of repayments to the Credit Settlement Account`,
      second: () => true,
      apply: async ({ tx, person }: { tx: Queryable; person: Person }, b: { amount: number; note: string }) => {
        const d = await deskNow(tx);
        const units = toUnits(b.amount);
        if (d.collection !== null && units > d.collection) throw new ActionError(409, 'TOO_MUCH', `The Collection Account held ${usd(Number(d.collection) / UNIT)} at the desk’s last check`);
        const row = await deskStore(tx, d.chainId, d.pool)
          .create({ kind: 'book', cutoffAt: null, ref: d.ref, due: 0n, need: 0n, amount: units, status: 'planned', recordedBy: named(person), note: b.note || 'Booked by two people from Command' })
          .catch(() => {
            throw new ActionError(409, 'DESK_BUSY', 'The desk is moving money now: approve again once that move lands');
          });
        return { move: row.id };
      },
    },
    'settlement-deploy': {
      body: z.object({ amount }),
      summary: (b: { amount: number }) => `Deploy ${usd(b.amount)} from the pool for the card settlement, beyond the lane`,
      second: () => true,
      apply: async ({ tx, at }: { tx: Queryable; at: Date }, b: { amount: number }) => {
        const d = await deskNow(tx);
        if (!d.ref) throw new ActionError(409, 'NO_REF', 'The desk’s last check has no settlement ref to deploy against');
        return { batches: remainderBatches(d.addresses, toUnits(b.amount), d.ref, at.getTime()) };
      },
      outbox: true,
    },
    'settlement-margin': {
      body: z.object({ amount, note: z.string().trim().max(300).default('') }),
      summary: (b: { amount: number }) => `Advance ${usd(b.amount)} of the Savings-Backed Margin to the card settlement`,
      second: () => true,
      apply: async ({ tx, person }: { tx: Queryable; person: Person }, b: { amount: number; note: string }) => {
        const d = await deskNow(tx);
        const row = await recordMarginAdvance(tx, d.chainId, d.pool, toUnits(b.amount), named(person), b.note || 'Advanced against the next cut-off from Command; restored within two business days');
        return { move: row.id };
      },
    },
    'settlement-restart': {
      body: z.object({}).default({}),
      summary: () => 'Restart the settlement funding desk',
      second: () => true,
      apply: async ({ tx, person, at }: { tx: Queryable; person: Person; at: Date }) => {
        const d = await deskNow(tx);
        const cleared = d.halted ? await clearDeskHalt(tx, d.halted.id, named(person)) : false;
        const funder = String(d.lane.funder ?? '');
        // the lane was never set up, or isn't stopped on chain: only the halt needed clearing
        if (!d.lane.stopped || !funder || /^0x0{40}$/i.test(funder)) return { cleared, batch: null };
        const call = { to: d.addresses.pool, value: '0', data: funderIface.encodeFunctionData('setSettlementFunder', [funder, BigInt(String(d.lane.capPerPeriod ?? 0)), BigInt(String(d.lane.periodSeconds ?? 0))]) };
        return {
          cleared,
          batch: batch(
            d.chainId,
            at.getTime(),
            'Restart the Settlement Funding lane',
            'Each of the two DEPLOYER_ROLE signers sends this same setSettlementFunder call from their own wallet; the second one restarts the lane with the funder, cap and period it had.',
            [call],
          ),
        };
      },
      outbox: true,
    },
  };
}
