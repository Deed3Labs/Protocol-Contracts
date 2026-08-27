/*
 * Scrub identity data out of anything on its way to a log or a response.
 *
 * The decision this enforces: we pass a member's SSN, date of birth and government id straight
 * through to Lithic and never store them. That is a decision about our database, and a database is
 * not the only place data lands. A provider SDK that echoes the offending request in its error
 * message, an unhandled throw logged whole, a 502 carrying the message to the browser — none of
 * those are "storing" anything, and all of them end with an SSN somewhere it will outlive the
 * request: Railway's log retention, a browser console, an error tracker.
 *
 * So this is applied at the two exits — what we log, and what we answer — rather than trusted to
 * every future call site remembering.
 *
 * Deliberately conservative. Over-redacting a log costs someone one debugging round; under-
 * redacting one costs a member their identity, and there is no round two.
 */

/** Keys whose values are identity data wherever they appear, in either casing convention. */
const SENSITIVE_KEYS = [
  'government_id',
  'governmentId',
  'ssn',
  'itin',
  'tax_id',
  'taxId',
  'dob',
  'date_of_birth',
  'dateOfBirth',
];

const KEY_VALUE = new RegExp(
  `("?(?:${SENSITIVE_KEYS.join('|')})"?\\s*[:=]\\s*)("?)([^",}\\s]+)(\\2)`,
  'gi',
);

/** SSN/ITIN as a bare string, with or without dashes — the backstop for an unkeyed leak. */
const SSN_SHAPED = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * A date on its own, which in this codebase's request bodies means a date of birth.
 *
 * Not applied to ISO timestamps: `2026-08-26T14:00:00Z` is a `tos_timestamp` or a `created_at` and
 * redacting those makes logs unreadable for no gain. The lookahead is what tells them apart.
 */
const DATE_ONLY = /\b\d{4}-\d{2}-\d{2}\b(?!T)/g;

/** Redact identity data from a string bound for a log or an HTTP response. */
export function redactSensitive(input: string): string {
  return input
    .replace(KEY_VALUE, (_m, key: string, quote: string) => `${key}${quote}[redacted]${quote}`)
    .replace(SSN_SHAPED, '[redacted]')
    .replace(DATE_ONLY, '[redacted]');
}

/**
 * The message from a thrown value, redacted — including anything an SDK attached to it.
 *
 * Errors are not always strings and not always shallow: a provider error can carry the request on
 * `cause`, `response.data` or its own enumerable fields, so the whole object is serialised before
 * scrubbing rather than only `.message`.
 */
export function redactError(error: unknown): string {
  if (error instanceof Error) {
    let extra = '';
    try {
      /*
       * Copy the own properties, then stringify normally.
       *
       * Not `JSON.stringify(error, [...keys])`: an array replacer filters keys at EVERY level, so a
       * nested `{ request: { individual: { dob, government_id } } }` came out with the whole
       * `individual` object dropped. That happens to be safe and it is not the mechanism intended
       * — it deleted the context that makes an error worth logging, and it meant the redaction was
       * never actually exercised on nested data. Safety by accident stops being safe the moment the
       * accident changes.
       *
       * A full JSON.stringify of an Error is `{}`, which is the other way this quietly does nothing.
       */
      const own: Record<string, unknown> = {};
      for (const key of Object.getOwnPropertyNames(error)) {
        if (key === 'stack' || key === 'message') continue;
        own[key] = (error as unknown as Record<string, unknown>)[key];
      }
      const serialised = JSON.stringify(own);
      if (serialised && serialised !== '{}') extra = ` ${serialised}`;
    } catch {
      // Circular or unserialisable. The message alone is still worth having.
    }
    return redactSensitive(`${error.message}${extra}`);
  }
  try {
    return redactSensitive(typeof error === 'string' ? error : JSON.stringify(error) ?? 'Unknown error');
  } catch {
    return 'Unknown error';
  }
}
