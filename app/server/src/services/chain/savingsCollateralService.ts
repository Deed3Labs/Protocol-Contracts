import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { savingsIntentService } from '../savingsIntentService.js';

/*
 * Making savings back a credit line.
 *
 * Depositing mints CLRUSD, and that is where it stopped: the registry reads `pledgedOf`, not a
 * member's balance, so five dollars of savings sat there backing nothing and the savings tier
 * stayed at zero. Two calls close it.
 *
 *   pledge(member, SAVINGS, amount)   records the collateral. Operator-only.
 *   pushCapacities(member)            derives the tier ceilings and writes them onto the issuer.
 *
 * Pledging costs a member nothing. Encumbrance is computed from what is *drawn*, not from what is
 * pledged -- `_requiredUnits` returns zero when nothing is drawn -- so savings pledged against an
 * untouched line remain entirely withdrawable. That is what makes pledging on deposit the right
 * default rather than a decision to put in front of somebody: at 100% haircut it is the whole
 * product promise, "borrow against your own money at no cost", and it takes nothing away.
 *
 * Best-effort, and deliberately so. The deposit has already landed on chain by the time this runs;
 * failing the member's deposit because a follow-up write did not go through would be the wrong
 * trade. A pledge that fails leaves the savings real and the line unmoved, which is exactly the
 * state we are already in, and the next deposit or a manual sync repairs it.
 */

const REGISTRY_ABI = [
  'function pledge(address member, bytes32 kind, uint256 amount)',
  'function release(address member, bytes32 kind, uint256 amount)',
  'function pledgedOf(address, bytes32) view returns (uint256)',
  'function freeCollateralOf(address member, bytes32 kind) view returns (uint256)',
];

const CALCULATOR_ABI = ['function pushCapacities(address member) returns (uint256)'];

/** `SAVINGS`, as the deploy script writes it — `encodeBytes32String`, not a hash. */
export const SAVINGS_KIND = ethers.encodeBytes32String('SAVINGS');

function chainId(): number {
  const raw = (process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

export interface CollateralSyncResult {
  ok: boolean;
  reason?: string;
  pledgedUnits?: string;
  txHash?: string;
}

/**
 * Bring a member's pledged savings in line with what they now hold.
 *
 * Synced to a target rather than incremented by a delta, because a delta assumes every movement
 * came through here. Deposits from a sweep, a redeem that raced this call, a direct transfer --
 * any of those leave an incremented figure describing a balance that no longer exists. Reading
 * the current pledge and moving it to where it should be is idempotent, which also means a retry
 * after a failure is safe.
 *
 * Never releases below what is encumbered: `release` reverts past `freeCollateralOf`, so a member
 * whose savings are backing drawn credit keeps the pledge that is holding it up.
 */
export async function syncSavingsCollateral(
  wallet: string,
  targetUnits: bigint,
): Promise<CollateralSyncResult> {
  const registryAddress = getContractAddress(chainId(), 'CollateralRegistry');
  const calculatorAddress = getContractAddress(chainId(), 'LimitCalculator');
  if (!registryAddress) return { ok: false, reason: 'no collateral registry on this chain' };

  const key = operatorKey();
  if (!key) return { ok: false, reason: 'no CREDIT_OPERATOR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY' };

  try {
    const provider = new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(chainId()));
    const signer = new ethers.Wallet(key, provider);
    const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, signer);
    const member = ethers.getAddress(wallet);

    const current: bigint = await registry.pledgedOf(member, SAVINGS_KIND);
    let txHash: string | undefined;

    if (targetUnits > current) {
      const tx = await registry.pledge(member, SAVINGS_KIND, targetUnits - current);
      txHash = (await tx.wait())?.hash ?? tx.hash;
    } else if (targetUnits < current) {
      // Only what is actually free. The rest is holding up drawn credit and the registry will
      // refuse to let it go -- correctly.
      const free: bigint = await registry.freeCollateralOf(member, SAVINGS_KIND);
      const wanted = current - targetUnits;
      const amount = wanted < free ? wanted : free;
      if (amount > 0n) {
        const tx = await registry.release(member, SAVINGS_KIND, amount);
        txHash = (await tx.wait())?.hash ?? tx.hash;
      }
    }

    // Always, even when the pledge did not move: capacities are derived from collateral *and*
    // attestations, so this is also how an off-chain underwriting decision reaches the issuer.
    // Permissionless by design -- a member whose collateral just moved should not wait for an
    // operator to notice.
    if (calculatorAddress) {
      const calculator = new ethers.Contract(calculatorAddress, CALCULATOR_ABI, signer);
      const push = await calculator.pushCapacities(member);
      await push.wait();
    }

    return { ok: true, pledgedUnits: targetUnits.toString(), txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[savings] collateral sync failed for', wallet, message);
    return { ok: false, reason: message };
  }
}

/** Read a member's CLRUSD balance, which is the target the pledge is synced to. */
export async function readSavingsUnits(wallet: string): Promise<bigint | null> {
  const clrusd = getContractAddress(chainId(), 'CLRUSD') || getContractAddress(chainId(), 'ClearUSD');
  if (!clrusd) return null;
  try {
    const provider = new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(chainId()));
    const token = new ethers.Contract(clrusd, ['function balanceOf(address) view returns (uint256)'], provider);
    return await token.balanceOf(ethers.getAddress(wallet));
  } catch (error) {
    console.error('[savings] balance read failed for', wallet, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Sync a member's pledge to whatever they currently hold. The whole job, in one call. */
export async function syncSavingsCollateralFromBalance(wallet: string): Promise<CollateralSyncResult> {
  const units = await readSavingsUnits(wallet);
  if (units === null) return { ok: false, reason: 'could not read the savings balance' };
  return syncSavingsCollateral(wallet, units);
}
