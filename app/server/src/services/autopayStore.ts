import crypto from 'crypto';
import { getPayPool } from '../config/postgres.js';
import { encryptSendContact, decryptSendContact } from '../utils/sendEncryption.js';

/*
 * Autopay rules — "sign once, then recurring gasless deposits" via a ZeroDev session key. The user
 * approves a session scoped to USDC.approve + ESA vault.deposit (lib/autopay on the client); the
 * serialized permission account (which embeds the session key) is stored ENCRYPTED here. The autopay
 * runner (jobs/autopayRunner) executes due rules server-side with that session, no further signing.
 *
 * Stored in the Pay DB (getPayPool). Kind is 'savings_deposit' for now (rent→ownership); the session
 * scope is what makes this safe — the key can ONLY approve + deposit, capped by rate + expiry on-chain.
 */

export type AutopayCadence = 'weekly' | 'monthly';
export type AutopayStatus = 'active' | 'paused' | 'cancelled' | 'exhausted' | 'expired';

export interface AutopayRule {
  id: string;
  wallet: string;
  chainId: number;
  kind: 'savings_deposit';
  amountUsdc: number;
  cadence: AutopayCadence;
  nextRunAt: string;
  runsLeft: number | null;
  status: AutopayStatus;
  lastRunAt: string | null;
  lastTx: string | null;
  lastError: string | null;
  createdAt: string;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  const pool = getPayPool();
  if (!pool || ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS autopay_rules (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'savings_deposit',
      amount_usdc NUMERIC NOT NULL,
      cadence TEXT NOT NULL,
      approval_enc TEXT NOT NULL,
      next_run_at TIMESTAMPTZ NOT NULL,
      runs_left INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      last_run_at TIMESTAMPTZ,
      last_tx TEXT,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS autopay_rules_wallet_idx ON autopay_rules (wallet);
    CREATE INDEX IF NOT EXISTS autopay_rules_due_idx ON autopay_rules (status, next_run_at);
  `);
  ensured = true;
}

function addCadence(from: Date, cadence: AutopayCadence): Date {
  const d = new Date(from);
  if (cadence === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function rowToRule(row: Record<string, unknown>): AutopayRule {
  return {
    id: String(row.id),
    wallet: String(row.wallet),
    chainId: Number(row.chain_id),
    kind: 'savings_deposit',
    amountUsdc: Number(row.amount_usdc),
    cadence: String(row.cadence) as AutopayCadence,
    nextRunAt: new Date(row.next_run_at as string).toISOString(),
    runsLeft: row.runs_left == null ? null : Number(row.runs_left),
    status: String(row.status) as AutopayStatus,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at as string).toISOString() : null,
    lastTx: row.last_tx ? String(row.last_tx) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

class AutopayStore {
  isConfigured(): boolean {
    return Boolean(getPayPool());
  }

  /** Create a rule. `approval` is the serialized ZeroDev permission account (encrypted at rest). */
  async create(input: {
    wallet: string;
    chainId: number;
    amountUsdc: number;
    cadence: AutopayCadence;
    approval: string;
    startAt?: Date;
    runsLeft?: number | null;
  }): Promise<AutopayRule> {
    await ensureTable();
    const pool = getPayPool();
    if (!pool) throw new Error('Autopay store not configured');
    const wallet = input.wallet.toLowerCase();
    const id = `ap_${crypto.randomBytes(12).toString('hex')}`;
    const approvalEnc = encryptSendContact(input.approval, `autopay:${wallet}:${id}`);
    const nextRun = input.startAt ?? addCadence(new Date(), input.cadence);
    const r = await pool.query(
      `INSERT INTO autopay_rules (id, wallet, chain_id, kind, amount_usdc, cadence, approval_enc, next_run_at, runs_left)
       VALUES ($1,$2,$3,'savings_deposit',$4,$5,$6,$7,$8) RETURNING *`,
      [id, wallet, input.chainId, input.amountUsdc, input.cadence, approvalEnc, nextRun.toISOString(), input.runsLeft ?? null],
    );
    return rowToRule(r.rows[0]);
  }

  async listForWallet(wallet: string): Promise<AutopayRule[]> {
    await ensureTable();
    const pool = getPayPool();
    if (!pool) return [];
    const r = await pool.query(
      `SELECT * FROM autopay_rules WHERE wallet = $1 AND status <> 'cancelled' ORDER BY created_at DESC`,
      [wallet.toLowerCase()],
    );
    return r.rows.map(rowToRule);
  }

  async cancel(wallet: string, id: string): Promise<boolean> {
    await ensureTable();
    const pool = getPayPool();
    if (!pool) return false;
    const r = await pool.query(
      `UPDATE autopay_rules SET status = 'cancelled' WHERE id = $1 AND wallet = $2 AND status <> 'cancelled'`,
      [id, wallet.toLowerCase()],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Rules whose next_run_at is due. Returns the decrypted approval for execution. */
  async getDue(now: Date = new Date(), limit = 25): Promise<(AutopayRule & { approval: string })[]> {
    await ensureTable();
    const pool = getPayPool();
    if (!pool) return [];
    const r = await pool.query(
      `SELECT * FROM autopay_rules WHERE status = 'active' AND next_run_at <= $1 ORDER BY next_run_at ASC LIMIT $2`,
      [now.toISOString(), limit],
    );
    return r.rows.map((row) => {
      const rule = rowToRule(row);
      return { ...rule, approval: decryptSendContact(String(row.approval_enc), `autopay:${rule.wallet}:${rule.id}`) };
    });
  }

  /** Record a successful run: advance next_run_at, decrement runs_left, mark exhausted at 0. */
  async recordSuccess(rule: AutopayRule, txHash: string): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    const next = addCadence(new Date(rule.nextRunAt), rule.cadence);
    const runsLeft = rule.runsLeft == null ? null : rule.runsLeft - 1;
    const status: AutopayStatus = runsLeft != null && runsLeft <= 0 ? 'exhausted' : 'active';
    await pool.query(
      `UPDATE autopay_rules SET next_run_at = $1, runs_left = $2, status = $3,
        last_run_at = now(), last_tx = $4, last_error = NULL WHERE id = $5`,
      [next.toISOString(), runsLeft, status, txHash, rule.id],
    );
  }

  /** Record a failed run. Pushes next_run_at out by a short retry window so one failure doesn't spin. */
  async recordFailure(rule: AutopayRule, message: string, retryInMinutes = 60): Promise<void> {
    const pool = getPayPool();
    if (!pool) return;
    const retryAt = new Date(Date.now() + retryInMinutes * 60_000);
    await pool.query(
      `UPDATE autopay_rules SET next_run_at = $1, last_error = $2 WHERE id = $3`,
      [retryAt.toISOString(), message.slice(0, 500), rule.id],
    );
  }
}

export const autopayStore = new AutopayStore();
