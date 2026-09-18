import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { recordOnchainRepayment } from '../deposits/depositReceiptService.js';

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
 * Only the second reaches the card books; a part that went to a term plan is not card debt.
 */

const STABLE_CREDIT_EVENTS = new ethers.Interface(['event CreditBalanceRepaid(address member, uint128 amount)']);
const ISSUER_EVENTS = new ethers.Interface(['event TierRepaid(address indexed member, uint256 indexed tierId, uint256 amount)']);
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
  reason?: string;
}

export async function recordUsdcRepayment(walletInput: string, txHash: string): Promise<RepaymentRecord> {
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
  for (const log of receipt.logs) {
    const from = log.address.toLowerCase();
    try {
      if (from === stableCredit) {
        const parsed = STABLE_CREDIT_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'CreditBalanceRepaid' && String(parsed.args.member).toLowerCase() === wallet) {
          total += BigInt(parsed.args.amount);
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

  const totalCents = Number(total / CENTS);
  const revolvingCents = Number(revolving / CENTS);
  const recorded = await recordOnchainRepayment({ wallet, txHash, totalCents, revolvingCents });
  console.log(`[usdc-repayment] ${wallet} repaid ${totalCents}c on chain (${revolvingCents}c card) ${txHash}${recorded.duplicate ? ' (already recorded)' : ''}`);
  return { ok: true, duplicate: recorded.duplicate, totalCents, revolvingCents };
}
