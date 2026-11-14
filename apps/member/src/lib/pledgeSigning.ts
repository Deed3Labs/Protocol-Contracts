import { signTypedData, switchChain } from '@wagmi/core';
import {
  COLLATERAL_SIGNED_TYPES,
  collateralMessage,
  collateralMismatch,
  type CollateralShown,
  type CollateralTypedData,
} from '@clear/domain';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { preparePledge, submitPledge, type PledgeKindName } from '@/utils/apiClient';

/*
 * The member signs every pledge (Phase 4b, decision L-I).
 *
 * `CollateralRegistry.pledge` / `pledgeItem` record a pledge only with the member's EIP-712
 * signature; the operator submits it. The typed data is defined once, in @clear/domain's pledge;
 * this is the phone's half: the server says what should be pledged (what the member holds and has
 * not pledged, read from the chain), the phone checks it is this member, this registry, this
 * network, and the amount or bond it was told, and the member's own wallet signs. A smart account
 * signs through EIP-1271, which the registry accepts (SignatureChecker).
 *
 * The signer is generic over the registry's signed structs (`COLLATERAL_SIGNED_TYPES`), so a further
 * one -- the bond Maturity Instruction (Phase 2e) -- signs through `signCollateral` unchanged.
 */

/** Check a registry struct against what the phone expects, then sign it with the member's wallet. */
export async function signCollateral(args: {
  typedData: CollateralTypedData;
  shown: CollateralShown;
  chainId: number;
}): Promise<string> {
  const registry = clearContracts(args.chainId)?.collateralRegistry;
  if (!registry) throw new Error('Pledging is not available on this network.');
  const mismatch = collateralMismatch({
    typedData: args.typedData,
    shown: args.shown,
    expected: { chainId: args.chainId, registry },
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (mismatch) throw new Error(`This is not the pledge we expected (${mismatch}). Nothing was signed.`);
  const config = wagmiAdapter.wagmiConfig;
  try {
    await switchChain(config, { chainId: args.chainId });
  } catch {
    /* already on it, or the wallet declined: the domain binds the chain either way */
  }
  const primaryType = args.typedData.primaryType;
  return signTypedData(config, {
    account: args.shown.member as `0x${string}`,
    domain: { ...args.typedData.domain, verifyingContract: args.typedData.domain.verifyingContract as `0x${string}` },
    types: { [primaryType]: COLLATERAL_SIGNED_TYPES[primaryType] },
    primaryType,
    message: collateralMessage(args.typedData),
  } as Parameters<typeof signTypedData>[1]);
}

/** At most this many pledges in one go (a member with several new bonds signs each). */
const MAX_PLEDGES = 5;

/**
 * Pledge what the member holds and has not pledged, of one kind: ask, sign, submit, until nothing is
 * left. Called after a deposit or a bond purchase. Returns how many were pledged, or the first error.
 */
export async function pledgeWhatIsHeld(args: { kind: PledgeKindName; member: string; chainId: number }): Promise<{ pledged: number; error?: string }> {
  let pledged = 0;
  for (let i = 0; i < MAX_PLEDGES; i++) {
    const prepared = await preparePledge(args.kind);
    if ('error' in prepared) return { pledged, error: prepared.error };
    if (!prepared.needsSignature) return { pledged };
    const td = prepared.typedData;
    const shown: CollateralShown = {
      member: args.member,
      kind: String(td.message.kind),
      ...(td.primaryType === 'PledgeItem' ? { itemId: td.message.itemId } : { amount: td.message.amount }),
    };
    const signature = await signCollateral({ typedData: td, shown, chainId: args.chainId });
    const submitted = await submitPledge({
      kind: args.kind,
      ...(td.primaryType === 'PledgeItem' ? { itemId: td.message.itemId } : { amount: td.message.amount }),
      deadline: Number(td.message.deadline),
      signature,
    });
    if (!submitted.ok) return { pledged, error: submitted.error };
    pledged += 1;
    if (args.kind !== 'BOND') return { pledged };
  }
  return { pledged };
}
