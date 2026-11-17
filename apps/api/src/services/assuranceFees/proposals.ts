import { ethers } from 'ethers';
import { approveData, depositData, SOURCE_TAG, transferData } from './chain.js';
import { usd } from './feeMath.js';

/*
 * What the people who sign are handed (docs/operators/assurance-fee-payer.md).
 *
 * Funding, to CL Operating. Command's own Safe flow (routes/command.ts: /safe/prepare, /safe/propose)
 * proposes to ONE Safe, the Ops Safe in COMMAND_SAFE_ADDRESS, and takes the first signature from a
 * Command person whose linked wallet is one of that Safe's owners, checked by ecrecover. CL Operating
 * is a nested Safe: its only owner is the Clear Lending Safe, a contract, so no person's wallet is
 * an owner, an EOA signature can never satisfy it, and the Transaction Service refuses a proposal
 * from a sender who is neither owner nor delegate. So the funding goes out as a Safe Transaction
 * Builder batch (the shape scripts/signing_plan.ts writes) with a link that opens the Transaction
 * Builder on CL Operating; Safe{Wallet} has the Clear Lending Safe's owners approve it there (its
 * nested-Safe flow: the parent approves the child's transaction hash), and their two signatures are
 * Step 5's confirmation.
 *
 * Interchange, to the Clear Treasury Safe. That Safe's owners are people, so when it is the Ops Safe
 * Command proposes to, the batch goes through Command's own flow (the outbox and safeTx.ts); the
 * batch file is kept as well, for when it isn't.
 */

const SHORT: Record<number, string> = { 84532: 'basesep', 8453: 'base' };
const TX_BUILDER = 'https://apps-portal.safe.global/tx-builder';

export interface SafeBatch {
  version: '1.0';
  chainId: string;
  createdAt: number;
  meta: { name: string; description: string };
  transactions: Array<{ to: string; value: '0'; data: string }>;
}

export function safeBatch(chainId: number, name: string, description: string, calls: Array<{ to: string; data: string }>, at = Date.now()): SafeBatch {
  return { version: '1.0', chainId: String(chainId), createdAt: at, meta: { name, description }, transactions: calls.map((c) => ({ to: ethers.getAddress(c.to), value: '0', data: c.data })) };
}

/** Opens the Transaction Builder on a Safe, where the batch file is dropped in. */
export const txBuilderLink = (chainId: number, safe: string) =>
  `https://app.safe.global/apps/open?safe=${SHORT[chainId] ?? 'basesep'}:${ethers.getAddress(safe)}&appUrl=${encodeURIComponent(TX_BUILDER)}`;

/** A Safe's queue, where its signers find what waits. */
export const safeQueueLink = (chainId: number, safe: string) => `https://app.safe.global/transactions/queue?safe=${SHORT[chainId] ?? 'basesep'}:${ethers.getAddress(safe)}`;

export interface FundingProposal {
  /** Where it's signed: CL Operating, and the Safe that owns it. */
  safe: string;
  owner: string | null;
  /** Command's own Safe flow can't propose to a nested Safe; this is the batch instead. */
  via: 'transaction_builder';
  why: string;
  to: string;
  token: string;
  amount: string;
  link: string;
  queue: string;
  batch: SafeBatch;
}

const WHAT: Record<string, string> = { fee: 'Credit Enhancement Fee', spread_repayment: 'Spread Repayment', recovery: 'Recovery (the Credit Backstop’s share)' };

/** CL Operating → the CL Fees wallet: exactly the item's amount of USDC, one transfer. */
export function fundingProposal(input: {
  chainId: number;
  clOperating: string;
  clearLendingSafe: string | null;
  clFees: string;
  token: string;
  amount: bigint;
  kind: string;
  month: string;
  itemId: string;
  at?: number;
}): FundingProposal {
  if (input.amount <= 0n) throw new Error('Nothing to fund');
  const what = `${WHAT[input.kind] ?? input.kind}, ${input.month}`;
  const batch = safeBatch(
    input.chainId,
    `Fund the Assurance payment: ${what}`,
    `Moves ${usd(input.amount)} USDC from CL Operating ${ethers.getAddress(input.clOperating)} to the CL Fees wallet ${ethers.getAddress(input.clFees)}, which then pays it into the Assurance Pool on its own (approve and deposit, exactly this amount). IV-03 7.5 Step 5: sign only when Steps 1 to 4 are met. Command item ${input.itemId}. Review the call before signing.`,
    [{ to: input.token, data: transferData(ethers.getAddress(input.clFees), input.amount) }],
    input.at,
  );
  return {
    safe: ethers.getAddress(input.clOperating),
    owner: input.clearLendingSafe ? ethers.getAddress(input.clearLendingSafe) : null,
    via: 'transaction_builder',
    why: 'CL Operating is a nested Safe owned by the Clear Lending Safe; Command proposes only to the Ops Safe, with an owner’s own wallet, so this is a Transaction Builder batch for CL Operating instead.',
    to: ethers.getAddress(input.clFees),
    token: ethers.getAddress(input.token),
    amount: input.amount.toString(),
    link: txBuilderLink(input.chainId, input.clOperating),
    queue: safeQueueLink(input.chainId, input.clOperating),
    batch,
  };
}

/** The Clear Treasury Safe's interchange contribution: approve(pool, x), then deposit(INTERCHANGE, x). */
export function interchangeCalls(pool: string, token: string, amount: bigint) {
  if (amount <= 0n) throw new Error('Nothing to deposit');
  return [
    { to: ethers.getAddress(token), data: approveData(ethers.getAddress(pool), amount), label: `Let the Assurance Pool take ${usd(amount)}` },
    { to: ethers.getAddress(pool), data: depositData(SOURCE_TAG.INTERCHANGE, amount), label: `Deposit ${usd(amount)} as INTERCHANGE` },
  ];
}

export function interchangeBatch(input: { chainId: number; safe: string; pool: string; token: string; amount: bigint; interchange: bigint; bps: bigint; month: string; at?: number }): SafeBatch {
  return safeBatch(
    input.chainId,
    `Assurance Pool: interchange for ${input.month}`,
    `The co-op's policy contribution: ${Number(input.bps) / 100}% of ${usd(input.interchange)} card interchange for ${input.month}, ${usd(input.amount)}. From the Clear Treasury Safe ${ethers.getAddress(input.safe)}: approve the pool for exactly that amount, then deposit it under INTERCHANGE. Review every call before signing.`,
    interchangeCalls(input.pool, input.token, input.amount),
    input.at,
  );
}
