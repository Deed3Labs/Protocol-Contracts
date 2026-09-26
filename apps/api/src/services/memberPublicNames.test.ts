import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { memberPublicNames } from './memberStore.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
  // Only what the lookup reads, as the member store makes them.
  await db.exec(`
    CREATE TABLE members (id BIGINT PRIMARY KEY, primary_wallet TEXT NOT NULL);
    CREATE TABLE member_wallets (member_id BIGINT, wallet_address TEXT, status TEXT);
    CREATE TABLE member_profile_public (member_id BIGINT PRIMARY KEY, username TEXT, display_name TEXT);
    INSERT INTO members VALUES (1, '0xaaa1'), (2, '0xbbb2'), (3, '0xccc3'), (4, '0xddd4');
    INSERT INTO member_profile_public VALUES (1, 'dana', 'Dana Whitfield'), (2, 'marco', NULL), (3, NULL, '  '), (4, NULL, 'Old Name');
    INSERT INTO member_wallets VALUES (1, '0xeee5', 'ACTIVE'), (4, '0xfff6', 'REMOVED');
  `);
});

describe('the name a shop sees for a member', () => {
  test('the display name they set, else their @username; nothing for a member with neither', async () => {
    const names = await memberPublicNames(db, ['0xAAA1', '0xbbb2', '0xccc3', '0x9999']);
    expect(Object.fromEntries(names)).toEqual({ '0xaaa1': 'Dana Whitfield', '0xbbb2': '@marco' });
  });

  test('a linked wallet finds its member; a removed one doesn’t', async () => {
    const names = await memberPublicNames(db, ['0xeee5', '0xfff6']);
    expect(Object.fromEntries(names)).toEqual({ '0xeee5': 'Dana Whitfield' });
  });

  test('no wallets, no query', async () => {
    let asked = false;
    const names = await memberPublicNames({ query: async () => ((asked = true), { rows: [] }) }, ['', '']);
    expect(names.size).toBe(0);
    expect(asked).toBe(false);
  });
});
