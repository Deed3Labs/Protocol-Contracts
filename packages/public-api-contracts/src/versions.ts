/**
 * Versions of the public API (rule 10). Every request names one in `Clear-Version`; a request without
 * the header gets the version its key was pinned to when it was made. Within a version, changes only
 * add optional request fields, response fields or new event types. Removing or renaming anything, or
 * changing what a field means, takes a new version, added to the end of this list and never taken out.
 *
 * `src/published/<version>.json` is the shape each version shipped with; `published.test.ts` fails if
 * a field in it disappears.
 */
export const CLEAR_VERSIONS = ['2026-10-16'] as const;
export type ClearVersion = (typeof CLEAR_VERSIONS)[number];

/** What a new key is pinned to. */
export const LATEST_VERSION: ClearVersion = CLEAR_VERSIONS[CLEAR_VERSIONS.length - 1];

export const VERSION_HEADER = 'Clear-Version';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export const isClearVersion = (v: string): v is ClearVersion => (CLEAR_VERSIONS as readonly string[]).includes(v);

/**
 * The version a request runs at: the header's when it names a known one, the key's pinned version when
 * there's no header, and an error (`version_unknown`) when the header names one that doesn't exist. An
 * unknown version is never rounded to a nearby one.
 */
export function resolveVersion(
  header: string | null | undefined,
  pinned: ClearVersion,
): { ok: true; version: ClearVersion } | { ok: false; code: 'version_unknown' } {
  const v = header?.trim();
  if (!v) return { ok: true, version: pinned };
  return isClearVersion(v) ? { ok: true, version: v } : { ok: false, code: 'version_unknown' };
}
