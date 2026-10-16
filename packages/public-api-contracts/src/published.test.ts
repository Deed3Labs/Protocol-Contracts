import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { breakingChanges, describePublished, type PublishedShape } from './published';
import { CLEAR_VERSIONS } from './versions';

/**
 * Rule 10: the public API only grows. Each published version's shape is kept in `published/`, and
 * the schemas as they are now must still have everything in it. If this fails, put the field back;
 * a real removal takes a new version.
 */
const snapshot = (version: string): PublishedShape =>
  JSON.parse(readFileSync(join(import.meta.dir, 'published', `${version}.json`), 'utf8')) as PublishedShape;

describe('published versions', () => {
  test.each([...CLEAR_VERSIONS])('%s has a snapshot', (version) => {
    expect(existsSync(join(import.meta.dir, 'published', `${version}.json`))).toBe(true);
  });

  test.each([...CLEAR_VERSIONS])('nothing %s published has disappeared', (version) => {
    expect(breakingChanges(snapshot(version), describePublished())).toEqual([]);
  });
});

describe('the check itself', () => {
  const now = describePublished();
  const copy = (): PublishedShape => JSON.parse(JSON.stringify(now));
  const props = (s: PublishedShape, name: string, side: 'responses' | 'requests' = 'responses') =>
    (s[side][name] as { properties: Record<string, unknown> }).properties;

  test('finds a response field that disappeared', () => {
    const later = copy();
    delete props(later, 'Payment').reference;
    expect(breakingChanges(now, later)).toContain('Payment.reference: removed');
  });
  test('finds a field whose type changed, or that turned nullable', () => {
    const later = copy();
    props(later, 'Payment').amount = { type: 'string' };
    props(later, 'Payment').status = { anyOf: [props(now, 'Payment').status, { type: 'null' }] };
    const found = breakingChanges(now, later);
    expect(found.some((f) => f.startsWith('Payment.amount: type'))).toBe(true);
    expect(found.some((f) => f.startsWith('Payment.status'))).toBe(true);
  });
  test('finds a status that is gone', () => {
    const later = copy();
    later.lists.paymentStatuses = later.lists.paymentStatuses!.filter((s) => s !== 'canceled');
    expect(breakingChanges(now, later)).toContain('paymentStatuses: lost canceled');
  });
  test('finds a request field that became required', () => {
    const later = copy();
    const create = later.requests.CreateRefund as { required: string[] };
    create.required = [...create.required, 'reason'];
    expect(breakingChanges(now, later)).toContain('CreateRefund.reason: now required');
  });
  test('lets a new response field, a new optional request field and a new event through', () => {
    const later = copy();
    props(later, 'Payment').receiptUrl = { type: 'string' };
    props(later, 'CreatePayment', 'requests').statementDescriptor = { type: 'string' };
    later.lists.eventTypes = [...later.lists.eventTypes!, 'payment.processing'];
    expect(breakingChanges(now, later)).toEqual([]);
  });
});
