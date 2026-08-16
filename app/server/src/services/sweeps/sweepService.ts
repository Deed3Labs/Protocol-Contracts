import { sweepStore, type Sweep } from './sweepStore.js';
import { ensureRailAccount, pushToBridge } from './bridgeRail.js';
import { bridgeCustomerStore } from '../bridgeCustomerStore.js';
import { readChainCollateral } from '../chain/collateralReader.js';
import { refreshSnapshotsFor } from '../lithic/snapshotService.js';

/*
 * The savings sweep — spec step 7, over the Bridge rail.
 *
 * One member action, two rails that cannot be made atomic:
 *
 *   fiat_debited       ACH push out of their Lithic cash account toward their Bridge account
 *   ready_to_allocate  Bridge converted the fiat and delivered USDC to their smart wallet
 *   clrusd_minted      the member moved it into the ESA and CLRUSD was minted
 *
 * There is no treasury here, deliberately. Bridge already converts USD to USDC and delivers it to
 * the member's own wallet, so holding a float to do it ourselves would buy speed at the price of
 * holding member dollars while owing them tokens. The money never touches a co-op balance sheet:
 * their Lithic account, their Bridge account, their smart wallet.
 *
 * The middle state is a WAIT, not a step. Nothing here retries it, because ACH takes days and a
 * "retry" would push the money a second time. The Bridge webhook advances it when the USDC lands.
 *
 * And the state after it is a wait on a person. USDC in the member's wallet is spendable-adjacent
 * money in their own custody, showing in their cash account as unspendable; whether it becomes
 * CLRUSD, goes into an Earn product, or stays put is theirs to decide.
 */

export interface SweepStepResult {
  sweep: Sweep | null;
  advanced: boolean;
  error?: string;
}

/**
 * Start a sweep.
 *
 * Takes the caller's own id for the intent, so a double-tap, a retried request and a scheduled rule
 * that fires twice all describe the same sweep rather than three debits.
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
 * Push the fiat out of Lithic toward the member's Bridge account.
 *
 * The only step that moves money on our instruction, and the only one where a duplicate takes real
 * money from a real member — hence the sweep id as the idempotency token, and the check for a
 * payment token already recorded before anything is sent.
 */
async function debitFiat(sweep: Sweep): Promise<SweepStepResult> {
  if (sweep.fiatTransferToken) {
    // Already pushed on a previous attempt; the crash was after the debit, not before it.
    return { sweep: await sweepStore.advance(sweep.id, 'fiat_debited'), advanced: true };
  }

  const customerId = await bridgeCustomerStore.customerFor(sweep.wallet);
  if (!customerId) {
    return { sweep, advanced: false, error: 'member has no Bridge customer' };
  }

  const rail = await ensureRailAccount({
    wallet: sweep.wallet,
    customerId,
    walletAddress: sweep.wallet,
  });
  if ('error' in rail) return { sweep, advanced: false, error: rail.error };

  const payment = await pushToBridge({
    wallet: sweep.wallet,
    externalBankAccountToken: rail.token,
    amountCents: sweep.amountCents,
    idempotencyToken: sweep.id,
    memo: 'Clear savings',
  });

  return {
    sweep: await sweepStore.advance(sweep.id, 'fiat_debited', {
      fiatTransferToken: payment.paymentToken,
    }),
    advanced: true,
  };
}

/**
 * Bridge delivered the USDC. Called by the webhook, never by a runner.
 *
 * This is where the sweep comes to rest. The member now holds the money on their smart wallet, it
 * shows in their cash account as unspendable, and nothing further happens without them.
 */
export async function markUsdcArrived(
  sweepId: string,
  usdcTxHash?: string,
): Promise<Sweep | null> {
  const sweep = await sweepStore.advance(sweepId, 'ready_to_allocate', { usdcTxHash });

  // Their fiat balance went down when the push left. The card's view of what they can spend has to
  // agree with that, or the waterfall will keep offering money that is no longer there.
  if (sweep) {
    try {
      await refreshSnapshotsFor(sweep.wallet);
    } catch (error) {
      console.error(`[sweep] snapshot refresh failed after arrival ${sweepId}:`, error);
    }
  }
  return sweep;
}

/**
 * Mint CLRUSD in the ESA and start the vesting clock — the member's choice, acted on.
 *
 * `mintedAt` is stamped here and nowhere else. The spec is explicit that vesting begins at the mint
 * rather than at the fiat debit, and the gap between them is real: a member who left USDC in their
 * cash account for a week must not be credited a week of vesting they did not have.
 *
 * Refuses rather than pretends, pending the ESA deposit call. A sweep reporting a mint that never
 * happened would put CLRUSD in our records with nothing behind it.
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
 * The member has chosen to put their USDC into the ESA.
 *
 * The only way out of `ready_to_allocate` toward CLRUSD, and it is always a member action. Moving
 * the same USDC into an Earn product instead is a different destination on the same money and does
 * not run through here.
 */
export async function allocateToSavings(id: string): Promise<SweepStepResult> {
  const sweep = await sweepStore.get(id);
  if (!sweep) return { sweep: null, advanced: false, error: 'unknown sweep' };
  if (sweep.state !== 'ready_to_allocate') {
    return { sweep, advanced: false, error: `sweep is ${sweep.state}, not ready to allocate` };
  }

  const result = await mintClrusd(sweep);
  if (!result.advanced && result.error) {
    return { ...result, sweep: await sweepStore.fail(id, result.error) };
  }
  return result;
}

export const sweepService = {
  beginSweep,
  advanceSweep,
  markUsdcArrived,
  allocateToSavings,
};
