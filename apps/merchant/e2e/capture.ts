import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { Ref, State } from './states';

export const E2E = path.dirname(new URL(import.meta.url).pathname);
export const REFERENCE_DIR = path.resolve(E2E, '../../../docs/merchant-reference');
/** Captures for the side-by-side report: git-ignored, rebuilt on every run. */
export const REPORT_DIR = path.join(E2E, '.report');

/** 4:41pm on the reference day, when the reference's card walk-in is at the counter. */
export const REFERENCE_NOW = new Date('2026-09-22T16:41:00-07:00');

export const refKey = (ref: Ref) => `${ref.file}__${ref.h2.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}__${ref.i}`;

/** Settle a page: fonts in, requests done, entry transitions finished. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Sheets and modals rise in; Playwright disables CSS animations for the capture itself, but a
  // transition that has not started yet would be caught mid-way.
  await page.waitForTimeout(250);
}

/**
 * Open a state and return what to capture: the page, or the gallery frame.
 *
 * The clock is fixed to the reference moment, so "2 minutes ago" and "today" read the same on
 * every run, and on the reference's day.
 */
export async function openState(page: Page, s: State): Promise<{ target: Page | Locator; errors: string[] }> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(REFERENCE_NOW);
  if (s.gallery) {
    await page.goto('/_gallery');
    await settle(page);
    const item = page.locator('.g-item').filter({ has: page.locator(':scope > p.c-label', { hasText: new RegExp(`^${escape(s.gallery)}$`) }) });
    const frame = item.locator(':scope > .g-frame, :scope > :not(p)').first();
    await frame.scrollIntoViewIfNeeded();
    // So a check can be scoped to this one frame (axe's include takes a selector).
    await frame.evaluate((e) => e.setAttribute('data-under-test', ''));
    return { target: frame, errors };
  }
  await page.goto(s.url!);
  await settle(page);
  for (const name of s.click ?? []) {
    await page.getByRole('button', { name, exact: true }).first().click();
    await settle(page);
  }
  return { target: page, errors };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
