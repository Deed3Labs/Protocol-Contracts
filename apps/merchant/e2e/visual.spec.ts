import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { STATES } from './states';
import { openState, REPORT_DIR } from './capture';

/**
 * Every state at the project's size (1180×820, 820×1180, 390×844).
 *
 * Two things come out of each: a regression baseline (`toHaveScreenshot`, kept in __screenshots__,
 * refreshed with `npm run test:visual -- --update-snapshots` when a change is meant), and a copy
 * for the side-by-side report against the reference frame (e2e/report.ts).
 */
for (const s of STATES) {
  test(s.id, async ({ page }, info) => {
    test.skip(!!s.sizes && !s.sizes.includes(info.project.name as never), `drawn for ${s.sizes?.join(' and ')} only`);
    const { target, errors } = await openState(page, s);
    const shot = await target.screenshot({ animations: 'disabled', caret: 'hide' });
    const out = path.join(REPORT_DIR, 'app', info.project.name, `${s.id}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, shot);
    expect(errors, 'no uncaught errors').toEqual([]);
    await expect(target).toHaveScreenshot(`${s.id}.png`);
  });
}
