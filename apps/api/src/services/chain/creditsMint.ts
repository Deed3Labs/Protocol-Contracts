import { ethers } from 'ethers';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider } from './provider.js';
import { envCount, keeperChainId, keeperMode, liveRunner, type CallRunner, type KeeperMode } from './keeperKit.js';
import type { DecodedChainError } from './chainErrors.js';
import { asOperator } from './operatorQueue.js';
import { networkFromChainId, payLedgerStore, type CreditNetwork, type MintableCredit } from '../payLedgerStore.js';
import { memberStore } from '../memberStore.js';

/*
 * The credits minting job: what the ledger has vested, minted on chain by the Points Issuer.
 *
 * Every rent, bill and saving credit is a row in pay_credits. Once its 30 days have passed it is
 * `vested`, and this job asks PointsIssuer.mint(member, amount, source, ref) for it, with
 * ref = keccak256(row id), so a row can mint only once however often the job runs. A saving credit
 * needs the member's Match Period open on chain, which this job opens from their join date the first
 * time (MEMBERS_ROLE; the same credit operator key holds both roles on Base Sepolia).
 *
 * The contract has the last word on the rules:
 *   - a ref it has already minted marks the row minted;
 *   - outside the Match Period, past the 54,000 lifetime cap, or a source it does not take: the row is
 *     void, with the reason kept;
 *   - the month's saving cap (counted by the month a credit is minted): the row waits for next month;
 *   - anything else (RPC down, gas): counted and retried next run, up to 5 times.
 *
 * Off unless CREDITS_MINT_ENABLED=1; CREDITS_MINT_DRY_RUN=1 simulates and reports without sending.
 * Sends from CREDIT_OPERATOR_PRIVATE_KEY through the operator's queue. At most CREDITS_MINT_MAX_PER_RUN
 * rows a run (default 50).
 */

export const POINTS_ISSUER_ABI = [
  'function mint(address member, uint256 amount, bytes32 source, bytes32 ref)',
  'function openMatchPeriod(address member, uint64 start)',
  'function mintOf(bytes32 ref) view returns (address member, uint128 amount, bytes32 source)',
  'function matchPeriodOf(address member) view returns (uint64 start, uint64 end, bool closed)',
  'function earnedOf(address member) view returns (uint256)',
  'function earnedBySource(address member, bytes32 source) view returns (uint256)',
  'function balanceOf(address member) view returns (uint256)',
] as const;
const ISSUER = new ethers.Interface(POINTS_ISSUER_ABI as unknown as string[]);

/** Credits have 6 decimals on the ledger, like the other StableCredit instance. */
export const CREDIT_UNITS = 1_000_000n;

export const SOURCE = {
  SAVING: ethers.encodeBytes32String('SAVING'),
  RENT: ethers.encodeBytes32String('RENT'),
  BILL: ethers.encodeBytes32String('BILL'),
} as const;

/** The Points Issuer source for a ledger row, by why it was earned. */
export function sourceOf(reason: string): string | null {
  if (reason === 'deposit_match') return SOURCE.SAVING;
  if (reason === 'rent_on_time') return SOURCE.RENT;
  if (reason === 'bill_on_time') return SOURCE.BILL;
  return null;
}

/** The mint's ref: unique per row, so the Points Issuer mints each row once. */
export const refOf = (rowId: string) => ethers.keccak256(ethers.toUtf8Bytes(rowId));

/** How the job treats each of the Points Issuer's refusals. */
export function refusalOf(decoded: DecodedChainError | null): 'minted' | 'void' | 'wait' | 'open_period' | null {
  switch (decoded?.name) {
    case 'PointsIssuerRefUsed':
      return 'minted';
    case 'PointsIssuerNoMatchPeriod':
    case 'PointsIssuerMatchPeriodSet': // opening one that is already open: carry on to the mint
      return 'open_period';
    case 'PointsIssuerOutsideMatchPeriod':
    case 'PointsIssuerLifetimeCap':
    case 'PointsIssuerSourceNotAllowed':
      return 'void';
    case 'PointsIssuerMonthlyCap':
      return 'wait';
    default:
      return null;
  }
}

const describeMintRefusal = (decoded: DecodedChainError | null) => (refusalOf(decoded) ? decoded!.name : null);

export interface CreditsMintDeps {
  mode: 'dry_run' | 'live';
  issuer: string;
  network: CreditNetwork;
  runner: CallRunner;
  rows: {
    mintable(limit: number): Promise<MintableCredit[]>;
    minted(id: string, tx: string): Promise<void>;
    refused(id: string, reason: string): Promise<void>;
    failed(id: string, reason: string): Promise<void>;
  };
  joinedAt(wallet: string): Promise<Date | null>;
  maxPerRun: number;
}

export interface CreditsMintRun {
  checked: number;
  minted: number;
  credits: number;
  periodsOpened: number;
  voided: number;
  waiting: number;
  failed: number;
  wouldMint: number;
}

const call = (issuer: string, fn: string, args: unknown[]) => ({ to: issuer, data: ISSUER.encodeFunctionData(fn, args) });

export async function runCreditsMint(d: CreditsMintDeps): Promise<CreditsMintRun> {
  const run: CreditsMintRun = { checked: 0, minted: 0, credits: 0, periodsOpened: 0, voided: 0, waiting: 0, failed: 0, wouldMint: 0 };
  const dry = d.mode === 'dry_run';
  // A dry run changes nothing: no transaction and no ledger write. It only counts what a live run would do.
  const rows = dry ? { minted: async () => {}, refused: async () => {}, failed: async () => {} } : d.rows;
  // Members whose Match Period this run opened, or in a dry run would open: one each, however many rows.
  const opened = new Set<string>();
  for (const row of await d.rows.mintable(d.maxPerRun)) {
    run.checked += 1;
    const source = sourceOf(row.reason);
    if (!source || !(row.amount > 0) || !Number.isInteger(row.amount)) {
      await rows.refused(row.id, `not mintable: ${row.reason} ${row.amount}`);
      run.voided += 1;
      continue;
    }
    const mint = call(d.issuer, 'mint', [row.wallet, BigInt(row.amount) * CREDIT_UNITS, source, refOf(row.id)]);
    const member = row.wallet.toLowerCase();
    try {
      let sim = await d.runner.simulate(mint);
      if (sim.kind === 'refused' && refusalOf(sim.error) === 'open_period') {
        if (!opened.has(member)) {
          // The member's first saving credit: open their Match Period from their join date.
          const start = Math.floor(((await d.joinedAt(row.wallet)) ?? row.createdAt).getTime() / 1000);
          const open = call(d.issuer, 'openMatchPeriod', [row.wallet, start]);
          const openSim = await d.runner.simulate(open);
          if (openSim.kind === 'failed') throw new Error(openSim.reason);
          opened.add(member);
          if (openSim.kind === 'ok') {
            if (!dry) {
              const r = await d.runner.send(open);
              if (r.status !== 1) throw new Error(`openMatchPeriod reverted in ${r.hash}`);
            }
            run.periodsOpened += 1;
          }
        }
        if (dry) {
          // Nothing was sent, so the mint can't be simulated after the opening: count it as a would-mint.
          run.wouldMint += 1;
          continue;
        }
        sim = await d.runner.simulate(mint);
      }
      if (sim.kind === 'failed') throw new Error(sim.reason);
      if (sim.kind === 'refused') {
        const how = refusalOf(sim.error);
        if (how === 'minted') {
          await rows.minted(row.id, 'onchain');
          run.minted += 1;
        } else if (how === 'wait') {
          run.waiting += 1;
        } else {
          await rows.refused(row.id, sim.error.name);
          run.voided += 1;
        }
        continue;
      }
      if (dry) {
        run.wouldMint += 1;
        continue;
      }
      const r = await d.runner.send(mint);
      if (r.status !== 1) throw new Error(`mint reverted in ${r.hash}`);
      await rows.minted(row.id, r.hash);
      run.minted += 1;
      run.credits += row.amount;
    } catch (error) {
      run.failed += 1;
      await rows.failed(row.id, String((error as Error)?.message ?? error)).catch(() => {});
    }
  }
  return run;
}

export function summarize(run: CreditsMintRun, mode: 'dry_run' | 'live'): string {
  if (mode === 'dry_run') {
    return `[credits-mint] dry run, nothing sent: ${run.checked} checked, would mint ${run.wouldMint}, would open ${run.periodsOpened} match period${run.periodsOpened === 1 ? '' : 's'}, ${run.minted} already minted, ${run.voided} would be void, ${run.waiting} waiting for next month, ${run.failed} failed`;
  }
  return `[credits-mint] ${run.checked} checked: minted ${run.minted} (${run.credits} credits), ${run.periodsOpened} match period${run.periodsOpened === 1 ? '' : 's'} opened, ${run.voided} void, ${run.waiting} waiting for next month, ${run.failed} failed`;
}

export const creditsMintMode = (env: Record<string, string | undefined> = process.env): KeeperMode => keeperMode('CREDITS_MINT', env);

const operatorKey = (env: Record<string, string | undefined>) => (env.CREDIT_OPERATOR_PRIVATE_KEY || '').trim();

/** Why the job cannot run, or null when it can. */
export function creditsMintUnconfigured(env: Record<string, string | undefined> = process.env): string | null {
  const chainId = keeperChainId(env);
  if (!getContractAddress(chainId, 'PointsIssuer')) return `no PointsIssuer on chain ${chainId}`;
  if (!operatorKey(env)) return 'CREDIT_OPERATOR_PRIVATE_KEY unset';
  return null;
}

export function creditsMintDeps(mode: 'dry_run' | 'live', env: Record<string, string | undefined> = process.env): CreditsMintDeps | null {
  if (creditsMintUnconfigured(env)) return null;
  const chainId = keeperChainId(env);
  return {
    mode,
    issuer: getContractAddress(chainId, 'PointsIssuer')!,
    network: networkFromChainId(chainId),
    runner: liveRunner(chainId, operatorKey(env), { describe: describeMintRefusal, lock: asOperator }),
    rows: {
      mintable: (limit) => payLedgerStore.mintableCredits(networkFromChainId(chainId), limit),
      minted: (id, tx) => payLedgerStore.markCreditMinted(id, tx),
      refused: (id, reason) => payLedgerStore.markCreditRefused(id, reason),
      failed: (id, reason) => payLedgerStore.markCreditMintFailed(id, reason),
    },
    joinedAt: (wallet) => memberStore.getJoinedAtByWallet(wallet).catch(() => null),
    maxPerRun: envCount('CREDITS_MINT_MAX_PER_RUN', 50, env),
  };
}

/** A member's credits as the chain records them: balance, earned in all, and earned by source. */
export async function readCreditsOnChain(
  wallet: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ balance: number; earned: number; bySource: { saving: number; rent: number; bill: number } } | null> {
  const chainId = keeperChainId(env);
  const issuer = getContractAddress(chainId, 'PointsIssuer');
  if (!issuer) return null;
  const c = new ethers.Contract(issuer, POINTS_ISSUER_ABI as unknown as string[], chainProvider(chainId));
  const whole = (v: bigint) => Number(v / CREDIT_UNITS);
  const [balance, earned, saving, rent, bill] = await Promise.all([
    c.balanceOf(wallet) as Promise<bigint>,
    c.earnedOf(wallet) as Promise<bigint>,
    c.earnedBySource(wallet, SOURCE.SAVING) as Promise<bigint>,
    c.earnedBySource(wallet, SOURCE.RENT) as Promise<bigint>,
    c.earnedBySource(wallet, SOURCE.BILL) as Promise<bigint>,
  ]);
  return { balance: whole(balance), earned: whole(earned), bySource: { saving: whole(saving), rent: whole(rent), bill: whole(bill) } };
}
