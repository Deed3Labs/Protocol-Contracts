import { getLithic } from '../lithic/lithicClient.js';
import { lithicStore } from '../lithic/lithicStore.js';
import { sweepStore, type Sweep } from './sweepStore.js';
import { readChainCollateral } from '../chain/collateralReader.js';
import { refreshSnapshotsFor } from '../lithic/snapshotService.js';

/*
 * The savings sweep — spec step 7.
 *
 * One member action, two rails that cannot be made atomic:
 *
 *   fiat_debited    their Lithic cash → the co-op's operating account (a book transfer)
 *   usdc_sent       the co-op's treasury → their smart account (a chain transfer)
 *   clrusd_minted   the ESA takes the USDC and mints CLRUSD (a chain call)
 *
 * Each step is attempted only when the one before it is recorded as done, and each records its
 * evidence — a transfer token, a transaction hash — before the next begins. That ordering is the
 * whole design: a process that dies mid-sweep resumes by reading its own state rather than by
 * guessing, and a step already done is never done twice.
 *
 * The failure that matters is between `usdc_sent` and `clrusd_minted`. The member has their money,
 * on their own smart account, in a form the app didn't intend. That is not an incident to retry
 * into oblivion — it is READY TO ALLOCATE, a real state they can see and act on. Hiding it behind
 * an endless retry would mean money the member owns and cannot find.
 */

/** Cent amounts convert to USDC's six decimals. */
function centsToUsdcUnits(cents: number): bigint {
  return BigInt(Math.round(cents)) * 10_000n;
}

function operatingAccountToken(): string {
  return (process.env.LITHIC_OPERATING_FINANCIAL_ACCOUNT || '').trim();
}

export interface SweepStepResult {
  sweep: Sweep | null;
  advanced: boolean;
  error?: string;
}

/**
 * Start a sweep.
 *
 * Takes the member's own id for the intent so a double-tap, a retried request and a payday job that
 * fires twice all describe the same sweep rather than three debits.
 */
export async function beginSweep(input: {
  id: string;
  wallet: string;
  amountCents: number;
  batchKey?: string | null;
}): Promise<Sweep | null> {
  if (input.amountCents <= 0) throw new Error('sweep amount must be positive');
  return sweepStore.create(input);
}

/**
 * Move fiat from the member's Lithic account to the co-op's operating account.
 *
 * The transfer is created with the sweep's own id as the idempotency key, so a retry after a
 * timeout — the case where we genuinely do not know whether the debit landed — cannot produce a
 * second debit. This is the one step where a duplicate takes real money from a real member.
 */
async function debitFiat(sweep: Sweep): Promise<SweepStepResult> {
  if (sweep.fiatTransferToken) {
    // Already done on a previous attempt; the crash was after the debit, not before it.
    return { sweep: await sweepStore.advance(sweep.id, 'fiat_debited'), advanced: true };
  }

  const lithic = getLithic();
  const operating = operatingAccountToken();
  const record = await lithicStore.get(sweep.wallet);

  if (!lithic) return { sweep, advanced: false, error: 'lithic not configured' };
  if (!operating) return { sweep, advanced: false, error: 'no operating financial account' };
  if (!record?.cashFinancialAccountToken) {
    return { sweep, advanced: false, error: 'member has no cash account' };
  }

  // `token` is Lithic's idempotency key on this endpoint and becomes the transaction token, so a
  // retry after a timeout resolves to the same transfer rather than a second debit.
  const created = await lithic.bookTransfers.create({
    amount: Math.round(sweep.amountCents),
    category: 'TRANSFER',
    from_financial_account_token: record.cashFinancialAccountToken,
    to_financial_account_token: operating,
    subtype: (process.env.LITHIC_SWEEP_SUBTYPE || 'ACCOUNT_TO_ACCOUNT').trim(),
    type: 'TRANSFER',
    token: sweep.id,
    memo: 'Clear savings sweep',
  });

  return {
    sweep: await sweepStore.advance(sweep.id, 'fiat_debited', {
      fiatTransferToken: created.token ?? sweep.id,
    }),
    advanced: true,
  };
}

/**
 * Send USDC from the co-op treasury to the member's smart account.
 *
 * Deliberately a stub that refuses rather than a stub that pretends: the treasury signer is not
 * configured on this server yet, and a sweep that reported success without moving anything would
 * mint CLRUSD against money that never arrived. Refusing leaves the sweep retryable and the fiat
 * recoverable; pretending would break the 1:1 backing the whole product rests on.
 */
async function sendUsdc(sweep: Sweep): Promise<SweepStepResult> {
  if (sweep.usdcTxHash) {
    return { sweep: await sweepStore.advance(sweep.id, 'usdc_sent'), advanced: true };
  }

  const treasuryKey = (process.env.TREASURY_PRIVATE_KEY || '').trim();
  if (!treasuryKey) {
    return { sweep, advanced: false, error: 'treasury signer not configured' };
  }

  void centsToUsdcUnits(sweep.amountCents);
  return { sweep, advanced: false, error: 'treasury transfer not implemented' };
}

/**
 * Mint CLRUSD in the ESA and start the vesting clock.
 *
 * `mintedAt` is stamped here and nowhere else. The spec is explicit that vesting begins at the mint
 * rather than at the fiat debit, and the gap between them is real — a sweep that sat in
 * `ready_to_allocate` for two days must not credit the member two days of vesting they didn't have.
 */
async function mintClrusd(sweep: Sweep): Promise<SweepStepResult> {
  if (sweep.mintTxHash) {
    return { sweep: await sweepStore.advance(sweep.id, 'clrusd_minted'), advanced: true };
  }
  return { sweep, advanced: false, error: 'ESA mint not implemented' };
}

/** Close the sweep out and make the new collateral visible to the card. */
async function finalize(sweep: Sweep): Promise<SweepStepResult> {
  const chain = await readChainCollateral(sweep.wallet);
  const done = await sweepStore.advance(sweep.id, 'complete');

  // The member's savings-backed limit just grew. A snapshot that doesn't know it is the member
  // being declined for credit they have already funded.
  try {
    await refreshSnapshotsFor(sweep.wallet, {
      savingsCents: chain.savingsCents ?? undefined,
      poolPositionCents: chain.poolPositionCents ?? undefined,
    });
  } catch (error) {
    console.error(`[sweep] snapshot refresh failed after ${sweep.id}:`, error);
  }

  return { sweep: done, advanced: true };
}

const STEPS: Record<string, (sweep: Sweep) => Promise<SweepStepResult>> = {
  initiated: debitFiat,
  fiat_debited: sendUsdc,
  usdc_sent: mintClrusd,
  clrusd_minted: finalize,
};

/**
 * Advance one sweep by exactly one step.
 *
 * One step per call rather than a loop to completion: every transition is durable, so the runner
 * can be interrupted between any two of them without losing its place, and a step that fails backs
 * off without holding the others behind it.
 */
export async function advanceSweep(sweep: Sweep): Promise<SweepStepResult> {
  const step = STEPS[sweep.state];
  if (!step) return { sweep, advanced: false };

  try {
    const result = await step(sweep);
    if (!result.advanced && result.error) {
      return { ...result, sweep: await sweepStore.fail(sweep.id, result.error) };
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sweep: await sweepStore.fail(sweep.id, message), advanced: false, error: message };
  }
}

/**
 * Finish a sweep the member's own USDC is already funding — the recovery path out of
 * `ready_to_allocate`.
 *
 * Re-enters at the mint, never at the debit. The fiat leg is long done, and the money in question
 * is the USDC already sitting on their smart account.
 */
export async function retryAllocation(id: string): Promise<SweepStepResult> {
  const sweep = await sweepStore.get(id);
  if (!sweep) return { sweep: null, advanced: false, error: 'unknown sweep' };
  if (sweep.state !== 'ready_to_allocate') {
    return { sweep, advanced: false, error: `sweep is ${sweep.state}, not ready_to_allocate` };
  }
  const resumed = await sweepStore.advance(id, 'usdc_sent');
  return advanceSweep(resumed ?? sweep);
}

export const sweepService = { beginSweep, advanceSweep, retryAllocation };
