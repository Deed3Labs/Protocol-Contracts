import { describe, expect, test } from 'bun:test';
import { SECTIONS, sectionsFor } from './sections';

describe('Settings’ rail by role', () => {
  test('Developers sits between Shop app and Devices', () => {
    const keys = SECTIONS.map((s) => s.key);
    expect(keys.slice(keys.indexOf('shop-app'), keys.indexOf('shop-app') + 3)).toEqual(['shop-app', 'developers', 'devices']);
  });
  test('an owner sees it, a manager sees it beside Shop app, the counter never', () => {
    expect(sectionsFor('owner', false).map((s) => s.key)).toContain('developers');
    expect(sectionsFor('manager', false).map((s) => s.key)).toEqual(['shop-app', 'developers', 'you']);
    expect(sectionsFor('counter', false).map((s) => s.key)).toEqual(['shop-app', 'you']);
  });
});
