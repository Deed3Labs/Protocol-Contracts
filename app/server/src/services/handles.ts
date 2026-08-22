/*
 * Handles: the third pointer to a member's smart account.
 *
 * The smart account is the identity. Email and phone already point at it, matched by hash and
 * gated by the directory opt-out because they are contact details somebody may not want
 * discoverable. A handle is the opposite kind of thing -- it exists to be public and typed at by
 * someone who does not have your number -- so it is stored plain and matched directly.
 *
 * Everything here is deliberately settled before anybody holds a handle, because each rule is
 * cheap now and a migration later.
 */

/**
 * Case is not part of a handle.
 *
 * `TEXT UNIQUE` on its own makes @Kai and @kai two different members, which in a payments app is
 * not an inconsistency but a phishing surface: the whole point of a handle is that somebody types
 * what they were told. Normalising on the way in and comparing normalised is what makes "told a
 * handle" and "reached that member" the same thing.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/** Handles are 3-20 characters of a-z, 0-9 and underscore, starting with a letter. */
const SHAPE = /^[a-z][a-z0-9_]{2,19}$/;

/**
 * Names nobody may claim.
 *
 * Impersonating the co-op is the obvious one, but the support and security names matter more: a
 * member who is told to "message @clearsupport" and finds somebody there has been handed to
 * whoever registered it first. Cheaper to reserve than to reclaim.
 */
const RESERVED = new Set([
  'clear', 'clearapp', 'clearco', 'clearcoop', 'useclear', 'clearpath', 'clearpay',
  'admin', 'administrator', 'root', 'system', 'official', 'staff', 'team',
  'support', 'help', 'helpdesk', 'security', 'billing', 'payments', 'noreply',
  'about', 'settings', 'login', 'signup', 'onboarding', 'api', 'www', 'app',
  'me', 'you', 'null', 'undefined', 'anonymous', 'deleted',
]);

export type HandleRejection = 'too_short' | 'too_long' | 'bad_shape' | 'reserved';

/** Why a handle cannot be used, or null if it can. */
export function rejectHandle(raw: string): HandleRejection | null {
  const handle = normalizeHandle(raw);
  if (handle.length < 3) return 'too_short';
  if (handle.length > 20) return 'too_long';
  if (!SHAPE.test(handle)) return 'bad_shape';
  // Prefix rather than exact match: @clear_support reads as official to anybody scanning quickly,
  // which is the whole of what reserving @clearsupport was meant to prevent.
  if (RESERVED.has(handle)) return 'reserved';
  for (const name of RESERVED) {
    if (handle.startsWith(`${name}_`)) return 'reserved';
  }
  return null;
}

export function isValidHandle(raw: string): boolean {
  return rejectHandle(raw) === null;
}

const ADJECTIVES = [
  'amber', 'bright', 'calm', 'clever', 'copper', 'daily', 'early', 'even', 'fair', 'gentle',
  'honest', 'level', 'lively', 'open', 'patient', 'plain', 'quiet', 'ready', 'solid', 'steady',
  'sunny', 'swift', 'tidy', 'true', 'warm', 'willing',
];
const NOUNS = [
  'anchor', 'basin', 'beacon', 'bridge', 'canyon', 'cedar', 'creek', 'ember', 'field', 'garden',
  'harbor', 'hollow', 'juniper', 'ledger', 'meadow', 'mesa', 'orchard', 'quarry', 'ridge', 'river',
  'sequoia', 'summit', 'thicket', 'valley', 'willow',
];

/**
 * A handle nobody was asked for.
 *
 * The reference collects no handle, and asking for one would need a collision-and-retry screen it
 * does not have. Generated gives Send something to show on day one; settings is where somebody who
 * cares picks their own.
 *
 * Two words rather than a name fragment, deliberately: deriving from an email or a legal name
 * publishes something the member did not choose to publish, on a field whose entire purpose is to
 * be seen.
 */
export function suggestHandle(seed = Math.random()): string {
  const pick = <T,>(list: T[], offset: number) =>
    list[Math.floor((seed * 9973 + offset * 6151) % list.length)];
  const adjective = pick(ADJECTIVES, 1);
  const noun = pick(NOUNS, 2);
  const digits = Math.floor((seed * 104729) % 100).toString().padStart(2, '0');
  return `${adjective}${noun}${digits}`;
}

/**
 * Generates handles until `isFree` accepts one.
 *
 * A generated handle can still collide, and a member whose signup fails because two people got the
 * same random pair would have no idea what happened. Falls back to a longer suffix rather than
 * giving up: a slightly uglier handle is better than a signup that stops.
 */
export async function generateHandle(
  isFree: (handle: string) => Promise<boolean>,
  attempts = 8,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const candidate = suggestHandle(Math.random());
    if (isValidHandle(candidate) && (await isFree(candidate))) return candidate;
  }
  for (let i = 0; i < attempts; i++) {
    const candidate = `${suggestHandle(Math.random())}${Math.floor(Math.random() * 9000) + 1000}`;
    if (candidate.length <= 20 && (await isFree(candidate))) return candidate;
  }
  throw new Error('Could not generate a free handle.');
}
