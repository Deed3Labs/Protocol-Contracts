import { describe, expect, test } from 'bun:test';
import { testDb } from '../../db/testDb.js';
import { parseLevels, SECTIONS } from './levels.js';

/*
 * The redesign's two new sections (migration 0056): every group, and anyone with custom access, gets
 * Community at the level they had for Governance and Settings at their Team (access) level, so no
 * one's access changes, and every stored set of levels is still a full one.
 */
describe('community and settings', () => {
  test('each group gets Governance’s level for Community and Team’s for Settings, and stays a full set', async () => {
    const { db } = await testDb();
    const { rows } = await db.query<{ key: string; levels: Record<string, number> }>('SELECT key, levels FROM command.groups ORDER BY key');
    expect(rows.length).toBeGreaterThan(0);
    for (const g of rows) {
      expect(parseLevels(g.levels), g.key).not.toBeNull();
      expect([g.levels.community, g.levels.settings], g.key).toEqual([g.levels.governance, g.levels.access]);
    }
    expect(SECTIONS).toContain('community');
    expect(SECTIONS).toContain('settings');
    // the members' row: they can read Community as they read Governance, and see no Settings
    expect(rows.find((g) => g.key === 'members')!.levels).toMatchObject({ governance: 2, community: 2, access: 0, settings: 0 });
  });
});
