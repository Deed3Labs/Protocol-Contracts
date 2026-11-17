import { merchantDb } from '../config/merchantDb.js';
import type { Db } from '../db/db.js';
import { alertOps } from '../services/opsAlert.js';
import { approveData, depositData, idempotencyKey, liveFeeChain, liveFeeSigner, mayPay, receiptMoved, type FeeChain, type FeeSigner, type ReceiptLite } from '../services/assuranceFees/chain.js';
import { assuranceFeeConfig, type AssuranceFeeConfig } from '../services/assuranceFees/config.js';
import { usd, utcDay } from '../services/assuranceFees/feeMath.js';
import {
  accrueFees,
  claimSend,
  knownDeposits,
  markFailed,
  markFunded,
  markPaid,
  nextAttempt,
  recordApprove,
  recordDeposit,
  recordSnapshot,
  unpaid,
  type Item,
} from '../services/assuranceFees/store.js';

/*
 * The Assurance fee payer (docs/operators/assurance-fee-payer.md; IV-03 7.5 Step 5, 8.3 and 8.7).
 *
 * Hourly, it:
 * 1. reads the pool once a UTC day (availableCoverage, backstopBalance, backstopFloor, coverageCap)
 *    and keeps the reading; a day it missed is filled with what it reads now, marked filled;
 * 2. after each month ends, works out its Credit Enhancement Fee (8% a year on average daily
 *    Available Coverage, actual/365, rounded down) and records it due, once;
 * 3. pays what is owed, oldest first, from Clear Lending's CL Fees wallet once that wallet holds it:
 *    approve(pool, exactly the amount), then pool.deposit(tag, amount), each dry-run first, each
 *    waited for. The only human step is before this: CL Operating's signers moving the money to the
 *    CL Fees wallet (Command proposes it), which is Step 5's confirmation.
 *
 * Never more than recorded, never twice: an item is claimed into `sending` by one guarded UPDATE,
 * the deposit hash is written the moment it exists, and after a restart a send in flight is settled
 * from the chain (its receipt, the wallet's pending transactions, the allowance, and the token
 * transfers to the pool) before anything is sent again. Any revert or surprise stops all paying at
 * `failed` and alerts (OPS_ALERT_EMAIL, the payout keeper's channel) until a person retries it.
 *
 * Reading and accruing run whenever the pool's address is set (ASSURANCE_POOL_V2_<chain>). Paying
 * also needs ASSURANCE_FEE_PAYER_ENABLED=1. Logs name addresses only.
 */

const HOUR_MS = 60 * 60 * 1000;
/** Passes in a row that fail to read the pool before someone is told. */
const FAILURES_BEFORE_ALERT = 3;
/** How long a deposit may sit unmined before someone is told. */
const STUCK_MS = 30 * 60 * 1000;

export interface PayerDeps {
  db: Db;
  config: AssuranceFeeConfig;
  chain: FeeChain;
  /** The CL Fees wallet; null when paying is off. */
  signer: FeeSigner | null;
  alert: (input: { key: string; subject: string; body: string }) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  receiptTimeoutMs?: number;
  receiptPollMs?: number;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

export type PayOutcome = 'off' | 'nothing' | 'paid' | 'waiting' | 'pending' | 'stopped' | 'failed';

export interface TickReport {
  snapshot: string[] | 'failed' | 'off';
  accrued: Array<{ month: string; fee: bigint }>;
  pay: PayOutcome;
  paid: string[];
}

const TAG_NAME = ['CREDIT_ENHANCEMENT_FEE', 'RECOVERY', 'INTERCHANGE', 'BOARD_ALLOCATION'];
const KIND_NAME: Record<string, string> = { fee: 'Credit Enhancement Fee', spread_repayment: 'Spread Repayment', recovery: 'Recovery' };
const describe = (i: Item) => `${KIND_NAME[i.kind] ?? i.kind} for ${i.month} (${usd(i.amount)}, ${TAG_NAME[i.sourceTag]}, item ${i.id})`;
const why = (e: unknown) => ((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? String(e)).slice(0, 300);

export function createAssuranceFeePayer(deps: PayerDeps) {
  const { db, config, chain } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((l: string) => console.log(l));
  const warn = deps.warn ?? ((l: string) => console.warn(l));
  const timeout = deps.receiptTimeoutMs ?? 180_000;
  const poll = deps.receiptPollMs ?? 3_000;
  let failures = 0;
  let running = false;

  const alert = (key: string, subject: string, body: string) =>
    deps.alert({ key: `assurance-fee:${config.chainId}:${key}`, subject, body }).catch((e) => warn(`[assurance-fees] alert failed: ${why(e)}`));

  async function waitReceipt(hash: string): Promise<ReceiptLite | null> {
    const started = Date.now();
    for (;;) {
      const r = await chain.receipt(hash);
      if (r) return r;
      if (Date.now() - started >= timeout) return null;
      await sleep(poll);
    }
  }

  /** Stops everything at failed, and says so. */
  async function fail(item: Item, reason: string): Promise<PayOutcome> {
    await markFailed(db, item.id, reason);
    warn(`[assurance-fees] stopped: ${describe(item)}: ${reason}`);
    await alert(
      `failed:${item.id}:${item.attempt}`,
      'Assurance fee payer stopped',
      `The Assurance fee payer stopped on ${describe(item)}.\n\n${reason}\n\nNothing more is paid into the Assurance Pool until a person looks and retries it in Command Center (Money, Pools, AssurancePool, Assurance fees). Pool ${config.pool}, CL Fees wallet ${item.payer ?? config.clFees}.`,
    );
    return 'failed';
  }

  /** approve (unless the allowance is already there), then deposit; each dry-run first and waited for. */
  async function approveAndDeposit(item: Item, token: string, payer: string, skipApprove: boolean): Promise<PayOutcome> {
    const pool = config.pool!;
    if (!skipApprove) {
      const approve = { from: payer, to: token, data: approveData(pool, item.amount) };
      try {
        await chain.dryRun(approve);
      } catch (e) {
        return fail(item, `The approve would revert: ${why(e)}`);
      }
      const hash = await deps.signer!.send({ to: token, data: approve.data }, idempotencyKey('assurance', item.id, item.attempt, 'approve'));
      await recordApprove(db, item.id, hash);
      log(`[assurance-fees] approve ${hash} from ${payer}: ${describe(item)}`);
      const r = await waitReceipt(hash);
      if (!r) {
        warn(`[assurance-fees] approve ${hash} not mined yet; settled from the chain next pass`);
        return 'pending';
      }
      if (r.status !== 1) return fail(item, `The approve reverted (${hash})`);
    }
    const allowance = await chain.allowance(token, payer, pool);
    if (allowance < item.amount) return fail(item, `The pool may take ${allowance} base units, less than the ${item.amount} due`);
    const deposit = { from: payer, to: pool, data: depositData(item.sourceTag, item.amount) };
    try {
      await chain.dryRun(deposit);
    } catch (e) {
      return fail(item, `The deposit would revert: ${why(e)}`);
    }
    let hash: string;
    try {
      hash = await deps.signer!.send({ to: pool, data: deposit.data }, idempotencyKey('assurance', item.id, item.attempt, 'deposit'));
    } catch (e) {
      // it may or may not have left: settled from the chain next pass, never sent again blind
      warn(`[assurance-fees] the deposit send errored (${why(e)}); settled from the chain next pass`);
      await alert(`send-error:${item.id}:${item.attempt}`, 'Assurance fee deposit: send errored', `Sending the deposit for ${describe(item)} errored: ${why(e)}\n\nIt may or may not have gone out. The payer checks the chain next pass before it sends anything again.`);
      return 'pending';
    }
    await recordDeposit(db, item.id, hash);
    log(`[assurance-fees] deposit ${hash} from ${payer}: ${describe(item)}`);
    return settleDeposit({ ...item, depositTx: hash.toLowerCase() }, token, payer);
  }

  async function settleDeposit(item: Item, token: string, payer: string): Promise<PayOutcome> {
    const hash = item.depositTx!;
    const r = await waitReceipt(hash);
    if (!r) {
      if (item.sendStartedAt && now().getTime() - item.sendStartedAt.getTime() > STUCK_MS) {
        await alert(`stuck:${item.id}:${hash}`, 'Assurance fee deposit not mined', `The deposit ${hash} for ${describe(item)} has not been mined after 30 minutes. The payer is waiting on it and sends nothing else.`);
      }
      return 'pending';
    }
    if (r.status !== 1) return fail(item, `The deposit reverted (${hash})`);
    if (!receiptMoved(r, token, payer, config.pool!, item.amount)) return fail(item, `The deposit ${hash} succeeded but moved no ${item.amount} from ${payer} to the pool`);
    await markPaid(db, item.id, hash, now());
    log(`[assurance-fees] paid: ${describe(item)} in ${hash}`);
    return 'paid';
  }

  /** A deposit since the item's first attempt, from the payer to the pool, for exactly its amount, that no other item owns. */
  async function landedDeposit(item: Item, token: string, payer: string): Promise<string | null> {
    if (item.sendBlock == null) return null;
    const known = await knownDeposits(db);
    const found = (await chain.transfers(token, payer, config.pool!, item.sendBlock)).filter((t) => t.value === item.amount && !known.has(t.hash.toLowerCase()));
    return found[0]?.hash ?? null;
  }

  /**
   * A send that was in flight when the server stopped (or whose receipt never came). Settled from the
   * chain before anything is sent again, in this order: the deposit's receipt if its hash is known;
   * else wait while the wallet has anything pending; else the allowance (read first), then a transfer
   * to the pool since the first attempt. Found: paid. Allowance still there: only the deposit is
   * sent. Neither: the approve didn't land, so it starts again (approve sets, it never adds).
   */
  async function recover(item: Item, token: string, payer: string): Promise<PayOutcome> {
    if (item.depositTx) return settleDeposit(item, token, payer);
    const n = await chain.nonces(payer);
    if (n.pending > n.latest) {
      log(`[assurance-fees] ${payer} has ${n.pending - n.latest} transaction(s) in flight; waiting before settling ${describe(item)}`);
      return 'pending';
    }
    const allowance = await chain.allowance(token, payer, config.pool!);
    const landed = await landedDeposit(item, token, payer);
    if (landed) {
      await markPaid(db, item.id, landed, now());
      log(`[assurance-fees] found the deposit on chain after a restart: ${describe(item)} in ${landed}`);
      return 'paid';
    }
    const again = await nextAttempt(db, item.id, now());
    if (!again) return 'stopped';
    log(`[assurance-fees] resuming ${describe(again)}: ${allowance >= item.amount ? 'the approve landed, sending the deposit' : 'nothing landed, starting from the approve'}`);
    return approveAndDeposit(again, token, payer, allowance >= item.amount);
  }

  async function pay(): Promise<{ outcome: PayOutcome; paid: string[] }> {
    const paid: string[] = [];
    const queue = await unpaid(db, config.chainId);
    if (!queue.length) return { outcome: 'nothing', paid };
    const stuck = queue.find((i) => i.status === 'failed');
    if (stuck) {
      log(`[assurance-fees] stopped: ${describe(stuck)} failed (${stuck.error ?? 'no reason recorded'}); a person must retry it`);
      return { outcome: 'stopped', paid };
    }
    const pool = config.pool!;
    const token = await chain.asset(pool);
    const wallet = config.clFees!;
    for (const item of queue) {
      if (item.status === 'due') {
        log(`[assurance-fees] waiting: ${describe(item)} has no funding proposal yet (Command Center proposes CL Operating's transfer)`);
        return { outcome: 'waiting', paid };
      }
      if (item.status !== 'sending') {
        const balance = await chain.balanceOf(token, wallet);
        if (balance < item.amount) {
          log(`[assurance-fees] waiting: the CL Fees wallet ${wallet} holds ${usd(balance)}, short of ${describe(item)}`);
          return { outcome: 'waiting', paid };
        }
        if (item.status === 'funding_proposed') await markFunded(db, item.id, now());
      }
      if (!config.payerEnabled || !deps.signer) {
        log(`[assurance-fees] ${describe(item)} is funded; paying is off (ASSURANCE_FEE_PAYER_ENABLED)`);
        return { outcome: 'off', paid };
      }
      const payer = await deps.signer.address();
      if (payer.toLowerCase() !== wallet.toLowerCase()) {
        await alert('wrong-wallet', 'Assurance fee payer: wrong wallet', `The CDP wallet resolves to ${payer}, not the CL Fees wallet ${wallet}. Nothing was sent. Check ASSURANCE_FEE_PAYER_CDP_ACCOUNT_NAME.`);
        warn(`[assurance-fees] stopped: the signer is ${payer}, not the CL Fees wallet ${wallet}`);
        return { outcome: 'stopped', paid };
      }
      let outcome: PayOutcome;
      if (item.status === 'sending') {
        outcome = await recover(item, token, payer);
      } else {
        const tags = await chain.payerTags(pool, payer);
        if (!mayPay(tags, item.sourceTag)) {
          outcome = await fail(item, `${payer} is not an allowlisted payer for ${TAG_NAME[item.sourceTag]} (payerTags ${tags})`);
          return { outcome, paid };
        }
        const n = await chain.nonces(payer);
        if (n.pending > n.latest) {
          log(`[assurance-fees] ${payer} has a transaction in flight; waiting`);
          return { outcome: 'pending', paid };
        }
        const claimed = await claimSend(db, item.id, { payer, block: await chain.block(), at: now() });
        if (!claimed) return { outcome: 'stopped', paid };
        // tried before (a person retried a failure): look on chain for a deposit that did land first
        const landed = claimed.attempt > 1 ? await landedDeposit(claimed, token, payer) : null;
        if (landed) {
          await markPaid(db, claimed.id, landed, now());
          log(`[assurance-fees] found an earlier deposit on chain: ${describe(claimed)} in ${landed}`);
          outcome = 'paid';
        } else {
          outcome = await approveAndDeposit(claimed, token, payer, false);
        }
      }
      if (outcome !== 'paid') return { outcome, paid };
      paid.push(item.id);
    }
    return { outcome: 'paid', paid };
  }

  async function tick(): Promise<TickReport | 'busy'> {
    if (running) return 'busy';
    running = true;
    const report: TickReport = { snapshot: 'off', accrued: [], pay: 'off', paid: [] };
    try {
      if (!config.pool) return report;
      const today = utcDay(now());
      try {
        const reading = await chain.readPool(config.pool);
        report.snapshot = await recordSnapshot(db, { chainId: config.chainId, pool: config.pool, today, reading });
        failures = 0;
        if (report.snapshot.length) log(`[assurance-fees] read ${config.pool}: availableCoverage ${usd(reading.availableCoverage)} for ${report.snapshot.join(', ')}`);
      } catch (e) {
        failures += 1;
        report.snapshot = 'failed';
        warn(`[assurance-fees] could not read the pool (${failures} in a row): ${why(e)}`);
        if (failures >= FAILURES_BEFORE_ALERT) await alert(`read-failed:${today}`, 'Assurance fee payer cannot read the pool', `The Assurance fee payer has failed to read ${config.pool} ${failures} times in a row, so today's Available Coverage isn't recorded. A missed day is filled by the next good read.\n\nLast error: ${why(e)}`);
      }
      report.accrued = await accrueFees(db, { chainId: config.chainId, today, bps: config.feeBps });
      for (const a of report.accrued) log(`[assurance-fees] accrued the ${a.month} Credit Enhancement Fee: ${usd(a.fee)}`);
      if (config.clFees) {
        try {
          const r = await pay();
          report.pay = r.outcome;
          report.paid = r.paid;
        } catch (e) {
          report.pay = 'failed';
          warn(`[assurance-fees] paying failed: ${why(e)}`);
          await alert(`pass-failed:${today}`, 'Assurance fee payer pass failed', `A pass of the Assurance fee payer failed: ${why(e)}\n\nAn item caught sending is settled from the chain next pass before anything is sent again.`);
        }
      }
      return report;
    } catch (e) {
      warn(`[assurance-fees] pass failed: ${why(e)}`);
      return report;
    } finally {
      running = false;
    }
  }

  return { tick };
}

export function startAssuranceFeePayer(): void {
  const config = assuranceFeeConfig();
  if (!config.pool) {
    console.log(`[assurance-fees] off (no AssurancePoolV2 address for chain ${config.chainId}: set ASSURANCE_POOL_V2_${config.chainId} once it's deployed)`);
    return;
  }
  let signer: FeeSigner | null = null;
  if (config.payerEnabled) {
    try {
      signer = liveFeeSigner(config);
    } catch (e) {
      console.error(`[assurance-fees] paying is on but the CL Fees wallet can't be used: ${why(e)}`);
    }
  }
  const chain = liveFeeChain(config.chainId);
  let payer: ReturnType<typeof createAssuranceFeePayer> | null = null;
  const run = async () => {
    if (!payer) {
      const db = await merchantDb().catch(() => null);
      if (!db) return console.warn('[assurance-fees] no database; nothing recorded');
      payer = createAssuranceFeePayer({ db, config, chain, signer, alert: alertOps });
    }
    await payer.tick();
  };
  setInterval(() => void run(), HOUR_MS).unref?.();
  void run();
  console.log(
    `[assurance-fees] started (hourly): pool ${config.pool}, CL Fees ${config.clFees ?? 'unset'}, fee ${Number(config.feeBps) / 100}% a year, paying ${config.payerEnabled ? (signer ? 'on' : 'on but no wallet') : 'off'}`,
  );
}
