import { maxUint256 } from 'viem';
import { readContract } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { CLEAR_GRANTS, type ClearGrant } from '@/lib/clearGrants';
import { scApproveMany } from '@/lib/sendCalls';

/**
 * Turning the declared permissions into on-chain allowances, and back.
 *
 * The list itself lives in `clearGrants` so that the settings page can render exactly what this
 * grants without importing a chain client to do it. One definition, two readers: what a member is
 * shown afterwards cannot describe something other than what they gave.
 */

const ALLOWANCE_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * Below this, a grant counts as not held.
 *
 * An exact-equality check against `maxUint256` would treat a member who has spent against an
 * unlimited allowance as ungranted on some tokens and not others, depending on whether that token
 * decrements an infinite allowance. Half of the maximum is past any real spend and below every
 * decrement, so it answers the question actually being asked: is this still effectively standing?
 */
const STANDING = maxUint256 / 2n;

export interface GrantStatus extends ClearGrant {
  allowance: bigint;
  held: boolean;
}

/** What the member has actually granted on-chain right now. */
export async function readGrants(owner: string, chainId: number): Promise<GrantStatus[]> {
  const contracts = clearContracts(chainId);
  if (!contracts) return [];

  return Promise.all(
    CLEAR_GRANTS.map(async (grant) => {
      const allowance = (await readContract(wagmiAdapter.wagmiConfig, {
        address: contracts[grant.token],
        abi: ALLOWANCE_ABI,
        functionName: 'allowance',
        args: [owner as `0x${string}`, contracts[grant.spender]],
        chainId,
      }).catch(() => 0n)) as bigint;

      return { ...grant, allowance, held: allowance >= STANDING };
    }),
  );
}

/**
 * Grants everything not already held, in one confirmation.
 *
 * Re-granting what is already standing would make the member confirm a transaction that changes
 * nothing, so this reads first and sends only the difference. Returns null when there was nothing
 * to do -- which is the normal case for anyone who has onboarded before on this device.
 */
export async function grantOnboardingPermissions(args: {
  smartWalletClient?: unknown;
  owner: string;
  chainId: number;
}): Promise<{ txHash: string | null; granted: ClearGrant[] }> {
  const contracts = clearContracts(args.chainId);
  if (!contracts) throw new Error(`Clear is not deployed on chain ${args.chainId}.`);

  const status = await readGrants(args.owner, args.chainId);
  const missing = status.filter((grant) => !grant.held);

  const txHash = await scApproveMany({
    smartWalletClient: args.smartWalletClient,
    owner: args.owner,
    chainId: args.chainId,
    approvals: missing.map((grant) => ({
      token: contracts[grant.token],
      spender: contracts[grant.spender],
      amount: maxUint256,
    })),
  });

  return { txHash, granted: missing };
}

/**
 * Withdraws one grant, by setting its allowance to zero.
 *
 * Deliberately one at a time and deliberately not bundled: revoking is the member changing their
 * mind about a specific thing, and batching several would make it easy to switch off more than
 * was meant. The app simply asks again the next time it needs the permission.
 */
export async function revokeGrant(args: {
  smartWalletClient?: unknown;
  owner: string;
  chainId: number;
  grantId: string;
}): Promise<string | null> {
  const contracts = clearContracts(args.chainId);
  const grant = CLEAR_GRANTS.find((g) => g.id === args.grantId);
  if (!contracts || !grant) throw new Error(`No such permission: ${args.grantId}`);

  return scApproveMany({
    smartWalletClient: args.smartWalletClient,
    owner: args.owner,
    chainId: args.chainId,
    approvals: [{ token: contracts[grant.token], spender: contracts[grant.spender], amount: 0n }],
  });
}
