import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { getContractAddress } from '../config/contracts.js';
import { merchantDb } from '../config/merchantDb.js';
import { chainProvider } from '../services/chain/provider.js';
import { alertOps } from '../services/opsAlert.js';
import { cdpTopUpSender } from '../services/payoutFunding/topUpCdp.js';
import {
  ALLOWANCE_MODULE_ABI,
  CANONICAL_ALLOWANCE_MODULE,
  CL_OPERATING_BASE_SEPOLIA,
  ERC20_ABI,
  PAYOUT_POOL_TOPUP_ABI,
  SAFE_MODULE_ABI,
  assertTopUpCall,
  capRemaining,
  decideTopUp,
  formatUsdc,
  gatherTopUp,
  remainderBatch,
  resetsAt,
  topUpCalls,
  topUpConfigFromEnv,
  type TopUpAddresses,
  type TopUpCall,
  type TopUpConfig,
  type TopUpDecision,
  type TopUpReads,
} from '../services/payoutFunding/topUp.js';
import { topUpStore, type TopUpRow, type TopUpStore } from '../services/payoutFunding/topUpStore.js';

/*
 * Bounded automatic PayoutPool top-ups (decision 51). services/payoutFunding/topUp.ts has the rules;
 * this runs them: a check every PAYOUT_TOPUP_CHECK_MINUTES (15) of view reads, and, when the low
 * horizon is short, one top-up of three transactions from the top-up wallet (a CDP server wallet):
 * the allowance transfer out of CL Operating, approve, fund. Each is dry-run first (eth_call and
 * estimateGas), then sent, then waited for.
 *
 * Every top-up is recorded before its first transaction (migration 0078), with its trigger, the
 * projections and the amount. At most one is in flight per pool, and a check with one in flight
 * finishes it rather than starting another. A restart finishes it from the chain: the receipts it
 * recorded; the allowance's nonce (past the one recorded, the pull happened); the wallet's balance
 * and approval (the wallet holds nothing between top-ups). Each send carries an idempotency key
 * derived from the top-up and the step, so a send repeated after a crash is the same transaction to
 * CDP. So one trigger is never funded twice.
 *
 * Any revert, on a dry run or on chain, stops it: the top-up is marked failed, ops is alerted, and
 * nothing moves until a person clears it (src/scripts/clearPayoutTopUpHalt.ts). A read that fails is
 * only retried; three in a row alert.
 *
 * What the cap cannot cover is prepared as a Transaction Builder batch for CL Operating (a transfer
 * to the top-up wallet, which funds it on its next check) and alerted, with the batch in the alert
 * and on the Command Center. When CL Operating itself lacks the money it alerts and does not try.
 *
 * Off unless PAYOUT_TOPUP_ENABLED=1. The read-only keeper (payoutFundingKeeper.ts) is separate and
 * unchanged: it keeps alerting on 12.10 and the standing balance whether this runs or not.
 */

const MINUTE_MS = 60_000;
const FAILURES_BEFORE_ALERT = 3;

export class TopUpRevert extends Error {}

export interface TopUpTx {
  to: string;
  data: string;
}

/** The chain and the wallet, as the job needs them; mocked in tests. */
export interface TopUpChain {
  read(): Promise<TopUpReads>;
  /** The wallet's USDC, its approval to the PayoutPool, and the allowance's nonce, read now. */
  state(): Promise<{ walletBalance: bigint; walletPoolAllowance: bigint; nonce: number }>;
  encode(call: TopUpCall): string;
  encodeTransfer(to: string, amount: bigint): string;
  /** eth_call and estimateGas from the wallet. Throws TopUpRevert when the call reverts. */
  dryRun(tx: TopUpTx): Promise<void>;
  /** Sends from the top-up wallet; the same key twice is the same transaction. Returns its hash. */
  send(tx: TopUpTx, idempotencyKey: string): Promise<string>;
  /** The receipt's status, or null while it is not mined. */
  receipt(hash: string): Promise<{ status: number } | null>;
}

export interface TopUpDeps {
  chainId: number;
  addresses: TopUpAddresses;
  config: TopUpConfig;
  chain: TopUpChain;
  store: TopUpStore;
  alert: (input: { key: string; subject: string; body: string }) => Promise<void>;
  /** How long one check waits for a receipt before leaving it for the next check. */
  receiptTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  debug?: (line: string) => void;
  warn?: (line: string) => void;
}

export type TopUpTick = 'idle' | 'funded' | 'pending' | 'needs-human' | 'operating-short' | 'setup' | 'halted' | 'failed' | 'busy';

/** A v4-shaped UUID from the top-up and the step: CDP sees a repeated send as the same request. */
export function idempotencyKey(chainId: number, pool: string, id: number, step: string): string {
  const h = createHash('sha256').update(`payout-topup:${chainId}:${pool.toLowerCase()}:${id}:${step}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const s = (v: bigint) => v.toString();

/** The check as the Command Center shows it (amounts in USDC base units, as strings). */
export function checkSnapshot(deps: Pick<TopUpDeps, 'addresses' | 'config'>, reads: TopUpReads, decision: TopUpDecision, extra: { needsHuman?: unknown; halted?: TopUpRow | null; outcome: TopUpTick }) {
  const p = (x: TopUpReads['low'], days: number) => ({ days, amount: s(x.amount), short: s(x.short), listed: x.listed, truncated: x.truncated });
  const remaining = capRemaining(reads.allowance, deps.config.capOverride);
  return {
    enabled: true,
    now: reads.now,
    addresses: deps.addresses,
    held: s(reads.held),
    payable: s(reads.payable),
    overdue: p(reads.overdue, 0),
    low: p(reads.low, deps.config.lowDays),
    target: p(reads.target, deps.config.targetDays),
    margin: s(deps.config.margin),
    operatingBalance: s(reads.operatingBalance),
    walletBalance: s(reads.walletBalance),
    allowance: {
      cap: s(deps.config.capOverride !== null && deps.config.capOverride < reads.allowance.amount ? deps.config.capOverride : reads.allowance.amount),
      chainCap: s(reads.allowance.amount),
      spent: s(reads.allowance.spent),
      remaining: s(remaining),
      resetMinutes: reads.allowance.resetTimeMin,
      resetsAt: resetsAt(reads.allowance),
    },
    setup: { moduleEnabled: reads.moduleEnabled, isFunder: reads.isFunder, otherRoles: reads.otherRoles },
    decision: JSON.parse(JSON.stringify(decision, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
    needsHuman: extra.needsHuman ?? null,
    halted: extra.halted ? { id: extra.halted.id, error: extra.halted.error, at: extra.halted.finishedAt } : null,
    outcome: extra.outcome,
  };
}

export function createPayoutTopUp(deps: TopUpDeps) {
  const log = deps.log ?? ((l: string) => console.log(l));
  const debug = deps.debug ?? ((l: string) => (process.env.PAYOUT_TOPUP_DEBUG ? console.log(l) : undefined));
  const warn = deps.warn ?? ((l: string) => console.warn(l));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = deps.receiptTimeoutMs ?? 120_000;
  const pollMs = deps.pollMs ?? 2_000;
  const { addresses: a, chain, store } = deps;
  const where = `chain ${deps.chainId}, PayoutPool ${a.payoutPool}`;
  let failures = 0;
  let running = false;

  const day = (now: number) => new Date(now * 1000).toISOString().slice(0, 10);

  async function waitReceipt(hash: string): Promise<{ status: number } | null> {
    const started = Date.now();
    for (;;) {
      const r = await chain.receipt(hash);
      if (r) return r;
      if (Date.now() - started >= timeoutMs) return null;
      await sleep(pollMs);
    }
  }

  async function fail(row: TopUpRow, why: string): Promise<TopUpTick> {
    const failed = await store.update(row.id, { status: 'failed', error: why });
    await deps.alert({
      key: `payout-topup:failed:${deps.chainId}:${a.payoutPool.toLowerCase()}:${row.id}`,
      subject: `Automatic payout top-up stopped: ${why}`,
      body:
        `Top-up #${row.id} (${formatUsdc(row.amount)}, ${row.trigger}) on ${where} stopped: ${why}.\n\n` +
        `Transactions so far: pull ${row.pullTx ?? '-'}, approve ${row.approveTx ?? '-'}, fund ${row.fundTx ?? '-'}.\n` +
        `The top-up wallet ${a.wallet} now holds what the chain shows; nothing more moves automatically until a person looks and clears it:\n` +
        `  cd apps/api && bun src/scripts/clearPayoutTopUpHalt.ts ${failed.id} "<your name>"\n` +
        'Until then the read-only payout funding keeper keeps alerting on the 12.10 deadline and the standing balance. docs/operators/payout-topups.md says what to check.',
    });
    warn(`[payout-topup] #${row.id} failed: ${why}`);
    return 'failed';
  }

  /** Sends one step: guarded, dry-run, sent with its key, the hash recorded, then waited for. */
  async function step(row: TopUpRow, call: TopUpCall, sending: 'pulling' | 'approving' | 'funding', done: 'pulled' | 'approved' | 'funded', hashField: 'pullTx' | 'approveTx' | 'fundTx'): Promise<TopUpRow | TopUpTick> {
    let hash = row[hashField];
    if (!hash) {
      const tx = { to: call.to, data: chain.encode(call) };
      try {
        assertTopUpCall(a, tx, row.amount);
      } catch (error) {
        return fail(row, (error as Error).message.replace(/\.$/, ''));
      }
      try {
        await chain.dryRun(tx);
      } catch (error) {
        if (error instanceof TopUpRevert) return fail(row, `the ${call.step} dry run reverts (${error.message})`);
        throw error;
      }
      row = await store.update(row.id, { status: sending });
      hash = await chain.send(tx, idempotencyKey(deps.chainId, a.payoutPool, row.id, call.step));
      row = await store.update(row.id, { [hashField]: hash });
      log(`[payout-topup] #${row.id} ${call.step} ${formatUsdc(row.amount)}: ${hash}`);
    }
    const rc = await waitReceipt(hash);
    if (!rc) return 'pending';
    if (rc.status !== 1) return fail(row, `the ${call.step} transaction ${hash} reverted`);
    return store.update(row.id, { status: done });
  }

  /** Takes an in-flight top-up as far as the chain lets it now. */
  async function advance(start: TopUpRow): Promise<TopUpTick> {
    let row = start;
    const [pull, approve, fund] = topUpCalls(a, row.amount);

    if (row.status === 'planned' || row.status === 'pulling') {
      if (!row.pullTx && row.nonceBefore !== null && (await chain.state()).nonce > row.nonceBefore) {
        // A pull landed whose hash was never recorded (a crash right after sending).
        warn(`[payout-topup] #${row.id}: the allowance nonce moved past ${row.nonceBefore}, so its pull landed; continuing from approve`);
        row = await store.update(row.id, { status: 'pulled' });
      } else {
        const r = await step(row, pull, 'pulling', 'pulled', 'pullTx');
        if (typeof r === 'string') return r;
        row = r;
      }
    }

    if (row.status === 'pulled' || row.status === 'approving') {
      const st = await chain.state();
      if (!row.approveTx && st.walletPoolAllowance >= row.amount) {
        row = await store.update(row.id, { status: 'approved' });
      } else {
        if (!row.approveTx && st.walletBalance < row.amount) return fail(row, `the wallet holds ${formatUsdc(st.walletBalance)}, less than the ${formatUsdc(row.amount)} it pulled`);
        const r = await step(row, approve, 'approving', 'approved', 'approveTx');
        if (typeof r === 'string') return r;
        row = r;
      }
    }

    if (row.status === 'approved' || row.status === 'funding') {
      if (!row.fundTx) {
        const st = await chain.state();
        if (row.status === 'funding' && st.walletPoolAllowance < row.amount && st.walletBalance < row.amount) {
          // fund ran (it spent both the approval and the money) but its hash was never recorded.
          warn(`[payout-topup] #${row.id}: approval and balance already spent, so its fund landed`);
          await store.update(row.id, { status: 'funded' });
          return 'funded';
        }
      }
      const r = await step(row, fund, 'funding', 'funded', 'fundTx');
      if (typeof r === 'string') return r;
      row = r;
    }
    if (row.status === 'funded') {
      log(`[payout-topup] #${row.id} funded ${formatUsdc(row.amount)} (${row.trigger})`);
      return 'funded';
    }
    return 'pending';
  }

  async function remainderNotice(reads: TopUpReads, remainder: bigint, why: string, keyPart: string) {
    const batch = remainderBatch(deps.chainId, a, remainder, chain.encodeTransfer(a.wallet, remainder), reads.now * 1000);
    await deps.alert({
      key: `payout-topup:remainder:${deps.chainId}:${a.payoutPool.toLowerCase()}:${keyPart}`,
      subject: `Payout top-up needs CL Operating's owners: ${formatUsdc(remainder)}`,
      body:
        `${why}\n\nThe 30-day refill needs ${formatUsdc(remainder)} more than the Safe spending limit allows this period ` +
        `(it resets ${resetsAt(reads.allowance) ? new Date(resetsAt(reads.allowance) * 1000).toISOString() : 'never'}). ` +
        `CL Operating's owner (the Clear Lending Safe) can send it now: load this Transaction Builder batch on CL Operating ${a.safe} in the Safe app. ` +
        'It sends the USDC to the top-up wallet, which funds the PayoutPool with exactly that on its next check.\n\n' +
        JSON.stringify(batch, null, 2),
    });
    return batch;
  }

  async function tick(): Promise<TopUpTick> {
    if (running) return 'busy';
    running = true;
    try {
      let reads: TopUpReads;
      try {
        reads = await chain.read();
      } catch (error) {
        failures += 1;
        const why = (error as Error)?.message ?? String(error);
        warn(`[payout-topup] could not read the chain (${failures} in a row): ${why}`);
        if (failures >= FAILURES_BEFORE_ALERT) {
          await deps.alert({
            key: `payout-topup:read-failed:${new Date().toISOString().slice(0, 10)}`,
            subject: 'Automatic payout top-up cannot read the chain',
            body: `The payout top-up job has failed ${failures} checks in a row on ${where}, so nothing tops up the PayoutPool automatically.\n\nLast error: ${why}`,
          });
        }
        return 'failed';
      }
      failures = 0;
      const decision = decideTopUp(reads, deps.config);
      const record = async (outcome: TopUpTick, extra: { needsHuman?: unknown; halted?: TopUpRow | null } = {}) => {
        await store.saveCheck(new Date(reads.now * 1000), checkSnapshot(deps, reads, decision, { ...extra, outcome }));
        return outcome;
      };
      debug(
        `[payout-topup] check: low ${deps.config.lowDays}d short ${formatUsdc(reads.low.short)}${reads.low.truncated ? ' (bound)' : ''}, ` +
          `target ${deps.config.targetDays}d short ${formatUsdc(reads.target.short)}${reads.target.truncated ? ' (bound)' : ''}, ` +
          `cap left ${formatUsdc(capRemaining(reads.allowance, deps.config.capOverride))}, CL Operating ${formatUsdc(reads.operatingBalance)} -> ${decision.kind}`,
      );

      const halted = await store.halted();
      if (halted) {
        warn(`[payout-topup] stopped since top-up #${halted.id} failed (${halted.error}); clear it to resume`);
        return record('halted', { halted });
      }

      const inFlight = await store.inFlight();
      if (inFlight) {
        const out = await advance(inFlight);
        return record(out, { needsHuman: inFlight.remainder > 0n ? { why: 'remainder', remainder: s(inFlight.remainder), batch: inFlight.safeBatch } : null, halted: out === 'failed' ? await store.halted() : null });
      }

      if (reads.walletBalance > 0n) {
        // USDC already in the wallet with no top-up in flight: a remainder CL Operating's owners sent. Fund exactly it.
        const row = await store.create({
          trigger: 'wallet-balance', lowShort: reads.low.short, targetShort: reads.target.short, need: reads.walletBalance,
          amount: reads.walletBalance, remainder: 0n, safeBatch: null, nonceBefore: null, status: 'pulled',
        });
        log(`[payout-topup] #${row.id}: the wallet holds ${formatUsdc(reads.walletBalance)}; funding the PayoutPool with it`);
        const out = await advance(row);
        return record(out, { halted: out === 'failed' ? await store.halted() : null });
      }

      switch (decision.kind) {
        case 'none': {
          if (decision.early) {
            await deps.alert({
              key: `payout-topup:early:${deps.chainId}:${a.payoutPool.toLowerCase()}:${reads.allowance.lastResetMin}`,
              subject: `Payout top-ups: the next ${deps.config.targetDays} days need more than the spending limit has left`,
              body:
                `Nothing is short within ${deps.config.lowDays} days, so nothing moves yet. But refilling to ${deps.config.targetDays} days ` +
                `(${formatUsdc(decision.early.need)} with the margin) is more than the ${formatUsdc(decision.early.remaining)} the Safe spending limit has left this period. ` +
                'When the low-water mark is reached the bot will move what the limit allows and prepare the rest for CL Operating\'s owners. ' +
                'To act early: move money into CL Operating and top up by hand, or have CL Operating\'s owners raise the allowance.',
            });
          }
          return record('idle');
        }
        case 'setup': {
          await deps.alert({
            key: `payout-topup:setup:${deps.chainId}:${a.payoutPool.toLowerCase()}:${day(reads.now)}`,
            subject: `PayoutPool is short ${formatUsdc(reads.low.short)} within ${deps.config.lowDays} days, and automatic top-ups are not set up`,
            body: `Nothing was moved: ${decision.missing.join('; ')}. The one-time setup is in scripts/signing_plan.ts (the PT- steps) and docs/operators/payout-topups.md.`,
          });
          return record('setup');
        }
        case 'operating-short': {
          await deps.alert({
            key: `payout-topup:operating-short:${deps.chainId}:${a.payoutPool.toLowerCase()}:${day(reads.now)}`,
            subject: `Clear Lending needs to move money into CL Operating: ${formatUsdc(decision.move - decision.operatingBalance)} short`,
            body:
              `The PayoutPool is short ${formatUsdc(reads.low.short)} within ${deps.config.lowDays} days (${decision.trigger}). The top-up would move ${formatUsdc(decision.move)}, ` +
              `and CL Operating ${a.safe} holds ${formatUsdc(decision.operatingBalance)}. Nothing was moved. ` +
              'Clear Lending needs to move money into CL Operating: a Yield Pool Deployment, BondVault excess, or the treasury. The next check moves it once it is there.',
          });
          return record('operating-short');
        }
        case 'cap-exhausted': {
          const batch = await remainderNotice(reads, decision.remainder, `The PayoutPool is short ${formatUsdc(reads.low.short)} within ${deps.config.lowDays} days (${decision.trigger}), and the spending limit has nothing left this period.`, `cap:${reads.allowance.lastResetMin}`);
          return record('needs-human', { needsHuman: { why: 'cap-exhausted', remainder: s(decision.remainder), batch } });
        }
        case 'move': {
          const batch =
            decision.remainder > 0n
              ? remainderBatch(deps.chainId, a, decision.remainder, chain.encodeTransfer(a.wallet, decision.remainder), reads.now * 1000)
              : null;
          let row: TopUpRow;
          try {
            row = await store.create({
              trigger: decision.trigger, lowShort: reads.low.short, targetShort: reads.target.short, need: decision.need,
              amount: decision.amount, remainder: decision.remainder, safeBatch: batch, nonceBefore: reads.allowance.nonce, status: 'planned',
            });
          } catch (error) {
            // Another instance recorded one first (the unique index): it moves the money, not this one.
            warn(`[payout-topup] a top-up is already in flight: ${(error as Error)?.message ?? error}`);
            return record('busy');
          }
          log(`[payout-topup] #${row.id} ${decision.trigger}: moving ${formatUsdc(decision.amount)} (need ${formatUsdc(decision.need)})`);
          if (decision.remainder > 0n) {
            await remainderNotice(reads, decision.remainder, `Top-up #${row.id} moves ${formatUsdc(decision.amount)}, all the Safe spending limit allows this period.`, `row:${row.id}`);
          }
          const out = await advance(row);
          return record(out, {
            needsHuman: decision.remainder > 0n ? { why: 'remainder', remainder: s(decision.remainder), batch } : null,
            halted: out === 'failed' ? await store.halted() : null,
          });
        }
      }
    } catch (error) {
      warn(`[payout-topup] check failed: ${(error as Error)?.message ?? error}`);
      return 'failed';
    } finally {
      running = false;
    }
  }

  return { tick };
}

/* ========== WIRING ========== */

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 84532;
}

export function payoutTopUpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test((env.PAYOUT_TOPUP_ENABLED || '').trim());
}

const isRevert = (e: unknown) => {
  const x = e as { code?: string; data?: unknown; info?: { error?: { data?: unknown } }; message?: string };
  return x?.code === 'CALL_EXCEPTION' || /execution reverted|revert/i.test(String(x?.message ?? ''));
};

/** The job on this server's chain and contracts, its wallet a CDP server wallet. Null (with why) when it cannot run. */
export async function defaultTopUpDeps(env: Record<string, string | undefined> = process.env): Promise<{ deps: TopUpDeps } | { why: string }> {
  const id = chainId();
  const payoutPool = getContractAddress(id, 'PayoutPool');
  if (!payoutPool || !ethers.isAddress(payoutPool)) return { why: `no PayoutPool address for chain ${id}` };
  const walletRaw = (env.PAYOUT_TOPUP_WALLET || '').trim();
  if (!ethers.isAddress(walletRaw)) return { why: 'PAYOUT_TOPUP_WALLET is not set to the top-up wallet\'s address' };
  const safeRaw = (env.PAYOUT_TOPUP_SAFE || '').trim() || (id === 84532 ? CL_OPERATING_BASE_SEPOLIA : '');
  if (!ethers.isAddress(safeRaw)) return { why: 'PAYOUT_TOPUP_SAFE (CL Operating) is not set' };
  const moduleRaw = (env.PAYOUT_TOPUP_ALLOWANCE_MODULE || '').trim() || CANONICAL_ALLOWANCE_MODULE;
  if (!ethers.isAddress(moduleRaw)) return { why: 'PAYOUT_TOPUP_ALLOWANCE_MODULE is not an address' };

  const provider = chainProvider(id);
  const pool = new ethers.Contract(payoutPool, PAYOUT_POOL_TOPUP_ABI, provider);
  const module = new ethers.Contract(moduleRaw, ALLOWANCE_MODULE_ABI, provider);
  const name: string = await module.NAME().catch(() => '');
  if (name !== 'Allowance Module') return { why: `${moduleRaw} on chain ${id} does not answer as Safe's AllowanceModule` };
  const usdcAddress = ethers.getAddress(await pool.reserveToken());
  const addresses: TopUpAddresses = {
    payoutPool: ethers.getAddress(payoutPool),
    safe: ethers.getAddress(safeRaw),
    module: ethers.getAddress(moduleRaw),
    usdc: usdcAddress,
    wallet: ethers.getAddress(walletRaw),
  };
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
  const safe = new ethers.Contract(addresses.safe, SAFE_MODULE_ABI, provider);
  const config = topUpConfigFromEnv(env);
  const ifaces = { module: module.interface, usdc: usdc.interface, pool: pool.interface };
  const sender = cdpTopUpSender(id, addresses.wallet, env);
  const db = await merchantDb();
  if (!db) return { why: 'no database to record top-ups in' };

  const chain: TopUpChain = {
    read: () =>
      gatherTopUp(
        {
          now: async () => {
            const b = await provider.getBlock('latest');
            if (!b) throw new Error('no latest block');
            return b.timestamp;
          },
          payoutPool: pool as never,
          module: module as never,
          safe: safe as never,
          usdc: usdc as never,
          addresses,
        },
        config,
      ),
    state: async () => {
      const [walletBalance, walletPoolAllowance, al] = await Promise.all([
        usdc.balanceOf(addresses.wallet),
        usdc.allowance(addresses.wallet, addresses.payoutPool),
        module.getTokenAllowance(addresses.safe, addresses.wallet, addresses.usdc),
      ]);
      return { walletBalance: BigInt(walletBalance), walletPoolAllowance: BigInt(walletPoolAllowance), nonce: Number(al[4]) };
    },
    encode: (call) => (call.fn === 'executeAllowanceTransfer' ? ifaces.module : call.fn === 'approve' ? ifaces.usdc : ifaces.pool).encodeFunctionData(call.fn, call.args),
    encodeTransfer: (to, amount) => ifaces.usdc.encodeFunctionData('transfer', [to, amount]),
    dryRun: async (tx) => {
      try {
        await provider.call({ from: addresses.wallet, to: tx.to, data: tx.data });
        await provider.estimateGas({ from: addresses.wallet, to: tx.to, data: tx.data });
      } catch (error) {
        if (isRevert(error)) throw new TopUpRevert((error as { shortMessage?: string; message?: string })?.shortMessage ?? String((error as Error)?.message ?? error));
        throw error;
      }
    },
    send: (tx, key) => sender.send(tx, key),
    receipt: async (hash) => {
      const r = await provider.getTransactionReceipt(hash);
      return r ? { status: Number(r.status) } : null;
    },
  };
  return { deps: { chainId: id, addresses, config, chain, store: topUpStore(db, id, addresses.payoutPool), alert: alertOps } };
}

export function startPayoutTopUp(): void {
  if (!payoutTopUpEnabled()) {
    console.log('[payout-topup] disabled (set PAYOUT_TOPUP_ENABLED=1 for bounded automatic PayoutPool top-ups)');
    return;
  }
  void (async () => {
    const made = await defaultTopUpDeps().catch((e) => ({ why: (e as Error)?.message ?? String(e) }));
    if ('why' in made) {
      console.warn(`[payout-topup] not started: ${made.why}`);
      return;
    }
    const job = createPayoutTopUp(made.deps);
    setInterval(() => void job.tick(), made.deps.config.checkMinutes * MINUTE_MS).unref?.();
    void job.tick();
    const d = made.deps;
    console.log(
      `[payout-topup] started: every ${d.config.checkMinutes} min; moves when ${d.config.lowDays}d is short, refills to ${d.config.targetDays}d + ${formatUsdc(d.config.margin)}; ` +
        `wallet ${d.addresses.wallet}, CL Operating ${d.addresses.safe}, AllowanceModule ${d.addresses.module}`,
    );
  })();
}
