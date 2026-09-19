import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { recordOnchainRepayment } from '../deposits/depositReceiptService.js';
import { recordPoolMovements } from './poolFunding.js';
import { recordPlanPayments } from '../credit/termPlanPayments.js';

/*
 * A member repaid card debt on chain, in USDC. Verify it from the chain and record it.
 *
 * The member's wallet called `StableCredit.repayCreditBalance` itself, so the chain is already right:
 * the obligation burned and the issuers took their share. What is left is our books, and they are
 * written from the transaction's own events -- never from an amount the client reports:
 *
 *   CreditBalanceRepaid(member, amount)   emitted by StableCredit: the whole payment
 *   TierRepaid(member, tierId, amount)    emitted by RevolvingIssuer: what the card tiers absorbed
 *
 *   PlanPaid(planId, amount, …)            emitted by TermIssuer: what went to a term plan
 *
 * Only TierRepaid reaches the card books; a part that went to a term plan is not card debt. Plan
 * payments are remembered separately, for Activity -- a Pay on a plan (`payPlan`) lands here too.
 */

const STABLE_CREDIT_EVENTS = new ethers.Interface(['event CreditBalanceRepaid(address member, uint128 amount)']);
const ISSUER_EVENTS = new ethers.Interface(['event TierRepaid(address indexed member, uint256 indexed tierId, uint256 amount)']);
const LIQUIDATOR_EVENTS = new ethers.Interface([
  'event SettledFromSavings(address indexed member, address indexed issuer, uint256 seized, uint256 repaid)',
]);
const CENTS = 10n ** 4n;

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

export interface RepaymentRecord {
  ok: boolean;
  duplicate?: boolean;
  totalCents?: number;
  revolvingCents?: number;
  /** What went to term plans. */
  planCents?: number;
  reason?: string;
}

export async function recordUsdcRepayment(
  walletInput: string,
  txHash: string,
  /** Set by automatic repayment; a Repay tap is `manual`; out of savings is detected from the tx. */
  method: 'manual' | 'auto' = 'manual',
): Promise<RepaymentRecord> {
  const wallet = walletInput.trim().toLowerCase();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, reason: 'That is not a transaction.' };

  const provider = chainProvider(chainId());
  const issuerAddress = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!issuerAddress) return { ok: false, reason: 'No card issuer on this chain.' };
  const issuer = new ethers.Contract(issuerAddress, ['function stableCredit() view returns (address)'], provider);
  const stableCredit = String(await issuer.stableCredit()).toLowerCase();

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { ok: false, reason: 'That transaction has not landed yet.' };
  if (receipt.status !== 1) return { ok: false, reason: 'That transaction did not go through.' };

  let total = 0n;
  let revolving = 0n;
  let fromSavings = 0n;
  const liquidatorAddress = (getContractAddress(chainId(), 'Liquidator') || '').toLowerCase();
  for (const log of receipt.logs) {
    const from = log.address.toLowerCase();
    try {
      if (from === stableCredit) {
        const parsed = STABLE_CREDIT_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'CreditBalanceRepaid' && String(parsed.args.member).toLowerCase() === wallet) {
          total += BigInt(parsed.args.amount);
        }
      } else if (liquidatorAddress && from === liquidatorAddress) {
        // The member settled out of their own savings: the savings tier, specifically.
        const parsed = LIQUIDATOR_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'SettledFromSavings' && String(parsed.args.member).toLowerCase() === wallet) {
          fromSavings += BigInt(parsed.args.repaid);
        }
      } else if (from === issuerAddress.toLowerCase()) {
        const parsed = ISSUER_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'TierRepaid' && String(parsed.args.member).toLowerCase() === wallet) {
          revolving += BigInt(parsed.args.amount);
        }
      }
    } catch {
      /* not an event we read */
    }
  }
  // A repayment for somebody else, or no repayment at all, is not recorded against this member.
  if (total === 0n) return { ok: false, reason: 'That transaction did not repay your balance.' };

  // The pool's share of this repayment, if any of it cleared a pool-funded tier.
  await recordPoolMovements(receipt);

  const termIssuer = getContractAddress(chainId(), 'TermIssuer');
  const planCents = termIssuer
    ? await recordPlanPayments({
        wallet,
        txHash,
        receipt,
        termIssuer,
        provider,
        method: fromSavings > 0n ? 'savings' : method,
      }).catch((error) => {
        console.error('[usdc-repayment] plan payment record failed', txHash, error);
        return 0;
      })
    : 0;

  const totalCents = Number(total / CENTS);
  const revolvingCents = Number(revolving / CENTS);
  const recorded = await recordOnchainRepayment({
    wallet,
    txHash,
    totalCents,
    revolvingCents,
    savingsCents: Number(fromSavings / CENTS),
    method,
  });
  console.log(`[usdc-repayment] ${wallet} repaid ${totalCents}c on chain (${revolvingCents}c card, ${planCents}c plans) ${txHash}${recorded.duplicate ? ' (already recorded)' : ''}`);
  return { ok: true, duplicate: recorded.duplicate, totalCents, revolvingCents, planCents };
}
