import { createHash, randomUUID } from 'node:crypto';
import type { Queryable } from '../../../db/db.js';
import { type AccountCode, ACCOUNTS, accountDef, type FixedAccount } from './accounts.js';

/**
 * The ledger service: the only writer to the `ledger` schema (card-processing prompt, principle 2).
 *
 * Every function takes a `Queryable` so it joins the caller's transaction. That's the point: a cash
 * tender, its ledger entry and its stock movements commit together or not at all (principle 5).
 * `post` and `reverse` must run inside a transaction, because the database checks each entry's
 * balance at COMMIT.
 *
 * The checks here and the ones in the database are the same checks, twice: here so a bad entry
 * fails with a readable error before it's written, there so nothing that bypasses this file can
 * leave the books unbalanced.
 */

export type Ref = { type: 'order' | 'tender' | 'refund' | 'drawer_session' | 'bank_deposit' | 'payout' | 'entry' | 'fee_bill'; id: string };

export interface LineInput {
  account: AccountCode;
  debit?: number;
  credit?: number;
}

export interface EntryInput {
  merchant: string;
  kind: string;
  /** The same fact posted twice is one entry: a retry with this key returns the first. */
  idempotencyKey: string;
  lines: LineInput[];
  occurredAt?: Date | string;
  ref?: Ref | null;
  memo?: string | null;
  createdBy?: string | null;
}

export interface PostedLine {
  account: AccountCode;
  debitCents: number;
  creditCents: number;
}

export interface Entry {
  id: string;
  merchant: string;
  kind: string;
  occurredAt: string;
  ref: Ref | null;
  memo: string | null;
  createdBy: string | null;
  idempotencyKey: string;
  reverses: string | null;
  lines: PostedLine[];
}

export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'conflict' | 'not_found' | 'already_reversed',
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function normaliseLines(lines: LineInput[]): PostedLine[] {
  if (lines.length < 2) throw new LedgerError('An entry needs at least two lines', 'invalid');
  let dr = 0;
  let cr = 0;
  const out = lines.map((l) => {
    accountDef(l.account);
    const debit = l.debit ?? 0;
    const credit = l.credit ?? 0;
    if (!isCents(debit) || !isCents(credit)) throw new LedgerError(`${l.account}: amounts are whole, non-negative cents`, 'invalid');
    if ((debit > 0) === (credit > 0)) throw new LedgerError(`${l.account}: a line is a debit or a credit, and not zero`, 'invalid');
    dr += debit;
    cr += credit;
    return { account: l.account, debitCents: debit, creditCents: credit };
  });
  if (dr !== cr) throw new LedgerError(`Unbalanced: debits ${dr} ≠ credits ${cr}`, 'invalid');
  return out;
}

/** What makes two posts "the same": kind, reference and lines. Not the time or the memo, which a retry may recompute. */
const contentHash = (kind: string, ref: Ref | null | undefined, lines: PostedLine[]) =>
  createHash('sha256')
    .update(JSON.stringify([kind, ref ? [ref.type, ref.id] : null, lines.map((l) => [l.account, l.debitCents, l.creditCents])]))
    .digest('hex');

/** Opens the fixed accounts for a shop, and any tips accounts named. Safe to call again. */
export async function ensureAccounts(tx: Queryable, merchant: string, codes: readonly AccountCode[] = Object.keys(ACCOUNTS) as FixedAccount[]): Promise<Map<AccountCode, string>> {
  const unique = [...new Set(codes)];
  for (const code of unique) {
    const def = accountDef(code);
    await tx.query(
      `INSERT INTO ledger.accounts (id, merchant, code, type, normal, staff_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (merchant, code) DO NOTHING`,
      [`acct_${randomUUID()}`, merchant, def.code, def.type, def.normal, def.staffId],
    );
  }
  const { rows } = await tx.query<{ id: string; code: AccountCode }>(
    'SELECT id, code FROM ledger.accounts WHERE merchant = $1 AND code = ANY($2::text[])',
    [merchant, unique],
  );
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function insertEntry(
  tx: Queryable,
  input: EntryInput & { reverses?: string | null },
  lines: PostedLine[],
): Promise<{ entry: Entry; created: boolean }> {
  if (!input.merchant) throw new LedgerError('An entry belongs to a shop', 'invalid');
  if (!/^[a-z_]+$/.test(input.kind)) throw new LedgerError(`Bad entry kind: ${input.kind}`, 'invalid');
  if (!input.idempotencyKey) throw new LedgerError('An entry needs an idempotency key', 'invalid');

  const hash = contentHash(input.kind, input.ref, lines);
  const id = `je_${randomUUID()}`;
  const occurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : new Date().toISOString();
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO ledger.journal_entries
       (id, merchant, occurred_at, kind, ref_type, ref_id, memo, created_by, idempotency_key, content_hash, reverses)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (merchant, idempotency_key) DO NOTHING
     RETURNING id`,
    [id, input.merchant, occurredAt, input.kind, input.ref?.type ?? null, input.ref?.id ?? null, input.memo ?? null, input.createdBy ?? null, input.idempotencyKey, hash, input.reverses ?? null],
  );

  if (!inserted.rows[0]) {
    const { rows } = await tx.query<{ id: string; content_hash: string }>(
      'SELECT id, content_hash FROM ledger.journal_entries WHERE merchant = $1 AND idempotency_key = $2',
      [input.merchant, input.idempotencyKey],
    );
    const existing = rows[0];
    if (!existing) throw new LedgerError(`Entry ${input.idempotencyKey} vanished mid-post`, 'conflict');
    if (existing.content_hash !== hash) {
      throw new LedgerError(`Idempotency key ${input.idempotencyKey} was already used for a different entry`, 'conflict');
    }
    return { entry: (await getEntry(tx, input.merchant, existing.id))!, created: false };
  }

  const accounts = await ensureAccounts(tx, input.merchant, lines.map((l) => l.account));
  for (const l of lines) {
    await tx.query('INSERT INTO ledger.journal_lines (entry_id, account_id, debit_cents, credit_cents) VALUES ($1, $2, $3, $4)', [
      id,
      accounts.get(l.account),
      l.debitCents,
      l.creditCents,
    ]);
  }
  return { entry: (await getEntry(tx, input.merchant, id))!, created: true };
}

/**
 * Posts one balanced entry. Idempotent on (shop, idempotencyKey): a retry returns the entry the
 * first call wrote, with `created: false`. The same key with different lines is refused.
 */
export async function post(tx: Queryable, input: EntryInput): Promise<{ entry: Entry; created: boolean }> {
  if (input.kind === 'reversal') throw new LedgerError('Use reverse() to reverse an entry', 'invalid');
  return insertEntry(tx, input, normaliseLines(input.lines));
}

/**
 * Undoes an entry with its mirror image: every debit becomes a credit on the same account. The
 * original stays. An entry is reversed at most once, and a second call returns the same reversal.
 */
export async function reverse(
  tx: Queryable,
  input: { merchant: string; entryId: string; occurredAt?: Date | string; createdBy?: string | null; memo?: string | null },
): Promise<{ entry: Entry; created: boolean }> {
  const original = await getEntry(tx, input.merchant, input.entryId);
  if (!original) throw new LedgerError(`No entry ${input.entryId} for this shop`, 'not_found');
  if (original.reverses) throw new LedgerError('A reversal is not reversed: post the entry again instead', 'invalid');

  const idempotencyKey = `reverse:${original.id}`;
  const { rows } = await tx.query<{ id: string; idempotency_key: string }>(
    'SELECT id, idempotency_key FROM ledger.journal_entries WHERE reverses = $1',
    [original.id],
  );
  if (rows[0] && rows[0].idempotency_key !== idempotencyKey) throw new LedgerError(`${original.id} is already reversed`, 'already_reversed');

  const lines = original.lines.map((l) => ({ account: l.account, debitCents: l.creditCents, creditCents: l.debitCents }));
  return insertEntry(
    tx,
    {
      merchant: input.merchant,
      kind: 'reversal',
      idempotencyKey,
      lines: [],
      occurredAt: input.occurredAt,
      ref: { type: 'entry', id: original.id },
      memo: input.memo ?? null,
      createdBy: input.createdBy ?? null,
      reverses: original.id,
    },
    lines,
  );
}

export async function getEntry(q: Queryable, merchant: string, id: string): Promise<Entry | null> {
  const { rows } = await q.query<{
    id: string;
    merchant: string;
    kind: string;
    occurred_at: Date | string;
    ref_type: Ref['type'] | null;
    ref_id: string | null;
    memo: string | null;
    created_by: string | null;
    idempotency_key: string;
    reverses: string | null;
  }>('SELECT * FROM ledger.journal_entries WHERE merchant = $1 AND id = $2', [merchant, id]);
  const e = rows[0];
  if (!e) return null;
  const lines = await q.query<{ code: AccountCode; debit_cents: string | number; credit_cents: string | number }>(
    `SELECT a.code, l.debit_cents, l.credit_cents
       FROM ledger.journal_lines l JOIN ledger.accounts a ON a.id = l.account_id
      WHERE l.entry_id = $1 ORDER BY l.id`,
    [id],
  );
  return {
    id: e.id,
    merchant: e.merchant,
    kind: e.kind,
    occurredAt: new Date(e.occurred_at).toISOString(),
    ref: e.ref_type && e.ref_id ? { type: e.ref_type, id: e.ref_id } : null,
    memo: e.memo,
    createdBy: e.created_by,
    idempotencyKey: e.idempotency_key,
    reverses: e.reverses,
    lines: lines.rows.map((l) => ({ account: l.code, debitCents: Number(l.debit_cents), creditCents: Number(l.credit_cents) })),
  };
}

/** Entries about one thing (an order, a tender …), oldest first. */
export async function entriesFor(q: Queryable, merchant: string, ref: Ref): Promise<Entry[]> {
  const { rows } = await q.query<{ id: string }>(
    'SELECT id FROM ledger.journal_entries WHERE merchant = $1 AND ref_type = $2 AND ref_id = $3 ORDER BY occurred_at, created_at',
    [merchant, ref.type, ref.id],
  );
  const out: Entry[] = [];
  for (const r of rows) out.push((await getEntry(q, merchant, r.id))!);
  return out;
}

/**
 * An account's balance on its normal side, as of a moment (inclusive): what the drawer should hold,
 * what the shop owes in tax. Negative means the other side, e.g. a drawer that's gone negative. An
 * account that was never opened is 0.
 */
export async function balance(q: Queryable, merchant: string, account: AccountCode, asOf: Date | string = new Date()): Promise<number> {
  const def = accountDef(account);
  const { rows } = await q.query<{ net: string | number | null }>(
    `SELECT sum(l.debit_cents - l.credit_cents) AS net
       FROM ledger.journal_lines l
       JOIN ledger.accounts a ON a.id = l.account_id
       JOIN ledger.journal_entries e ON e.id = l.entry_id
      WHERE a.merchant = $1 AND a.code = $2 AND e.occurred_at <= $3`,
    [merchant, account, new Date(asOf).toISOString()],
  );
  const net = Number(rows[0]?.net ?? 0);
  // 0 - net, not -net: a settled credit account is 0, not -0.
  return def.normal === 'debit' ? net : 0 - net;
}

/** Every account's balance on its normal side. Debit-normal balances minus credit-normal ones is always 0. */
export async function balances(q: Queryable, merchant: string, asOf: Date | string = new Date()): Promise<Map<AccountCode, number>> {
  const { rows } = await q.query<{ code: AccountCode; normal: 'debit' | 'credit'; net: string | number | null }>(
    `SELECT a.code, a.normal, sum(l.debit_cents - l.credit_cents) AS net
       FROM ledger.accounts a
       LEFT JOIN (ledger.journal_lines l
                  JOIN ledger.journal_entries e ON e.id = l.entry_id AND e.occurred_at <= $2)
         ON l.account_id = a.id
      WHERE a.merchant = $1
      GROUP BY a.code, a.normal`,
    [merchant, new Date(asOf).toISOString()],
  );
  return new Map(rows.map((r) => [r.code, r.normal === 'debit' ? Number(r.net ?? 0) : 0 - Number(r.net ?? 0)]));
}
