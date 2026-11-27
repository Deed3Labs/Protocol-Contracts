import { beforeEach, describe, expect, test } from 'bun:test';
import { captureInvite, storedInvite } from './invite';

/* An invite link's code is kept on the device until onboarding sends it back (Command Center, Phase 7b). */

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});

describe('an invite link', () => {
  test('keeps its code, whatever its case, until the invite closes after 90 days', () => {
    captureInvite('?invite=abcde-23456&utm=x');
    expect(storedInvite()).toBe('ABCDE-23456');
    expect(storedInvite(Date.now() + 91 * 24 * 3600e3)).toBe('');
  });

  test('a page without one, or with something that isn’t a code, keeps what was there', () => {
    captureInvite('?invite=ABCDE-23456');
    captureInvite('?as=member');
    captureInvite('?invite=<script>');
    expect(storedInvite()).toBe('ABCDE-23456');
  });

  test('no storage: no code, and no error', () => {
    (globalThis as any).localStorage = { getItem: () => { throw new Error('off'); }, setItem: () => { throw new Error('off'); } };
    captureInvite('?invite=ABCDE-23456');
    expect(storedInvite()).toBe('');
  });
});
