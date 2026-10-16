import { z } from 'zod';
import { ERROR_CODE_LIST, ErrorResponse } from './errors';
import { CreatePayment, ListPayments, Payment, PAYMENT_STATUSES } from './payments';
import { CreatePaymentLink, PaymentLink, Price } from './prices';
import { CreateRefund, Refund, REFUND_STATUSES } from './refunds';
import { CreateWebhookEndpoint, Event, EVENT_TYPES, WebhookEndpoint } from './webhooks';
import { CreateModalSession, MODAL_ERROR_CODES, ModalMessage, ModalSession } from './modal';
import { CLEAR_VERSIONS } from './versions';

/**
 * What a version publishes, and the check that a later change only grows it (rule 10).
 *
 * `bun run snapshot` writes `src/published/<latest version>.json` from these schemas. Run it when a
 * version is first published, and after an addition. `published.test.ts` compares every snapshot with
 * the schemas as they are now and fails on anything `breakingChanges` finds. A snapshot is never edited
 * by hand to make the test pass: a real removal takes a new version.
 */
export const PUBLISHED_SCHEMAS = {
  responses: { Payment, Price, PaymentLink, Refund, WebhookEndpoint, Event, ModalSession, ErrorResponse, ModalMessage },
  requests: { CreatePayment, ListPayments, CreatePaymentLink, CreateRefund, CreateWebhookEndpoint, CreateModalSession },
} as const;

export const PUBLISHED_LISTS = {
  versions: CLEAR_VERSIONS,
  eventTypes: EVENT_TYPES,
  errorCodes: ERROR_CODE_LIST,
  paymentStatuses: PAYMENT_STATUSES,
  refundStatuses: REFUND_STATUSES,
  modalErrorCodes: MODAL_ERROR_CODES,
} as const;

type Json = { [k: string]: unknown };
export type PublishedShape = {
  responses: Record<string, Json>;
  requests: Record<string, Json>;
  lists: Record<string, readonly string[]>;
};

export function describePublished(): PublishedShape {
  const of = (schemas: Record<string, z.ZodType>, io: 'input' | 'output') =>
    Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, z.toJSONSchema(s, { io, unrepresentable: 'any' }) as Json]));
  return {
    responses: of(PUBLISHED_SCHEMAS.responses, 'output'),
    requests: of(PUBLISHED_SCHEMAS.requests, 'input'),
    lists: { ...PUBLISHED_LISTS },
  };
}

/**
 * Every way `now` breaks what `was` published:
 * - a field, list value, union member or enum value that disappeared;
 * - a type or constant that changed (a field turning nullable counts);
 * - a response field that stopped being required, or a request field that became required.
 */
export function breakingChanges(was: PublishedShape, now: PublishedShape): string[] {
  const out: string[] = [];
  for (const [name, schema] of Object.entries(was.responses)) {
    if (!now.responses[name]) out.push(`${name}: removed`);
    else compare(schema, now.responses[name]!, 'response', name, out);
  }
  for (const [name, schema] of Object.entries(was.requests)) {
    if (!now.requests[name]) out.push(`${name}: removed`);
    else compare(schema, now.requests[name]!, 'request', name, out);
  }
  for (const [name, values] of Object.entries(was.lists)) {
    const current = now.lists[name] ?? [];
    for (const v of values) if (!current.includes(v)) out.push(`${name}: lost ${v}`);
  }
  return out;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);

function compare(was: Json, now: Json, mode: 'response' | 'request', path: string, out: string[]) {
  if ('const' in was && was.const !== now.const) out.push(`${path}: was ${JSON.stringify(was.const)}, now ${JSON.stringify(now.const)}`);
  if ('type' in was && JSON.stringify(was.type) !== JSON.stringify(now.type)) {
    out.push(`${path}: type was ${JSON.stringify(was.type)}, now ${JSON.stringify(now.type ?? 'something else')}`);
  }
  for (const v of arr(was.enum)) if (!arr(now.enum).includes(v)) out.push(`${path}: lost ${JSON.stringify(v)}`);

  const wasProps = obj(was.properties);
  if (wasProps) {
    const nowProps = obj(now.properties) ?? {};
    for (const [key, sub] of Object.entries(wasProps)) {
      if (!(key in nowProps)) out.push(`${path}.${key}: removed`);
      else compare(sub as Json, nowProps[key] as Json, mode, `${path}.${key}`, out);
    }
    const wasRequired = arr(was.required);
    const nowRequired = arr(now.required);
    if (mode === 'response') {
      for (const r of wasRequired) if (!nowRequired.includes(r)) out.push(`${path}.${String(r)}: no longer always present`);
    } else {
      for (const r of nowRequired) if (!wasRequired.includes(r)) out.push(`${path}.${String(r)}: now required`);
    }
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const wasList = arr(was[key]);
    if (!wasList.length) continue;
    const nowList = arr(now[key]);
    if (nowList.length < wasList.length) out.push(`${path}: ${key} lost a member`);
    wasList.forEach((sub, i) => nowList[i] && compare(sub as Json, nowList[i] as Json, mode, `${path}[${i}]`, out));
  }
  const wasItems = obj(was.items);
  if (wasItems) {
    const nowItems = obj(now.items);
    if (!nowItems) out.push(`${path}[]: items removed`);
    else compare(wasItems, nowItems, mode, `${path}[]`, out);
  }
  const wasExtra = obj(was.additionalProperties);
  const nowExtra = obj(now.additionalProperties);
  if (wasExtra && nowExtra) compare(wasExtra, nowExtra, mode, `${path}{}`, out);
}
