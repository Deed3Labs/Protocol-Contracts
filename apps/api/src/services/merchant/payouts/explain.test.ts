import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { explainFlag, FlagError, reconciliationView, recordFlags } from './reconcile.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const stranded = (expectedCents = 18900) => ({ kind: 'card_stranded', ref: 'tnd_1', expectedCents, actualCents: null, detail: 'Card payment tnd_1 was authorised and then card processing was disconnected' });

describe('explaining a reconciliation flag', () => {
  test('it closes with what happened and who said so, and stays closed while its figures hold', async () => {
    const { merchant, staff } = await seedShop(db);
    await recordFlags(db, merchant, [stranded(), { kind: 'payout_unbooked', ref: 'po_1', expectedCents: 50000, actualCents: null, detail: 'Payout po_1 was paid but isn’t in the books' }]);
    let v = await reconciliationView(db, merchant);
    expect(v.open.map((f) => f.kind).sort()).toEqual(['card_stranded', 'payout_unbooked']);
    expect(v.explained).toEqual([]);

    const flag = v.open.find((f) => f.kind === 'card_stranded')!;
    const done = await explainFlag(db, { merchant, flagId: flag.id, staffId: staff.owner, body: { note: 'Marcus captured it in Stripe before the hold lapsed' } });
    expect(done.explained).toMatchObject({ by: 'Marcus', note: 'Marcus captured it in Stripe before the hold lapsed' });

    // The nightly run finds it again at the same figures: it stays explained.
    await recordFlags(db, merchant, [stranded(), { kind: 'payout_unbooked', ref: 'po_1', expectedCents: 50000, actualCents: null, detail: 'x' }]);
    v = await reconciliationView(db, merchant);
    expect(v.open.map((f) => f.kind)).toEqual(['payout_unbooked']);
    expect(v.explained.map((f) => f.id)).toEqual([flag.id]);

    // Its figures moved: that's news, and it opens again.
    await recordFlags(db, merchant, [stranded(20900), { kind: 'payout_unbooked', ref: 'po_1', expectedCents: 50000, actualCents: null, detail: 'x' }]);
    expect((await reconciliationView(db, merchant)).open.map((f) => f.kind).sort()).toEqual(['card_stranded', 'payout_unbooked']);

    const { rows } = await db.query<{ action: string }>(`SELECT action FROM payments.audit_log WHERE merchant = $1 AND action = 'reconciliation.explained'`, [merchant]);
    expect(rows).toHaveLength(1);
  });

  test('a note is needed; a closed flag or another shop’s can’t be explained', async () => {
    const a = await seedShop(db);
    const b = await seedShop(db);
    await recordFlags(db, a.merchant, [stranded()]);
    const flag = (await reconciliationView(db, a.merchant)).open[0]!;
    await expect(explainFlag(db, { merchant: a.merchant, flagId: flag.id, staffId: a.staff.owner, body: { note: 'ok' } })).rejects.toThrow('Say what happened');
    await expect(explainFlag(db, { merchant: b.merchant, flagId: flag.id, staffId: b.staff.owner, body: { note: 'Not mine' } })).rejects.toBeInstanceOf(FlagError);
    await explainFlag(db, { merchant: a.merchant, flagId: flag.id, staffId: a.staff.manager, body: { note: 'Captured in Stripe' } });
    await expect(explainFlag(db, { merchant: a.merchant, flagId: flag.id, staffId: a.staff.manager, body: { note: 'Again' } })).rejects.toThrow('closed already');
  });
});
