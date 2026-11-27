import { randomUUID } from 'node:crypto';
import * as fontkit from 'fontkit';
import wawoff2 from 'wawoff2';
import { MAX_FONT_BYTES, UploadFontFields, type UploadedFont } from '@clear/merchant-contracts';
import type { Queryable } from '../../../db/db.js';
import { RewardsError } from './errors.js';

/**
 * A shop's own font (Settings › Shop app › Upload a font): checked for the characters the app draws
 * and for reading small, converted to WOFF2, and kept with the shop's licence declaration. Served
 * from `/api/s/:slug/fonts/:id.woff2`. Never used for amounts or the Clear balance block.
 */

/** A–Z, a–z, 0–9, the accents Spanish and French menus use, and $. */
export const REQUIRED_CHARACTERS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$',
  ...'áéíóúñüÁÉÍÓÚÑÜàèçâêôû',
];

interface Checked {
  name: string;
  glyphs: 'passed' | 'failed';
  missing: string[];
  legibility: 'passed' | 'failed';
}

/** At 14px a lower-case letter must stand at least 5.5px, and letters mustn't be squeezed. */
export function checkFont(bytes: Buffer): Checked {
  let font: fontkit.Font;
  try {
    const parsed = fontkit.create(bytes);
    font = 'fonts' in parsed ? (parsed as unknown as { fonts: fontkit.Font[] }).fonts[0]! : (parsed as fontkit.Font);
  } catch {
    throw new RewardsError('That file isn’t a font we can read. Use WOFF2, OTF or TTF', 'invalid');
  }
  const missing = REQUIRED_CHARACTERS.filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0)!));
  const upm = font.unitsPerEm || 1000;
  const xHeight = font.xHeight || 0;
  const avg = (font as unknown as { 'OS/2'?: { xAvgCharWidth?: number } })['OS/2']?.xAvgCharWidth ?? 0;
  const readable = (14 * xHeight) / upm >= 5.5 && (avg === 0 || avg / upm >= 0.35);
  return { name: font.familyName || 'Uploaded font', glyphs: missing.length ? 'failed' : 'passed', missing, legibility: readable ? 'passed' : 'failed' };
}

function formatOf(bytes: Buffer, fileName: string): 'woff2' | 'otf' | 'ttf' {
  const sig = bytes.subarray(0, 4).toString('latin1');
  if (sig === 'wOF2') return 'woff2';
  if (sig === 'OTTO') return 'otf';
  if (sig === '\u0000\u0001\u0000\u0000' || sig === 'true') return 'ttf';
  if (/\.woff2$/i.test(fileName)) return 'woff2';
  throw new RewardsError('Use WOFF2, OTF or TTF', 'invalid');
}

interface FontRow {
  id: string;
  name: string;
  file_name: string;
  size_bytes: number;
  uploaded_as: UploadedFont['uploadedAs'];
  checks: Checked | string;
  used_for: UploadedFont['usedFor'];
  licence_declared_at: Date | string;
  licence_declared_by: string;
  uploaded_at: Date | string;
}

export function toUploadedFont(r: FontRow, url: string): UploadedFont {
  const checks = typeof r.checks === 'string' ? (JSON.parse(r.checks) as Checked) : r.checks;
  return {
    id: r.id,
    name: r.name,
    fileName: r.file_name,
    sizeBytes: r.size_bytes,
    uploadedAs: r.uploaded_as,
    url,
    checks: { glyphs: checks.glyphs, missing: checks.missing, legibility: checks.legibility },
    usedFor: r.used_for,
    licence: { declaredAt: new Date(r.licence_declared_at).toISOString(), declaredBy: r.licence_declared_by },
    uploadedAt: new Date(r.uploaded_at).toISOString(),
  };
}

export async function fontsFor(q: Queryable, merchant: string, urlFor: (id: string) => string): Promise<UploadedFont[]> {
  const { rows } = await q.query<FontRow>('SELECT id, name, file_name, size_bytes, uploaded_as, checks, used_for, licence_declared_at, licence_declared_by, uploaded_at FROM rewards.shop_app_fonts WHERE merchant = $1 AND removed_at IS NULL ORDER BY uploaded_at', [merchant]);
  return rows.map((r) => toUploadedFont(r, urlFor(r.id)));
}

/**
 * Upload. Over 1 MB or without the licence declared is refused outright; a font that fails a check
 * is kept, so the sheet can say what's wrong, and Settings won't let it be chosen.
 */
export async function uploadFont(
  q: Queryable,
  input: { merchant: string; staffId: string; fileName: string; bytes: Buffer; fields: unknown; urlFor: (id: string) => string; now?: Date },
): Promise<UploadedFont> {
  const fields = UploadFontFields.safeParse(input.fields);
  if (!fields.success) throw new RewardsError(fields.error.issues[0]?.message ?? 'That upload isn’t complete', 'invalid');
  if (input.bytes.length === 0) throw new RewardsError('That file is empty', 'invalid');
  if (input.bytes.length > MAX_FONT_BYTES) throw new RewardsError('Fonts up to 1 MB', 'invalid');
  const as = formatOf(input.bytes, input.fileName);
  const checks = checkFont(input.bytes);
  const woff2 = as === 'woff2' ? input.bytes : Buffer.from(await wawoff2.compress(new Uint8Array(input.bytes)));
  const now = input.now ?? new Date();
  const { rows } = await q.query<FontRow>(
    `INSERT INTO rewards.shop_app_fonts (id, merchant, name, file_name, size_bytes, uploaded_as, woff2, checks, used_for, licence_declared_at, licence_declared_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, name, file_name, size_bytes, uploaded_as, checks, used_for, licence_declared_at, licence_declared_by, uploaded_at`,
    [`fnt_${randomUUID()}`, input.merchant, fields.data.name, input.fileName.slice(0, 200), input.bytes.length, as, woff2, JSON.stringify(checks), fields.data.usedFor, now.toISOString(), input.staffId],
  );
  return toUploadedFont(rows[0]!, input.urlFor(rows[0]!.id));
}

/** The WOFF2 for a shop's font, for its app. */
export async function fontFile(q: Queryable, slug: string, id: string): Promise<Buffer | null> {
  const { rows } = await q.query<{ woff2: Buffer | Uint8Array }>(
    `SELECT f.woff2 FROM rewards.shop_app_fonts f JOIN rewards.shop_apps a ON a.merchant = f.merchant WHERE a.slug = $1 AND f.id = $2 AND f.removed_at IS NULL`,
    [slug, id],
  );
  return rows[0] ? Buffer.from(rows[0].woff2) : null;
}

/** Settings won't use a font that failed a check. */
export async function fontUsable(q: Queryable, merchant: string, id: string): Promise<boolean> {
  const { rows } = await q.query<{ checks: Checked | string }>('SELECT checks FROM rewards.shop_app_fonts WHERE id = $1 AND merchant = $2 AND removed_at IS NULL', [id, merchant]);
  if (!rows[0]) return false;
  const c = typeof rows[0].checks === 'string' ? (JSON.parse(rows[0].checks) as Checked) : rows[0].checks;
  return c.glyphs === 'passed' && c.legibility === 'passed';
}
