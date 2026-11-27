import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS_PAGES, settingsPageOf } from '@/pages/app/settingsPages';
import { SETTINGS } from '@/data/clearPlaceholder';
import { patronageBasis } from '@/lib/clearModel';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', '..', p), 'utf8');
const page = read('pages/app/SettingsPage.tsx');

describe('Acceleration and patronage are Settings pages', () => {
  test('both are routes under Membership, with hyphenated ids resolving', () => {
    expect(settingsPageOf('/settings/acceleration')).toBe('acceleration');
    expect(settingsPageOf('/settings/patronage-calculation')).toBe('patronage-calculation');
    expect(SETTINGS_PAGES.acceleration.up).toBe('/settings/membership');
    expect(SETTINGS_PAGES['patronage-calculation'].title).toBe('How patronage is calculated');
    expect(SETTINGS_PAGES['patronage-calculation'].up).toBe('/settings/patronage');
  });

  test('acceleration is a page, not the old dialog', () => {
    expect(page).not.toContain('AccelerationDialog');
    expect(page).toContain("onSelect={() => go('acceleration')}");
  });

  test('"How patronage is calculated" stays in Settings instead of the explainer', () => {
    expect(page).toContain("onExplain={() => go('patronage-calculation')}");
    expect(page).not.toContain("navigate('/learn/patronage')");
  });

  test('the old patronage explainer is gone, and its link lands on the Settings page', () => {
    const explainer = read('pages/app/ExplainerPage.tsx');
    expect(explainer).not.toContain('PatronageExplainer');
    expect(explainer).toContain("if (topic === 'patronage') return <Navigate to=\"/settings/patronage-calculation\" replace />;");
    expect(read('components/shell/AppChrome.tsx')).not.toContain("'/learn/patronage'");
  });
});

describe('the figures agree with each other', () => {
  test('the free route is what is left of the cycles', () => {
    const { cleared, needed } = SETTINGS.accelerationCycles;
    expect(needed - cleared).toBe(4);
  });

  test('the basis is the sum of what counts', () => {
    expect(patronageBasis(SETTINGS.patronage.basisRows)).toBeCloseTo(385.4, 2);
  });

  test('acceleration cannot be switched on until it can be bought', () => {
    const panel = read('components/settings/AccelerationPanel.tsx');
    expect(panel).toContain('disabled={!onTurnOn || data.accelerationActive}');
    expect(page).toContain('<AccelerationPanel data={data} intro={!desktop} />');
  });
});
