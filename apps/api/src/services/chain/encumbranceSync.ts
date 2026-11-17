import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';

/*
 * Keeping CLRUSD's last-known lock current after a draw on savings (audit M-3, Phase 1 report §4).
 *
 * CLRUSD reads each holder's lock from the collateral registry on every transfer. If that read ever
 * fails, it holds the lock it last read successfully for that holder, and no more. That record only
 * moves when something reads it, so it can lag a draw: a member who pledged savings, drew against
 * them on the card, and then hit an outage would be held at the smaller, older lock.
 *
 * `ClearUSDUpgradeable.syncEncumbrance(member)` is permissionless and writes only what the source
 * reports. The API calls it right after it draws on a member's line (card settlement and re-issue,
 * the only draws the API itself makes), and only when the record is actually behind: a static call
 * asks what the source says now, `lastKnownLockOf` what is recorded, and a transaction is sent only
 * when they differ.
 *
 * Best-effort by design. The draw has landed; a failed sync leaves the record where it was, which
 * is the state before this existed, and the next draw tries again.
 *
 * Draws the API does not make (a member spending ledger credit at a shop from their own wallet)
 * do not pass through here. Those belong on the credit side: the issuer's draw is the natural place
 * to sync, which is a contract change (recorded for Phase 2), or a watcher on `TierDrawn` events.
 */

const CLRUSD_ABI = [
  'function syncEncumbrance(address holder) returns (uint256)',
  'function lastKnownLockOf(address holder) view returns (uint256)',
];

export type EncumbranceSync = 'synced' | 'current' | 'skipped' | 'failed';

export async function syncClrusdEncumbrance(
  chainId: number,
  member: string,
  signer: ethers.ContractRunner,
): Promise<EncumbranceSync> {
  const address = getContractAddress(chainId, 'CLRUSD');
  if (!address || /^0x0{40}$/i.test(address)) return 'skipped';
  try {
    const clrusd = new ethers.Contract(address, CLRUSD_ABI, signer);
    const [live, recorded]: [bigint, bigint] = await Promise.all([
      clrusd.syncEncumbrance.staticCall(member),
      clrusd.lastKnownLockOf(member),
    ]);
    if (live === recorded) return 'current';
    const tx = await clrusd.syncEncumbrance(member);
    await tx.wait(1);
    console.log(`[clrusd] ${member} last-known lock ${recorded} -> ${live} (${tx.hash})`);
    return 'synced';
  } catch (error) {
    console.error(`[clrusd] syncEncumbrance(${member}) failed:`, error instanceof Error ? error.message : error);
    return 'failed';
  }
}
