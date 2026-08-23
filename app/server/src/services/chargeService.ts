import { ethers } from 'ethers';
import { getContractAddress } from '../config/contracts.js';
import { savingsIntentService } from './savingsIntentService.js';
import { chargeStore, type ChargeRow } from './chargeStore.js';
import { notificationStore } from './notificationStore.js';
import { sendNotificationService } from './sendNotificationService.js';
import { memberStore } from './memberStore.js';

/*
 * Raising a charge, and a member answering it.
 *
 * The split is chosen on the member's phone and nowhere else -- a service writer must not be
 * picking somebody's repayment terms -- so a merchant's request carries an amount and a member and
 * nothing about how it will be repaid. `installments` only ever arrives on the approve call, from
 * the member's own session.
 *
 * ## How a merchant proves who it is
 *
 * There is no merchant account system, and inventing one would mean inventing the credential
 * store, the rotation and the recovery that go with it. There is already an on-chain
 * `MerchantRegistry` keyed by address, with an active flag and a per-charge approval cap, so a
 * merchant authenticates the way every other actor in this system does: it signs. The server
 * recovers the address from an EIP-712 signature and asks the registry whether that address is a
 * merchant in good standing.
 *
 * That gives the cap and the discount for free, and both are enforced here rather than trusted:
 * the amount is checked against `approvalCapOf`, and the payout is computed from `discountBpsOf`
 * rather than from anything the merchant sent.
 */

const MERCHANT_ABI = [
  'function isActive(address merchant) view returns (bool)',
  'function isRegistered(address merchant) view returns (bool)',
  'function approvalCapOf(address merchant) view returns (uint256)',
  'function discountBpsOf(address merchant) view returns (uint256)',
];

const TERM_ISSUER_ABI = [
  'function openPlan(address member, address merchant, uint256 purchase, uint256 payout, uint256 ratePerCycle, uint64 cycleLength, uint32 installments, uint64 installmentLength) returns (uint256)',
  'function isOfferedSplit(uint32 installments) pure returns (bool)',
  'function termLimitOf(address) view returns (uint256)',
  'function totalPrincipalOf(address member) view returns (uint256)',
  'event PlanOpened(uint256 indexed planId, address indexed member, uint256 purchase, uint256 ratePerCycle, uint32 installments)',
];

const ISSUER_ABI = ['function cycleLength() view returns (uint64)'];

/** A charge is answerable for a day. The reference says so on the screen, so it is not a knob. */
export const CHARGE_TTL_SECONDS = 24 * 60 * 60;

/** 2% a cycle on what is still owed — the figure the approval screen quotes. */
const DEFAULT_RATE_BPS = 200;

export function chainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(chainId()));
}

/**
 * The typed data a merchant signs to raise a charge.
 *
 * `nonce` and `issuedAt` are in the payload because without them a captured signature is a
 * reusable licence to charge the same member the same amount forever. The server checks the age
 * and the registry checks the cap; together that bounds what a leaked signature can do to one
 * charge inside a short window, against one member, under a cap the co-op set.
 */
export function chargeTypedData(input: {
  merchant: string;
  member: string;
  amountCents: number;
  nonce: string;
  issuedAt: number;
}) {
  return {
    domain: {
      name: 'Clear Charge',
      version: '1',
      chainId: chainId(),
      verifyingContract: getContractAddress(chainId(), 'MerchantRegistry') || ethers.ZeroAddress,
    },
    types: {
      Charge: [
        { name: 'merchant', type: 'address' },
        { name: 'member', type: 'address' },
        { name: 'amountCents', type: 'uint256' },
        { name: 'nonce', type: 'string' },
        { name: 'issuedAt', type: 'uint256' },
      ],
    },
    message: {
      merchant: input.merchant,
      member: input.member,
      amountCents: input.amountCents,
      nonce: input.nonce,
      issuedAt: input.issuedAt,
    },
  };
}

/** A signature older than this is refused however valid it is. */
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

export interface RaiseResult {
  ok: boolean;
  charge?: ChargeRow;
  reason?: string;
}

export async function raiseCharge(input: {
  merchant: string;
  merchantName: string;
  member: string;
  amountCents: number;
  nonce: string;
  issuedAt: number;
  signature: string;
}): Promise<RaiseResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: 'amount must be a positive whole number of cents' };
  }

  const age = Math.floor(Date.now() / 1000) - input.issuedAt;
  if (!Number.isFinite(age) || age > SIGNATURE_MAX_AGE_SECONDS || age < -60) {
    return { ok: false, reason: 'signature is stale' };
  }

  const typed = chargeTypedData(input);
  let recovered: string;
  try {
    recovered = ethers.verifyTypedData(typed.domain, typed.types, typed.message, input.signature);
  } catch {
    return { ok: false, reason: 'signature could not be verified' };
  }
  // The signer *is* the merchant. Taking the address from the body and the signature separately
  // would let anyone raise a charge in somebody else's name by signing it with their own key.
  if (recovered.toLowerCase() !== input.merchant.trim().toLowerCase()) {
    return { ok: false, reason: 'signature does not match the merchant' };
  }

  const registryAddress = getContractAddress(chainId(), 'MerchantRegistry');
  if (!registryAddress) return { ok: false, reason: 'no merchant registry on this chain' };

  let payoutCents: number;
  try {
    const registry = new ethers.Contract(registryAddress, MERCHANT_ABI, provider());
    const [active, capRaw, discountBps] = await Promise.all([
      registry.isActive(recovered) as Promise<boolean>,
      registry.approvalCapOf(recovered) as Promise<bigint>,
      registry.discountBpsOf(recovered) as Promise<bigint>,
    ]);
    if (!active) return { ok: false, reason: 'merchant is not active' };

    // The cap is in token units (6dp); the charge is in cents. Compare in cents.
    const capCents = Number(capRaw / 10_000n);
    if (capCents > 0 && input.amountCents > capCents) {
      return { ok: false, reason: 'amount is over this merchant’s approval cap' };
    }

    // Computed from the registry, never from the request. A merchant that could name its own
    // payout could name the whole purchase and leave the co-op nothing.
    payoutCents = input.amountCents - Math.floor((input.amountCents * Number(discountBps)) / 10_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[charge] registry read failed', message);
    // A failed read is not a pass. Raising a charge on an unreadable registry would mean charging
    // on behalf of a merchant nobody could confirm is still one.
    return { ok: false, reason: 'could not confirm the merchant right now' };
  }

  const charge = await chargeStore.create({
    merchantAddress: recovered,
    merchantName: input.merchantName.trim().slice(0, 80) || 'A Clear partner',
    memberWallet: input.member,
    amountCents: input.amountCents,
    payoutCents,
    chainId: chainId(),
    ttlSeconds: CHARGE_TTL_SECONDS,
  });
  if (!charge) return { ok: false, reason: 'could not record the charge' };

  await notifyMember(charge);
  return { ok: true, charge };
}

/**
 * The alert, in the reference's own words.
 *
 * "You have not been charged yet" is the whole message — it is what makes the other two sentences
 * safe to read on a lock screen, and it is why the body is not summarised or shortened here.
 */
export async function notifyMember(charge: ChargeRow): Promise<void> {
  const amount = (charge.amountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  const base = (process.env.APP_PUBLIC_URL || 'https://app.useclear.org').replace(/\/+$/, '');

  const approveUrl = `${base}/c/${charge.code}`;

  // In-app and Web Push together, deduped on the code so a retried raise cannot alert twice.
  await notificationStore.emit({
    wallet: charge.memberWallet,
    kind: 'request',
    title: `${charge.merchantName} is charging ${amount}`,
    body: 'Approve or decline. You have not been charged yet.',
    data: { chargeCode: charge.code, url: approveUrl, amountCents: charge.amountCents },
    dedupeKey: `charge:${charge.code}`,
  });

  // Then the text, which the reference treats as the primary channel — a member standing at a
  // counter has not necessarily opened the app since they installed it. Null means they opted out
  // of notifications, which is a decision to respect rather than a lookup that failed.
  try {
    const contact = await memberStore.getContactByWallet(charge.memberWallet);
    if (!contact) return;
    const destination = contact.phone ?? contact.email;
    if (!destination) return;
    await sendNotificationService.sendChargeAlert({
      recipientType: contact.phone ? 'phone' : 'email',
      recipientContact: destination,
      merchantName: charge.merchantName,
      amount,
      approveUrl,
    });
  } catch (error) {
    // Never fatal to raising a charge. The member already has it in-app and on their lock screen,
    // and failing the merchant's request because Twilio was down would be the wrong trade.
    console.error('[charge] contact alert failed', error instanceof Error ? error.message : error);
  }
}

export interface ResolveResult {
  ok: boolean;
  charge?: ChargeRow;
  reason?: string;
}

export async function declineCharge(code: string, member: string): Promise<ResolveResult> {
  const existing = await chargeStore.get(code);
  if (!existing) return { ok: false, reason: 'no such charge' };
  if (existing.memberWallet !== member.trim().toLowerCase()) {
    return { ok: false, reason: 'not your charge' };
  }
  const claimed = await chargeStore.claimForResolution(code);
  if (!claimed) return { ok: false, reason: `charge is ${existing.status}` };
  const done = await chargeStore.finish(code, { status: 'declined' });
  return { ok: true, charge: done ?? undefined };
}

/**
 * Approve: open the term plan, then record it.
 *
 * In that order, and the order is the point. The chain is what a member actually owes; this table
 * only describes it. Writing `approved` first and opening the plan second would leave a charge
 * that says it was approved and a member who owes nothing — or, on a retry, two plans.
 */
export async function approveCharge(
  code: string,
  member: string,
  installments: number,
): Promise<ResolveResult> {
  const existing = await chargeStore.get(code);
  if (!existing) return { ok: false, reason: 'no such charge' };
  if (existing.memberWallet !== member.trim().toLowerCase()) {
    return { ok: false, reason: 'not your charge' };
  }

  const termIssuerAddress = getContractAddress(chainId(), 'TermIssuer');
  const revolvingAddress = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!termIssuerAddress) return { ok: false, reason: 'no term issuer on this chain' };

  const key = operatorKey();
  if (!key) return { ok: false, reason: 'no credit operator configured' };

  const claimed = await chargeStore.claimForResolution(code);
  if (!claimed) return { ok: false, reason: `charge is ${existing.status}` };

  // Whether a transaction ever left this process. Everything about failure handling below turns
  // on it: before it is set, nothing can have happened on chain and the charge is safe to hand
  // back; after, it may have landed and handing it back could open a second plan for the same
  // purchase. Not the same question as whether the call threw.
  let submitted = false;

  try {
    const signer = new ethers.Wallet(key, provider());
    const issuer = new ethers.Contract(termIssuerAddress, TERM_ISSUER_ABI, signer);

    // Asked rather than assumed: the offered splits are a contract rule, and a UI listing one the
    // chain does not take would fail at the last possible moment.
    if (!(await issuer.isOfferedSplit(installments))) {
      await chargeStore.release(code);
      return { ok: false, reason: 'that split is not offered' };
    }

    // One clock. The cycle comes from the revolving issuer, which is what a member's own cycle is
    // measured against — a plan on its own schedule would come due on a day nothing else does.
    let cycle = 30n * 24n * 60n * 60n;
    if (revolvingAddress) {
      try {
        cycle = await new ethers.Contract(revolvingAddress, ISSUER_ABI, provider()).cycleLength();
      } catch {
        /* fall back to the network default above */
      }
    }

    // Contract amounts are 6dp; the table is in cents.
    const purchase = BigInt(claimed.amountCents) * 10_000n;
    const payout = BigInt(claimed.payoutCents) * 10_000n;

    const tx = await issuer.openPlan(
      claimed.memberWallet,
      claimed.merchantAddress,
      purchase,
      payout,
      BigInt(DEFAULT_RATE_BPS),
      cycle,
      installments,
      cycle,
    );
    submitted = true;
    // Persisted before the wait, not after. If this process dies in the next few seconds, the hash
    // is the difference between a charge that reconciles itself and one that needs a person.
    await chargeStore.markSubmitted(code, tx.hash);
    const receipt = await tx.wait();

    let planId: number | undefined;
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = issuer.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'PlanOpened') planId = Number(parsed.args.planId);
      } catch {
        /* not our event */
      }
    }

    const done = await chargeStore.finish(code, {
      status: 'approved',
      splitInto: installments,
      planId,
      txHash: receipt?.hash ?? tx.hash,
    });
    return { ok: true, charge: done ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[charge] openPlan failed for', code, message);

    if (!submitted) {
      // The transaction never left, so nothing was opened and the charge is answerable again.
      await chargeStore.release(code);
      return { ok: false, reason: message };
    }

    // It did leave, and we do not know whether it landed -- a dropped connection while waiting
    // for a receipt looks exactly like a revert from here. The charge stays `resolving` on
    // purpose. Somebody has to look, and that is the right cost: releasing it would let the same
    // purchase be approved a second time, and a member owing twice for one repair is worse than
    // a charge that needs a human.
    console.error('[charge] submitted but unconfirmed — left resolving for reconciliation:', code);
    return { ok: false, reason: 'We could not confirm this went through. Give us a moment before trying again.' };
  }
}

/**
 * Charges left mid-flight, resolved against the chain.
 *
 * A charge goes `resolving` the moment it is claimed and stays there until the receipt comes back.
 * If the process dies in that window — or the RPC connection drops, which from here looks exactly
 * like a revert — nobody can say whether the plan was opened. Approving again could open a second
 * plan for one repair; releasing it could do the same. So it waits, and this is what ends the wait.
 *
 * It asks one exact question rather than guessing: the transaction hash was written before the
 * wait began, so there is a specific transaction to look up. Three answers and each is definite:
 *
 * - **mined and succeeded** → the plan exists; record it and mark the charge approved
 * - **mined and reverted** → nothing was opened; hand the charge back so it can be answered again
 * - **gone from the node entirely** → dropped without mining; hand it back
 *
 * A transaction still sitting in the mempool is left alone. That is the case a time-based rule
 * would get wrong: an underpriced transaction can sit for a long while and then land, and a sweep
 * that released the charge because "ten minutes is surely enough" would be the thing that opened
 * the second plan.
 *
 * Safe to run concurrently and safe to run twice. `finish` only closes a row that is still
 * `resolving`, so a second runner arriving behind the first does nothing.
 */
export interface ReconcileSummary {
  checked: number;
  approved: number;
  released: number;
  stillPending: number;
  unknown: number;
}

export async function reconcileCharges(olderThanSeconds = 120): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, approved: 0, released: 0, stillPending: 0, unknown: 0 };

  const stuck = await chargeStore.listStuck(olderThanSeconds);
  if (stuck.length === 0) return summary;

  const termIssuerAddress = getContractAddress(chainId(), 'TermIssuer');
  const rpc = provider();
  const iface = new ethers.Interface(TERM_ISSUER_ABI);

  for (const charge of stuck) {
    summary.checked += 1;

    // Claimed but never submitted — the process died between the two. Nothing can have happened
    // on chain, so this one is simply answerable again.
    if (!charge.txHash) {
      await chargeStore.release(charge.code);
      summary.released += 1;
      continue;
    }

    try {
      const receipt = await rpc.getTransactionReceipt(charge.txHash);

      if (!receipt) {
        // No receipt yet. Still in the mempool is a different thing from dropped, and only the
        // second is safe to act on.
        const tx = await rpc.getTransaction(charge.txHash);
        if (tx) {
          summary.stillPending += 1;
        } else {
          await chargeStore.release(charge.code);
          summary.released += 1;
        }
        continue;
      }

      if (receipt.status === 0) {
        await chargeStore.release(charge.code);
        summary.released += 1;
        continue;
      }

      let planId: number | undefined;
      for (const log of receipt.logs) {
        if (termIssuerAddress && log.address.toLowerCase() !== termIssuerAddress.toLowerCase()) continue;
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === 'PlanOpened') planId = Number(parsed.args.planId);
        } catch {
          /* not our event */
        }
      }

      // A successful receipt with no PlanOpened in it should not happen, and is not something to
      // paper over with a release: the transaction succeeded, so releasing could open a second
      // plan. Left alone and counted, so it shows up rather than being decided wrongly.
      if (planId === undefined) {
        console.error('[charge] mined without PlanOpened — leaving for review:', charge.code, charge.txHash);
        summary.unknown += 1;
        continue;
      }

      await chargeStore.finish(charge.code, {
        status: 'approved',
        splitInto: charge.splitInto ?? undefined,
        planId,
        txHash: charge.txHash,
      });
      summary.approved += 1;

      // The member pressed Approve and never saw it land. Tell them it did.
      await notificationStore
        .emit({
          wallet: charge.memberWallet,
          kind: 'credit',
          title: 'Your plan is open',
          body: `${charge.merchantName} · ${(charge.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
          data: { chargeCode: charge.code, planId },
          dedupeKey: `charge-approved:${charge.code}`,
        })
        .catch(() => {});
    } catch (error) {
      // An unreadable chain is not an answer. Left as it is for the next run.
      console.error('[charge] reconcile failed for', charge.code, error instanceof Error ? error.message : error);
      summary.unknown += 1;
    }
  }

  return summary;
}
