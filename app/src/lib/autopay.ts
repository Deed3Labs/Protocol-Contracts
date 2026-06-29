import { createPublicClient, http, type Chain } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { getWalletClient } from '@wagmi/core';
import { createKernelAccount } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_3 } from '@zerodev/sdk/constants';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { toPermissionValidator, serializePermissionAccount } from '@zerodev/permissions';
import { toECDSASigner } from '@zerodev/permissions/signers';
import { toCallPolicy, toTimestampPolicy, toRateLimitPolicy, CallPolicyVersion } from '@zerodev/permissions/policies';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { createAutopayRule } from '@/utils/apiClient';

/*
 * Autopay install (rent → ownership, "sign once"). Creates a ZeroDev SESSION KEY scoped to only
 * USDC.approve + ESA vault.deposit, time-boxed and rate-limited, then serializes the permission
 * account (embedding the session key) and hands it to the backend. The autopay runner then executes
 * recurring sponsored deposits with that session — the user never signs again.
 *
 * Same gating as the AA layer (VITE_ZERODEV_PROJECT_ID). UNVERIFIED on-chain (7702 + smart-sessions) —
 * verify on the demo before relying on it. The session can ONLY approve+deposit into the user's OWN
 * savings, capped by the on-chain rate-limit + expiry policies.
 */

const PROJECT_ID = (import.meta.env.VITE_ZERODEV_PROJECT_ID as string | undefined)?.trim();
const CHAINS: Record<number, Chain> = { 8453: base, 84532: baseSepolia };

export type AutopayCadence = 'weekly' | 'monthly';

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const cadenceSeconds = (c: AutopayCadence) => (c === 'weekly' ? 7 * 24 * 3600 : 31 * 24 * 3600);

/**
 * Set up recurring gasless Cash→Savings deposits. The user signs ONCE (the session enable); returns
 * the created rule. `runs` bounds the session (count + expiry) so it can't outlive the schedule.
 */
export async function installAutopaySession(args: {
  chainId: number;
  ownerWallet: string;
  amountUsdc: number;
  cadence: AutopayCadence;
  runs: number;
}): Promise<void> {
  if (!PROJECT_ID) throw new Error('Autopay is not available yet.');
  const chain = CHAINS[args.chainId];
  if (!chain) throw new Error(`No autopay config for chain ${args.chainId}.`);
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);

  const walletClient = await getWalletClient(wagmiAdapter.wagmiConfig, { chainId: args.chainId });
  if (!walletClient) throw new Error('Connect your wallet to set up Auto-save.');

  const publicClient = createPublicClient({ chain, transport: http() });
  const entryPoint = getEntryPoint('0.7');

  // Session key (the agent key the backend executes with) — embedded in the serialized approval.
  const sessionKey = generatePrivateKey();
  const sessionSigner = await toECDSASigner({ signer: privateKeyToAccount(sessionKey) });

  const runs = Math.max(1, Math.floor(args.runs));
  const interval = cadenceSeconds(args.cadence);
  // Expiry: cover all runs + one cadence of slack.
  const validUntil = Math.floor(Date.now() / 1000) + interval * (runs + 1);

  const policies = [
    toCallPolicy({
      policyVersion: CallPolicyVersion.V0_0_4,
      // Two different ABIs/targets in one policy fights the per-call generic typing; the runtime shape
      // (target + abi + functionName per entry) is what toCallPolicy consumes.
      permissions: [
        { target: c.usdc, abi: ERC20_ABI, functionName: 'approve' },
        { target: c.esaVault, abi: VAULT_ABI, functionName: 'deposit' },
      ] as never,
    }),
    // Bound total runs (one approve+deposit batch counts once) and the lifetime of the session.
    toRateLimitPolicy({ interval, count: runs }),
    toTimestampPolicy({ validUntil }),
  ];

  const permissionPlugin = await toPermissionValidator(publicClient, {
    signer: sessionSigner,
    policies,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });

  // The 7702 ECDSA root (sudo) for the user's EOA. create7702KernelAccount only wires the sudo into the
  // plugin manager (it ignores a regular plugin), so we use createKernelAccount in 7702 mode with an
  // explicit { sudo, regular } — that's what puts the session validator IN the manager so it can be
  // serialized/enabled. The session is the `regular` (active) validator.
  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: walletClient as never,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });

  const account = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    eip7702Account: walletClient as never, // EOA delegated to Kernel at the same address (7702)
    plugins: { sudo: sudoValidator, regular: permissionPlugin },
  });

  // The user signs ONCE here (the session enable, + the 7702 authorization); the session key is
  // embedded in the approval so the backend can execute without it.
  const approval = await serializePermissionAccount(account, sessionKey);

  await createAutopayRule(args.ownerWallet, {
    chainId: args.chainId,
    amountUsdc: args.amountUsdc,
    cadence: args.cadence,
    approval,
    runs,
  });
}
