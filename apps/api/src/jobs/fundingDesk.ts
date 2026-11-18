import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { getContractAddress } from '../config/contracts.js';
import { getPayPool } from '../config/postgres.js';
import { merchantDb } from '../config/merchantDb.js';
import { chainProvider } from '../services/chain/provider.js';
import { alertOps } from '../services/opsAlert.js';
import { cdpWalletSender } from '../services/payoutFunding/topUpCdp.js';
import { ALLOWANCE_MODULE_ABI, CANONICAL_ALLOWANCE_MODULE, CL_OPERATING_BASE_SEPOLIA, SAFE_MODULE_ABI, formatUsdc, parseUsdc, type AllowanceRead } from '../services/payoutFunding/topUp.js';
import { DESK_ERC20_ABI, SETTLEMENT_DEPLOYED_TOPIC, SETTLEMENT_FORWARDER_ABI, YIELD_POOL_ABI, erc20Interface, forwarderInterface, isSettlementDeployedFor, laneInterface } from '../services/settlementFunding/abi.js';
import { bankAccountsFromEnv, lithicBank, mockBank, transferClassFromEnv, type BankRail, type LithicLike } from '../services/settlementFunding/bank.js';
import { cardCreditBetween, readCardCredit, type CardCredit } from '../services/settlementFunding/cardCredit.js';
import { deskConfigFromEnv, settlementFundingEnabled, type DeskConfig } from '../services/settlementFunding/config.js';
import {
  assertDeskCall,
  decideFunding,
  marginWords,
  remainderBatches,
  settlementRef,
  type DeskAddresses,
  type DeskDecision,
  type DeskReads,
  type DeskStep,
  type ForwarderReads,
  type LaneReads,
} from '../services/settlementFunding/desk.js';
import { matchPayout, type OffRamp } from '../services/settlementFunding/offRamp.js';
import { bridgeOffRamp } from '../services/settlementFunding/offRampBridge.js';
import { mockOffRamp } from '../services/settlementFunding/offRampMock.js';
import { addDays, coverage, forcedRunAt, localDate, zonedInstant, type Coverage } from '../services/settlementFunding/schedule.js';
import { deskStore, type DeskStore, type MoveRow, type MoveStatus } from '../services/settlementFunding/store.js';

/*
 * The settlement funding desk (decision 54). services/settlementFunding/desk.ts has the rules; this
 * runs them, every SETTLEMENT_FUNDING_CHECK_MINUTES (15) and once more at the forced time,
 * cut-off - (off-ramp latency + margin), so the money lands before the bank debits the CSA. Runs
 * before the funding window only record what they see: the desk funds settlements, it never chases
 * a swipe.
 *
 * The money paths:
 *   book         Collection Account -> CSA: a Lithic book transfer, idempotent on its token.
 *   deploy       two transactions from the desk wallet (a CDP server wallet): the Yield Pool's
 *                deploySettlement(amount, ref), which sends USDC to CL Operating, then the
 *                SettlementForwarder's forward(amount), which moves exactly that from CL Operating to
 *                the off-ramp's address within the AllowanceModule limit. The off-ramp pays the CSA.
 *   return       (SETTLEMENT_RETURNS_ENABLED) CSA -> the Margin by book transfer; CSA -> the on-ramp by
 *                same-day ACH, then the USDC it delivers to the desk wallet is approved and Returned
 *                with returnFunds. The BondVault's share goes to people.
 *
 * As payout top-ups do (decision 51): every move is recorded (migration 0079) before its first
 * transaction or bank call; each send carries an idempotency key from the move and the step; a
 * restart finishes an acting move from what the chain shows (the receipts recorded, the
 * SettlementDeployed event for the ref, the forwarder's allowance nonce, the wallet's balance and
 * approval). Any revert, failed guard or failed bank or off-ramp payment marks the move failed,
 * alerts, and stops the desk until a person clears it (src/scripts/clearSettlementFundingHalt.ts).
 * Alerts go through ops_alerts, once each.
 *
 * SETTLEMENT_FUNDING_DRY_RUN=1 decides, records the check and logs; it creates no move and sends
 * nothing. Off unless SETTLEMENT_FUNDING_ENABLED=1, and inert until the lane and the forwarder are
 * deployed and set up: without them every check ends in a setup alert, with nothing sent.
 *
 * The ESA vault is never read, named or touched here.
 */

const MINUTE_MS = 60_000;
const FAILURES_BEFORE_ALERT = 3;

export class DeskRevert extends Error {}

export interface DeskTx {
  to: string;
  data: string;
}

/** What the chain says now, for one check. */
export interface DeskChainReads {
  now: number;
  block: number;
  lane: LaneReads;
  /** The lane's views are not on this pool yet (before its upgrade). */
  laneMissing: boolean;
  forwarder: ForwarderReads;
  operatingBalance: bigint;
  walletBalance: bigint;
}

/** The chain and the wallet, as the desk needs them; mocked in tests. */
export interface DeskChain {
  read(): Promise<DeskChainReads>;
  /** The forwarder's allowance nonce, and the wallet's USDC and approval to the pool, read now. */
  state(): Promise<{ nonce: number; walletBalance: bigint; walletPoolAllowance: bigint }>;
  /** The transaction that emitted SettlementDeployed for `ref` since `fromBlock`, if any. */
  findDeployed(ref: string, fromBlock: number): Promise<string | null>;
  /** eth_call and estimateGas from the wallet. Throws DeskRevert when the call reverts. */
  dryRun(tx: DeskTx): Promise<void>;
  /** Sends from the desk wallet; the same key twice is the same transaction. */
  send(tx: DeskTx, idempotencyKey: string): Promise<string>;
  receipt(hash: string): Promise<{ status: number } | null>;
}

export interface DeskDeps {
  chainId: number;
  addresses: DeskAddresses;
  config: DeskConfig;
  chain: DeskChain;
  store: DeskStore;
  bank: BankRail;
  offRamp: OffRamp;
  /** The credit portions (cardCredit.ts), for a check. */
  card: (input: { now: number; coverage: Coverage }) => Promise<CardCredit>;
  /** One day's authorized and settled credit, for the daily reconciliation. */
  cardDay: (from: Date, to: Date) => Promise<{ authorized: bigint; settled: bigint }>;
  alert: (input: { key: string; subject: string; body: string }) => Promise<void>;
  /** After the off-ramp reports a payout processed, it still counts in flight this long (minutes). */
  settleGraceMinutes?: number;
  receiptTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  debug?: (line: string) => void;
  warn?: (line: string) => void;
}

export type DeskTick =
  | 'idle'
  | 'waiting'
  | 'funded'
  | 'pending'
  | 'returned'
  | 'returns-off'
  | 'needs-human'
  | 'setup'
  | 'unknown'
  | 'dry-run'
  | 'halted'
  | 'failed'
  | 'busy';

/** A v4-shaped UUID from the move and the step: CDP and Lithic see a repeat as the same request. */
export function deskIdempotencyKey(chainId: number, pool: string, id: number, step: string): string {
  const h = createHash('sha256').update(`settlement-funding:${chainId}:${pool.toLowerCase()}:${id}:${step}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const s = (v: bigint | null) => (v === null ? null : v.toString());
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export function createFundingDesk(deps: DeskDeps) {
  const log = deps.log ?? ((l: string) => console.log(l));
  const debug = deps.debug ?? ((l: string) => (process.env.SETTLEMENT_FUNDING_DEBUG ? console.log(l) : undefined));
  const warn = deps.warn ?? ((l: string) => console.warn(l));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = deps.receiptTimeoutMs ?? 120_000;
  const pollMs = deps.pollMs ?? 2_000;
  const graceMinutes = deps.settleGraceMinutes ?? 60;
  const { addresses: a, chain, store, bank, offRamp, config: c } = deps;
  const where = `chain ${deps.chainId}, Yield Pool ${a.pool}`;
  const keyBase = `settlement-funding:${deps.chainId}:${a.pool.toLowerCase()}`;
  const key = (id: number, step: string) => deskIdempotencyKey(deps.chainId, a.pool, id, step);
  // In a dry run every alert says so: it describes what the desk would need, and nothing was sent.
  const alert = (x: { key: string; subject: string; body: string }) => deps.alert(c.dryRun ? { key: `${x.key}:dry-run`, subject: `[dry run] ${x.subject}`, body: x.body } : x);
  let failures = 0;
  let running = false;
  /** The chain's time at this check (block timestamp), for what the desk stamps. */
  let clock = 0;
  const stamp = () => new Date((clock || Math.floor(Date.now() / 1000)) * 1000);

  async function waitReceipt(hash: string): Promise<{ status: number } | null> {
    const started = Date.now();
    for (;;) {
      const r = await chain.receipt(hash);
      if (r) return r;
      if (Date.now() - started >= timeoutMs) return null;
      await sleep(pollMs);
    }
  }

  async function fail(row: MoveRow, why: string): Promise<DeskTick> {
    await store.update(row.id, { status: 'failed', error: why });
    await alert({
      key: `${keyBase}:failed:${row.id}`,
      subject: `Settlement funding stopped: ${why}`,
      body:
        `Move #${row.id} (${row.kind}, ${formatUsdc(row.amount)}${row.cutoffAt ? `, for the cut-off at ${row.cutoffAt.toISOString()}` : ''}) on ${where} stopped: ${why}.\n\n` +
        `So far: deploySettlement ${row.deployTx ?? '-'}, forward ${row.forwardTx ?? '-'}, approve ${row.approveTx ?? '-'}, returnFunds ${row.returnTx ?? '-'}, bank ${row.bankToken ?? '-'}.\n` +
        'Nothing more moves automatically until a person looks and clears it:\n' +
        `  cd apps/api && bun src/scripts/clearSettlementFundingHalt.ts ${row.id} "<your name>"\n` +
        'Until then the CSA is funded by hand: the Collection Account, a two-person Deployment, or the Savings-Backed Margin. ' +
        'docs/operators/settlement-funding.md says what to check.',
    });
    warn(`[settlement-funding] #${row.id} failed: ${why}`);
    return 'failed';
  }

  /** One transaction: guarded, dry-run, sent with its key, its hash recorded, then waited for. */
  async function step(
    row: MoveRow,
    tx: DeskTx,
    st: DeskStep,
    sending: MoveStatus,
    done: MoveStatus,
    field: 'deployTx' | 'forwardTx' | 'approveTx' | 'returnTx',
  ): Promise<MoveRow | DeskTick> {
    let hash = row[field];
    if (!hash) {
      try {
        assertDeskCall(a, tx, { step: st, amount: row.amount, ref: st === 'deploy' ? row.ref ?? undefined : undefined });
      } catch (error) {
        return fail(row, (error as Error).message.replace(/\.$/, ''));
      }
      try {
        await chain.dryRun(tx);
      } catch (error) {
        if (error instanceof DeskRevert) return fail(row, `the ${st} dry run reverts (${error.message})`);
        throw error;
      }
      row = await store.update(row.id, { status: sending });
      hash = await chain.send(tx, key(row.id, st));
      row = await store.update(row.id, { [field]: hash });
      log(`[settlement-funding] #${row.id} ${st} ${formatUsdc(row.amount)}: ${hash}`);
    }
    const rc = await waitReceipt(hash);
    if (!rc) return 'pending';
    if (rc.status !== 1) return fail(row, `the ${st} transaction ${hash} reverted`);
    return store.update(row.id, { status: done });
  }

  /* ---------- the moves ---------- */

  async function advanceBook(row: MoveRow): Promise<DeskTick> {
    const toMargin = row.kind === 'return-margin';
    const from = toMargin ? bank.accounts.csa : bank.accounts.collection;
    const to = toMargin ? bank.accounts.margin : bank.accounts.csa;
    if (!from || !to) return fail(row, `the ${toMargin ? 'CSA or Margin' : 'Collection Account or CSA'} account is not configured`);
    const token = row.bankToken ?? key(row.id, 'book');
    if (!row.bankToken) row = await store.update(row.id, { bankToken: token, status: 'booking' });
    let status;
    try {
      status = await bank.bookTransfer({ token, from, to, amount: row.amount, memo: toMargin ? 'Settlement Funding: restore the Margin' : 'Settlement Funding: Collection Account to CSA' });
    } catch (error) {
      return fail(row, `the book transfer was refused (${(error as Error).message})`);
    }
    if (status === 'failed') return fail(row, 'the book transfer failed at the bank');
    await store.update(row.id, { status: status === 'settled' ? 'done' : 'booked' });
    log(`[settlement-funding] #${row.id} ${row.kind} ${formatUsdc(row.amount)}: ${status}`);
    return toMargin ? 'returned' : 'funded';
  }

  async function advanceDeploy(start: MoveRow): Promise<DeskTick> {
    let row = start;
    if (row.status === 'planned' || row.status === 'deploying') {
      if (!row.deployTx && row.status === 'deploying' && row.ref && row.fromBlock !== null) {
        const landed = await chain.findDeployed(row.ref, row.fromBlock);
        if (landed) {
          warn(`[settlement-funding] #${row.id}: SettlementDeployed for its ref is on chain (${landed}); continuing from forward`);
          row = await store.update(row.id, { deployTx: landed, status: 'deployed' });
        }
      }
      if (row.status !== 'deployed') {
        const data = laneInterface.encodeFunctionData('deploySettlement', [row.amount, row.ref]);
        const r = await step(row, { to: a.pool, data }, 'deploy', 'deploying', 'deployed', 'deployTx');
        if (typeof r === 'string') return r;
        row = r;
      }
    }
    if (row.status === 'deployed' || row.status === 'forwarding') {
      if (row.status === 'forwarding' && !row.forwardTx && row.nonceBefore !== null && (await chain.state()).nonce > row.nonceBefore) {
        warn(`[settlement-funding] #${row.id}: the forwarder's allowance nonce moved past ${row.nonceBefore}, so its forward landed`);
        row = await store.update(row.id, { status: 'forwarded', forwardedAt: stamp() });
      } else {
        if (row.status === 'deployed' && row.nonceBefore === null) row = await store.update(row.id, { nonceBefore: (await chain.state()).nonce });
        const data = forwarderInterface.encodeFunctionData('forward', [row.amount]);
        const r = await step(row, { to: a.forwarder, data }, 'forward', 'forwarding', 'forwarded', 'forwardTx');
        if (typeof r === 'string') return r;
        row = await store.update(r.id, { forwardedAt: stamp() });
      }
    }
    if (row.status === 'forwarded') {
      log(`[settlement-funding] #${row.id} sent ${formatUsdc(row.amount)} to the off-ramp (${offRamp.name}, ${offRamp.rail}) for the cut-off at ${row.cutoffAt?.toISOString()}`);
      return 'funded';
    }
    return 'pending';
  }

  async function advanceReturnPool(start: MoveRow): Promise<DeskTick> {
    let row = start;
    if (row.status === 'planned' || row.status === 'sending') {
      const from = bank.accounts.csa;
      const ext = bank.accounts.onRampExternalBankAccount;
      if (!from || !ext) return fail(row, 'the CSA or the on-ramp bank account is not configured');
      const token = row.bankToken ?? key(row.id, 'payment');
      if (!row.bankToken) row = await store.update(row.id, { bankToken: token, status: 'sending' });
      let status;
      try {
        status = await bank.payment({ token, from, externalBankAccount: ext, amount: row.amount, memo: 'Settlement Funding: Return to the Yield Pool' });
      } catch (error) {
        return fail(row, `the ACH to the on-ramp was refused (${(error as Error).message})`);
      }
      if (status === 'failed') return fail(row, 'the ACH to the on-ramp failed at the bank');
      await store.update(row.id, { status: 'sent' });
      log(`[settlement-funding] #${row.id} return ${formatUsdc(row.amount)}: ACH to the on-ramp ${status}`);
      return 'returned';
    }
    if (row.status === 'approving' || row.status === 'approved' || row.status === 'returning') {
      if (row.status === 'approving' && !row.approveTx && (await chain.state()).walletPoolAllowance >= row.amount) row = await store.update(row.id, { status: 'approved' });
      if (row.status === 'approving') {
        const data = erc20Interface.encodeFunctionData('approve', [a.pool, row.amount]);
        const r = await step(row, { to: a.usdc, data }, 'approve', 'approving', 'approved', 'approveTx');
        if (typeof r === 'string') return r;
        row = r;
      }
      if (row.status === 'returning' && !row.returnTx) {
        const st = await chain.state();
        if (st.walletPoolAllowance < row.amount && st.walletBalance < row.amount) {
          warn(`[settlement-funding] #${row.id}: approval and balance already spent, so its Return landed`);
          await store.update(row.id, { status: 'done' });
          return 'returned';
        }
      }
      const data = laneInterface.encodeFunctionData('returnFunds', [row.amount]);
      const r = await step(row, { to: a.pool, data }, 'return', 'returning', 'done', 'returnTx');
      if (typeof r === 'string') return r;
      log(`[settlement-funding] #${row.id} returned ${formatUsdc(row.amount)} to the Yield Pool`);
      return 'returned';
    }
    return 'pending';
  }

  function advance(row: MoveRow): Promise<DeskTick> {
    if (row.kind === 'deploy') return advanceDeploy(row);
    if (row.kind === 'return-pool') return advanceReturnPool(row);
    return advanceBook(row);
  }

  /** Moves waiting on the bank or the off-ramp: landed, failed, or still on their way. */
  async function settleWaiting(now: number, walletBalance: bigint): Promise<DeskTick | null> {
    const rows = await store.waiting();
    if (!rows.length) return null;
    const forwarded = rows.filter((r) => r.kind === 'deploy');
    const payouts = forwarded.length ? await offRamp.payouts(Math.min(...forwarded.map((r) => Math.floor((r.forwardedAt ?? r.createdAt).getTime() / 1000))) - 3_600) : [];
    const taken = new Set<string>();
    for (const row of rows) {
      if (row.kind === 'book' || row.kind === 'return-margin') {
        const st = await bank.status(row.bankToken ?? '', 'book');
        if (st === 'failed') return fail(row, 'the book transfer failed at the bank');
        if (st === 'settled') await store.update(row.id, { status: 'done' });
      } else if (row.kind === 'deploy') {
        const forwardedAt = Math.floor((row.forwardedAt ?? row.createdAt).getTime() / 1000);
        const p = matchPayout({ forwardTx: row.forwardTx, amount: row.amount, forwardedAt }, payouts, taken);
        if (p) {
          taken.add(p.id);
          if (p.state === 'failed') {
            return fail(row, `the off-ramp payout ${p.id} failed (${p.detail}); the provider returns the USDC to CL Operating`);
          }
          if (p.state === 'arrived' && p.arrivedAt !== null && now >= p.arrivedAt + graceMinutes * 60) {
            await store.update(row.id, { status: 'done', offrampRef: p.id, arrivedAt: new Date(p.arrivedAt * 1000) });
            log(`[settlement-funding] #${row.id} ${formatUsdc(row.amount)} arrived at the CSA (${offRamp.name} ${p.id})`);
            continue;
          }
          if (!row.offrampRef) await store.update(row.id, { offrampRef: p.id });
        }
        const late = c.offRampLatencyMinutes * 3 * 60;
        if (now > forwardedAt + Math.max(late, 6 * 3_600)) {
          await alert({
            key: `${keyBase}:offramp-late:${row.id}`,
            subject: `Settlement funding: ${formatUsdc(row.amount)} sent to the off-ramp has not arrived`,
            body: `Move #${row.id} forwarded ${formatUsdc(row.amount)} to ${a.offRamp} (${row.forwardTx ?? '-'}) at ${new Date(forwardedAt * 1000).toISOString()}, and ${offRamp.name} reports ${p ? `${p.id}: ${p.detail}` : 'no payout for it'}. It still counts as in flight. Check the off-ramp; if it is lost, mark the move failed and fund the CSA by hand.`,
          });
        }
      } else if (row.kind === 'return-pool') {
        const st = await bank.status(row.bankToken ?? '', 'payment');
        if (st === 'failed') return fail(row, 'the ACH to the on-ramp failed at the bank');
        if (walletBalance >= row.amount && !(await store.acting())) {
          // The on-ramp delivered the USDC to the desk wallet: approve and Return it.
          const r = await store.update(row.id, { status: 'approving' });
          return advanceReturnPool(r);
        }
      }
    }
    return null;
  }

  /* ---------- the daily reconciliation ---------- */

  async function reconcileDay(now: number, csa: bigint | null) {
    const zone = c.schedule.timeZone;
    const today = localDate(now, zone);
    const day = addDays(today, -1);
    const from = new Date(zonedInstant(day, 0, zone) * 1000);
    const to = new Date(zonedInstant(today, 0, zone) * 1000);
    const [credit, done] = await Promise.all([deps.cardDay(from, to), store.doneBetween(from, to)]);
    const saved = await store.saveDay({
      day,
      authorized: credit.authorized,
      settled: credit.settled,
      fundedBook: done.book,
      fundedPool: done.deploy,
      returnedMargin: done['return-margin'],
      returnedPool: done['return-pool'],
      marginAdvanced: done['margin-advance'],
      // The first reading after the day ended: the CSA's end-of-day balance as the desk sees it.
      csaClose: csa,
      snapshot: { readAt: new Date(now * 1000).toISOString(), timeZone: zone },
    });
    if (saved) {
      log(
        `[settlement-funding] ${day}: credit authorized ${formatUsdc(credit.authorized)}, settled ${formatUsdc(credit.settled)}; funded ${formatUsdc(done.book)} (Collection) + ${formatUsdc(done.deploy)} (pool); ` +
          `returned ${formatUsdc(done['return-margin'])} (Margin) + ${formatUsdc(done['return-pool'])} (pool); Margin advanced ${formatUsdc(done['margin-advance'])}; CSA ${csa === null ? 'unread' : formatUsdc(csa)}`,
      );
    }
  }

  /* ---------- a check ---------- */

  async function tick(opts: { forced?: boolean } = {}): Promise<DeskTick> {
    if (running) return 'busy';
    running = true;
    try {
      let chainReads: DeskChainReads;
      try {
        chainReads = await chain.read();
      } catch (error) {
        failures += 1;
        const why = (error as Error)?.message ?? String(error);
        warn(`[settlement-funding] could not read the chain (${failures} in a row): ${why}`);
        if (failures >= FAILURES_BEFORE_ALERT) {
          await alert({
            key: `${keyBase}:read-failed:${new Date().toISOString().slice(0, 10)}`,
            subject: 'Settlement funding cannot read the chain',
            body: `The settlement funding desk has failed ${failures} checks in a row on ${where}, so the CSA is not being funded automatically. Fund it by hand until it reads again.\n\nLast error: ${why}`,
          });
        }
        return 'failed';
      }
      failures = 0;
      const now = chainReads.now;
      clock = now;
      const cov = coverage(now, c.schedule);
      const day = localDate(now, c.schedule.timeZone);

      // Waiting moves first (landed, failed, or a Return's USDC arrived), so in-flight is current.
      const settled = (await store.halted()) ? null : await settleWaiting(now, chainReads.walletBalance);
      const halted = await store.halted();
      const [card, csa, collection, inFlight, marginOutstanding, measured, idle] = await Promise.all([
        deps.card({ now, coverage: cov }),
        bank.balance(bank.accounts.csa),
        bank.balance(bank.accounts.collection),
        store.inFlight(),
        store.marginOutstanding(),
        store.measuredLatencyMinutes(),
        store.idleSurplus(new Date((now - c.returnIdleHours * 3_600) * 1000)),
      ]);
      const reads: DeskReads = {
        now,
        coverage: cov,
        dueSettled: card.dueSettled,
        pendingCredit: card.pendingCredit,
        recentSettled: card.recentSettled,
        csa,
        collection,
        inFlight,
        lane: chainReads.lane,
        forwarder: chainReads.forwarder,
        operatingBalance: chainReads.operatingBalance,
        walletBalance: chainReads.walletBalance,
        idleSurplus: idle,
        marginOutstanding,
        measuredLatencyMinutes: measured,
      };
      const decision = decideFunding(reads, a, c, opts);
      const f = decision.f;
      const ref = settlementRef(cov.next, f.due);
      const record = async (outcome: DeskTick, extra: Record<string, unknown> = {}) => {
        await store.saveCheck({
          checkedAt: new Date(now * 1000),
          cutoffAt: new Date(cov.next * 1000),
          need: f.need > 0n ? f.need : 0n,
          surplus: f.surplus,
          csa,
          outcome,
          snapshot: json({
            enabled: true,
            dryRun: c.dryRun,
            returnsEnabled: c.returnsEnabled,
            forced: !!opts.forced,
            now,
            addresses: a,
            offRamp: { name: offRamp.name, rail: offRamp.rail, address: offRamp.address },
            bank: bank.name,
            coverage: cov,
            ref,
            figures: f,
            byCutoff: card.byCutoff,
            pendingCredit: card.pendingCredit,
            collection,
            inFlight,
            marginOutstanding,
            measuredLatencyMinutes: measured,
            lane: chainReads.lane,
            laneMissing: chainReads.laneMissing,
            forwarder: chainReads.forwarder,
            operatingBalance: chainReads.operatingBalance,
            decision,
            halted: halted ? { id: halted.id, error: halted.error, at: halted.finishedAt } : null,
            outcome,
            ...extra,
          }),
        });
        return outcome;
      };
      debug(
        `[settlement-funding] check: cut-off ${new Date(cov.next * 1000).toISOString()}${cov.rollover ? ` (through ${new Date(cov.through * 1000).toISOString()})` : ''}, ` +
          `due ${formatUsdc(f.due)} + buffer ${formatUsdc(f.buffer)}, CSA ${csa === null ? 'unread' : formatUsdc(csa)}, in flight ${formatUsdc(f.inFlight)} -> need ${formatUsdc(f.need)}: ${decision.kind}`,
      );

      await reconcileDay(now, csa).catch((e) => warn(`[settlement-funding] reconciliation failed: ${(e as Error)?.message ?? e}`));

      if (settled) return record(settled);
      if (halted) {
        warn(`[settlement-funding] stopped since move #${halted.id} failed (${halted.error}); clear it to resume`);
        return record('halted');
      }

      const acting = await store.acting();
      if (acting) return record(await advance(acting));

      if (chainReads.walletBalance > 0n && !c.dryRun && !(await store.waiting()).some((r) => r.kind === 'return-pool')) {
        await alert({
          key: `${keyBase}:wallet-holds:${day}`,
          subject: `Settlement funding: the desk wallet holds ${formatUsdc(chainReads.walletBalance)} with no Return expected`,
          body: `The desk wallet ${a.wallet} only ever holds USDC that the on-ramp delivered for a Return. It holds ${formatUsdc(chainReads.walletBalance)} and no Return is waiting for it. Nothing was done with it. Find where it came from before doing anything.`,
        });
      }

      return record(await act(decision, reads, ref, day, chainReads.block));
    } catch (error) {
      warn(`[settlement-funding] check failed: ${(error as Error)?.message ?? error}`);
      return 'failed';
    } finally {
      running = false;
    }
  }

  async function act(decision: DeskDecision, reads: DeskReads, ref: string, day: string, block: number): Promise<DeskTick> {
    const f = decision.f;
    const cutoffIso = new Date(reads.coverage.next * 1000).toISOString();
    switch (decision.kind) {
      case 'unknown':
        await alert({
          key: `${keyBase}:unknown:${day}`,
          subject: 'Settlement funding cannot read the Credit Settlement Account',
          body: `${decision.why}, so nothing was moved (a balance that cannot be read is never taken as zero). Set SETTLEMENT_CSA_FINANCIAL_ACCOUNT_TOKEN, or check Lithic. Fund the cut-off at ${cutoffIso} by hand meanwhile.`,
        });
        return 'unknown';
      case 'covered':
        return 'idle';
      case 'wait':
        return 'waiting';
      case 'return': {
        const words = `The CSA holds ${formatUsdc(f.surplus)} more than the next settlement plus the buffer, at least ${formatUsdc(decision.margin + decision.pool + decision.bondVault)} of it idle for ${c.returnIdleHours} hours. It goes back within ${c.returnBusinessDays} business days: ${formatUsdc(decision.margin)} to restore the Savings-Backed Margin, ${formatUsdc(decision.pool)} as a Return to the Yield Pool, ${formatUsdc(decision.bondVault)} to the BondVault.`;
        if (!c.returnsEnabled || c.dryRun) {
          if (!c.returnsEnabled) {
            await alert({ key: `${keyBase}:returns-off:${day}`, subject: `Settlement funding: ${formatUsdc(f.surplus)} idle in the CSA (automatic Returns are off)`, body: `${words}\n\nSETTLEMENT_RETURNS_ENABLED is off, so a person sends it back. docs/operators/settlement-funding.md, "Returns".` });
          }
          log(`[settlement-funding] ${c.dryRun ? 'dry run: ' : ''}would return ${formatUsdc(decision.margin)} (Margin) + ${formatUsdc(decision.pool)} (pool) + ${formatUsdc(decision.bondVault)} (BondVault)`);
          return c.dryRun ? 'dry-run' : 'returns-off';
        }
        if (decision.bondVault > 0n || (decision.margin > 0n && !bank.accounts.margin) || (decision.pool > 0n && !bank.accounts.onRampExternalBankAccount)) {
          await alert({ key: `${keyBase}:returns-people:${day}`, subject: 'Settlement funding: part of the CSA surplus goes back by hand', body: `${words}\n\nThe BondVault's share${!bank.accounts.margin ? ', the Margin (SETTLEMENT_MARGIN_FINANCIAL_ACCOUNT_TOKEN is not set)' : ''}${!bank.accounts.onRampExternalBankAccount ? ', the pool Return (SETTLEMENT_ONRAMP_EXTERNAL_BANK_ACCOUNT_TOKEN is not set)' : ''} are for a person.` });
        }
        if (decision.margin > 0n && bank.accounts.margin) {
          const row = await store.create({ kind: 'return-margin', cutoffAt: new Date(reads.coverage.next * 1000), ref: null, due: f.due, need: 0n, amount: decision.margin, status: 'planned' });
          const out = await advanceBook(row);
          if (out === 'failed') return out;
        }
        if (decision.pool > 0n && bank.accounts.onRampExternalBankAccount) {
          const row = await store.create({ kind: 'return-pool', cutoffAt: new Date(reads.coverage.next * 1000), ref: null, due: f.due, need: 0n, amount: decision.pool, status: 'planned' });
          return advanceReturnPool(row);
        }
        return 'returned';
      }
      case 'fund': {
        const people = decision.capShort + decision.poolShort;
        const batches = decision.capShort > 0n ? remainderBatches(a, decision.capShort, ref, reads.now * 1000) : null;
        if (decision.setup.length && (decision.capShort > 0n || decision.poolShort > 0n)) {
          await alert({
            key: `${keyBase}:setup:${day}`,
            subject: `Settlement funding: the CSA needs ${formatUsdc(f.need)} by ${cutoffIso}, and the settlement lane is not set up`,
            body: `Nothing was deployed: ${decision.setup.join('; ')}. The one-time setup is in scripts/signing_plan.ts (SL-funder, SL-headroom and the CL Operating batch) and docs/operators/settlement-funding.md.`,
          });
        }
        if (decision.capShort > 0n) {
          await alert({
            key: `${keyBase}:remainder:${reads.coverage.next}:${decision.capShort}`,
            subject: `Settlement funding needs two deployers and CL Operating's owners: ${formatUsdc(decision.capShort)}`,
            body:
              `The cut-off at ${cutoffIso} needs ${formatUsdc(f.need)}. ${decision.book ? `${formatUsdc(decision.book)} comes from the Collection Account; ` : ''}${decision.deploy ? `${formatUsdc(decision.deploy)} through the settlement lane; ` : ''}` +
              `${formatUsdc(decision.capShort)} more is within what the pool allows but over ${decision.setup.length ? 'nothing (the lane is not set up)' : 'the lane\'s cap or the forwarder\'s allowance this period'}. ` +
              'Two DEPLOYER_ROLE signers send the first batch (the two-person Deployment to CL Operating); then CL Operating\'s owners sign the second (the USDC to the off-ramp).\n\n' +
              JSON.stringify(batches, null, 2),
          });
        }
        if (decision.poolShort > 0n) {
          await alert({
            key: `${keyBase}:margin:${reads.coverage.next}:${decision.poolShort}`,
            subject: `Settlement funding is ${formatUsdc(decision.poolShort)} short for the cut-off at ${cutoffIso}: the Margin or a person`,
            body: marginWords(decision.poolShort, decision.blocked),
          });
        }
        if (decision.late.deploy || decision.late.book) {
          await alert({
            key: `${keyBase}:late:${reads.coverage.next}`,
            subject: `Settlement funding will land after the cut-off at ${cutoffIso}`,
            body: `${decision.late.deploy ? `The off-ramp takes about ${f.latencyMinutes} minutes, and the cut-off is sooner. ` : ''}${decision.late.book ? 'The Collection Account book transfer is not same-day (SETTLEMENT_BOOK_TRANSFER_SAME_DAY). ' : ''}The Savings-Backed Margin covers the settlement at the bank until it lands; afterwards the surplus restores the Margin first. Record the advance: bun src/scripts/recordSettlementMarginAdvance.ts <dollars> "<your name>" "<note>".`,
          });
        }
        if (c.dryRun) {
          log(`[settlement-funding] dry run: cut-off ${cutoffIso} needs ${formatUsdc(f.need)}: book ${formatUsdc(decision.book)}, deploy ${formatUsdc(decision.deploy)} (ref ${ref}), for people ${formatUsdc(people)}`);
          return 'dry-run';
        }
        let out: DeskTick = people > 0n ? 'needs-human' : 'funded';
        if (decision.book > 0n) {
          const row = await store.create({ kind: 'book', cutoffAt: new Date(reads.coverage.next * 1000), ref, due: f.due, need: f.need, amount: decision.book, status: 'planned' });
          log(`[settlement-funding] #${row.id} book ${formatUsdc(decision.book)} from the Collection Account (need ${formatUsdc(f.need)})`);
          const r = await advanceBook(row);
          if (r === 'failed') return r;
        }
        if (decision.deploy > 0n) {
          const st = await chain.state();
          const row = await store.create({
            kind: 'deploy', cutoffAt: new Date(reads.coverage.next * 1000), ref, due: f.due, need: f.need, amount: decision.deploy,
            capShort: decision.capShort, poolShort: decision.poolShort, safeBatch: batches, nonceBefore: st.nonce, fromBlock: block, status: 'planned',
          });
          log(`[settlement-funding] #${row.id} deploy ${formatUsdc(decision.deploy)} through the lane (ref ${ref}, need ${formatUsdc(f.need)})`);
          const r = await advanceDeploy(row);
          if (r !== 'funded') return r;
        }
        if (!decision.book && !decision.deploy) out = decision.setup.length ? 'setup' : 'needs-human';
        return out;
      }
    }
  }

  return { tick };
}

/* ========== TIMING ========== */

/** When the next forced run is due (unix seconds): the next cut-off's, or the one after when it has passed. */
export function nextForcedRun(now: number, config: DeskConfig, measuredLatencyMinutes: number | null): number {
  const latency = Math.max(config.offRampLatencyMinutes, measuredLatencyMinutes ?? 0);
  const cov = coverage(now, config.schedule);
  const at = forcedRunAt(cov.next, latency, config.marginMinutes);
  if (at > now) return at;
  const after = coverage(cov.next, config.schedule);
  return forcedRunAt(after.next, latency, config.marginMinutes);
}

/* ========== WIRING ========== */

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 84532;
}

const isRevert = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return x?.code === 'CALL_EXCEPTION' || /execution reverted|revert/i.test(String(x?.message ?? ''));
};

export function deskAccountName(id: number, env: Record<string, string | undefined> = process.env): string {
  return (env[`SETTLEMENT_DESK_CDP_ACCOUNT_NAME_${id}`] || env.SETTLEMENT_DESK_CDP_ACCOUNT_NAME || '').trim() || (id === 84532 ? 'settlement-desk-base-sepolia' : `settlement-desk-chain-${id}`);
}

/** The desk on this server's chain and contracts. Null (with why) when it cannot run. */
export async function defaultDeskDeps(env: Record<string, string | undefined> = process.env): Promise<{ deps: DeskDeps } | { why: string }> {
  const id = chainId();
  const poolRaw = getContractAddress(id, 'LendingPool');
  if (!poolRaw || !ethers.isAddress(poolRaw)) return { why: `no LendingPool (Yield Pool) address for chain ${id}` };
  const need = (name: string) => {
    const v = (env[name] || '').trim();
    return ethers.isAddress(v) ? ethers.getAddress(v) : null;
  };
  const wallet = need('SETTLEMENT_DESK_WALLET');
  if (!wallet) return { why: 'SETTLEMENT_DESK_WALLET is not set to the desk wallet\'s address' };
  const forwarder = need('SETTLEMENT_FORWARDER');
  if (!forwarder) return { why: 'SETTLEMENT_FORWARDER is not set (the SettlementForwarder is not deployed yet)' };
  const offRampAddress = need('SETTLEMENT_OFFRAMP_ADDRESS');
  if (!offRampAddress) return { why: 'SETTLEMENT_OFFRAMP_ADDRESS is not set (the off-ramp\'s deposit address)' };
  const safeRaw = (env.SETTLEMENT_SAFE || '').trim() || (id === 84532 ? CL_OPERATING_BASE_SEPOLIA : '');
  if (!ethers.isAddress(safeRaw)) return { why: 'SETTLEMENT_SAFE (CL Operating) is not set' };
  const moduleRaw = (env.SETTLEMENT_ALLOWANCE_MODULE || '').trim() || CANONICAL_ALLOWANCE_MODULE;

  const provider = chainProvider(id);
  const pool = new ethers.Contract(poolRaw, YIELD_POOL_ABI as unknown as string[], provider);
  const module = new ethers.Contract(moduleRaw, ALLOWANCE_MODULE_ABI, provider);
  if ((await module.NAME().catch(() => '')) !== 'Allowance Module') return { why: `${moduleRaw} on chain ${id} does not answer as Safe's AllowanceModule` };
  const usdcAddress = ethers.getAddress(await pool.asset());
  const addresses: DeskAddresses = {
    chainId: id,
    pool: ethers.getAddress(poolRaw),
    forwarder,
    safe: ethers.getAddress(safeRaw),
    module: ethers.getAddress(moduleRaw),
    usdc: usdcAddress,
    wallet,
    offRamp: offRampAddress,
  };
  const usdc = new ethers.Contract(usdcAddress, DESK_ERC20_ABI as unknown as string[], provider);
  const safe = new ethers.Contract(addresses.safe, SAFE_MODULE_ABI, provider);
  const fwd = new ethers.Contract(forwarder, SETTLEMENT_FORWARDER_ABI as unknown as string[], provider);
  const config = deskConfigFromEnv(env);
  const db = await merchantDb();
  if (!db) return { why: 'no database to record moves in' };
  const store = deskStore(db, id, addresses.pool);
  const sender = cdpWalletSender(id, wallet, {
    accountName: deskAccountName(id, env),
    networkVars: [`SETTLEMENT_DESK_CDP_NETWORK_${id}`, 'SETTLEMENT_DESK_CDP_NETWORK'],
    walletVar: 'SETTLEMENT_DESK_WALLET',
    label: 'settlement desk wallet',
  }, env);

  const opt = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const chain: DeskChain = {
    read: async () => {
      const b = await provider.getBlock('latest');
      if (!b) throw new Error('no latest block');
      const at = { blockTag: b.number };
      const lane = await Promise.all([
        pool.settlementFunder(at), pool.settlementCapPerPeriod(at), pool.settlementPeriodSeconds(at), pool.settlementPeriodUsed(at), pool.settlementHeadroom(at),
      ]).catch(() => null);
      const [pp, deployed, available, vault, queued, suspended] = await Promise.all([
        pool.poolTierPrincipal(at), pool.deployedBalance(at), pool.availableCash(at), pool.vaultCash(at), pool.queuedShares(at), pool.isSuspended(at),
      ]);
      const [al, moduleEnabled, offRamp, desk, operating, walletBal] = await Promise.all([
        module.getTokenAllowance(addresses.safe, forwarder, usdcAddress, at),
        safe.isModuleEnabled(addresses.module, at),
        opt(fwd.offRamp(at) as Promise<string>),
        opt(fwd.desk(at) as Promise<string>),
        usdc.balanceOf(addresses.safe, at),
        usdc.balanceOf(wallet, at),
      ]);
      const a5 = Array.from(al as Iterable<bigint>, (x) => BigInt(x));
      const allowance: AllowanceRead = { amount: a5[0], spent: a5[1], resetTimeMin: Number(a5[2]), lastResetMin: Number(a5[3]), nonce: Number(a5[4]) };
      return {
        now: b.timestamp,
        block: b.number,
        laneMissing: !lane,
        lane: {
          funder: lane ? ethers.getAddress(lane[0]) : ethers.ZeroAddress,
          capPerPeriod: lane ? BigInt(lane[1]) : 0n,
          periodSeconds: lane ? Number(lane[2]) : 0,
          periodUsed: lane ? BigInt(lane[3]) : 0n,
          headroom: lane ? BigInt(lane[4]) : 0n,
          principal: BigInt(pp[0]),
          principalPosted: BigInt(pp[1]) !== 0n,
          deployedBalance: BigInt(deployed),
          availableCash: BigInt(available),
          vaultCash: BigInt(vault),
          queuedShares: BigInt(queued),
          suspended: Boolean(suspended),
        },
        forwarder: { moduleEnabled: Boolean(moduleEnabled), allowance, offRamp: offRamp ? ethers.getAddress(offRamp) : null, desk: desk ? ethers.getAddress(desk) : null },
        operatingBalance: BigInt(operating),
        walletBalance: BigInt(walletBal),
      };
    },
    state: async () => {
      const [al, bal, appr] = await Promise.all([
        module.getTokenAllowance(addresses.safe, forwarder, usdcAddress),
        usdc.balanceOf(wallet),
        usdc.allowance(wallet, addresses.pool),
      ]);
      return { nonce: Number(al[4]), walletBalance: BigInt(bal), walletPoolAllowance: BigInt(appr) };
    },
    findDeployed: async (ref, fromBlock) => {
      const logs = await provider.getLogs({ address: addresses.pool, topics: [SETTLEMENT_DEPLOYED_TOPIC], fromBlock, toBlock: 'latest' });
      return logs.find((l) => isSettlementDeployedFor(l, ref))?.transactionHash ?? null;
    },
    dryRun: async (tx) => {
      try {
        await provider.call({ from: wallet, to: tx.to, data: tx.data });
        await provider.estimateGas({ from: wallet, to: tx.to, data: tx.data });
      } catch (error) {
        if (isRevert(error)) throw new DeskRevert((error as { shortMessage?: string; message?: string })?.shortMessage ?? String((error as Error)?.message ?? error));
        throw error;
      }
    },
    send: (tx, k) => {
      if (config.dryRun) throw new Error('SETTLEMENT_FUNDING_DRY_RUN is on: nothing is sent');
      return sender.send(tx, k);
    },
    receipt: async (hash) => {
      const r = await provider.getTransactionReceipt(hash);
      return r ? { status: Number(r.status) } : null;
    },
  };

  const accounts = bankAccountsFromEnv(env);
  const bankName = (env.SETTLEMENT_BANK || '').trim().toLowerCase() || 'lithic';
  let bank: BankRail;
  if (bankName === 'mock') {
    bank = mockBank({
      balances: { 'mock-csa': parseUsdc(env.SETTLEMENT_MOCK_CSA_USDC) ?? 0n, 'mock-collection': parseUsdc(env.SETTLEMENT_MOCK_COLLECTION_USDC) ?? 0n },
    });
  } else {
    const { getLithic } = await import('../services/lithic/lithicClient.js');
    const lithic = getLithic();
    if (!lithic) return { why: 'Lithic is not configured (LITHIC_API_KEY), and SETTLEMENT_BANK is not mock' };
    bank = lithicBank(lithic as unknown as LithicLike, accounts, transferClassFromEnv(env));
  }

  const rampName = (env.SETTLEMENT_OFFRAMP || '').trim().toLowerCase() || (id === 84532 ? 'mock' : 'bridge');
  let offRamp: OffRamp;
  if (rampName === 'bridge') {
    const customerId = (env.SETTLEMENT_BRIDGE_CUSTOMER_ID || '').trim();
    const liq = (env.SETTLEMENT_BRIDGE_LIQUIDATION_ADDRESS_ID || '').trim();
    if (!customerId || !liq) return { why: 'SETTLEMENT_OFFRAMP=bridge needs SETTLEMENT_BRIDGE_CUSTOMER_ID and SETTLEMENT_BRIDGE_LIQUIDATION_ADDRESS_ID' };
    offRamp = bridgeOffRamp({ customerId, liquidationAddressId: liq, address: offRampAddress, rail: (env.SETTLEMENT_OFFRAMP_RAIL || 'wire').trim() });
  } else {
    offRamp = mockOffRamp({
      address: offRampAddress,
      latencyMinutes: config.offRampLatencyMinutes,
      now: () => Math.floor(Date.now() / 1000),
      deposits: async () =>
        (await store.recent(50))
          .filter((r) => r.kind === 'deploy' && r.forwardedAt)
          .map((r) => ({ forwardTx: r.forwardTx, amount: r.amount, forwardedAt: Math.floor(r.forwardedAt!.getTime() / 1000) })),
    });
  }

  const payPool = getPayPool();
  const pay = payPool ? { query: async <T>(text: string, params?: unknown[]) => ({ rows: (await payPool.query(text, params)).rows as T[] }) } : null;
  return {
    deps: {
      chainId: id,
      addresses,
      config,
      chain,
      store,
      bank,
      offRamp,
      card: (input) => readCardCredit(pay, { ...input, schedule: config.schedule, velocityDays: config.velocityDays }),
      cardDay: (from, to) => cardCreditBetween(pay, from, to),
      alert: alertOps,
      settleGraceMinutes: Number((env.SETTLEMENT_OFFRAMP_SETTLE_MINUTES || '').trim()) || 60,
    },
  };
}

export function startFundingDesk(): void {
  if (!settlementFundingEnabled()) {
    console.log('[settlement-funding] disabled (set SETTLEMENT_FUNDING_ENABLED=1, with SETTLEMENT_FUNDING_DRY_RUN=1 first, for automatic Settlement Funding)');
    return;
  }
  void (async () => {
    const made = await defaultDeskDeps().catch((e) => ({ why: (e as Error)?.message ?? String(e) }));
    if ('why' in made) {
      console.warn(`[settlement-funding] not started: ${made.why}`);
      return;
    }
    const d = made.deps;
    const job = createFundingDesk(d);
    setInterval(() => void job.tick(), d.config.checkMinutes * MINUTE_MS).unref?.();
    const forced = async () => {
      const measured = await d.store.measuredLatencyMinutes().catch(() => null);
      const at = nextForcedRun(Math.floor(Date.now() / 1000), d.config, measured);
      setTimeout(() => {
        void job.tick({ forced: true }).finally(() => void forced());
      }, Math.max(1_000, at * 1000 - Date.now())).unref?.();
    };
    void forced();
    void job.tick();
    console.log(
      `[settlement-funding] started${d.config.dryRun ? ' in DRY RUN (nothing is sent)' : ''}: every ${d.config.checkMinutes} min and at each cut-off's forced time; ` +
        `returns ${d.config.returnsEnabled ? 'on' : 'off'}; wallet ${d.addresses.wallet}, forwarder ${d.addresses.forwarder}, off-ramp ${d.offRamp.name} ${d.addresses.offRamp} (${d.offRamp.rail}), bank ${d.bank.name}`,
    );
  })();
}
