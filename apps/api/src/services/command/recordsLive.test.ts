import { afterEach, describe, expect, test } from 'bun:test';
import { testDb } from '../../db/testDb.js';
import { recordsSection } from './sections.js';

/* Records, live: the counts on the page are the documents themselves. The seed's stored counts (records.doc_counts,
   records.doc_states, records.coverage) never reach a live page; seeded, they're the design's, as before. */

const KEYS = ['records.doc_counts', 'records.doc_states', 'records.coverage'];

async function withFigures() {
  const { db } = await testDb();
  for (const k of KEYS) await db.query('INSERT INTO command.figures (key, value, source) VALUES ($1, $2, $3)', [k, JSON.stringify({ agreement: 41 }), 'seed']);
  return db;
}

describe('Records’ stored counts', () => {
  afterEach(() => {
    delete process.env.PROVIDER_RECORDS;
  });
  test('live, they aren’t sent', async () => {
    process.env.PROVIDER_RECORDS = 'live';
    const r = (await recordsSection(await withFigures(), { level: 4 as never, reveal: false, now: new Date() })) as { figures: Record<string, unknown> };
    for (const k of KEYS) expect(r.figures[k]).toBeUndefined();
  });
  test('seeded, they are', async () => {
    const r = (await recordsSection(await withFigures(), { level: 4 as never, reveal: false, now: new Date() })) as { figures: Record<string, unknown> };
    for (const k of KEYS) expect(r.figures[k]).toEqual({ agreement: 41 });
  });
});
