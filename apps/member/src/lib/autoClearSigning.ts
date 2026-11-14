import { signTypedData, switchChain } from '@wagmi/core';
import { AUTO_CLEAR_SCOPE, AUTO_CLEAR_TYPES, autoClearMessage, switchMismatch } from '@clear/domain';
import { wagmiAdapter } from '@/AppKitProvider';
import { ACTIVE_CHAIN_ID, clearContracts } from '@/lib/clearNetwork';
import { prepareAutoClear, submitAutoClear } from '@/utils/apiClient';

/*
 * Turning auto-clear on by signature (Phase 2b, section 12.2): how onboarding sets it, so a new
 * member is not asked for a transaction before they have anything on their line.
 *
 * The server builds `AutoClear(member, on, scope, nonce, deadline)` in RevolvingIssuer's domain at
 * the member's `memberNonces`; this checks it is exactly the choice being made (this member, this
 * contract and chain, on, UNSECURED_ONLY), signs it with the member's own wallet, and the server
 * submits `setAutoClearWithSignature`. The member can turn it off, or change what it covers, in
 * Settings at any time.
 */
export async function signAutoClearOn(member: string, scope: number = AUTO_CLEAR_SCOPE.UNSECURED_ONLY): Promise<{ ok: boolean; error?: string }> {
  const revolvingIssuer = clearContracts(ACTIVE_CHAIN_ID)?.revolvingIssuer;
  if (!revolvingIssuer) return { ok: false, error: 'Not available on this network yet.' };
  const prepared = await prepareAutoClear(member, true, scope);
  if (!prepared.typedData) return { ok: false, error: prepared.error };
  const td = prepared.typedData;
  const mismatch = switchMismatch({
    typedData: td,
    shown: { member, on: true, scope },
    expected: { chainId: ACTIVE_CHAIN_ID, revolvingIssuer },
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (mismatch) return { ok: false, error: `Not signed: ${mismatch}.` };

  const config = wagmiAdapter.wagmiConfig;
  try {
    await switchChain(config, { chainId: ACTIVE_CHAIN_ID });
  } catch {
    /* already on it, or the wallet declined: the domain binds the chain either way */
  }
  const signature = await signTypedData(config, {
    account: member as `0x${string}`,
    domain: { ...td.domain, verifyingContract: td.domain.verifyingContract as `0x${string}` },
    types: AUTO_CLEAR_TYPES,
    primaryType: 'AutoClear',
    message: { ...autoClearMessage(td.message), member: td.message.member as `0x${string}` },
  });
  return submitAutoClear(member, { on: true, scope, deadline: td.message.deadline, signature });
}
