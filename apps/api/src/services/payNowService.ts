import { ethers } from 'ethers';
import { getContractAddress } from '../config/contracts.js';
import { merchantDb } from '../config/merchantDb.js';
import { chainProvider } from './chain/provider.js';
import { chainId } from './chargeService.js';
import { chargeStore, type ChargeRow } from './chargeStore.js';
import { notificationStore } from './notificationStore.js';
import { usdcAddressFor } from './savingsGaslessService.js';

/*
 * Paying a shop now, from the member's own Clear cash.
 *
 * The other way to answer a charge. Approving opens a plan, which the operator signs; paying now
 * moves the member's own USDC, so the member's wallet signs it and the server never holds the money:
 *
 *   start    the charge is held (`resolving`, so the shop cannot cancel it and a plan cannot open on
 *            it) and quoted: the shop's share at its paid-now rate, and Clear's fee
 *   pay      the member's app sends both transfers in one sponsored batch, from their wallet
 *   confirm  the server reads the transaction's own Transfer events and only then marks it paid
 *
 * The member pays the sticker price. The shop pays Clear its tier's paid-now rate, which comes out
 * of the same payment: two transfers, shop's share and fee, adding up to the amount.
 *
 * Nothing the app reports is taken on its word. A transaction counts when, on chain, it moved at
 * least the quoted amounts of USDC from this member to this shop and to Clear, after the hold began,
 * and no other charge has claimed it.
 *
 * A hold nobody finishes lapses. Before it is let go, the chain is searched for the payment (the
 * app may have closed between paying and saying so): a hold is released only when the money did not
 * move, because releasing a paid charge would let the shop cancel it or the member pay twice.
 */

/** How long a member has to pay once they press Pay now. Longer than any Face ID prompt. */
export const PAY_NOW_HOLD_SECONDS = Number(process.env.PAY_NOW_HOLD_SECONDS || 15 * 60);

/** The standard tier's paid-now rate, for a shop with no profile to read one from. */
const FALLBACK_PAID_NOW_BPS = 150;

const TERM_ISSUER_FEES = [
  'function feeRecipient() view returns (address)',
  'function carryTreasury() view returns (address)',
];
const TRANSFER = ethers.id('Transfer(address,address,uint256)');
const UNITS_PER_CENT = 10_000n;

/** What the member's app sends: USDC, in token units (6dp), to two places. */
export interface PayNowInstructions {
  chainId: number;
  token: string;
  shop: { to: string; units: string };
  /** Zero units on a charge too small to carry a fee: the app then sends one transfer. */
  fee: { to: string; units: string };
  until: string;
}

export interface PayNowResult {
  ok: boolean;
  charge?: ChargeRow;
  pay?: PayNowInstructions;
  /** The transaction is out but not yet confirmed; the charge stays held until it is. */
  pending?: boolean;
  reason?: string;
}

/** The shop's paid-now rate, from its Clear tier. */
async function paidNowBps(merchant: string): Promise<number> {
  const db = await merchantDb();
  if (!db) return FALLBACK_PAID_NOW_BPS;
  const { rows } = await db.query<{ paid_now_bps: number }>(
    `SELECT t.paid_now_bps FROM merchant.profiles p JOIN merchant.clear_tiers t ON t.tier = p.clear_tier
      WHERE lower(p.merchant) = $1`,
    [merchant.toLowerCase()],
  );
  if (rows[0]) return Number(rows[0].paid_now_bps);
  const { rows: std } = await db.query<{ paid_now_bps: number }>(`SELECT paid_now_bps FROM merchant.clear_tiers WHERE tier = 'standard'`);
  return std[0] ? Number(std[0].paid_now_bps) : FALLBACK_PAID_NOW_BPS;
}

/** Where Clear's fee goes: the term issuer's fee recipient, else its carry treasury, as the contract does. */
async function feeRecipient(): Promise<string | null> {
  const address = getContractAddress(chainId(), 'TermIssuer');
  if (!address) return null;
  const issuer = new ethers.Contract(address, TERM_ISSUER_FEES, chainProvider(chainId()));
  const named = String(await issuer.feeRecipient()).toLowerCase();
  if (named !== ethers.ZeroAddress) return named;
  const treasury = String(await issuer.carryTreasury()).toLowerCase();
  return treasury !== ethers.ZeroAddress ? treasury : null;
}

/** Floored like the raise path's discount: rounding goes to the shop, not to Clear. */
export function quotePaidNow(amountCents: number, bps: number): { payoutCents: number; feeCents: number } {
  const feeCents = Math.floor((amountCents * bps) / 10_000);
  return { payoutCents: amountCents - feeCents, feeCents };
}

function instructions(charge: ChargeRow): PayNowInstructions {
  const hold = charge.payNow!;
  return {
    chainId: charge.chainId,
    token: usdcAddressFor(charge.chainId),
    shop: { to: charge.merchantAddress, units: String(BigInt(hold.payoutCents) * UNITS_PER_CENT) },
    fee: { to: hold.feeTo, units: String(BigInt(hold.feeCents) * UNITS_PER_CENT) },
    until: hold.until,
  };
}

const mine = (charge: ChargeRow, member: string) => charge.memberWallet === member.trim().toLowerCase();

/** Hold the charge and say what to send. Pressing Pay now again on a held charge returns the same hold. */
export async function startPayNow(code: string, member: string): Promise<PayNowResult> {
  const existing = await chargeStore.get(code);
  if (!existing) return { ok: false, reason: 'no such charge' };
  if (!mine(existing, member)) return { ok: false, reason: 'not your charge' };
  if (existing.status === 'resolving' && existing.payNow && !existing.txHash && Date.parse(existing.payNow.until) > Date.now()) {
    return { ok: true, charge: existing, pay: instructions(existing) };
  }
  if (existing.status !== 'pending') return { ok: false, reason: `charge is ${existing.status}` };
  if (!usdcAddressFor(existing.chainId)) return { ok: false, reason: 'Paying now is not available on this network.' };

  let feeTo: string | null;
  let bps: number;
  try {
    [feeTo, bps] = await Promise.all([feeRecipient(), paidNowBps(existing.merchantAddress)]);
  } catch (error) {
    console.error('[pay-now] quote failed for', code, error instanceof Error ? error.message : error);
    return { ok: false, reason: 'We could not get this ready. Nothing was charged — try again in a moment.' };
  }
  if (!feeTo) return { ok: false, reason: 'Paying now is not available on this network.' };

  const held = await chargeStore.holdForPayNow(code, member, { ...quotePaidNow(existing.amountCents, bps), feeTo, holdSeconds: PAY_NOW_HOLD_SECONDS });
  if (!held) return { ok: false, reason: 'This charge is no longer open. Ask the shop to send a new one.' };
  return { ok: true, charge: held, pay: instructions(held) };
}

/** The member went back to choosing. Only before anything was sent. */
export async function releasePayNowFor(code: string, member: string): Promise<PayNowResult> {
  const existing = await chargeStore.get(code);
  if (!existing) return { ok: false, reason: 'no such charge' };
  if (!mine(existing, member)) return { ok: false, reason: 'not your charge' };
  if (existing.status === 'pending') return { ok: true, charge: existing };
  const released = await chargeStore.releasePayNow(code);
  if (!released) return { ok: false, reason: 'A payment is already on its way for this charge.' };
  return { ok: true, charge: released };
}

/**
 * Whether this receipt is the payment for this charge: at least the quoted USDC from the member to
 * the shop and to Clear, in a transaction mined after the hold began.
 */
export async function receiptPays(charge: ChargeRow, receipt: ethers.TransactionReceipt, blockTime?: number): Promise<boolean> {
  const hold = charge.payNow;
  if (!hold || !charge.memberWallet || receipt.status !== 1) return false;
  const time = blockTime ?? (await receipt.getBlock()).timestamp;
  // A minute's grace for a node's clock; a payment older than that was for something else.
  if (time * 1000 < Date.parse(hold.since) - 60_000) return false;

  const token = usdcAddressFor(charge.chainId).toLowerCase();
  const from = ethers.zeroPadValue(charge.memberWallet, 32).toLowerCase();
  const sent = (to: string) =>
    receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === token &&
          log.topics[0] === TRANSFER &&
          log.topics[1]?.toLowerCase() === from &&
          log.topics[2]?.toLowerCase() === ethers.zeroPadValue(to, 32).toLowerCase(),
      )
      .reduce((total, log) => total + BigInt(log.data), 0n);

  const shopUnits = BigInt(hold.payoutCents) * UNITS_PER_CENT;
  const feeUnits = BigInt(hold.feeCents) * UNITS_PER_CENT;
  if (hold.feeTo === charge.merchantAddress) return sent(charge.merchantAddress) >= shopUnits + feeUnits;
  return sent(charge.merchantAddress) >= shopUnits && sent(hold.feeTo) >= feeUnits;
}

async function paid(charge: ChargeRow, txHash: string): Promise<ChargeRow | null> {
  const done = await chargeStore.finishPaidNow(charge.code, txHash);
  if (done?.memberWallet)
    await notificationStore
      .emit({
        wallet: done.memberWallet,
        kind: 'sent',
        title: `Paid ${done.merchantName}`,
        body: (done.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
        data: { chargeCode: done.code, txHash },
        dedupeKey: `charge-paid:${done.code}`,
      })
      .catch(() => {});
  return done;
}

/**
 * The member's app sent the payment: check it on chain, then mark the charge paid.
 *
 * The hash is written before it is checked, so a hold with a payment on its way is never let go by
 * the member backing out or by the hold lapsing: the reconciliation asks the chain about it instead.
 */
export async function confirmPayNow(code: string, member: string, txHash: string): Promise<PayNowResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, reason: 'That is not a transaction.' };
  const hash = txHash.toLowerCase();
  const existing = await chargeStore.get(code);
  if (!existing) return { ok: false, reason: 'no such charge' };
  if (!mine(existing, member)) return { ok: false, reason: 'not your charge' };
  // Asked twice (a retry after a dropped reply): the same answer.
  if (existing.status === 'approved' && existing.paidNow && existing.txHash === hash) return { ok: true, charge: existing };
  if (existing.status !== 'resolving' || !existing.payNow) return { ok: false, reason: `charge is ${existing.status}` };
  if (existing.txHash && existing.txHash !== hash) return { ok: false, reason: 'A different payment is already being checked for this charge.' };

  await chargeStore.markSubmitted(code, hash);
  const rpc = chainProvider(existing.chainId);
  let receipt: ethers.TransactionReceipt | null;
  try {
    receipt = await rpc.waitForTransaction(hash, 1, 30_000);
  } catch {
    receipt = null;
  }
  if (!receipt) return { ok: false, pending: true, charge: existing, reason: 'Your payment is on its way. We’ll mark it paid as soon as it lands.' };

  const held = { ...existing, txHash: hash };
  if (!(await receiptPays(held, receipt))) {
    // Not this payment. Forgotten, so the hold can run out (and be searched for) as if never reported.
    await chargeStore.forgetPayNowTx(code, hash);
    return {
      ok: false,
      reason: receipt.status === 1 ? 'That payment doesn’t match this charge.' : 'Your payment didn’t go through. Nothing was taken.',
    };
  }
  const done = await paid(held, hash);
  if (!done) return { ok: false, reason: 'That payment has already been counted for another charge.' };
  return { ok: true, charge: done };
}

/**
 * The payment, looked for on chain: a USDC transfer from the member to the shop since the hold
 * began, in a transaction that also pays Clear. For a hold whose app never reported back.
 */
async function findPayment(charge: ChargeRow): Promise<string | null> {
  const hold = charge.payNow;
  if (!hold || !charge.memberWallet) return null;
  const rpc = chainProvider(charge.chainId);
  const latest = await rpc.getBlock('latest');
  if (!latest) return null;
  // Base makes a block every two seconds. A margin either side, and never more than a day back.
  const seconds = Math.max(0, latest.timestamp - Math.floor(Date.parse(hold.since) / 1000));
  const back = Math.min(Math.ceil(seconds / 2) + 150, 43_200);
  const token = usdcAddressFor(charge.chainId);
  const topics = [TRANSFER, ethers.zeroPadValue(charge.memberWallet, 32), ethers.zeroPadValue(charge.merchantAddress, 32)];
  const STEP = 2_000;
  for (let to = latest.number; to > latest.number - back; to -= STEP) {
    const fromBlock = Math.max(latest.number - back, to - STEP + 1, 0);
    const logs = await rpc.getLogs({ address: token, topics, fromBlock, toBlock: to });
    for (const log of logs) {
      const receipt = await rpc.getTransactionReceipt(log.transactionHash);
      if (receipt && (await receiptPays(charge, receipt))) return log.transactionHash.toLowerCase();
    }
  }
  return null;
}

export interface PayNowReconcileSummary {
  checked: number;
  paid: number;
  released: number;
  stillPending: number;
  unknown: number;
}

/**
 * Pay-now holds left open, settled from the chain.
 *
 *   a transaction reported   mined and pays: paid. Mined and doesn't, or gone from the node:
 *                            forgotten, and the hold runs out as below. In the mempool: left.
 *   none, and lapsed         the payment is searched for. Found: paid. Not found: released, and
 *                            the charge is answerable again.
 *
 * An unreadable chain is never an answer: the hold is left for the next pass.
 */
export async function reconcilePayNow(): Promise<PayNowReconcileSummary> {
  const summary: PayNowReconcileSummary = { checked: 0, paid: 0, released: 0, stillPending: 0, unknown: 0 };
  for (const charge of await chargeStore.listPayNowStuck()) {
    summary.checked += 1;
    try {
      const rpc = chainProvider(charge.chainId);
      if (charge.txHash) {
        const receipt = await rpc.getTransactionReceipt(charge.txHash);
        if (!receipt) {
          if (await rpc.getTransaction(charge.txHash)) summary.stillPending += 1;
          else await chargeStore.forgetPayNowTx(charge.code, charge.txHash);
          continue;
        }
        if (await receiptPays(charge, receipt)) {
          if (await paid(charge, charge.txHash)) summary.paid += 1;
          continue;
        }
        await chargeStore.forgetPayNowTx(charge.code, charge.txHash);
        if (Date.parse(charge.payNow!.until) > Date.now()) continue;
      }
      const found = await findPayment(charge);
      if (found) {
        if (await paid(charge, found)) summary.paid += 1;
        else summary.unknown += 1;
        continue;
      }
      if (await chargeStore.releasePayNow(charge.code, { onlyIfLapsed: true })) summary.released += 1;
    } catch (error) {
      console.error('[pay-now] reconcile failed for', charge.code, error instanceof Error ? error.message : error);
      summary.unknown += 1;
    }
  }
  return summary;
}
