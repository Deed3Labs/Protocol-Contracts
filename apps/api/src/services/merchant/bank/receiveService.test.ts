import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { type BridgeReceive, emailReceive, openReceive, ReceiveError, receiveDetails } from './receiveService.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const ACCOUNT = { beneficiary: '', bankName: 'Lead Bank', routingNumber: '101019644', accountNumber: '900123456789', rails: ['ach_push', 'wire'] };

/** Bridge as the tests play it: an account opens for a verified business, once per address. */
function fakeBridge(opts: { configured?: boolean; verified?: boolean; open?: boolean; refuse?: string } = {}): BridgeReceive & { opened: string[] } {
  const opened: string[] = [];
  const accounts = new Map<string, typeof ACCOUNT>();
  if (opts.open) accounts.set('any', ACCOUNT);
  return {
    opened,
    configured: () => opts.configured ?? true,
    verified: async () => opts.verified ?? true,
    find: async (_c, address) => accounts.get(address) ?? accounts.get('any') ?? null,
    open: async (customerId, address) => {
      if (opts.refuse) return { error: opts.refuse };
      opened.push(`${customerId}:${address}`);
      accounts.set(address, ACCOUNT);
      return ACCOUNT;
    },
  };
}

async function shop(opts: { customer?: boolean } = {}) {
  const s = await seedShop(db);
  await db.query(`UPDATE merchant.profiles SET name = 'Mike’s Tire LLC', bridge_customer_id = $2, kyb_email = 'mike@mikestire.com' WHERE merchant = $1`, [
    s.merchant,
    opts.customer === false ? null : 'cus_biz',
  ]);
  return s;
}

describe('the shop’s account for being paid', () => {
  test('where it stands: no Bridge, not verified, verified but not opened, open', async () => {
    const s = await shop();
    expect((await receiveDetails(db, fakeBridge({ configured: false }), s.merchant)).state).toBe('not_configured');
    expect((await receiveDetails(db, fakeBridge({ verified: false }), s.merchant)).state).toBe('not_verified');
    expect((await receiveDetails(db, fakeBridge(), s.merchant)).state).toBe('not_opened');
    const open = await receiveDetails(db, fakeBridge({ open: true }), s.merchant);
    // Bridge's beneficiary when it gives one, else the shop's name.
    expect(open).toEqual({ state: 'ready', account: { ...ACCOUNT, beneficiary: 'Mike’s Tire LLC' }, email: 'mike@mikestire.com' });

    const never = await shop({ customer: false });
    expect((await receiveDetails(db, fakeBridge(), never.merchant)).state).toBe('not_verified');
  });

  test('an owner opens it once, paying into the shop’s own wallet; asking again hands back the same one', async () => {
    const s = await shop();
    const bridge = fakeBridge();
    const first = await openReceive(db, bridge, { merchant: s.merchant, staffId: s.staff.owner });
    expect(first.state).toBe('ready');
    expect(first.account?.accountNumber).toBe('900123456789');
    expect(bridge.opened).toEqual([`cus_biz:${s.merchant}`]);
    await openReceive(db, bridge, { merchant: s.merchant, staffId: s.staff.owner });
    expect(bridge.opened).toHaveLength(1);

    // Recorded with only the last four, and no numbers are kept anywhere else.
    const { rows } = await db.query<{ detail: { last4: string } }>(`SELECT detail FROM payments.audit_log WHERE merchant = $1 AND action = 'receive.opened'`, [s.merchant]);
    expect(rows.map((r) => r.detail)).toEqual([{ last4: '6789' }]);
    const { rows: p } = await db.query<{ row: string }>('SELECT row_to_json(p)::text AS row FROM merchant.profiles p WHERE merchant = $1', [s.merchant]);
    expect(p[0]!.row).not.toContain('900123456789');
  });

  test('not before the business is verified, and Bridge’s refusal is passed on', async () => {
    const s = await shop();
    await expect(openReceive(db, fakeBridge({ verified: false }), { merchant: s.merchant, staffId: s.staff.owner })).rejects.toMatchObject({ code: 'not_verified', status: 409 });
    const never = await shop({ customer: false });
    await expect(openReceive(db, fakeBridge(), { merchant: never.merchant, staffId: never.staff.owner })).rejects.toMatchObject({ code: 'not_verified' });
    await expect(openReceive(db, fakeBridge({ configured: false }), { merchant: s.merchant, staffId: s.staff.owner })).rejects.toMatchObject({ code: 'not_configured', status: 503 });
    const refused = openReceive(db, fakeBridge({ refuse: 'Customer is not eligible' }), { merchant: s.merchant, staffId: s.staff.owner });
    await expect(refused).rejects.toBeInstanceOf(ReceiveError);
    await expect(refused).rejects.toMatchObject({ code: 'upstream', message: 'Customer is not eligible' });
  });

  test('emailed only to the address the business was verified under', async () => {
    const s = await shop();
    const sent: Array<{ to: string; subject: string; body: string }> = [];
    const send = async (m: (typeof sent)[number]) => void sent.push(m);
    expect(await emailReceive(db, fakeBridge({ open: true }), send, { merchant: s.merchant, staffId: s.staff.owner })).toEqual({ to: 'mike@mikestire.com' });
    expect(sent[0]!.to).toBe('mike@mikestire.com');
    expect(sent[0]!.body).toContain('Routing number: 101019644');
    expect(sent[0]!.body).toContain('Account number: 900123456789');
    expect(sent[0]!.body).toContain('Account name: Mike’s Tire LLC');

    await expect(emailReceive(db, fakeBridge(), send, { merchant: s.merchant, staffId: s.staff.owner })).rejects.toMatchObject({ status: 409 });
    await db.query('UPDATE merchant.profiles SET kyb_email = NULL WHERE merchant = $1', [s.merchant]);
    await expect(emailReceive(db, fakeBridge({ open: true }), send, { merchant: s.merchant, staffId: s.staff.owner })).rejects.toMatchObject({ code: 'no_email' });
    const failing = async () => {
      throw new Error('Resend said no');
    };
    await db.query(`UPDATE merchant.profiles SET kyb_email = 'mike@mikestire.com' WHERE merchant = $1`, [s.merchant]);
    await expect(emailReceive(db, fakeBridge({ open: true }), failing, { merchant: s.merchant, staffId: s.staff.owner })).rejects.toMatchObject({ code: 'upstream', status: 502 });
    expect(sent).toHaveLength(1);
  });
});
