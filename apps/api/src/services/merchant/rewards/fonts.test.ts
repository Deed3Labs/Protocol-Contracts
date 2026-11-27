import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { checkFont, fontFile, uploadFont } from './fonts.js';
import { ensureShopApp, patchShopApp } from './shopApp.js';

// An icon font has none of the letters; a system text font has them all. Neither is committed.
const ICONS = fileURLToPath(new URL('../../../../../../node_modules/playwright-core/lib/vite/recorder/assets/codicon-DCmgc-ay.ttf', import.meta.url));
const ARIAL = '/System/Library/Fonts/Supplemental/Arial.ttf';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

describe('uploading a font', () => {
  test.skipIf(!existsSync(ICONS))('a font without the letters fails its check, and says which are missing', () => {
    const c = checkFont(readFileSync(ICONS));
    expect(c.glyphs).toBe('failed');
    expect(c.missing).toContain('$');
  });

  test.skipIf(!existsSync(ARIAL))('a text font passes, is converted to WOFF2, and is served to the app', async () => {
    const s = await seedShop(db);
    await ensureShopApp(db, s.merchant, s.staff.owner);
    await patchShopApp(db, s.merchant, s.staff.owner, { slug: `fonts-${s.merchant.slice(-4)}`, enabled: true });
    const bytes = readFileSync(ARIAL);
    const f = await uploadFont(db, { merchant: s.merchant, staffId: s.staff.owner, fileName: 'Arial.ttf', bytes, fields: { name: 'Casa Display', usedFor: 'headings', licenceDeclared: true }, urlFor: (id) => `/fonts/${id}.woff2` });
    expect(f).toMatchObject({ name: 'Casa Display', uploadedAs: 'ttf', checks: { glyphs: 'passed', legibility: 'passed', missing: [] }, licence: { declaredBy: s.staff.owner } });
    const served = await fontFile(db, `fonts-${s.merchant.slice(-4)}`, f.id);
    expect(served!.subarray(0, 4).toString('latin1')).toBe('wOF2');
    await patchShopApp(db, s.merchant, s.staff.owner, { brand: { headingFont: { kind: 'uploaded', fontId: f.id } } });
  });

  test('without the licence declared, or over 1 MB, nothing is kept', async () => {
    const s = await seedShop(db);
    await expect(uploadFont(db, { merchant: s.merchant, staffId: s.staff.owner, fileName: 'x.ttf', bytes: Buffer.from('x'), fields: { name: 'X', usedFor: 'headings', licenceDeclared: false }, urlFor: (id) => id })).rejects.toMatchObject({ code: 'invalid' });
    await expect(uploadFont(db, { merchant: s.merchant, staffId: s.staff.owner, fileName: 'x.ttf', bytes: Buffer.alloc(1_048_577), fields: { name: 'X', usedFor: 'headings', licenceDeclared: true }, urlFor: (id) => id })).rejects.toMatchObject({ message: 'Fonts up to 1 MB' });
  });
});
