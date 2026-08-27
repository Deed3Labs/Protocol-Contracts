import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

/*
 * The decision: a member's SSN, date of birth and government id pass through to Lithic and are
 * never kept. These pin the parts of that which are easy to undo by accident.
 */
describe('identity data is passed through, never kept', () => {
  test('the table has no column that could hold any of it', () => {
    const store = read('services/lithic/lithicStore.ts');
    const schema = store.slice(store.indexOf('CREATE TABLE'), store.indexOf('CREATE UNIQUE INDEX'));
    for (const column of ['ssn', 'government', 'dob', 'birth', 'first_name', 'last_name', 'address']) {
      expect(schema.toLowerCase()).not.toContain(column);
    }
    // What it does hold: provider tokens and a status, none of which identify anyone on their own.
    expect(schema).toContain('account_token');
    expect(schema).toContain('status');
  });

  test('nothing persists the request body', () => {
    const route = read('routes/lithic.ts');
    // The body is destructured into the provisioning call and goes nowhere else.
    expect(route).not.toMatch(/upsert\([^)]*body/);
    expect(route).not.toMatch(/INSERT|UPDATE\s+/i);
  });

  test('a provider error never reaches the log or the response unscrubbed', () => {
    const route = read('routes/lithic.ts');
    expect(route).toContain('redactError(error)');
    // The shape that leaked: `error.message` straight into both.
    expect(route).not.toMatch(/error instanceof Error \? error\.message/);
  });

  test('and the catch-all handler scrubs too, since it sees this route as well', () => {
    const index = read('index.ts');
    const handler = index.slice(index.indexOf("console.error('Unhandled error:'"));
    expect(handler.slice(0, 200)).toContain('redactError(err)');
    expect(handler.slice(0, 400)).not.toMatch(/message: process\.env\.NODE_ENV === 'development' \? err\.message/);
  });

  test('the field list the route validates is names only', () => {
    // `missing` is returned to the client on a 400. Names are safe; values would not be.
    const route = read('routes/lithic.ts');
    const missing = route.slice(route.indexOf('const missing'), route.indexOf('const workflow'));
    expect(missing).toMatch(/missing\.push\('[a-zA-Z.]+'\)/);
    expect(missing).not.toMatch(/missing\.push\(body\./);
  });
});
