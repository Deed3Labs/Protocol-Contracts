import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const job = readFileSync(new URL('./snapshotRefresher.ts', import.meta.url), 'utf8');
const store = readFileSync(
  new URL('../services/lithic/cardStore.ts', import.meta.url),
  'utf8',
);
const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

/*
 * The snapshot is the only thing the authorization path reads, and it fails closed on what it finds.
 * A stale one is not a cosmetic problem: it is a member declined at a till for money they have.
 */
describe('the scheduled refresh exists and is wired up', () => {
  test('the server actually starts it', () => {
    // The comments in snapshotService referred to "the scheduled refresh" and "the hourly job" as
    // the backstop for months. Nothing started one, so there was no backstop.
    expect(index).toContain('startSnapshotRefresher');
    expect(job).toContain('export async function startSnapshotRefresher');
  });

  test('it runs once at boot rather than waiting out the first interval', () => {
    // A deploy is itself a moment when snapshots may be stale, and waiting is a window of declines.
    expect(job).toMatch(/void tick\(\);\s*\n\s*console\.log/);
  });

  test('a pass cannot overlap itself', () => {
    // Each wallet costs chain reads and a Lithic call; two passes racing doubles that for no new
    // answer.
    expect(job).toContain('if (running) return 0');
    expect(job).toMatch(/finally\s*\{\s*running = false/);
  });
});

describe('which members get refreshed', () => {
  test('it keys off cards, not existing snapshots', () => {
    /*
     * A card whose snapshot row was never written is the one that most needs this: the auth stream
     * fails closed, so its very first charge declines. Listing snapshots would skip exactly that
     * card.
     */
    expect(job).toContain('walletsWithCards');
    expect(store).toContain('SELECT DISTINCT wallet');
  });

  test('closed cards are left out', () => {
    expect(store).toContain("state <> 'CLOSED'");
  });
});
