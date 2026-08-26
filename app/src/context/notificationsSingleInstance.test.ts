import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '_archive' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  text: readFileSync(path, 'utf8'),
}));

/*
 * Why this is worth a test at all.
 *
 * `useNotificationsState` holds rows, an optimistic `readIds` ref and a WebSocket. A hook is not
 * shared state, so every extra caller is a second, silently divergent copy. Three surfaces called
 * it — the bell, the inbox page, the shell badge — and marking a row read in one left the others
 * showing it unread until their own 20-second poll. Clicking twice "worked" because the second
 * click landed on the copy being looked at.
 *
 * Nothing about that is visible in a type error or a render. The only durable guard is the count
 * of callers, so that is what this asserts.
 */
describe('notifications have exactly one state', () => {
  test('only the provider calls the stateful hook', () => {
    // Skip the file that declares it — `function useNotificationsState(` is a definition, not a call.
    const callers = FILES.filter(
      (f) => f.path !== 'hooks/useNotifications.ts' && /(?<!function )useNotificationsState\s*\(/.test(f.text),
    ).map((f) => f.path);
    expect(callers).toEqual(['context/ClearNotificationsContext.tsx']);
  });

  test('and only the provider imports it', () => {
    const importers = FILES.filter((f) => /import[^;]*useNotificationsState[^;]*from/.test(f.text)).map((f) => f.path);
    expect(importers).toEqual(['context/ClearNotificationsContext.tsx']);
  });

  test('every surface reads the shared context instead', () => {
    for (const path of [
      'components/app-ui/NotificationsMenu.tsx',
      'pages/app/InboxRoute.tsx',
      'components/shell/AppShell.tsx',
    ]) {
      const file = FILES.find((f) => f.path === path)!;
      expect(file.text).toContain("from '@/context/ClearNotificationsContext'");
      expect(file.text).not.toContain("useNotifications } from '@/hooks/useNotifications'");
    }
  });

  test('the provider is mounted, or every consumer throws', () => {
    const app = FILES.find((f) => f.path === 'App.tsx')!;
    expect(app.text).toContain('<ClearNotificationsProvider>');
    expect(app.text).toContain('</ClearNotificationsProvider>');
  });

  test('missing the provider fails loudly rather than handing back a second copy', () => {
    // A null-object fallback here would restore the exact bug, quietly.
    const ctx = FILES.find((f) => f.path === 'context/ClearNotificationsContext.tsx')!;
    expect(ctx.text).toContain('throw new Error');
  });

  test('the unread count is derived from the rows, not tracked alongside them', () => {
    const hook = FILES.find((f) => f.path === 'hooks/useNotifications.ts')!;
    // Four hand-maintained adjustments were four chances to disagree with the list. One of them
    // did: `notification:new` incremented even when the row was already present.
    expect(hook.text).not.toContain('setUnreadCount');
    expect(hook.text).toMatch(/const unreadCount = notifications\.reduce/);
  });
});
