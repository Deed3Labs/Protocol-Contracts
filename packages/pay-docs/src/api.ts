import { describePublished, ENDPOINTS, ERROR_CODES, IDEMPOTENCY_HEADER, LATEST_VERSION, VERSION_HEADER, type PublishedShape } from '@clear/public-api-contracts';

/**
 * `docs/api.md`, generated from `@clear/public-api-contracts`: the routes (`ENDPOINTS`) and the JSON
 * Schema of every request and object a version publishes. Nothing here is typed by hand about a field,
 * so the reference can't say something the API doesn't do. `docs.test.ts` fails when the committed file
 * differs from this.
 */

type Schema = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  default?: unknown;
  description?: string;
};

const code = (v: unknown) => `\`${typeof v === 'string' ? v : JSON.stringify(v)}\``;
const SAFE_MAX = Number.MAX_SAFE_INTEGER;

/** "`pay_…`" for an id's pattern. */
function idOf(pattern: string | undefined): string | null {
  const m = pattern ? /^\^([a-z]+_)\[/.exec(pattern) : null;
  return m ? `${code(`${m[1]}…`)}` : null;
}

/** A one-line type: `string`, `integer, 1 to 100`, `"usd"`, one of `clear`, `card`, … */
export function typeOf(s: Schema): string {
  if (s.anyOf || s.oneOf) {
    const parts = (s.anyOf ?? s.oneOf)!;
    const nonNull = parts.filter((p) => p.type !== 'null');
    const t = nonNull.map(typeOf).join(' or ');
    return parts.length > nonNull.length ? `${t}, or null` : t;
  }
  if (s.const !== undefined) return code(s.const);
  if (s.enum) return `one of ${s.enum.map(code).join(', ')}`;
  if (s.type === 'array') return `list of ${s.items ? typeOf(s.items) : 'anything'}${s.minItems ? ` (at least ${s.minItems})` : ''}`;
  if (s.type === 'object') return 'object';
  if (s.type === 'integer' || s.type === 'number') {
    const lo = s.minimum;
    const hi = s.maximum !== undefined && s.maximum < SAFE_MAX ? s.maximum : undefined;
    return `${s.type}${lo !== undefined && hi !== undefined ? `, ${lo} to ${hi}` : lo !== undefined ? `, at least ${lo}` : hi !== undefined ? `, at most ${hi}` : ''}`;
  }
  if (s.type === 'string') {
    const id = idOf(s.pattern);
    if (id) return `id (${id})`;
    if (s.format === 'date-time') return 'timestamp (ISO 8601, with a zone)';
    if (s.format === 'uri') return 'URL';
    const len = s.minLength !== undefined && s.maxLength !== undefined ? `, ${s.minLength} to ${s.maxLength} characters` : s.maxLength !== undefined ? `, up to ${s.maxLength} characters` : '';
    return `string${len}`;
  }
  if (s.type === 'boolean') return 'boolean';
  return s.type ? String(s.type) : 'anything';
}

/** Rows for an object's fields, nested objects as `parent.child`. */
function rows(s: Schema, prefix = ''): string[] {
  const out: string[] = [];
  for (const [name, f] of Object.entries(s.properties ?? {})) {
    const required = (s.required ?? []).includes(name) && f.default === undefined;
    const notes = [f.default !== undefined ? `default ${code(f.default)}` : '', f.description ?? ''].filter(Boolean).join('. ');
    out.push(`| \`${prefix}${name}\` | ${typeOf(f)} | ${required ? 'yes' : 'no'} | ${notes} |`);
    const inner = f.type === 'object' ? f : f.type === 'array' && f.items?.type === 'object' ? f.items : null;
    if (inner?.properties) out.push(...rows(inner, `${prefix}${name}${f.type === 'array' ? '[]' : ''}.`));
  }
  return out;
}

function table(s: Schema): string {
  const alts = s.anyOf ?? s.oneOf;
  if (alts && alts.every((a) => a.type === 'object')) {
    return alts.map((a, i) => `${i === 0 ? 'Either' : 'Or'}:\n\n${table(a)}`).join('\n\n');
  }
  const r = rows(s);
  return r.length ? ['| Field | Type | Required | Notes |', '|---|---|---|---|', ...r].join('\n') : '_No fields._';
}

export function renderApiMd(shape: PublishedShape = describePublished()): string {
  const out: string[] = [];
  out.push('# Pay with Clear: API reference');
  out.push('');
  out.push(`Generated from \`@clear/public-api-contracts\` for version ${code(LATEST_VERSION)}. Base URL \`https://api.useclear.org\`.`);
  out.push('');
  out.push('## Every request');
  out.push('');
  out.push('- `Authorization: Bearer <key>`. The secret key (`clear_sk_…`) from a server; the publishable key (`clear_pk_…`) only where a route says so.');
  out.push(`- \`${VERSION_HEADER}: ${LATEST_VERSION}\`. Without it, the key's pinned version is used, and said in the answer. An unknown version is refused.`);
  out.push(`- \`${IDEMPOTENCY_HEADER}\` on the routes marked so: the same key and body give the same answer; the same key with another body is refused.`);
  out.push('- Bodies are JSON. Amounts are integer cents in `usd`. Times are ISO 8601. Lists are newest first: `{ object: "list", data, hasMore }`, continued with `startingAfter`.');
  out.push('- A test key sees only test objects, and a live key only live ones.');
  out.push('');
  out.push('## Routes');
  out.push('');
  out.push('| Route | Key | Request | Answer |');
  out.push('|---|---|---|---|');
  for (const e of ENDPOINTS) out.push(`| \`${e.method} ${e.path}\` | ${e.key === 'either' ? 'either' : e.key}${e.idempotent ? ', with `Idempotency-Key`' : ''} | ${e.request ? `[${e.request}](#${e.request.toLowerCase()})` : '-'} | ${e.response} |`);
  out.push('');
  for (const e of ENDPOINTS) {
    out.push(`### \`${e.method} ${e.path}\``);
    out.push('');
    out.push(e.summary);
    out.push('');
  }
  out.push('## Requests');
  out.push('');
  for (const [name, schema] of Object.entries(shape.requests)) {
    out.push(`### ${name}`);
    out.push('');
    out.push(table(schema as Schema));
    out.push('');
  }
  out.push('## Objects');
  out.push('');
  for (const [name, schema] of Object.entries(shape.responses)) {
    if (name === 'ModalMessage') continue; // the frame's postMessage, not an HTTP answer: in the script's README
    out.push(`### ${name}`);
    out.push('');
    out.push(name === 'Event' ? `A webhook's body. \`type\` is one of ${shape.lists.eventTypes!.map(code).join(', ')}; \`data\` is the payment (or for a refund event, the refund).\n\n${table(schema as Schema)}` : table(schema as Schema));
    out.push('');
  }
  out.push('## Errors');
  out.push('');
  out.push('Every refusal is `{ "error": { "type", "code", "message", "param" } }`. Branch on `code`; `message` is for people; `param` is the field at fault.');
  out.push('');
  out.push('| Code | Type | HTTP |');
  out.push('|---|---|---|');
  for (const c of shape.lists.errorCodes!) out.push(`| \`${c}\` | ${ERROR_CODES[c as keyof typeof ERROR_CODES].type} | ${ERROR_CODES[c as keyof typeof ERROR_CODES].status} |`);
  out.push('');
  out.push('## Lists');
  out.push('');
  out.push(`- Versions: ${shape.lists.versions!.map(code).join(', ')}`);
  out.push(`- Payment statuses: ${shape.lists.paymentStatuses!.map(code).join(', ')}`);
  out.push(`- Refund statuses: ${shape.lists.refundStatuses!.map(code).join(', ')}`);
  out.push(`- Webhook delivery statuses: ${shape.lists.webhookDeliveryStatuses!.map(code).join(', ')}`);
  out.push('');
  return out.join('\n');
}
