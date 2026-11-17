import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import type { Db } from '../db/db';
import { testDb } from '../db/testDb';
import { ERC20_ABI, POOL_ABI, TRANSFER_TOPIC, type FeeChain, type FeeSigner, type ReceiptLite } from '../services/assuranceFees/chain';
import type { AssuranceFeeConfig } from '../services/assuranceFees/config';
import { claimSend, itemById, markFundingProposed, recordRepayment, unpaid } from '../services/assuranceFees/store';
import type { FundingProposal } from '../services/assuranceFees/proposals';
import { createAssuranceFeePayer } from './assuranceFeePayer';

/*
 * The payer against a pretend chain: a USDC, a pool that pulls by transferFrom from an allowlisted
 * payer, and the CL Fees wallet. Nothing here reaches a network or CDP.
 */

const USDC = 1_000_000n;
const CHAIN = 84532;
const TOKEN = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const POOL = '0x00000000000000000000000000000000000A55A1';
const CL_FEES = '0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd';
const ERC20 = new ethers.Interface(ERC20_ABI);
const POOLI = new ethers.Interface(POOL_ABI);
const lc = (a: string) => a.toLowerCase();
const pad = (a: string) => ethers.zeroPadValue(a, 32);

const config = (o: Partial<AssuranceFeeConfig> = {}): AssuranceFeeConfig => ({
  chainId: CHAIN,
  pool: POOL,
  clFees: CL_FEES,
  clOperating: '0xfAFf1081F77bF528bA21eea590f251a755bCdf65',
  clearLendingSafe: '0xAE8FF4Fa84d786Ece2C7Ab87886A2CD6086c419d',
  treasurySafe: '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50',
  payerEnabled: true,
  payerMode: 'cdp_server_wallet',
  cdpAccountName: 'cl-fees-base-sepolia',
  feeBps: 800n,
  interchangeBps: 2500n,
  ...o,
});

type Sent = { to: string; name: string; args: unknown[]; key: string; hash: string };

/** A pretend chain. `hold` keeps sends in the mempool until `mine()`; `throwOn` makes the wallet lose a hash after broadcasting. */
function world() {
  const s = {
    block: 1000,
    coverage: 0n,
    balances: new Map<string, bigint>(),
    allowance: new Map<string, bigint>(),
    tags: new Map<string, bigint>([[lc(CL_FEES), 0b11n]]),
    receipts: new Map<string, ReceiptLite>(),
    transfers: [] as Array<{ hash: string; from: string; to: string; value: bigint; block: number }>,
    mempool: [] as Array<() => void>,
    mined: 0,
    hold: false,
    throwOn: null as null | 'approve' | 'deposit',
    /** The deposit reverts on chain though its dry run passed. */
    revertOnChain: false,
    signerAddress: CL_FEES,
    readFails: false,
  };
  const sent: Sent[] = [];
  const bal = (a: string) => s.balances.get(lc(a)) ?? 0n;
  const allow = (o: string, sp: string) => s.allowance.get(`${lc(o)}:${lc(sp)}`) ?? 0n;
  const depositWouldFail = (from: string, tag: number, amount: bigint) => {
    if (((s.tags.get(lc(from)) ?? 0n) >> BigInt(tag)) % 2n === 0n) return 'AssurancePoolNotPayer';
    if (allow(from, POOL) < amount) return 'ERC20: insufficient allowance';
    if (bal(from) < amount) return 'ERC20: transfer amount exceeds balance';
    return null;
  };
  const mineOne = (fn: () => void) => {
    s.block += 1;
    s.mined += 1;
    fn();
  };
  const chain: FeeChain = {
    block: async () => s.block,
    readPool: async () => {
      if (s.readFails) throw new Error('rpc down');
      return { availableCoverage: s.coverage, backstopBalance: s.coverage, backstopFloor: 0n, coverageCap: s.coverage, block: s.block };
    },
    floorInputsAt: async () => 0n,
    releasedDraws: async () => ({ total: 0n, count: 0 }),
    asset: async () => TOKEN,
    payerTags: async (_p, who) => s.tags.get(lc(who)) ?? 0n,
    balanceOf: async (_t, who) => bal(who),
    allowance: async (_t, o, sp) => allow(o, sp),
    nonces: async () => ({ latest: s.mined, pending: s.mined + s.mempool.length }),
    async dryRun(tx) {
      if (lc(tx.to) === lc(POOL)) {
        const d = POOLI.parseTransaction({ data: tx.data })!;
        const why = depositWouldFail(tx.from, Number(d.args[0]), d.args[1] as bigint);
        if (why) throw new Error(`execution reverted: ${why}`);
      }
    },
    receipt: async (h) => s.receipts.get(h) ?? null,
    transfers: async (_t, from, to, fromBlock) => s.transfers.filter((t) => lc(t.from) === lc(from) && lc(t.to) === lc(to) && t.block >= fromBlock).map(({ hash, value, block }) => ({ hash, value, block })),
  };
  const signer: FeeSigner = {
    address: async () => s.signerAddress,
    async send(tx, key) {
      const hash = ethers.keccak256(ethers.toUtf8Bytes(`${key}:${sent.length}`));
      const from = s.signerAddress;
      let name: string;
      let args: unknown[];
      let effect: () => void;
      if (lc(tx.to) === lc(TOKEN)) {
        const d = ERC20.parseTransaction({ data: tx.data })!;
        name = d.name;
        args = [...d.args];
        effect = () => {
          s.allowance.set(`${lc(from)}:${lc(d.args[0] as string)}`, d.args[1] as bigint);
          s.receipts.set(hash, { status: 1, blockNumber: s.block, logs: [] });
        };
      } else {
        const d = POOLI.parseTransaction({ data: tx.data })!;
        name = d.name;
        args = [Number(d.args[0]), d.args[1]];
        const amount = d.args[1] as bigint;
        effect = () => {
          if (s.revertOnChain || depositWouldFail(from, Number(d.args[0]), amount)) {
            s.receipts.set(hash, { status: 0, blockNumber: s.block, logs: [] });
            return;
          }
          s.balances.set(lc(from), bal(from) - amount);
          s.balances.set(lc(POOL), bal(POOL) + amount);
          s.allowance.set(`${lc(from)}:${lc(POOL)}`, allow(from, POOL) - amount);
          s.transfers.push({ hash, from, to: POOL, value: amount, block: s.block });
          s.receipts.set(hash, { status: 1, blockNumber: s.block, logs: [{ address: TOKEN, topics: [TRANSFER_TOPIC, pad(from), pad(POOL)], data: ethers.toBeHex(amount, 32) }] });
        };
      }
      sent.push({ to: tx.to, name, args, key, hash });
      if (s.hold) s.mempool.push(() => mineOne(effect));
      else mineOne(effect);
      if (s.throwOn === name) throw new Error('CDP: connection reset');
      return hash;
    },
  };
  return {
    s,
    sent,
    chain,
    signer,
    fund: (amount: bigint) => s.balances.set(lc(CL_FEES), bal(CL_FEES) + amount),
    poolHolds: () => bal(POOL),
    mine: () => {
      for (const f of s.mempool.splice(0)) f();
    },
    deposits: () => sent.filter((x) => x.name === 'deposit'),
  };
}

let db: Db;
let pg: PGlite;
beforeAll(async () => {
  ({ db, pg } = await testDb());
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.exec('DELETE FROM command.assurance_items; DELETE FROM command.assurance_snapshots;');
});

function payer(w: ReturnType<typeof world>, o: Partial<AssuranceFeeConfig> = {}, now = '2026-11-03T10:00:00Z') {
  const alerts: Array<{ key: string; subject: string; body: string }> = [];
  const logs: string[] = [];
  const p = createAssuranceFeePayer({
    db,
    config: config(o),
    chain: w.chain,
    signer: config(o).payerEnabled ? w.signer : null,
    alert: async (a) => {
      alerts.push(a);
    },
    now: () => new Date(now),
    sleep: async () => undefined,
    receiptTimeoutMs: 0,
    log: (l) => logs.push(l),
    warn: (l) => logs.push(l),
  });
  return { tick: p.tick, alerts, logs };
}

const at = new Date('2026-11-02T10:00:00Z');
async function item(kind: 'fee' | 'recovery' | 'spread_repayment', amount: bigint, month = '2026-10', status: 'due' | 'funding_proposed' = 'funding_proposed') {
  const { rows } = await db.query<{ id: string }>(`INSERT INTO command.assurance_items (chain_id, kind, month, source_tag, amount) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
    CHAIN,
    kind,
    `${month}-01`,
    kind === 'fee' ? 0 : 1,
    amount.toString(),
  ]);
  if (status === 'funding_proposed') await markFundingProposed(db, rows[0].id, {} as FundingProposal, null, at);
  return rows[0].id;
}

describe('reading and accruing', () => {
  test('off without the pool’s address: reads nothing, sends nothing', async () => {
    const w = world();
    const r = await payer(w, { pool: null }).tick();
    expect(r).toMatchObject({ snapshot: 'off', pay: 'off' });
    expect(w.sent).toEqual([]);
  });

  test('reads once a day and accrues the month once it has ended', async () => {
    const w = world();
    w.s.coverage = 36_500n * USDC;
    for (let d = 1; d <= 31; d++) await payer(w, { payerEnabled: false }, `2026-10-${String(d).padStart(2, '0')}T00:05:00Z`).tick();
    const r = await payer(w, { payerEnabled: false }, '2026-11-01T00:05:00Z').tick();
    expect(r).not.toBe('busy');
    if (r === 'busy') return;
    expect(r.accrued).toEqual([{ month: '2026-10', fee: 248n * USDC }]);
    // the same day again: nothing new
    const again = await payer(w, { payerEnabled: false }, '2026-11-01T05:05:00Z').tick();
    expect(again).toMatchObject({ snapshot: [], accrued: [] });
    expect((await unpaid(db, CHAIN))[0]).toMatchObject({ kind: 'fee', status: 'due', amount: 248n * USDC });
  });

  test('a failing read alerts after three passes in a row', async () => {
    const w = world();
    w.s.readFails = true;
    const p = payer(w);
    for (let i = 0; i < 3; i++) await p.tick();
    expect(p.alerts.map((a) => a.subject)).toEqual(['Assurance fee payer cannot read the pool']);
  });
});

describe('paying', () => {
  test('approve(pool, exactly the amount) on USDC, then deposit(CREDIT_ENHANCEMENT_FEE, amount); paid with its hash', async () => {
    const w = world();
    w.fund(1_000n * USDC);
    const id = await item('fee', 26_301_369n);
    const r = await payer(w).tick();
    expect(r).toMatchObject({ pay: 'paid', paid: [id] });
    expect(w.sent.map((x) => [x.to, x.name, ...x.args])).toEqual([
      [TOKEN, 'approve', ethers.getAddress(POOL), 26_301_369n],
      [POOL, 'deposit', 0, 26_301_369n],
    ]);
    expect(w.poolHolds()).toBe(26_301_369n);
    const paid = await itemById(db, id);
    expect(paid).toMatchObject({ status: 'paid', depositTx: lc(w.sent[1].hash), approveTx: lc(w.sent[0].hash), attempt: 1 });
    // never more than recorded, though the wallet holds far more
    expect(w.s.balances.get(lc(CL_FEES))).toBe(1_000n * USDC - 26_301_369n);
  });

  test('a Spread Repayment or recovery goes under RECOVERY', async () => {
    const w = world();
    w.fund(100n * USDC);
    const id = await db.transaction((tx) => recordRepayment(tx, { chainId: CHAIN, kind: 'spread_repayment', month: '2026-10', amount: 40n * USDC, note: 'n', evidence: '', by: null, released: 100n * USDC }));
    await markFundingProposed(db, id.id, {} as FundingProposal, null, at);
    await payer(w).tick();
    expect(w.deposits().map((d) => d.args)).toEqual([[1, 40n * USDC]]);
  });

  test('nothing is paid before its funding is proposed', async () => {
    const w = world();
    w.fund(100n * USDC);
    await item('fee', 5n * USDC, '2026-10', 'due');
    expect(await payer(w).tick()).toMatchObject({ pay: 'waiting' });
    expect(w.sent).toEqual([]);
  });

  test('the wallet short of the oldest item: it waits, and pays once funded', async () => {
    const w = world();
    w.fund(4n * USDC);
    const id = await item('fee', 5n * USDC);
    expect(await payer(w).tick()).toMatchObject({ pay: 'waiting' });
    expect(w.sent).toEqual([]);
    expect((await itemById(db, id))?.status).toBe('funding_proposed');
    w.fund(1n * USDC);
    expect(await payer(w).tick()).toMatchObject({ pay: 'paid' });
  });

  test('paying off: funded is noted, nothing is sent', async () => {
    const w = world();
    w.fund(10n * USDC);
    const id = await item('fee', 5n * USDC);
    expect(await payer(w, { payerEnabled: false }).tick()).toMatchObject({ pay: 'off' });
    expect(w.sent).toEqual([]);
    expect((await itemById(db, id))?.status).toBe('funded');
  });

  test('oldest first, and stops at the first the wallet can’t cover', async () => {
    const w = world();
    w.fund(7n * USDC);
    const nov = await item('fee', 4n * USDC, '2026-11');
    const sep = await item('recovery', 3n * USDC, '2026-09');
    const oct = await item('fee', 2n * USDC, '2026-10');
    const r = await payer(w).tick();
    expect(r).toMatchObject({ pay: 'waiting', paid: [sep, oct] });
    expect(w.deposits().map((d) => d.args[1])).toEqual([3n * USDC, 2n * USDC]);
    expect((await itemById(db, nov))?.status).toBe('funding_proposed');
  });
});

describe('refusing', () => {
  test('not an allowlisted payer for the tag: stops and alerts, sends nothing', async () => {
    const w = world();
    w.fund(10n * USDC);
    w.s.tags.set(lc(CL_FEES), 0b10n); // RECOVERY only
    const id = await item('fee', 5n * USDC);
    const p = payer(w);
    expect(await p.tick()).toMatchObject({ pay: 'failed' });
    expect(w.sent).toEqual([]);
    expect((await itemById(db, id))?.status).toBe('failed');
    expect(p.alerts[0].subject).toBe('Assurance fee payer stopped');
    expect(p.alerts[0].body).toContain('CREDIT_ENHANCEMENT_FEE');
    // and stays stopped: later items aren't paid either
    await item('recovery', 1n * USDC, '2026-11');
    w.s.tags.set(lc(CL_FEES), 0b11n);
    expect(await payer(w).tick()).toMatchObject({ pay: 'stopped' });
    expect(w.sent).toEqual([]);
  });

  test('a deposit whose dry run reverts is never sent', async () => {
    const w = world();
    w.fund(10n * USDC);
    w.s.tags.set(lc(CL_FEES), 0b11n);
    const id = await item('fee', 5n * USDC);
    // the approve lands, but the pool would refuse the payer (the dry run sees it)
    const realDryRun = w.chain.dryRun;
    w.chain.dryRun = async (tx) => {
      if (lc(tx.to) === lc(POOL)) throw new Error('execution reverted: AssurancePoolMoneyPath');
      return realDryRun(tx);
    };
    const p = payer(w);
    expect(await p.tick()).toMatchObject({ pay: 'failed' });
    expect(w.deposits()).toEqual([]);
    expect((await itemById(db, id))?.error).toContain('AssurancePoolMoneyPath');
    expect(p.alerts).toHaveLength(1);
  });

  test('a revert on chain stops everything and alerts', async () => {
    const w = world();
    w.fund(10n * USDC);
    w.s.revertOnChain = true;
    const first = await item('fee', 5n * USDC, '2026-09');
    await item('fee', 1n * USDC, '2026-10');
    const p = payer(w);
    expect(await p.tick()).toMatchObject({ pay: 'failed', paid: [] });
    expect(w.deposits()).toHaveLength(1);
    expect((await itemById(db, first))?.status).toBe('failed');
    expect(p.alerts[0].body).toContain('reverted');
    expect(await payer(w).tick()).toMatchObject({ pay: 'stopped' });
    expect(w.deposits()).toHaveLength(1);
  });

  test('a wallet that isn’t the CL Fees wallet sends nothing', async () => {
    const w = world();
    w.fund(10n * USDC);
    w.s.signerAddress = '0x000000000000000000000000000000000000bEEF';
    await item('fee', 5n * USDC);
    const p = payer(w);
    expect(await p.tick()).toMatchObject({ pay: 'stopped' });
    expect(w.sent).toEqual([]);
    expect(p.alerts[0].subject).toBe('Assurance fee payer: wrong wallet');
  });
});

describe('never twice, across a restart mid-send', () => {
  test('the deposit was sent and not yet mined: the next run waits for its receipt and sends nothing new', async () => {
    const w = world();
    w.fund(10n * USDC);
    const id = await item('fee', 5n * USDC);
    w.s.hold = true;
    // the approve is held too: mine it, then hold the deposit
    const first = payer(w);
    expect(await first.tick()).toMatchObject({ pay: 'pending' });
    w.mine();
    // a restart: a new payer, the item still sending with the approve's hash and no deposit yet
    expect((await itemById(db, id))?.status).toBe('sending');
    expect(await payer(w).tick()).toMatchObject({ pay: 'pending' });
    w.mine();
    const r = await payer(w).tick();
    expect(r).toMatchObject({ pay: 'paid' });
    expect(w.deposits()).toHaveLength(1);
    expect(w.sent.filter((x) => x.name === 'approve')).toHaveLength(1);
    expect(w.poolHolds()).toBe(5n * USDC);
  });

  test('the deposit went out but its hash was lost: found on chain after the restart, not sent again', async () => {
    const w = world();
    w.fund(10n * USDC);
    const id = await item('fee', 5n * USDC);
    w.s.throwOn = 'deposit';
    expect(await payer(w).tick()).toMatchObject({ pay: 'pending' });
    expect((await itemById(db, id))).toMatchObject({ status: 'sending', depositTx: null });
    w.s.throwOn = null;
    const r = await payer(w).tick();
    expect(r).toMatchObject({ pay: 'paid', paid: [id] });
    expect(w.deposits()).toHaveLength(1);
    expect((await itemById(db, id))?.depositTx).toBe(lc(w.deposits()[0].hash));
    expect(w.poolHolds()).toBe(5n * USDC);
  });

  test('lost hash and still in the mempool: waits while anything is pending, then finds it', async () => {
    const w = world();
    w.fund(10n * USDC);
    await item('fee', 5n * USDC);
    w.s.throwOn = 'deposit';
    await payer(w).tick(); // approve mined, deposit errored
    w.s.throwOn = null;
    // pretend the deposit is still pending: undo its mining into the mempool
    const dep = w.deposits()[0];
    w.s.transfers = [];
    w.s.receipts.delete(dep.hash);
    w.s.balances.set(lc(CL_FEES), 10n * USDC);
    w.s.balances.set(lc(POOL), 0n);
    w.s.allowance.set(`${lc(CL_FEES)}:${lc(POOL)}`, 5n * USDC);
    w.s.mined -= 1;
    w.s.mempool.push(() => {
      w.s.mined += 1;
      w.s.block += 1;
      w.s.balances.set(lc(CL_FEES), 5n * USDC);
      w.s.balances.set(lc(POOL), 5n * USDC);
      w.s.allowance.set(`${lc(CL_FEES)}:${lc(POOL)}`, 0n);
      w.s.transfers.push({ hash: dep.hash, from: CL_FEES, to: POOL, value: 5n * USDC, block: w.s.block });
    });
    expect(await payer(w).tick()).toMatchObject({ pay: 'pending' });
    expect(w.deposits()).toHaveLength(1);
    w.mine();
    expect(await payer(w).tick()).toMatchObject({ pay: 'paid' });
    expect(w.deposits()).toHaveLength(1);
  });

  test('the approve landed and the server stopped before the deposit: only the deposit is sent', async () => {
    const w = world();
    w.fund(10n * USDC);
    const id = await item('fee', 5n * USDC);
    w.s.throwOn = 'approve';
    // the approve's hash is lost as it errors: the pass dies there, the item sending
    expect(await payer(w).tick()).toMatchObject({ pay: 'failed' });
    expect((await itemById(db, id))?.status).toBe('sending');
    w.s.throwOn = null;
    expect(await payer(w).tick()).toMatchObject({ pay: 'paid' });
    expect(w.sent.map((x) => x.name)).toEqual(['approve', 'deposit']);
    expect(w.poolHolds()).toBe(5n * USDC);
  });

  test('a send already claimed by another run is not claimed again', async () => {
    const w = world();
    w.fund(10n * USDC);
    const id = await item('fee', 5n * USDC);
    await claimSend(db, id, { payer: CL_FEES, block: 1, at });
    // the other run holds it in sending with nothing sent: this run settles it from the chain, sending once
    await payer(w).tick();
    expect(w.deposits()).toHaveLength(1);
    expect(await payer(w).tick()).toMatchObject({ pay: 'nothing' });
    expect(w.deposits()).toHaveLength(1);
  });

  test('a retried failure whose deposit did land is recorded, not paid twice', async () => {
    const w = world();
    w.fund(10n * USDC);
    const id = await item('fee', 5n * USDC);
    // the deposit lands, but the receipt shows no transfer: stopped as a surprise
    const realReceipt = w.chain.receipt;
    w.chain.receipt = async (h) => {
      const r = await realReceipt(h);
      return r && r.logs.length ? { ...r, logs: [] } : r;
    };
    expect(await payer(w).tick()).toMatchObject({ pay: 'failed' });
    w.chain.receipt = realReceipt;
    await db.query(`UPDATE command.assurance_items SET status = 'funded', error = NULL, approve_tx = NULL, deposit_tx = NULL WHERE id = $1`, [id]);
    expect(await payer(w).tick()).toMatchObject({ pay: 'paid' });
    expect(w.deposits()).toHaveLength(1);
    expect(w.poolHolds()).toBe(5n * USDC);
  });
});
