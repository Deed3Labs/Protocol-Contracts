import { ethers } from 'ethers';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';

/*
 * Credit the LendingPool funds, accounted for on chain.
 *
 * The unsecured tiers (income and Boost by default) are funded by the pool's depositors. A card
 * purchase is still paid to the merchant in fiat from the co-op's float -- that does not change --
 * but when such a purchase settles on one of those tiers, the co-op BORROWS the same amount of USDC
 * from the pool. That is what makes the pool's funding real: its cash leaves, `totalBorrowed` rises,
 * and depositors' shares are backed by a loan rather than by nothing. The USDC lands in the co-op's
 * card-funding wallet and reaches the fiat float by the ordinary periodic off-ramp, never per swipe.
 *
 * When a pool-funded tier is repaid, the co-op REPAYS the pool that amount in USDC. Carry is
 * materialised into a tier's principal on chain, so what a tier repays already includes the carry
 * that accrued on it -- and `LendingPool.repay` counts anything above principal as depositors' yield.
 * Principal and carry reach the depositors exactly as the member pays them.
 *
 * Driven by the issuer's own events, read from the receipts of the transactions this service writes
 * (settlement, reversal, netting, re-issue) and of member repayments it records: TierDrawn on a
 * pool-funded tier is a borrow, TierRepaid is a repayment. One row per event, keyed by
 * (tx, log index), so a receipt read twice is recorded once; the sweep settles the rows.
 *
 * Two things can make a row wait, and both are stated rather than retried into the ground: the pool
 * short of cash to lend, and the card-funding wallet short of USDC to repay. The second is the one
 * point where the co-op tops up from treasury -- the on-ramp -- and the row says how much.
 */

const TABLE = 'pool_funding_movements';
const ISSUER_EVENTS = new ethers.Interface([
  'event TierDrawn(address indexed member, uint256 indexed tierId, uint256 amount)',
  'event TierRepaid(address indexed member, uint256 indexed tierId, uint256 amount)',
]);
const POOL_ABI = [
  'function borrow(uint256 amount, address to)',
  'function repay(uint256 amount)',
  'function availableCash() view returns (uint256)',
  'function asset() view returns (address)',
];
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];
const MAX_ATTEMPTS = 5;

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

/** Tier kinds the pool funds. The unsecured ones by default; secured tiers are backed by the member's own collateral. */
export function poolFundedKinds(): Set<string> {
  const raw = (process.env.POOL_FUNDED_TIER_KINDS || 'INCOME,BOOST').trim();
  return new Set(raw.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean));
}

function settlerKey(): string {
  return (process.env.CARD_SETTLER_PRIVATE_KEY || '').trim();
}

export function isPoolFundingConfigured(): boolean {
  return Boolean(settlerKey() && getPayPool() && getContractAddress(chainId(), 'LendingPool'));
}

let ensured = false;
async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      member TEXT NOT NULL,
      tier_id INTEGER NOT NULL,
      tier_kind TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('borrow', 'repay')),
      amount_units NUMERIC(38, 0) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      pool_tx TEXT,
      reason TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS ${TABLE}_status_idx ON ${TABLE} (status, created_at);
  `);
  ensured = true;
}

const kindCache = new Map<number, string>();
async function tierKind(issuer: ethers.Contract, tierId: number): Promise<string> {
  const cached = kindCache.get(tierId);
  if (cached) return cached;
  const [kind] = (await issuer.tierAt(tierId)) as [string, bigint, boolean];
  const decoded = ethers.decodeBytes32String(kind).toUpperCase();
  kindCache.set(tierId, decoded);
  return decoded;
}

/**
 * The pool-funded draws and repayments in one of our receipts, as rows to settle.
 *
 * Never throws. It runs straight after a transaction that has already landed, and an RPC hiccup here
 * must not make the caller believe the transaction failed. A miss is logged loudly with the hash, so
 * it can be replayed with `recordPoolMovementsFor(hash)`.
 */
export async function recordPoolMovements(receipt: ethers.TransactionReceipt | null): Promise<number> {
  try {
    return await recordPoolMovementsUnsafe(receipt);
  } catch (error) {
    console.error(
      `[pool-funding] MISSED pool movements for ${receipt?.hash ?? 'unknown tx'} — replay with recordPoolMovementsFor:`,
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}

/** Replay a receipt by hash, for a movement a failed read missed. */
export async function recordPoolMovementsFor(txHash: string): Promise<number> {
  return recordPoolMovements(await chainProvider(chainId()).getTransactionReceipt(txHash));
}

async function recordPoolMovementsUnsafe(receipt: ethers.TransactionReceipt | null): Promise<number> {
  if (!receipt || receipt.status !== 1 || !isPoolFundingConfigured()) return 0;
  const issuerAddress = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!issuerAddress) return 0;
  await ensureTable();
  const issuer = new ethers.Contract(
    issuerAddress,
    ['function tierAt(uint256) view returns (bytes32 kind, uint256 ratePerCycle, bool active)'],
    chainProvider(chainId()),
  );
  const funded = poolFundedKinds();
  let recorded = 0;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== issuerAddress.toLowerCase()) continue;
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = ISSUER_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (!parsed) continue;
    const tierId = Number(parsed.args.tierId);
    const kind = await tierKind(issuer, tierId);
    if (!funded.has(kind)) continue;
    const r = await getPayPool()!.query(
      `INSERT INTO ${TABLE} (tx_hash, log_index, member, tier_id, tier_kind, direction, amount_units)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tx_hash, log_index) DO NOTHING`,
      [
        receipt.hash.toLowerCase(),
        log.index,
        String(parsed.args.member).toLowerCase(),
        tierId,
        kind,
        parsed.name === 'TierDrawn' ? 'borrow' : 'repay',
        BigInt(parsed.args.amount).toString(),
      ],
    );
    recorded += r.rowCount ?? 0;
  }
  if (recorded) console.log(`[pool-funding] ${recorded} pool movement(s) from ${receipt.hash}`);
  return recorded;
}

export interface PoolSettlement {
  settled: number;
  waiting: Array<{ direction: string; amountUnits: string; reason: string }>;
}

/** Borrow and repay what the rows say. Oldest first; a row that cannot go yet waits with its reason. */
export async function settlePoolMovements(limit = 25): Promise<PoolSettlement> {
  const out: PoolSettlement = { settled: 0, waiting: [] };
  if (!isPoolFundingConfigured()) return out;
  await ensureTable();
  const db = getPayPool()!;
  const { rows } = await db.query<{ tx_hash: string; log_index: number; direction: string; amount_units: string; attempts: number }>(
    `SELECT tx_hash, log_index, direction, amount_units, attempts FROM ${TABLE}
      WHERE status IN ('pending', 'waiting', 'failed') ORDER BY created_at LIMIT $1`,
    [limit],
  );
  if (!rows.length) return out;

  const provider = chainProvider(chainId());
  const signer = new ethers.Wallet(settlerKey(), provider);
  const poolAddress = getContractAddress(chainId(), 'LendingPool')!;
  const pool = new ethers.Contract(poolAddress, POOL_ABI, writesAs(signer));
  const usdc = new ethers.Contract(String(await pool.asset()), ERC20_ABI, writesAs(signer));

  const mark = (row: { tx_hash: string; log_index: number }, status: string, fields: { poolTx?: string; reason?: string | null; attempt?: boolean }) =>
    db.query(
      `UPDATE ${TABLE} SET status = $3, pool_tx = COALESCE($4, pool_tx), reason = $5,
              attempts = attempts + $6, updated_at = now() WHERE tx_hash = $1 AND log_index = $2`,
      [row.tx_hash, row.log_index, status, fields.poolTx ?? null, fields.reason ?? null, fields.attempt ? 1 : 0],
    );

  for (const row of rows) {
    const amount = BigInt(row.amount_units);
    try {
      if (row.direction === 'borrow') {
        const cash = (await pool.availableCash()) as bigint;
        if (cash < amount) {
          const reason = `pool has ${cash} to lend, needs ${amount}`;
          await mark(row, 'waiting', { reason });
          out.waiting.push({ direction: 'borrow', amountUnits: row.amount_units, reason });
          continue;
        }
        const tx = await pool.borrow(amount, signer.address);
        await tx.wait(1);
        await mark(row, 'done', { poolTx: tx.hash, reason: null, attempt: true });
      } else {
        const held = (await usdc.balanceOf(signer.address)) as bigint;
        if (held < amount) {
          // The one top-up point: the co-op sends USDC to the card-funding wallet, from treasury.
          const reason = `card-funding wallet holds ${held} USDC, needs ${amount} to repay the pool — top up from treasury`;
          await mark(row, 'waiting', { reason });
          out.waiting.push({ direction: 'repay', amountUnits: row.amount_units, reason });
          continue;
        }
        if (((await usdc.allowance(signer.address, poolAddress)) as bigint) < amount) {
          await (await usdc.approve(poolAddress, ethers.MaxUint256)).wait(1);
        }
        const tx = await pool.repay(amount);
        await tx.wait(1);
        await mark(row, 'done', { poolTx: tx.hash, reason: null, attempt: true });
      }
      out.settled += 1;
      console.log(`[pool-funding] ${row.direction} ${amount} settled (${row.tx_hash}#${row.log_index})`);
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      const status = row.attempts + 1 >= MAX_ATTEMPTS ? 'needs_review' : 'failed';
      await mark(row, status, { reason, attempt: true });
      console.error(`[pool-funding] ${row.direction} ${amount} ${status}: ${reason}`);
    }
  }
  return out;
}
