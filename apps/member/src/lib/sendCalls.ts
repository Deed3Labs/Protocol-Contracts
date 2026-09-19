import { encodeFunctionData, parseUnits } from 'viem';
import { sendCalls, waitForCallsStatus } from '@wagmi/core';
import { wagmiAdapter } from '@/AppKitProvider';
import { clearContracts } from '@/lib/clearNetwork';
import { recordGaslessSavings, recordGaslessPool, recordGaslessBond } from '@/utils/apiClient';
import { requireStepUp } from '@/lib/stepUp';

/*
 * 3-TIER gasless money router (see [[clearpath-privy-migration]]).
 *   Tier 1 — email/social: Privy ERC-4337 smart wallet. Pass the client from useSmartWallets(); one
 *            sponsored UserOp, gas paid by the paymaster registered in the Privy dashboard. Silent
 *            (0 signatures). No relayer fallback (a 1271 smart account can't sign EIP-3009).
 *   Tier 2 — external (MetaMask): EIP-5792 wallet_sendCalls + the ZeroDev self-funded paymaster, so the
 *            wallet uses 7702 to batch + sponsor at its own address. Throws if unsupported → caller
 *            falls back to tier 3.
 *   Tier 3 — graceful fallback: the EIP-3009 relayer (handled by the modals' relayerRun), gasless.
 *
 * sc* take `smartWalletClient` (Privy client or undefined). Defined → tier 1; undefined → tier 2.
 */

// Tier-2 sponsorship via the ZeroDev self-funded paymaster (the funded one we verified). Tier-1 needs
// no URL here — Privy applies the dashboard-registered paymaster.
const ZERODEV_PROJECT_ID = (import.meta.env.VITE_ZERODEV_PROJECT_ID as string | undefined)?.trim();
const paymasterUrl = (chainId: number) =>
  `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${chainId}?selfFunded=true`;

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'redeem', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'clrusdAmount', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const ESCROW_ABI = [
  { name: 'createTransfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'transferId', type: 'bytes32' }, { name: 'principalUsdc', type: 'uint256' }, { name: 'sponsorFeeUsdc', type: 'uint256' }, { name: 'expiry', type: 'uint64' }, { name: 'recipientHintHash', type: 'bytes32' }], outputs: [] },
] as const;

type Call = { to: `0x${string}`; data: `0x${string}` };

/** Minimal shape of Privy's useSmartWallets().client we use (batched sendTransaction). */
interface SmartWalletLike {
  sendTransaction: (input: { calls: { to: `0x${string}`; data: `0x${string}`; value?: bigint }[] }) => Promise<`0x${string}`>;
}

/** Tier 1: Privy smart wallet — one sponsored UserOp (gas via the dashboard paymaster). */
async function runSmartWallet(client: SmartWalletLike, calls: Call[]): Promise<string> {
  return client.sendTransaction({ calls });
}

/** Tier 2: external wallet via EIP-5792 + ZeroDev paymaster (wallet uses 7702). Throws if unsupported. */
async function run5792(owner: string, chainId: number, calls: Call[]): Promise<string> {
  const config = wagmiAdapter.wagmiConfig;
  const { id } = await sendCalls(config, {
    account: owner as `0x${string}`,
    chainId: chainId as 8453,
    calls,
    ...(ZERODEV_PROJECT_ID ? { capabilities: { paymasterService: { url: paymasterUrl(chainId) } } } : {}),
  });
  const res = await waitForCallsStatus(config, { id, timeout: 120_000 });
  if (res.status !== 'success') {
    throw new Error(`Transaction didn't confirm (status: ${res.status ?? 'unknown'}).`);
  }
  const receipts = res.receipts ?? [];
  const last = receipts[receipts.length - 1];
  if (last && last.status === 'reverted') throw new Error('Transaction reverted on-chain.');
  return (last?.transactionHash as string | undefined) ?? id;
}

/** Route: tier 1 if a Privy smart wallet client is given, else tier 2 (external EIP-5792). */
async function runBatch(smartWalletClient: unknown, owner: string, chainId: number, calls: Call[]): Promise<string> {
  // Every sponsored money move leaves through here — Face ID first, for members who have it.
  await requireStepUp();
  if (smartWalletClient) return runSmartWallet(smartWalletClient as SmartWalletLike, calls);
  return run5792(owner, chainId, calls);
}

/** One-time sponsored ERC-20 approve (smart-account autopay allowance — they can't sign EIP-2612). */
export async function scApprove(args: { smartWalletClient?: unknown; owner: string; token: `0x${string}`; spender: `0x${string}`; amount: bigint; chainId: number }): Promise<string> {
  return runBatch(args.smartWalletClient, args.owner, args.chainId, [
    { to: args.token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [args.spender, args.amount] }) },
  ]);
}

/**
 * Several ERC-20 approvals in ONE sponsored batch.
 *
 * For the onboarding grant: the member confirms once and every standing allowance Clear needs is
 * in place, instead of meeting an approval prompt the first time they try each thing -- and for an
 * external wallet the first redeem is a real, user-paid transaction, so lazily granting is not
 * merely an extra tap but an unexpected charge mid-flow.
 *
 * Callers pass only what is actually missing; an empty list is a no-op rather than an empty
 * UserOp, because a batch of nothing still asks the member to confirm nothing.
 */
export async function scApproveMany(args: {
  smartWalletClient?: unknown;
  owner: string;
  chainId: number;
  approvals: { token: `0x${string}`; spender: `0x${string}`; amount: bigint }[];
}): Promise<string | null> {
  if (args.approvals.length === 0) return null;
  return runBatch(
    args.smartWalletClient,
    args.owner,
    args.chainId,
    args.approvals.map((a) => ({
      to: a.token,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [a.spender, a.amount] }),
    })),
  );
}

/** Cash (USDC) → Savings (CLRUSD): [approve, deposit] in ONE sponsored batch. */
export async function scDeposit(args: { smartWalletClient?: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const hash = await runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'deposit', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/** Savings (CLRUSD) → Cash (USDC): [approve, redeem] in ONE sponsored batch. */
export async function scRedeem(args: { smartWalletClient?: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const hash = await runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.clrusd, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.esaVault, amt] }) },
    { to: c.esaVault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'redeem', args: [c.usdc, amt, receiver] }) },
  ]);
  await recordGaslessSavings({ action: 'redeem', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

const POOL_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable',
    inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }],
    outputs: [{ name: 'shares', type: 'uint256' }] },
  { type: 'function', name: 'redeem', stateMutability: 'nonpayable',
    inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }],
    outputs: [{ name: 'assets', type: 'uint256' }] },
  { type: 'function', name: 'requestWithdrawal', stateMutability: 'nonpayable',
    inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }],
    outputs: [{ name: 'requestId', type: 'uint256' }] },
] as const;

/**
 * Ready to allocate (USDC) → the yield pool: [approve, deposit] in ONE sponsored batch.
 *
 * The same shape as a savings deposit, pointed at a different destination — which is also how the
 * reference describes the screen in front of it.
 */
export async function scPoolDeposit(args: { smartWalletClient?: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c?.lendingPool) throw new Error('The yield pool is not available on this network.');
  const amt = parseUnits(args.amount, 6);
  const receiver = args.ownerWallet as `0x${string}`;
  const hash = await runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.lendingPool, amt] }) },
    { to: c.lendingPool, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'deposit', args: [amt, receiver] }) },
  ]);
  await recordGaslessPool({ action: 'deposit', amount: amt.toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/**
 * The yield pool → Ready to allocate.
 *
 * Two paths, because the pool has a state savings does not: it can be fully lent. `redeem` pays
 * immediately and is capped at `maxRedeem`, which the contract caps at available cash;
 * `requestWithdrawal` burns the shares now and queues the claim, paid as members repay.
 *
 * A member asking for more than is free gets both in one batch — paid what is there, queued for
 * the rest — because refusing the whole amount would be the pool telling somebody their own money
 * is unavailable when most of it is not.
 */
export async function scPoolWithdraw(args: {
  smartWalletClient?: unknown;
  ownerWallet: string;
  /** Shares to redeem now, already capped at what the pool can pay. */
  sharesNow: bigint;
  /** Shares to queue. Zero when the pool can cover the whole request. */
  sharesQueued: bigint;
  chainId: number;
}): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c?.lendingPool) throw new Error('The yield pool is not available on this network.');
  if (args.sharesNow === 0n && args.sharesQueued === 0n) throw new Error('Nothing to withdraw.');
  const owner = args.ownerWallet as `0x${string}`;

  const calls: { to: `0x${string}`; data: `0x${string}` }[] = [];
  if (args.sharesNow > 0n) {
    calls.push({ to: c.lendingPool, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'redeem', args: [args.sharesNow, owner, owner] }) });
  }
  if (args.sharesQueued > 0n) {
    calls.push({ to: c.lendingPool, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'requestWithdrawal', args: [args.sharesQueued, owner] }) });
  }

  const hash = await runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, calls);
  await recordGaslessPool({ action: 'withdraw', amount: (args.sharesNow + args.sharesQueued).toString(), txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

const BOND_DEPOSIT_ABI = [
  { type: 'function', name: 'makeDeposit', stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'faceValue', type: 'uint256' },
      { name: 'maturityDate', type: 'uint256' },
      { name: 'discountPercentage', type: 'uint256' },
    ],
    outputs: [{ name: 'bondId', type: 'uint256' }] },
] as const;

/**
 * Ready to allocate (USDC) → a bond: [approve, makeDeposit] in ONE sponsored batch.
 *
 * A bond is bought at a discount and matures at face, so what a member pays is derived from the
 * face value and the term rather than typed. `approve` is for the price, not the face — approving
 * the face would let the deposit contract take more than the bond costs.
 *
 * The price is quoted by the chain (`calculateRequiredDeposit`) and passed in, so the approval and
 * the purchase agree on one figure that neither this file nor the screen invented.
 */
export async function scBuyBond(args: {
  smartWalletClient?: unknown;
  ownerWallet: string;
  /** Face value in whole units — what the bond pays at maturity. */
  faceValue: string;
  /** Unix seconds. */
  maturityDate: number;
  /** Basis points, as the collection prices it. */
  discountBps: number;
  /** What it costs today, quoted by the chain. */
  priceUnits: bigint;
  chainId: number;
}): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c?.burnerBondDeposit) throw new Error('Bonds are not available on this network.');
  const face = parseUnits(args.faceValue, 6);

  const hash = await runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.burnerBondDeposit, args.priceUnits] }) },
    { to: c.burnerBondDeposit, data: encodeFunctionData({
        abi: BOND_DEPOSIT_ABI, functionName: 'makeDeposit',
        args: [c.usdc, face, BigInt(args.maturityDate), BigInt(args.discountBps)],
      }) },
  ]);
  await recordGaslessBond({ txHash: hash, chainId: args.chainId }).catch(() => {});
  return hash;
}

/** Send: [approve(escrow), createTransfer] in ONE sponsored batch. Returns the lock tx hash. */
export async function scSendLock(args: {
  smartWalletClient?: unknown;
  ownerWallet: string;
  chainId: number;
  transferId: `0x${string}`;
  principalUsdcMicros: string;
  sponsorFeeUsdcMicros: string;
  totalLockedUsdcMicros: string;
  recipientHintHash: `0x${string}`;
  expiresAt: string;
}): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c) throw new Error(`No contracts for chain ${args.chainId}.`);
  const principal = BigInt(args.principalUsdcMicros);
  const fee = BigInt(args.sponsorFeeUsdcMicros);
  const total = BigInt(args.totalLockedUsdcMicros);
  const expiry = BigInt(Math.floor(new Date(args.expiresAt).getTime() / 1000));
  return runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.claimEscrow, total] }) },
    { to: c.claimEscrow, data: encodeFunctionData({ abi: ESCROW_ABI, functionName: 'createTransfer', args: [args.transferId, principal, fee, expiry, args.recipientHintHash] }) },
  ]);
}

/**
 * Cash/Savings → a linked external wallet: ONE sponsored ERC-20 transfer from the smart wallet.
 * `token` is the canonical USDC (Cash) or CLRUSD (Savings) address; both are 6-decimals. Gasless via
 * the smart-wallet client. The reverse (linked → smart) can't be sponsored — the external EOA signs it.
 */
export async function scTransferToken(args: {
  smartWalletClient?: unknown;
  ownerWallet: string;
  token: `0x${string}`;
  to: `0x${string}`;
  amount: string;
  chainId: number;
}): Promise<string> {
  const amt = parseUnits(args.amount, 6);
  return runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: args.token, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [args.to, amt] }) },
  ]);
}

const STABLE_CREDIT_ABI = [
  { type: 'function', name: 'repayCreditBalance', stateMutability: 'nonpayable',
    inputs: [{ name: 'member', type: 'address' }, { name: 'amount', type: 'uint128' }], outputs: [] },
  { type: 'function', name: 'creditBalanceOf', stateMutability: 'view',
    inputs: [{ name: 'member', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export { STABLE_CREDIT_ABI };

/**
 * Repay card debt in USDC: [approve, repayCreditBalance] in ONE sponsored batch.
 *
 * StableCredit pulls the reserve token (USDC, 1:1) from the caller, burns the member's obligation and
 * tells the issuers, which clear the dearest tier first. Face ID first, like every money move
 * (runBatch). The server then records it in the books from this transaction's own events.
 */
export async function scRepayCredit(args: {
  smartWalletClient?: unknown;
  ownerWallet: string;
  amount: string;
  chainId: number;
  /** Exact ledger units, for clearing everything -- so no fraction of a cent of carry is left behind. */
  units?: bigint;
}): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c?.stableCredit) throw new Error('Repaying on chain is not available on this network yet.');
  const amt = args.units ?? parseUnits(args.amount, 6);
  return runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.stableCredit, amt] }) },
    {
      to: c.stableCredit,
      data: encodeFunctionData({ abi: STABLE_CREDIT_ABI, functionName: 'repayCreditBalance', args: [args.ownerWallet as `0x${string}`, amt] }),
    },
  ]);
}

const TERM_PLAN_ABI = [
  { type: 'function', name: 'payPlan', stateMutability: 'nonpayable',
    inputs: [{ name: 'planId', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'setSplit', stateMutability: 'nonpayable',
    inputs: [{ name: 'planId', type: 'uint256' }, { name: 'installments', type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'owedOn', stateMutability: 'view',
    inputs: [{ name: 'planId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;
export { TERM_PLAN_ABI };

/**
 * Pay a term plan in USDC: [approve, payPlan] in ONE sponsored batch.
 *
 * Directed at the plan, so it services that plan's schedule rather than whichever balance is dearest.
 * The approval is to StableCredit, which pulls the USDC; TermIssuer only names the plan. `payPlan`
 * caps at what is owed, so approving a little over (carry accrues by the second) never overpays.
 */
export async function scPayPlan(args: {
  smartWalletClient?: unknown;
  ownerWallet: string;
  planId: number;
  units: bigint;
  chainId: number;
}): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c?.stableCredit || !c.termIssuer) throw new Error('Paying plans on chain is not available on this network yet.');
  return runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.stableCredit, args.units] }) },
    {
      to: c.termIssuer,
      data: encodeFunctionData({ abi: TERM_PLAN_ABI, functionName: 'payPlan', args: [BigInt(args.planId), args.units] }),
    },
  ]);
}

/** Re-split what is left of a plan over 1, 2, 4, 6 or 12 cycles. The member signs it themselves. */
export async function scSetSplit(args: {
  smartWalletClient?: unknown;
  ownerWallet: string;
  planId: number;
  installments: number;
  chainId: number;
}): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c?.termIssuer) throw new Error('Changing a split on chain is not available on this network yet.');
  return runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    {
      to: c.termIssuer,
      data: encodeFunctionData({ abi: TERM_PLAN_ABI, functionName: 'setSplit', args: [BigInt(args.planId), args.installments] }),
    },
  ]);
}

/** The savings tier's position on the revolving line: the cheapest tier, first in draw order. */
export const SAVINGS_TIER_ID = 0n;

const SAVINGS_SETTLE_ABI = [
  { type: 'function', name: 'settleFromSavings', stateMutability: 'nonpayable',
    inputs: [{ name: 'issuer', type: 'address' }, { name: 'tierId', type: 'uint256' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'repaid', type: 'uint256' }] },
] as const;

export const TIER_PRINCIPAL_ABI = [
  { type: 'function', name: 'principalOf', stateMutability: 'view',
    inputs: [{ name: 'member', type: 'address' }, { name: 'tierId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

/**
 * Settle savings-backed credit out of the member's own savings, in one sponsored call.
 *
 * The Liquidator seizes the locked CLRUSD, redeems it one-for-one and settles the savings tier --
 * the same move as a liquidation, chosen instead of suffered. Only the caller's own savings, only
 * against the savings tier, only through a trusted issuer: the contract enforces all three.
 */
export async function scRepayFromSavings(args: { smartWalletClient?: unknown; ownerWallet: string; amount: string; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c?.liquidator || !c.revolvingIssuer) throw new Error('Repaying from savings is not available on this network yet.');
  const amt = parseUnits(args.amount, 6);
  return runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    {
      to: c.liquidator,
      data: encodeFunctionData({ abi: SAVINGS_SETTLE_ABI, functionName: 'settleFromSavings', args: [c.revolvingIssuer, SAVINGS_TIER_ID, amt] }),
    },
  ]);
}

const AUTO_REPAY_ABI = [
  { type: 'function', name: 'setAutoRepay', stateMutability: 'nonpayable', inputs: [{ name: 'enabled', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'autoRepayEnabled', stateMutability: 'view', inputs: [{ name: 'member', type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;
export { AUTO_REPAY_ABI };

const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * Switch automatic repayment from USDC deposits on or off, in one sponsored batch.
 *
 * On: the ledger may take USDC to repay (approve) and the member's mandate is set. Off: the mandate
 * is cleared and the approval withdrawn -- both, so neither half is left standing. Face ID first.
 */
export async function scSetAutoRepay(args: { smartWalletClient?: unknown; ownerWallet: string; enabled: boolean; chainId: number }): Promise<string> {
  const c = clearContracts(args.chainId);
  if (!c?.stableCredit || !c.revolvingIssuer) throw new Error('Automatic repayment is not available on this network yet.');
  return runBatch(args.smartWalletClient, args.ownerWallet, args.chainId, [
    { to: c.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [c.stableCredit, args.enabled ? MAX_UINT256 : 0n] }) },
    { to: c.revolvingIssuer, data: encodeFunctionData({ abi: AUTO_REPAY_ABI, functionName: 'setAutoRepay', args: [args.enabled] }) },
  ]);
}
