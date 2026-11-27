import { PointCode } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';

/**
 * The factory's list: every Point made goes into merchant.point_keys by the code on its back, so a
 * shop can claim it (claimPoint answers "No Point has that code" for anything not here). Run by
 * scripts/point-codes.ts.
 *
 * Adding is all or nothing on the list's shape: one code that isn't a Point's code (four Crockford
 * base32 characters) and nothing goes in, so a bad file is fixed and run again. A code already here
 * is left as it is, model and claim included; running the same list twice adds nothing.
 */

export type PointModel = 'point' | 'point_large';
export const POINT_MODELS: readonly PointModel[] = ['point', 'point_large'];

export type PointCodesResult = {
  /** Not a Point's code, as written. Nothing was added. */
  invalid: string[];
  /** In the list more than once; added (or skipped) once. */
  repeated: string[];
  added: string[];
  /** Already made, with the model it was made as (which may not be the one asked for). */
  skipped: Array<{ code: string; model: PointModel }>;
};

/** A file's codes: one per line, or separated by spaces or commas; blank lines and `#` comments ignored. */
export const readCodes = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/#.*/, ''))
    .flatMap((line) => line.split(/[\s,]+/))
    .filter(Boolean);

export async function addPointCodes(db: Db, input: { codes: string[]; model: PointModel; dryRun?: boolean }): Promise<PointCodesResult> {
  if (!POINT_MODELS.includes(input.model)) throw new Error(`model must be ${POINT_MODELS.join(' or ')}`);
  const invalid: string[] = [];
  const repeated: string[] = [];
  const codes: string[] = [];
  for (const raw of input.codes) {
    const parsed = PointCode.safeParse(raw);
    if (!parsed.success) invalid.push(raw);
    else if (!codes.includes(parsed.data)) codes.push(parsed.data);
    else if (!repeated.includes(parsed.data)) repeated.push(parsed.data);
  }
  if (invalid.length || !codes.length) return { invalid, repeated, added: [], skipped: [] };

  return db.transaction(async (tx) => {
    const { rows: existing } = await tx.query<{ code: string; model: PointModel }>('SELECT code, model FROM merchant.point_keys WHERE code = ANY($1::text[])', [codes]);
    let added = codes.filter((c) => !existing.some((e) => e.code === c));
    if (!input.dryRun && added.length) {
      const { rows } = await tx.query<{ code: string }>('INSERT INTO merchant.point_keys (code, model) SELECT unnest($1::text[]), $2 ON CONFLICT (code) DO NOTHING RETURNING code', [
        added,
        input.model,
      ]);
      added = added.filter((c) => rows.some((r) => r.code === c));
    }
    const skipped = codes.filter((c) => !added.includes(c)).map((code) => ({ code, model: existing.find((e) => e.code === code)?.model ?? input.model }));
    return { invalid, repeated, added, skipped };
  });
}
