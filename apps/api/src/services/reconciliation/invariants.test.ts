import { describe, expect, test } from 'bun:test';
import { buildReport, compare, compareAtLeast, TOLERANCE_CENTS } from './invariants.js';

/*
 * The four invariants — spec §3. What is tested here is the judgement: when two figures count as
 * agreeing, and what happens when one of them cannot be read at all.
 */

describe('comparing two figures', () => {
  test('equal figures hold', () => {
    expect(compare('k', 'L', 500_000, 500_000, '').status).toBe('ok');
  });

  test('a real difference is drift, not noise', () => {
    const result = compare('k', 'L', 500_000, 499_000, '');
    expect(result.status).toBe('drift');
    expect(result.driftCents).toBe(-1_000);
  });

  test('drift is signed so the direction is readable', () => {
    // Surplus and shortfall are different problems and the sign is how you tell them apart.
    expect(compare('k', 'L', 100, 150, '').driftCents).toBe(50);
    expect(compare('k', 'L', 150, 100, '').driftCents).toBe(-50);
  });

  test('the tolerance is a cent, not a slack budget', () => {
    expect(TOLERANCE_CENTS).toBe(1);
    expect(compare('k', 'L', 1000, 1001, '').status).toBe('ok');
    expect(compare('k', 'L', 1000, 1002, '').status).toBe('drift');
  });
});

describe('a figure that could not be read', () => {
  test('an unreadable actual is unavailable, never ok', () => {
    // The failure this prevents: a reconciler that reads nothing and reports health.
    expect(compare('k', 'L', 500_000, null, '').status).toBe('unavailable');
  });

  test('an unreadable expectation is unavailable too', () => {
    expect(compare('k', 'L', null, 500_000, '').status).toBe('unavailable');
  });

  test('unavailable carries no drift figure', () => {
    // Reporting a drift of zero would read as agreement between numbers never compared.
    expect(compare('k', 'L', null, null, '').driftCents).toBeNull();
  });
});

describe('float adequacy is an inequality', () => {
  test('a float larger than what was drawn is healthy, not drift', () => {
    // Equality would be the wrong test — surplus float is the desired state.
    expect(compareAtLeast('k', 'L', 100_000, 250_000, '').status).toBe('ok');
  });

  test('exactly covering is fine', () => {
    expect(compareAtLeast('k', 'L', 100_000, 100_000, '').status).toBe('ok');
  });

  test('a shortfall is drift', () => {
    // The co-op has lent savings-backed credit it cannot currently settle.
    const result = compareAtLeast('k', 'L', 100_000, 90_000, '');
    expect(result.status).toBe('drift');
    expect(result.driftCents).toBe(-10_000);
  });

  test('an unknown float is unavailable rather than assumed sufficient', () => {
    expect(compareAtLeast('k', 'L', 100_000, null, '').status).toBe('unavailable');
  });
});

describe('the report', () => {
  const at = '2026-08-16T00:00:00.000Z';

  test('all four holding is healthy', () => {
    const results = [1, 2, 3, 4].map((n) => compare(`k${n}`, 'L', 100, 100, ''));
    expect(buildReport(results, at).healthy).toBe(true);
  });

  test('any drift makes it unhealthy', () => {
    const results = [compare('a', 'L', 100, 100, ''), compare('b', 'L', 100, 200, '')];
    const report = buildReport(results, at);
    expect(report.healthy).toBe(false);
    expect(report.driftCount).toBe(1);
  });

  test('a run that could not check everything is NOT a clean bill of health', () => {
    // The most dangerous thing this module could do is call a half-blind run healthy.
    const results = [compare('a', 'L', 100, 100, ''), compare('b', 'L', 100, null, '')];
    const report = buildReport(results, at);
    expect(report.healthy).toBe(false);
    expect(report.unavailableCount).toBe(1);
    expect(report.driftCount).toBe(0);
  });

  test('drift and unavailable are counted separately', () => {
    // They need different responses: one is a bug to chase, the other a gap to close.
    const results = [
      compare('a', 'L', 100, 200, ''),
      compare('b', 'L', 100, null, ''),
      compare('c', 'L', 100, 100, ''),
    ];
    const report = buildReport(results, at);
    expect(report.driftCount).toBe(1);
    expect(report.unavailableCount).toBe(1);
  });
});
