import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';

/*
 * Rolling a member's cycle into the next one.
 *
 * A credit period is set when a line is opened and never again. Nothing on chain renews it: the
 * expiry path runs inside a credit transaction and DELETES the period rather than starting the next
 * one, and the opener skips anyone who already has a line. So every member's cycle runs out and
 * stays out -- the card reads "0 days left" from then on, and the next credit purchase leaves them
 * with no period at all.
 *
 * This is what renews it, once a cycle, for members the chain considers clear.
 *
 *   compliant      credit balance is zero -> a new period of the network's own cycle length
 *   not compliant  left alone. They are inside the grace the contract gives them to clear what they
 *                  carry, and handing them a fresh period would quietly wipe that deadline. Clearing
 *                  their balance makes them compliant, and the next pass renews them.
 *   in default     left alone. A default is its own state with its own way out.
 *
 * Operator-signed, and no contract change: `updateCreditPeriod` is already operator-callable.
 */

const ISSUER_ABI = [
  'function creditPeriods(address member) view returns (uint256 issuedAt, uint256 expiration, uint256 graceLength, bool paused)',
  'function updateCreditPeriod(address member, uint256 periodExpiration, uint256 graceLength)',
  'function cycleLength() view returns (uint64)',
  'function inCompliance(address member) view returns (bool)',
  'function inDefault(address member) view returns (bool)',
];

export interface RenewalResult {
  wallet: string;
  action: 'renewed' | 'carrying' | 'defaulted' | 'paused' | 'failed';
  /** When the new period ends, for the ones that were renewed. */
  expiresAt?: number;
  txHash?: string;
  reason?: string;
}

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}
const operatorKey = () => (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

export function isRenewalConfigured(): boolean {
  return Boolean(getContractAddress(chainId(), 'RevolvingIssuer') && operatorKey() && getPayPool());
}

async function memberWallets(): Promise<string[]> {
  const pool = getPayPool();
  if (!pool) return [];
  const { rows } = await pool.query<{ primary_wallet: string }>(
    `SELECT DISTINCT primary_wallet FROM members
      WHERE primary_wallet IS NOT NULL AND primary_wallet <> ''
      ORDER BY primary_wallet`,
  );
  return rows.map((r) => r.primary_wallet.toLowerCase());
}

/**
 * Renew every expired period that belongs to a member the chain considers clear.
 *
 * Reads run through the pooling provider, so a hundred members cost a handful of calls rather than
 * hundreds. Writes are one transaction each, and only for the ones actually being renewed -- on an
 * ordinary pass, when nobody's cycle has ended, this sends nothing at all.
 */
export async function renewExpiredPeriods(now = Math.floor(Date.now() / 1000)): Promise<RenewalResult[]> {
  if (!isRenewalConfigured()) return [];
  const issuerAddress = getContractAddress(chainId(), 'RevolvingIssuer')!;
  const provider = chainProvider(chainId());
  const reader = new ethers.Contract(issuerAddress, ISSUER_ABI, provider);
  const cycle = Number(await reader.cycleLength());
  if (!cycle) return [];

  const wallets = await memberWallets();
  const results: RenewalResult[] = [];
  let writer: ethers.Contract | null = null;

  for (const wallet of wallets) {
    try {
      const [issuedAt, expiration, graceLength, paused] = await reader.creditPeriods(wallet);
      // No period at all is not this job's business: opening a line is (creditLineService).
      if (Number(issuedAt) === 0 || Number(expiration) === 0) continue;
      if (now < Number(expiration)) continue;
      if (paused) {
        results.push({ wallet, action: 'paused' });
        continue;
      }

      const [compliant, defaulted] = await Promise.all([reader.inCompliance(wallet), reader.inDefault(wallet)]);
      if (defaulted) {
        results.push({ wallet, action: 'defaulted' });
        continue;
      }
      if (!compliant) {
        // Their grace is running. Renewing now would move the deadline they are inside.
        results.push({ wallet, action: 'carrying' });
        continue;
      }

      if (!writer) {
        const signer = new ethers.Wallet(operatorKey(), provider);
        writer = new ethers.Contract(issuerAddress, ISSUER_ABI, writesAs(signer));
      }
      /*
       * Counted from now, not from the old expiry. A member whose cycle ended three days ago gets a
       * full cycle from today rather than one already three days spent -- and the contract refuses
       * an expiration in the past anyway, which an old-expiry sum would eventually produce.
       */
      const expiresAt = now + cycle;
      const tx = await writer.updateCreditPeriod(wallet, expiresAt, graceLength);
      await tx.wait(1);
      console.log(`[credit-period] ${wallet} renewed to ${new Date(expiresAt * 1000).toISOString().slice(0, 10)} (${tx.hash})`);
      results.push({ wallet, action: 'renewed', expiresAt, txHash: tx.hash });
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      console.error(`[credit-period] ${wallet} renewal failed: ${reason}`);
      results.push({ wallet, action: 'failed', reason });
    }
  }
  return results;
}
