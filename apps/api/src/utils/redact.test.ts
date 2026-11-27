import { describe, expect, test } from 'bun:test';
import { redactSensitive, redactError } from './redact.js';

const SSN = '123-45-6789';

describe('identity data does not reach a log or a response', () => {
  test('an SSN in a provider error is scrubbed', () => {
    const out = redactError(new Error(`400 Invalid government_id: ${SSN}`));
    expect(out).not.toContain(SSN);
    expect(out).toContain('[redacted]');
  });

  test('so is a bare one with no key next to it', () => {
    expect(redactSensitive(`applicant ${SSN} rejected`)).not.toContain(SSN);
  });

  test('and a whole request body echoed back by an SDK', () => {
    const body = JSON.stringify({
      first_name: 'Ada',
      dob: '1985-04-12',
      government_id: SSN,
      address: { address1: '1 Test Street' },
    });
    const out = redactSensitive(`Lithic rejected: ${body}`);
    expect(out).not.toContain(SSN);
    expect(out).not.toContain('1985-04-12');
    // The parts that make an error useful survive.
    expect(out).toContain('Ada');
    expect(out).toContain('1 Test Street');
  });

  test('both key conventions, since the SDK uses one and our route the other', () => {
    expect(redactSensitive(`governmentId=${SSN}`)).not.toContain(SSN);
    expect(redactSensitive(`government_id: "${SSN}"`)).not.toContain(SSN);
  });

  test('an ISO timestamp is left alone', () => {
    // tos_timestamp and created_at are in every one of these payloads; redacting them would make
    // the logs useless and buy nothing.
    const line = 'tos_timestamp 2026-08-26T14:00:00.000Z accepted';
    expect(redactSensitive(line)).toContain('2026-08-26T14:00:00.000Z');
  });

  test('a date on its own is not, because here that means a birthday', () => {
    expect(redactSensitive('dob 1985-04-12')).not.toContain('1985-04-12');
  });

  test('properties hung off an Error are searched too, not just its message', () => {
    // JSON.stringify(error) is `{}` — a naive implementation stops working here and looks fine.
    const err = Object.assign(new Error('Request failed'), { requestBody: { government_id: SSN } });
    expect(redactError(err)).not.toContain(SSN);
  });

  test('nested context is redacted rather than silently dropped', () => {
    // The first version used an array replacer, which filters keys at every level: the whole
    // nested object disappeared. Safe, by accident, and useless for debugging — and it meant the
    // redaction was never exercised on the shape a real SDK error actually has.
    const err = Object.assign(new Error('400 Bad Request'), {
      status: 400,
      error: { message: 'invalid government_id', request: { individual: { dob: '1985-04-12', government_id: SSN, first_name: 'Ada' } } },
    });
    const out = redactError(err);
    expect(out).not.toContain(SSN);
    expect(out).not.toContain('1985-04-12');
    // The context that makes it worth logging survives.
    expect(out).toContain('invalid government_id');
    expect(out).toContain('Ada');
    expect(out).toContain('400');
  });

  test('and an unserialisable error still returns something', () => {
    const circular: Record<string, unknown> = { government_id: SSN };
    circular.self = circular;
    expect(() => redactError(circular)).not.toThrow();
    expect(redactError(circular)).not.toContain(SSN);
  });
});
