import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { recordUsdcRepayment } from './usdcRepaymentService.js';

/*
 * A term plan's life after it opens, run by the sweep. For each member holding plans:
 *
 *   1. Collect   what is due (arrears, oldest plan first, then carry a refund left on nothing) from
 *                the member's own USDC, if they switched on automatic repayment. The contract bounds
 *                it: a card settler, the mandate on, only what is due, once per ref.
 *   2. Default   a plan two installments overdue. `declareDefault` checks the schedule itself, so
 *                this only calls it when the chain says it is due. Term plans are written off; the
 *                member keeps their card, savings and membership.
 *   3. Reinstate a suspended member who paid back what was written off (anyone may), or who has had
 *                CLEAN_CYCLES clean cycles since (the co-op's call, so the operator key).
 *
 * A clean cycle is measured here as a cycle passing with the revolving line never frozen or in
 * default. The issuer cannot see cycles on the other line; this is where that judgement lives.
 */

export const CLEAN_CYCLES = 6;
const UNITS_PER_CENT = 10_000n;

const TERM_ABI = [
  'function planCount() view returns (uint256)',
  'function planAt(uint256 planId) view returns (address member, uint256 principal, uint256 principalOutstanding, uint256 repaid, uint64 openedAt, uint32 installments, uint64 installmentLength, uint256 ratePerCycle, bool closed)',
  'function totalArrearsOf(address member) view returns (uint256)',
  'function residualCarryOf(address member) view returns (uint256)',
  'function memberDefaultableAt(address member) view returns (uint256)',
  'function termSuspended(address member) view returns (bool)',
  'function writtenOffOf(address member) view returns (uint256)',
  'function recoveredOf(address member) view returns (uint256)',
  'function defaultedAt(address member) view returns (uint64)',
  'function collectForMember(bytes32 ref, address member, uint256 amount) returns (uint256)',
  'function declareDefault(address member) returns (uint256)',
  'function reinstate(address member)',
];
const REVOLVING_ABI = [
  'function autoRepayEnabled(address) view returns (bool)',
  'function stableCredit() view returns (address)',
  'function cycleLength() view returns (uint64)',
  'function hasDefaulted(address) view returns (bool)',
  'function isFrozen(address) view returns (bool)',
];

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}
const settlerKey = () => (process.env.CARD_SETTLER_PRIVATE_KEY || '').trim();
const operatorKey = () => (process.env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();

export interface LifecycleResult {
  wallet: string;
  action: 'collected' | 'defaulted' | 'reinstated' | 'failed';
  cents?: number;
  txHash?: string;
  reason?: string;
}

/*
 * Plans never reopen, so a closed plan is skipped for the life of the process rather than read
 * again every five minutes. A member whose plans are all closed is still visited while suspended.
 */
const closedPlanMember = new Map<number, string>();

/** Every member who holds, or has held, a plan -- with whether any of theirs is still open. */
async function termMembers(term: ethers.Contract): Promise<Map<string, boolean>> {
  const members = new Map<string, boolean>();
  const count = Number(await term.planCount());
  for (let id = 0; id < count; id++) {
    const known = closedPlanMember.get(id);
    if (known) {
      members.set(known, members.get(known) ?? false);
      continue;
    }
    const plan = await term.planAt(id);
    const member = String(plan[0]).toLowerCase();
    const open = !plan[8];
    if (!open) closedPlanMember.set(id, member);
    members.set(member, (members.get(member) ?? false) || open);
  }
  return members;
}

export async function sweepTermLifecycle(): Promise<LifecycleResult[]> {
  const termAddress = getContractAddress(chainId(), 'TermIssuer');
  const revolvingAddress = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!termAddress || !revolvingAddress || !settlerKey()) return [];

  const provider = chainProvider(chainId());
  const settler = new ethers.Wallet(settlerKey(), provider);
  const term = new ethers.Contract(termAddress, TERM_ABI, writesAs(settler));
  const revolving = new ethers.Contract(revolvingAddress, REVOLVING_ABI, provider);
  // A chain without the late-handling upgrade has nothing for this pass to call.
  if (!(await term.memberDefaultableAt(ethers.ZeroAddress).then(() => true).catch(() => false))) return [];

  const results: LifecycleResult[] = [];
  for (const [wallet, hasOpen] of await termMembers(term)) {
    try {
      if (hasOpen) {
        const collected = await collect(wallet, term, revolving, provider);
        if (collected) results.push(collected);
        const defaulted = await maybeDefault(wallet, term);
        if (defaulted) results.push(defaulted);
      }
      const reinstated = await maybeReinstate(wallet, term, revolving, provider);
      if (reinstated) results.push(reinstated);
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      console.error(`[term-lifecycle] ${wallet} failed: ${reason}`);
      results.push({ wallet, action: 'failed', reason });
    }
  }
  return results;
}

async function collect(
  wallet: string,
  term: ethers.Contract,
  revolving: ethers.Contract,
  provider: ethers.Provider,
): Promise<LifecycleResult | null> {
  if (!(await revolving.autoRepayEnabled(wallet))) return null;
  const [arrears, residual]: bigint[] = await Promise.all([term.totalArrearsOf(wallet), term.residualCarryOf(wallet)]);
  const due = arrears + residual;
  if (due === 0n) return null;

  // Bounded by what the member holds and approved: the contract would revert past either.
  const stableCredit = String(await revolving.stableCredit());
  const ledger = new ethers.Contract(stableCredit, ['function assurancePool() view returns (address)'], provider);
  const pool = new ethers.Contract(String(await ledger.assurancePool()), ['function reserveToken() view returns (address)'], provider);
  const usdc = new ethers.Contract(
    String(await pool.reserveToken()),
    ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'],
    provider,
  );
  const [held, allowed]: bigint[] = await Promise.all([usdc.balanceOf(wallet), usdc.allowance(wallet, stableCredit)]);
  let amount = due;
  for (const cap of [held, allowed]) if (cap < amount) amount = cap;
  if (amount <= 0n) return null;

  const ref = ethers.id(`term-collect:${wallet}:${Date.now()}`);
  const tx = await term.collectForMember(ref, wallet, amount);
  await tx.wait(1);
  // The books and Activity from the transaction's own events, as for any repayment.
  await recordUsdcRepayment(wallet, tx.hash, 'auto');
  const cents = Number(amount / UNITS_PER_CENT);
  console.log(`[term-lifecycle] ${wallet} collected ${cents}c due on plans from their USDC (${tx.hash})`);
  return { wallet, action: 'collected', cents, txHash: tx.hash };
}

async function maybeDefault(wallet: string, term: ethers.Contract): Promise<LifecycleResult | null> {
  const at = Number(await term.memberDefaultableAt(wallet));
  if (at === 0 || Date.now() / 1000 < at) return null;
  const tx = await term.declareDefault(wallet);
  await tx.wait(1);
  const writtenOff = Number((await term.writtenOffOf(wallet)) / UNITS_PER_CENT);
  console.warn(`[term-lifecycle] ${wallet} DEFAULTED on term plans; ${writtenOff}c written off in total (${tx.hash})`);
  return { wallet, action: 'defaulted', cents: writtenOff, txHash: tx.hash };
}

async function maybeReinstate(
  wallet: string,
  term: ethers.Contract,
  revolving: ethers.Contract,
  provider: ethers.Provider,
): Promise<LifecycleResult | null> {
  if (!(await term.termSuspended(wallet))) return null;
  const [writtenOff, recovered]: bigint[] = await Promise.all([term.writtenOffOf(wallet), term.recoveredOf(wallet)]);

  // Paid back in full: anyone may reinstate, so the settler does.
  if (recovered >= writtenOff) {
    const tx = await term.reinstate(wallet);
    await tx.wait(1);
    console.log(`[term-lifecycle] ${wallet} reinstated: paid back what was written off (${tx.hash})`);
    return { wallet, action: 'reinstated', txHash: tx.hash, reason: 'repaid' };
  }

  // Otherwise the co-op's call, after clean cycles on the card line.
  if (!operatorKey()) return null;
  const [defaultedAt, cycle, cardDefaulted, frozen] = await Promise.all([
    term.defaultedAt(wallet),
    revolving.cycleLength(),
    revolving.hasDefaulted(wallet),
    revolving.isFrozen(wallet),
  ]);
  const cleanSince = Number(defaultedAt) + CLEAN_CYCLES * Number(cycle);
  if (cardDefaulted || frozen || Date.now() / 1000 < cleanSince) return null;
  const operatorTerm = term.connect(writesAs(new ethers.Wallet(operatorKey(), provider))) as ethers.Contract;
  const tx = await operatorTerm.reinstate(wallet);
  await tx.wait(1);
  console.log(`[term-lifecycle] ${wallet} reinstated after ${CLEAN_CYCLES} clean cycles (${tx.hash})`);
  return { wallet, action: 'reinstated', txHash: tx.hash, reason: 'clean cycles' };
}
