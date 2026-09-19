import { ethers } from 'ethers';
import type { PoolClient } from 'pg';
import { getPayPool } from '../../config/postgres.js';
import { getContractAddress } from '../../config/contracts.js';
import { chainProvider, writesAs } from './provider.js';
import { recordPlanPayments } from '../credit/termPlanPayments.js';

/*
 * Term plans, paid out of a bank deposit.
 *
 * A fiat deposit lands in the co-op's account, so it cannot pay a plan on chain itself. It pays in
 * the books, on arrival, and the co-op pays the same amount on chain out of the card-funding float
 * -- the way fiat already pays card debt (netting). `payPlan` takes the payer as msg.sender, so the
 * settler pays and nothing needs the member's signature.
 *
 * What a deposit pays, in order, before any card debt:
 *   1. every plan's arrears, oldest plan first -- falling behind is what a plan defaults on
 *   2. carry owed on no plan and no tier: left behind when a plan was refunded
 *
 * Only what is DUE, not the next installment early: a deposit is the member's money, and taking
 * ahead of schedule would be lending them their own cash back at 0%.
 *
 * The deposit writes the ledger entries and a `term_collections` row in one DB transaction; the
 * sweep does the on-chain half. `payPlan` has no idempotency key, so a send is never retried
 * blind: a row is marked `sending` before the transaction and given its hash straight after, and a
 * `sending` row with no hash goes to review rather than being sent again. Whatever the chain did
 * not take (the member paid the plan off in between) goes back to their cash.
 */

const COLLECTIONS = 'term_collections';
const ENTRIES = 'lithic_ledger_entries';
const UNITS_PER_CENT = 10_000n;
const MAX_ATTEMPTS = 3;

const TERM_ABI = [
  'function plansOf(address member) view returns (uint256[])',
  'function planAt(uint256 planId) view returns (address member, uint256 principal, uint256 principalOutstanding, uint256 repaid, uint64 openedAt, uint32 installments, uint64 installmentLength, uint256 ratePerCycle, bool closed)',
  'function arrearsOf(uint256 planId) view returns (uint256)',
  'function owedOn(uint256 planId) view returns (uint256)',
  'function totalPrincipalOf(address member) view returns (uint256)',
  'function payPlan(uint256 planId, uint256 amount)',
  'event PlanPaid(uint256 indexed planId, uint256 amount, uint256 principalPortion)',
];
const REVOLVING_ABI = [
  'function totalPrincipalOf(address member) view returns (uint256)',
  'function stableCredit() view returns (address)',
];
const LEDGER_ABI = [
  'function creditBalanceOf(address member) view returns (uint256)',
  'function reserveToken() view returns (address)',
  'function repayCreditBalance(address member, uint128 amount)',
  'event CreditBalanceRepaid(address member, uint128 amount)',
];
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

function chainId(): number {
  const parsed = Number((process.env.SAVINGS_DEFAULT_CHAIN_ID || process.env.SEND_DEFAULT_CHAIN_ID || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 84532;
}

function settlerKey(): string {
  return (process.env.CARD_SETTLER_PRIVATE_KEY || '').trim();
}

/** One thing a deposit can pay: a plan's arrears, or (planId null) carry owed on nothing. */
export interface TermDue {
  planId: number | null;
  cents: number;
}

const upCents = (units: bigint): number => Number((units + UNITS_PER_CENT - 1n) / UNITS_PER_CENT);

/**
 * What is due on a member's term plans right now, in the order a deposit pays it. Read from chain.
 * Empty when there is no TermIssuer or the read fails: a deposit must never fail on this.
 */
export async function readTermDue(walletInput: string): Promise<TermDue[]> {
  const wallet = walletInput.trim().toLowerCase();
  const termAddress = getContractAddress(chainId(), 'TermIssuer');
  const revolvingAddress = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!termAddress || !revolvingAddress) return [];
  try {
    const provider = chainProvider(chainId());
    const term = new ethers.Contract(termAddress, TERM_ABI, provider);
    const revolving = new ethers.Contract(revolvingAddress, REVOLVING_ABI, provider);
    const ledger = new ethers.Contract(String(await revolving.stableCredit()), LEDGER_ABI, provider);

    const due: TermDue[] = [];
    const ids: bigint[] = await term.plansOf(wallet);
    for (const id of ids) {
      const plan = await term.planAt(id);
      if (plan[8]) continue;
      const arrears: bigint = await term.arrearsOf(id);
      if (arrears > 0n) due.push({ planId: Number(id), cents: upCents(arrears) });
    }

    const [owed, termPrincipal, revolvingPrincipal]: bigint[] = await Promise.all([
      ledger.creditBalanceOf(wallet),
      term.totalPrincipalOf(wallet),
      revolving.totalPrincipalOf(wallet),
    ]);
    const orphan = owed - termPrincipal - revolvingPrincipal;
    if (orphan > 0n) due.push({ planId: null, cents: upCents(orphan) });
    return due;
  } catch (error) {
    console.error('[term-collection] due read failed', wallet, error);
    return [];
  }
}

export async function ensureTermCollectionTable(client: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${COLLECTIONS} (
      id BIGSERIAL PRIMARY KEY,
      wallet TEXT NOT NULL,
      plan_id BIGINT,
      amount_cents BIGINT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tx TEXT,
      paid_cents BIGINT,
      error TEXT,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS term_collections_open_idx ON ${COLLECTIONS} (status) WHERE status IN ('pending', 'failed', 'sending')`);
}

/** Split a deposit over what is due, in order. Pure, so it can be tested without a chain. */
export function allocateTermDue(amountCents: number, due: TermDue[]): { paid: TermDue[]; remainingCents: number } {
  let remaining = Math.max(0, Math.round(amountCents));
  const paid: TermDue[] = [];
  for (const d of due) {
    if (remaining <= 0) break;
    const cents = Math.min(remaining, d.cents);
    if (cents > 0) paid.push({ planId: d.planId, cents });
    remaining -= cents;
  }
  return { paid, remainingCents: remaining };
}

const accountFor = (planId: number | null) => (planId === null ? 'member_term_carry' : 'member_term_plan');

/**
 * Book a deposit's term payments, inside the deposit's own DB transaction, and queue each for the
 * chain. The ledger legs mirror a card settlement: the obligation credited, the cash debited.
 */
export async function bookTermPayments(
  client: PoolClient,
  input: { wallet: string; group: string; externalId: string; paid: TermDue[] },
): Promise<number> {
  if (input.paid.length === 0) return 0;
  await ensureTermCollectionTable(client);
  let total = 0;
  for (const p of input.paid) {
    const key = p.planId === null ? 'carry' : `plan:${p.planId}`;
    await client.query(
      `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
       VALUES ($1, $2, $3, 'credit', $4, 'fiat', 'term_settlement', $5, $6::jsonb),
              ($1, $2, 'member_cash_fiat', 'debit', $4, 'fiat', 'term_settlement', $5, $6::jsonb)`,
      [input.group, input.wallet, accountFor(p.planId), p.cents, `${input.externalId}:${key}`, JSON.stringify({ planId: p.planId })],
    );
    await client.query(
      `INSERT INTO ${COLLECTIONS} (wallet, plan_id, amount_cents, source) VALUES ($1, $2, $3, 'fiat')`,
      [input.wallet, p.planId, p.cents],
    );
    total += p.cents;
  }
  return total;
}

export interface CollectionResult {
  id: number;
  wallet: string;
  action: 'paid' | 'returned' | 'waiting' | 'failed' | 'needs_review';
  cents?: number;
  txHash?: string;
  error?: string;
}

type Row = { id: string; wallet: string; plan_id: string | null; amount_cents: string; status: string; tx: string | null; attempts: number };

/** The sweep's pass: put every booked term payment on chain. */
export async function sweepTermCollections(): Promise<CollectionResult[]> {
  const pool = getPayPool();
  const termAddress = getContractAddress(chainId(), 'TermIssuer');
  const revolvingAddress = getContractAddress(chainId(), 'RevolvingIssuer');
  if (!pool || !settlerKey() || !termAddress || !revolvingAddress) return [];
  await ensureTermCollectionTable(pool);

  const { rows } = await pool.query<Row>(
    `SELECT id, wallet, plan_id, amount_cents, status, tx, attempts FROM ${COLLECTIONS}
      WHERE status IN ('pending', 'failed', 'sending') ORDER BY id LIMIT 25`,
  );
  if (rows.length === 0) return [];

  const provider = chainProvider(chainId());
  const signer = new ethers.Wallet(settlerKey(), provider);
  const term = new ethers.Contract(termAddress, TERM_ABI, writesAs(signer));
  const revolving = new ethers.Contract(revolvingAddress, REVOLVING_ABI, provider);
  const ledger = new ethers.Contract(String(await revolving.stableCredit()), LEDGER_ABI, writesAs(signer));

  const results: CollectionResult[] = [];
  for (const row of rows) {
    results.push(await collect(row, { pool, provider, signer, term, revolving, ledger }).catch((error) => fail(row, error, false)));
  }
  return results;
}

interface Ctx {
  pool: NonNullable<ReturnType<typeof getPayPool>>;
  provider: ethers.Provider;
  signer: ethers.Wallet;
  term: ethers.Contract;
  revolving: ethers.Contract;
  ledger: ethers.Contract;
}

async function collect(row: Row, ctx: Ctx): Promise<CollectionResult> {
  const id = Number(row.id);
  const planId = row.plan_id === null ? null : Number(row.plan_id);
  const askedUnits = BigInt(row.amount_cents) * UNITS_PER_CENT;

  // Interrupted mid-send. With a hash, the chain says what happened; without one, a person does --
  // sending again could pay twice, and payPlan has no key to stop it.
  if (row.status === 'sending') {
    if (!row.tx) {
      await ctx.pool.query(`UPDATE ${COLLECTIONS} SET status = 'needs_review', error = 'interrupted before the send was recorded', updated_at = now() WHERE id = $1`, [id]);
      return { id, wallet: row.wallet, action: 'needs_review' };
    }
    const receipt = await ctx.provider.getTransactionReceipt(row.tx);
    if (!receipt) return { id, wallet: row.wallet, action: 'waiting' };
    if (receipt.status !== 1) return fail(row, new Error('transaction reverted'), true);
    return finish(row, receipt, ctx);
  }

  let payUnits: bigint;
  if (planId !== null) {
    const plan = await ctx.term.planAt(planId);
    const owed: bigint = plan[8] ? 0n : await ctx.term.owedOn(planId);
    payUnits = askedUnits < owed ? askedUnits : owed;
  } else {
    // Carry on no plan and no tier. The only way to pay it is an undirected repayment, which every
    // issuer is told about -- so it waits until there is nothing else it could be absorbed by.
    const [termPrincipal, revolvingPrincipal]: bigint[] = await Promise.all([
      ctx.term.totalPrincipalOf(row.wallet),
      ctx.revolving.totalPrincipalOf(row.wallet),
    ]);
    if (termPrincipal > 0n || revolvingPrincipal > 0n) return { id, wallet: row.wallet, action: 'waiting' };
    const owed: bigint = await ctx.ledger.creditBalanceOf(row.wallet);
    payUnits = askedUnits < owed ? askedUnits : owed;
  }

  if (payUnits === 0n) {
    await giveBack(ctx.pool, row, Number(row.amount_cents), 'nothing left to pay');
    await ctx.pool.query(`UPDATE ${COLLECTIONS} SET status = 'returned', paid_cents = 0, updated_at = now() WHERE id = $1`, [id]);
    return { id, wallet: row.wallet, action: 'returned', cents: Number(row.amount_cents) };
  }

  await ensureAllowance(ctx.signer, ctx.ledger, payUnits);
  await ctx.pool.query(`UPDATE ${COLLECTIONS} SET status = 'sending', tx = NULL, updated_at = now() WHERE id = $1`, [id]);
  const tx =
    planId !== null ? await ctx.term.payPlan(planId, payUnits) : await ctx.ledger.repayCreditBalance(row.wallet, payUnits);
  await ctx.pool.query(`UPDATE ${COLLECTIONS} SET tx = $2, updated_at = now() WHERE id = $1`, [id, tx.hash]);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) return fail({ ...row, status: 'sending', tx: tx.hash }, new Error('transaction reverted'), true);
  return finish({ ...row, tx: tx.hash }, receipt, ctx);
}

/** Written from the receipt: what the chain actually took, and anything it did not goes back. */
async function finish(row: Row, receipt: ethers.TransactionReceipt, ctx: Ctx): Promise<CollectionResult> {
  const id = Number(row.id);
  const planId = row.plan_id === null ? null : Number(row.plan_id);
  let paidUnits = 0n;
  const termIface = new ethers.Interface(TERM_ABI);
  const ledgerIface = new ethers.Interface(LEDGER_ABI);
  const termAddress = String(ctx.term.target).toLowerCase();
  const ledgerAddress = String(ctx.ledger.target).toLowerCase();
  for (const log of receipt.logs) {
    try {
      if (planId !== null && log.address.toLowerCase() === termAddress) {
        const parsed = termIface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'PlanPaid' && Number(parsed.args.planId) === planId) paidUnits += BigInt(parsed.args.amount);
      } else if (planId === null && log.address.toLowerCase() === ledgerAddress) {
        const parsed = ledgerIface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'CreditBalanceRepaid' && String(parsed.args.member).toLowerCase() === row.wallet) paidUnits += BigInt(parsed.args.amount);
      }
    } catch {
      /* not ours */
    }
  }
  const paidCents = upCents(paidUnits);
  const short = Number(row.amount_cents) - paidCents;
  if (short > 0) await giveBack(ctx.pool, row, short, 'the chain took less than was booked');
  if (planId !== null) {
    await recordPlanPayments({
      wallet: row.wallet,
      txHash: receipt.hash,
      receipt,
      termIssuer: String(ctx.term.target),
      provider: ctx.provider,
      method: 'bank',
    });
  }
  await ctx.pool.query(
    `UPDATE ${COLLECTIONS} SET status = 'done', tx = $2, paid_cents = $3, error = NULL, updated_at = now() WHERE id = $1`,
    [id, receipt.hash, paidCents],
  );
  console.log(`[term-collection] ${row.wallet} ${planId === null ? 'carry' : `plan ${planId}`} paid ${paidCents}c on chain (${receipt.hash})`);
  return { id, wallet: row.wallet, action: 'paid', cents: paidCents, txHash: receipt.hash };
}

/** Undo the booking for cents the chain did not take: back to the member's cash. */
async function giveBack(pool: Ctx['pool'], row: Row, cents: number, reason: string): Promise<void> {
  const planId = row.plan_id === null ? null : Number(row.plan_id);
  // Once per row, even if finishing is interrupted and runs again.
  const done = await pool.query(`SELECT 1 FROM ${ENTRIES} WHERE external_id = $1 LIMIT 1`, [`term-return:${row.id}`]);
  if (done.rowCount) return;
  await pool.query(
    `INSERT INTO ${ENTRIES} (entry_group, wallet, account, direction, amount_cents, rail, event_type, external_id, metadata)
     VALUES ($1, $2, $3, 'debit', $4, 'fiat', 'term_settlement_return', $5, $6::jsonb),
            ($1, $2, 'member_cash_fiat', 'credit', $4, 'fiat', 'term_settlement_return', $5, $6::jsonb)`,
    [`term-return:${row.id}`, row.wallet, accountFor(planId), cents, `term-return:${row.id}`, JSON.stringify({ planId, reason })],
  );
}

/**
 * A send that reverted is safe to retry: nothing moved. One that errored AFTER it was broadcast
 * (a receipt wait that timed out) is not -- it may still land -- so a row that has a hash stays
 * `sending` and the next pass asks the chain. Past the limit, a person looks.
 */
async function fail(row: Row, error: unknown, reverted: boolean): Promise<CollectionResult> {
  const id = Number(row.id);
  const reason = error instanceof Error ? error.message.slice(0, 300) : String(error);
  const attempts = row.attempts + 1;
  const pool = getPayPool();
  if (!reverted && pool) {
    const current = await pool.query<{ tx: string | null }>(`SELECT tx FROM ${COLLECTIONS} WHERE id = $1`, [id]);
    if (current.rows[0]?.tx) {
      await pool.query(`UPDATE ${COLLECTIONS} SET status = 'sending', error = $2, updated_at = now() WHERE id = $1`, [id, reason]);
      return { id, wallet: row.wallet, action: 'waiting', error: reason };
    }
  }
  const status = attempts >= MAX_ATTEMPTS ? 'needs_review' : 'failed';
  await pool?.query(
    `UPDATE ${COLLECTIONS} SET status = $2, error = $3, attempts = $4, updated_at = now() WHERE id = $1`,
    [id, status, reason, attempts],
  );
  console.error(`[term-collection] ${row.wallet} row ${id} ${status}: ${reason}`);
  return { id, wallet: row.wallet, action: status, error: reason };
}

/** The settler pays from its float, pulled by StableCredit, so StableCredit needs the allowance. */
async function ensureAllowance(signer: ethers.Wallet, ledger: ethers.Contract, units: bigint): Promise<void> {
  const usdc = new ethers.Contract(String(await ledger.reserveToken()), ERC20_ABI, writesAs(signer));
  const current: bigint = await usdc.allowance(signer.address, ledger.target);
  if (current >= units) return;
  const tx = await usdc.approve(ledger.target, ethers.MaxUint256);
  await tx.wait(1);
}
