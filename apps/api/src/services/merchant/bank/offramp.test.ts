import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { feeCents, type OfframpDeps, withdrawToBank } from './offramp.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

/** Bridge and the shop's wallet as the tests play them. */
function fake(opts: { walletError?: string; bridgeError?: string; sendFails?: boolean } = {}) {
  const transfers: Array<Record<string, unknown>> = [];
  const sent: Array<{ to: string; micros: bigint }> = [];
  const deps: OfframpDeps = {
    async createTransfer(input) {
      transfers.push(input);
      if (opts.bridgeError) return { error: opts.bridgeError };
      return { id: `tr_${transfers.length}`, state: 'awaiting_funds', toAddress: '0xB41d6e000000000000000000000000000000beef', amountMicros: BigInt(input.amountCents) * 10_000n };
    },
    async wallet() {
      if (opts.walletError) return { error: opts.walletError };
      return {
        address: '0x5b0b000000000000000000000000000000005b0b',
        sendUsdc: async (to, micros) => {
          if (opts.sendFails) throw new Error('execution reverted');
          sent.push({ to, micros });
          return '0xhash';
        },
      };
    },
  };
  return { deps, transfers, sent };
}

async function shopWithBank() {
  const s = await seedShop(db);
  await db.query(`UPDATE merchant.profiles SET bridge_customer_id = 'cus_biz' WHERE merchant = $1`, [s.merchant]);
  const bankId = `bank_${s.merchant.slice(-6)}`;
  await db.query(`INSERT INTO merchant.bank_accounts (id, merchant, external_account_id, bank_name, mask, subtype, added_by) VALUES ($1, $2, 'ea_1', 'Chase', '4417', 'checking', $3)`, [bankId, s.merchant, s.staff.owner]);
  return { ...s, bankId };
}

describe('withdrawing to a bank', () => {
  test('the fee: none standard, 1% same-day rounded up', () => {
    expect(feeCents(10000, 'standard')).toBe(0);
    expect(feeCents(10000, 'same_day')).toBe(100);
    expect(feeCents(12345, 'same_day')).toBe(124);
  });

  test('Bridge’s transfer to the linked bank, then the cash account funds it; audited', async () => {
    const s = await shopWithBank();
    const f = fake();
    const r = await withdrawToBank(db, f.deps, { merchant: s.merchant, staffId: s.staff.manager, bankAccountId: s.bankId, amountCents: 240000, speed: 'same_day' });
    expect(r).toMatchObject({ state: 'sent', feeCents: 2400, note: null });
    expect(f.transfers[0]).toEqual({ idempotencyKey: r.id, customerId: 'cus_biz', externalAccountId: 'ea_1', fromAddress: '0x5b0b000000000000000000000000000000005b0b', amountCents: 240000, speed: 'same_day' });
    expect(f.sent).toEqual([{ to: '0xB41d6e000000000000000000000000000000beef', micros: 2_400_000_000n }]);
    const { rows } = await db.query<{ state: string; bridge_transfer_id: string; tx_hash: string }>('SELECT state, bridge_transfer_id, tx_hash FROM merchant.bank_withdrawals WHERE id = $1', [r.id]);
    expect(rows[0]).toEqual({ state: 'sent', bridge_transfer_id: 'tr_1', tx_hash: '0xhash' });
    const { rows: log } = await db.query<{ detail: Record<string, unknown> }>(`SELECT detail FROM payments.audit_log WHERE merchant = $1 AND action = 'bank.withdrawal_sent'`, [s.merchant]);
    expect(log[0]!.detail).toMatchObject({ speed: 'same_day', feeCents: 2400, mask: '4417', transfer: 'tr_1' });
  });

  test('nothing sent when: Clear can’t sign yet (recorded), Bridge says no, the wallet can’t fund it, no such bank', async () => {
    const s = await shopWithBank();
    const noSigner = fake({ walletError: 'Clear’s signing key is not configured on this server.' });
    expect(await withdrawToBank(db, noSigner.deps, { merchant: s.merchant, staffId: s.staff.owner, bankAccountId: s.bankId, amountCents: 5000, speed: 'standard' })).toMatchObject({ state: 'requested' });
    expect(noSigner.transfers).toHaveLength(0);

    const refused = fake({ bridgeError: 'customer is not active' });
    const r = await withdrawToBank(db, refused.deps, { merchant: s.merchant, staffId: s.staff.owner, bankAccountId: s.bankId, amountCents: 5000, speed: 'standard' });
    expect(r.state).toBe('refused');
    expect(r.note).toContain('Nothing left the cash account');
    expect(refused.sent).toHaveLength(0);

    const unfunded = fake({ sendFails: true });
    expect((await withdrawToBank(db, unfunded.deps, { merchant: s.merchant, staffId: s.staff.owner, bankAccountId: s.bankId, amountCents: 5000, speed: 'standard' })).state).toBe('unfunded');

    expect((await withdrawToBank(db, fake().deps, { merchant: s.merchant, staffId: s.staff.owner, bankAccountId: 'bank_nope', amountCents: 5000, speed: 'standard' })).state).toBe('refused');
  });
});
