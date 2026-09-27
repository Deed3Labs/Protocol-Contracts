import { afterEach, describe, expect, test } from 'bun:test';
import { memberAppUrl } from './memberAppUrl';

const saved = { APP_PUBLIC_URL: process.env.APP_PUBLIC_URL, APP_ORIGIN: process.env.APP_ORIGIN };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

describe('where a member’s links point', () => {
  test('dev: APP_ORIGIN is the demo, and links follow it', () => {
    delete process.env.APP_PUBLIC_URL;
    process.env.APP_ORIGIN = 'https://demo.useclear.org/';
    expect(memberAppUrl()).toBe('https://demo.useclear.org');
  });
  test('APP_PUBLIC_URL wins when it’s set', () => {
    process.env.APP_PUBLIC_URL = 'https://links.example ';
    process.env.APP_ORIGIN = 'https://demo.useclear.org';
    expect(memberAppUrl()).toBe('https://links.example');
  });
  test('neither: the live app', () => {
    delete process.env.APP_PUBLIC_URL;
    delete process.env.APP_ORIGIN;
    expect(memberAppUrl()).toBe('https://app.useclear.org');
  });
});
