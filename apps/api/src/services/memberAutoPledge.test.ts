import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECURITY_AUTO_PLEDGE_COLUMN, defaultSecurity, mapSecurity } from './memberStore.js';

/*
 * The member's "back my line with Savings and Earn automatically" setting, kept with their other
 * account switches so it follows them across devices. On unless they turn it off.
 */

const row = (extra: Record<string, unknown> = {}) => ({
  member_id: 1,
  signature_lock: true,
  session_review: true,
  biometric_access: true,
  social_discovery: false,
  transfer_alerts: true,
  updated_at: new Date(0),
  ...extra,
});

describe('auto-pledge setting', () => {
  test('on for a member with no row yet', () => {
    expect(defaultSecurity().autoPledge).toBe(true);
    expect(mapSecurity(null).autoPledge).toBe(true);
  });

  test('on when the row predates the column; off only when the member turned it off', () => {
    expect(mapSecurity(row()).autoPledge).toBe(true);
    expect(mapSecurity(row({ auto_pledge: null })).autoPledge).toBe(true);
    expect(mapSecurity(row({ auto_pledge: true })).autoPledge).toBe(true);
    expect(mapSecurity(row({ auto_pledge: false })).autoPledge).toBe(false);
  });

  test('the column is added to an existing table on, for every member already on file, and twice is harmless', async () => {
    const pg = new PGlite();
    await pg.exec(`
      CREATE TABLE member_security_settings (
        member_id BIGINT PRIMARY KEY,
        transfer_alerts BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO member_security_settings (member_id) VALUES (1), (2);
    `);
    await pg.exec(SECURITY_AUTO_PLEDGE_COLUMN);
    await pg.exec(SECURITY_AUTO_PLEDGE_COLUMN);
    const { rows } = await pg.query<{ auto_pledge: boolean }>('SELECT auto_pledge FROM member_security_settings ORDER BY member_id');
    expect(rows.map((r) => r.auto_pledge)).toEqual([true, true]);
    await pg.close();
  });

  test('PATCH /me/security takes it as a boolean and saves it', () => {
    const route = readFileSync(join(import.meta.dirname, '..', 'routes', 'members.ts'), 'utf8');
    expect(route).toContain("parseOptionalBoolean(body.autoPledge, 'autoPledge', res)");
    const store = readFileSync(join(import.meta.dirname, 'memberStore.ts'), 'utf8');
    expect(store).toContain('autoPledge: patch.autoPledge ?? current.autoPledge');
    expect(store).toContain('auto_pledge = EXCLUDED.auto_pledge');
  });
});
