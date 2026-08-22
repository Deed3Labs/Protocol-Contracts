import { describe, expect, test } from 'bun:test';
import {
  generateHandle,
  isValidHandle,
  normalizeHandle,
  rejectHandle,
  suggestHandle,
} from './handles.js';

describe('normalising', () => {
  test('case is not part of a handle', () => {
    // TEXT UNIQUE alone makes @Kai and @kai two members. In a payments app that is not an
    // inconsistency, it is a phishing surface: somebody types what they were told.
    expect(normalizeHandle('@Kai')).toBe(normalizeHandle('kai'));
    expect(normalizeHandle('  @KAI  ')).toBe('kai');
  });

  test('strips the @ people will type', () => {
    expect(normalizeHandle('@@kai')).toBe('kai');
  });
});

describe('what may be claimed', () => {
  test('accepts an ordinary handle', () => {
    expect(isValidHandle('quietriver42')).toBe(true);
  });

  test('refuses handles too short to be distinct or too long to read', () => {
    expect(rejectHandle('ab')).toBe('too_short');
    expect(rejectHandle('a'.repeat(21))).toBe('too_long');
  });

  test('requires a letter first, so a handle never reads as a number', () => {
    expect(rejectHandle('1kai')).toBe('bad_shape');
  });

  test('refuses characters that could impersonate another handle', () => {
    // Dots and dashes let @cle-ar and @cle.ar sit beside @clear.
    expect(rejectHandle('cle-ar')).toBe('bad_shape');
    expect(rejectHandle('cle.ar')).toBe('bad_shape');
  });

  test('reserves the co-op and its support names', () => {
    for (const name of ['clear', 'support', 'security', 'admin']) {
      expect(rejectHandle(name)).toBe('reserved');
    }
  });

  test('reserves the prefixes too, which is the case that actually bites', () => {
    // Somebody told to message @clearsupport who finds @clear_support has been handed to whoever
    // registered it first. Reserving only the exact name would not stop that.
    expect(rejectHandle('clear_support')).toBe('reserved');
    expect(rejectHandle('support_team')).toBe('reserved');
  });

  test('reserves regardless of case, since case is not part of a handle', () => {
    expect(rejectHandle('@Clear')).toBe('reserved');
  });
});

describe('generating one nobody asked for', () => {
  test('produces something claimable', () => {
    for (let i = 0; i < 200; i++) {
      const handle = suggestHandle(Math.random());
      expect(isValidHandle(handle), `${handle} should be valid`).toBe(true);
    }
  });

  test('never derives from anything the member did not choose to publish', () => {
    // Deriving from an email or a legal name publishes it on a field whose whole purpose is to be
    // seen. Two words and digits carry nothing.
    const handle = suggestHandle(0.5);
    expect(handle).not.toContain('@');
    expect(/^[a-z]+[0-9]{2}$/.test(handle)).toBe(true);
  });

  test('keeps trying when the first choices are taken', async () => {
    const taken = new Set<string>();
    let asked = 0;
    const handle = await generateHandle(async (h) => {
      asked++;
      if (asked <= 3) { taken.add(h); return false; }
      return true;
    });
    expect(taken.has(handle)).toBe(false);
    expect(isValidHandle(handle)).toBe(true);
  });

  test('falls back to a longer suffix rather than failing a signup', async () => {
    // A member whose signup stops because two people drew the same random pair would have no idea
    // what happened. A slightly uglier handle is the better failure.
    let asked = 0;
    const handle = await generateHandle(async () => {
      asked++;
      return asked > 8;
    });
    expect(handle.length).toBeLessThanOrEqual(20);
    expect(asked).toBeGreaterThan(8);
  });
});
