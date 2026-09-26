import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { seedShop, testDb } from '../../db/testDb.js';
import { addCode, checkCode, claimCode } from './termsCodes.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let n = 0;
const fresh = () => `KAI-${1000 + ++n}`;
const tierOf = async (merchant: string) =>
  (await db.query<{ clear_tier: string; founding: boolean; terms_code: string | null }>('SELECT clear_tier, founding, terms_code FROM merchant.profiles WHERE merchant = $1', [merchant])).rows[0]!;

describe('terms codes', () => {
  test('what a code would do: founding rates while places last; full; unknown or retired', async () => {
    const code = fresh();
    await addCode(db, { code: code.toLowerCase(), tier: 'founding', places: 2, note: 'Pilot' });
    expect(await checkCode(db, ` ${code.toLowerCase()} `)).toEqual({ state: 'ok', code, tier: 'founding', paidNowBps: 125, overTimeBps: 200, placesLeft: 2, places: 2 });
    expect(await checkCode(db, 'NOPE-1')).toEqual({ state: 'unknown' });
    expect(await checkCode(db, "x'; drop table")).toEqual({ state: 'unknown' });

    const none = fresh();
    await addCode(db, { code: none, tier: 'founding', places: 0 });
    expect(await checkCode(db, none)).toEqual({ state: 'full', code: none, tier: 'founding', places: 0 });

    await db.query('UPDATE merchant.terms_codes SET retired_at = now() WHERE code = $1', [code]);
    expect(await checkCode(db, code)).toEqual({ state: 'unknown' });
  });

  test('a new shop takes a place and goes on the tier; the last place goes once', async () => {
    const code = fresh();
    await addCode(db, { code, tier: 'founding', places: 1 });
    const a = await seedShop(db);
    const b = await seedShop(db);
    expect(await claimCode(db, a.merchant, code)).toMatchObject({ state: 'ok', placesLeft: 0 });
    expect(await tierOf(a.merchant)).toEqual({ clear_tier: 'founding', founding: true, terms_code: code });
    expect(await checkCode(db, code)).toMatchObject({ state: 'full' });
    // Too late: standard terms, as the owner was shown.
    expect(await claimCode(db, b.merchant, code)).toMatchObject({ state: 'full' });
    expect(await tierOf(b.merchant)).toEqual({ clear_tier: 'standard', founding: false, terms_code: null });
  });

  test('two shops at once for the last place: one gets it', async () => {
    const code = fresh();
    await addCode(db, { code, tier: 'founding', places: 1 });
    const [a, b] = [await seedShop(db), await seedShop(db)];
    const results = await Promise.all([claimCode(db, a.merchant, code), claimCode(db, b.merchant, code)]);
    expect(results.map((r) => r.state).sort()).toEqual(['full', 'ok']);
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM merchant.profiles WHERE terms_code = $1', [code]);
    expect(rows[0]!.n).toBe(1);
  });

  test('once only: a retried signup keeps its code and doesn’t take another place', async () => {
    const code = fresh();
    const other = fresh();
    await addCode(db, { code, tier: 'founding', places: 3 });
    await addCode(db, { code: other, tier: 'standard', places: 3 });
    const s = await seedShop(db);
    await claimCode(db, s.merchant, code);
    expect(await claimCode(db, s.merchant, code)).toMatchObject({ state: 'ok', code, placesLeft: 2 });
    expect(await claimCode(db, s.merchant, other)).toMatchObject({ code });
    expect((await tierOf(s.merchant)).terms_code).toBe(code);
  });

  test('Clear’s codes are checked when added', async () => {
    await expect(addCode(db, { code: 'a b!', tier: 'founding', places: 1 })).rejects.toThrow('3 to 32');
    await expect(addCode(db, { code: fresh(), tier: 'founding', places: -1 })).rejects.toThrow('whole number');
    await expect(addCode(db, { code: fresh(), tier: 'gold', places: 1 })).rejects.toThrow();
  });
});
