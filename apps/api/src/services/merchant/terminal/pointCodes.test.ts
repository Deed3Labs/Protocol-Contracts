import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { claimPoint } from './hardware.js';
import { addPointCodes, readCodes } from './pointCodes.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const keys = async (codes: string[]) =>
  (await db.query<{ code: string; model: string; device_id: string | null }>('SELECT code, model, device_id FROM merchant.point_keys WHERE code = ANY($1::text[]) ORDER BY code', [codes])).rows;

describe('the factory list of Points', () => {
  test('valid codes go in with their model, upper-cased, and can then be claimed', async () => {
    const r = await addPointCodes(db, { codes: ['A7K2', 'b3m9', ' C4N8 '], model: 'point_large' });
    expect(r).toEqual({ invalid: [], repeated: [], added: ['A7K2', 'B3M9', 'C4N8'], skipped: [] });
    expect(await keys(['A7K2', 'B3M9', 'C4N8'])).toEqual([
      { code: 'A7K2', model: 'point_large', device_id: null },
      { code: 'B3M9', model: 'point_large', device_id: null },
      { code: 'C4N8', model: 'point_large', device_id: null },
    ]);
    const s = await seedShop(db);
    const claimed = await claimPoint(db, { merchant: s.merchant, staffId: s.staff.owner, request: { code: 'B3M9' }, apiBase: 'x' });
    expect(claimed.device.code).toBe('B3M9');
  });

  test('one invalid code and nothing goes in', async () => {
    const r = await addPointCodes(db, { codes: ['D5P1', 'E6QL', 'F7R', 'G8S2X', 'H0OU'], model: 'point' });
    expect(r.invalid).toEqual(['E6QL', 'F7R', 'G8S2X', 'H0OU']);
    expect(r.added).toEqual([]);
    expect(await keys(['D5P1'])).toEqual([]);
  });

  test('a code already made is reported and left as it is, model and claim included', async () => {
    const s = await seedShop(db);
    await addPointCodes(db, { codes: ['J9T3'], model: 'point' });
    await claimPoint(db, { merchant: s.merchant, staffId: s.staff.owner, request: { code: 'J9T3' }, apiBase: 'x' });
    const [before] = await keys(['J9T3']);

    const r = await addPointCodes(db, { codes: ['J9T3', 'K1V4'], model: 'point_large' });
    expect(r.added).toEqual(['K1V4']);
    expect(r.skipped).toEqual([{ code: 'J9T3', model: 'point' }]);
    expect(await keys(['J9T3'])).toEqual([before!]);

    const again = await addPointCodes(db, { codes: ['J9T3', 'K1V4'], model: 'point_large' });
    expect(again.added).toEqual([]);
    expect(again.skipped).toEqual([
      { code: 'J9T3', model: 'point' },
      { code: 'K1V4', model: 'point_large' },
    ]);
  });

  test('a code repeated in the list goes in once', async () => {
    const r = await addPointCodes(db, { codes: ['M2W5', 'm2w5', 'N3X6', 'M2W5'], model: 'point' });
    expect(r.added).toEqual(['M2W5', 'N3X6']);
    expect(r.repeated).toEqual(['M2W5']);
    expect(await keys(['M2W5'])).toHaveLength(1);
  });

  test('a dry run says what it would add and writes nothing', async () => {
    await addPointCodes(db, { codes: ['P4Y7'], model: 'point' });
    const r = await addPointCodes(db, { codes: ['P4Y7', 'Q5Z8'], model: 'point', dryRun: true });
    expect(r.added).toEqual(['Q5Z8']);
    expect(r.skipped).toEqual([{ code: 'P4Y7', model: 'point' }]);
    expect(await keys(['Q5Z8'])).toEqual([]);
  });

  test('a file: a code per line, or spaces and commas, with comments', () => {
    expect(readCodes('# batch 7, line 2\nR6A9\n\nS7B0, T8C1  V9D2\nW0E3 # retested\n')).toEqual(['R6A9', 'S7B0', 'T8C1', 'V9D2', 'W0E3']);
  });
});
