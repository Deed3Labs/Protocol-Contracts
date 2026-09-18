import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS_PAGES, settingsPageOf } from '@/pages/app/settingsPages';
import { DISPUTE_KINDS } from '@/data/clearPlaceholder';

const read = (p: string) => readFileSync(join(import.meta.dirname, '..', '..', p), 'utf8');
const page = read('pages/app/SettingsPage.tsx');
const route = read('pages/app/SettingsRoute.tsx');
const dialog = read('components/settings/RaiseDisputeDialog.tsx');

describe('Dispute resolution is a Settings page under Help', () => {
  test('routed, titled, and up goes to Help', () => {
    expect(settingsPageOf('/settings/disputes')).toBe('disputes');
    expect(SETTINGS_PAGES.disputes).toEqual({ title: 'Dispute resolution', rail: 'help', up: '/settings/help' });
    expect(page).toContain("onDispute={() => go('disputes')}");
  });

  test('the old explainer is gone and its link lands on the page', () => {
    const explainer = read('pages/app/ExplainerPage.tsx');
    expect(explainer).not.toContain('DisputesExplainer');
    expect(explainer).toContain('<Navigate to="/settings/disputes" replace />');
  });
});

describe('who decides changes with what went wrong', () => {
  test('three kinds, and two of them are not Clear', () => {
    expect(DISPUTE_KINDS.map((k) => k.kind)).toEqual(['card', 'partner', 'member']);
    expect(DISPUTE_KINDS.filter((k) => !/Clear mediates/.test(k.whoDecides))).toHaveLength(2);
  });
});

describe('filing is real, and never pretends', () => {
  test('the live route files through the API; the harness files nothing', () => {
    expect(route).toContain('fileDispute(input)');
    expect(route).toContain('getDisputeCandidates(include)');
    expect(page).toContain("error: 'Sign in to file a dispute — nothing was sent.'");
  });

  test('a card dispute needs a reason before it can be filed', () => {
    expect(dialog).toContain("(kind !== 'card' || reason)");
  });

  test('a card dispute the network refused is not reported as filed with Visa', () => {
    expect(dialog).toContain('the card network did not accept it yet');
  });
});

describe('"Something wrong" on a transaction leads to disputes', () => {
  const dialog = read('components/clear/TransactionDetailDialog.tsx');

  test('one full-width button, and Split is hidden for now', () => {
    expect(dialog).toMatch(/<Btn lg onClick=\{somethingWrong\}>\s*Something wrong\s*<\/Btn>/);
    expect(dialog).not.toContain('>Split this<');
  });

  test('it carries the payment when the disputes API can name it', () => {
    expect(dialog).toContain("navigate('/settings/disputes', row.dispute ? { state: { dispute: row.dispute } } : undefined)");
    // Card charges are named by Lithic's transaction token; a reversed one has nothing to dispute.
    const mapping = read('lib/activityMapping.ts');
    expect(mapping).toContain("...(tx.reversed ? {} : { dispute: { kind: 'card' as const, ref: tx.id } })");
  });

  test('the disputes page opens Raise a dispute with that payment chosen', () => {
    expect(page).toContain('useState(() => Boolean(arrivedWith))');
    expect(page).toContain('disputes?.load(arrivedWith)');
    const raise = read('components/settings/RaiseDisputeDialog.tsx');
    expect(raise).toContain('picked && picked.kind === kind ? picked');
    expect(raise).toContain('if (picked) setKind(picked.kind);');
  });
});

describe('a dispute can be withdrawn, and says where it stands', () => {
  const panel = read('components/settings/DisputesPanel.tsx');

  test('the member sees their own disputes, and can withdraw an open one with a second tap', () => {
    expect(panel).toContain('label="Your disputes"');
    expect(panel).toContain("confirming === d.token ? 'Confirm withdraw' : 'Withdraw'");
    expect(route).toContain('withdrawMyDispute(token)');
  });

  test('a send already claimed is not claimed to be held', () => {
    expect(panel).toContain("'Open · already claimed, so not held'");
    expect(DISPUTE_KINDS.find((k) => k.kind === 'member')?.heldLine).toBe('Held if not yet claimed');
    expect(dialog).toContain('<span>{info.heldLine}</span>');
  });
});
