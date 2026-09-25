import QRCode from 'qrcode';
import { expect, test, type Page } from '@playwright/test';
import { REFERENCE_NOW, settle } from './capture';

/**
 * New charge on a live shop (the mock), as Jen: a Clear charge sent to a member by scanning their
 * own code, or texted to a number; a custom tip; and the line that says the tablet is offline.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one walk-through is enough'));

const WALLET = '0x9f2c4e6a8b0d1f3e5a7c9b1d3f5e7a9c1b3d5f70';

/** The tablet's camera, showing `dataUrl` (a QR code) instead of the room. */
async function fakeCamera(page: Page, dataUrl: string) {
  await page.addInitScript((src) => {
    const img = new Image();
    img.src = src;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 640, 480);
      if (img.complete) ctx.drawImage(img, 170, 90, 300, 300);
      requestAnimationFrame(draw);
    };
    draw();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => canvas.captureStream(15) }, configurable: true });
  }, dataUrl);
}

async function toClearCode(page: Page) {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/new?preview=1&live=1&as=jen');
  await settle(page);
  for (const d of '120') await page.getByRole('button', { name: d, exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: /^Clear/ }).first().click();
  await page.getByRole('button', { name: 'No tip' }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByRole('link', { name: 'Scan their code instead' })).toBeVisible();
}

test('send the charge to a number', async ({ page }) => {
  await toClearCode(page);
  await page.getByRole('link', { name: 'Enter phone number' }).click();
  for (const d of '9095550177') await page.getByRole('button', { name: d, exact: true }).first().click();
  await page.getByRole('button', { name: 'Send the charge' }).click();
  // Waiting on them, with where it went.
  await expect(page.getByText('Sent to (909) 555-0177')).toBeVisible();
  await expect(page.getByText('By text')).toBeVisible();
  await expect(page.getByText(/Text\s*Sent/)).toBeVisible();
});

test('scan a member’s own code: the charge goes to their app', async ({ page }) => {
  await fakeCamera(page, await QRCode.toDataURL(`https://app.useclear.org/send?to=${WALLET}`, { margin: 2, width: 300 }));
  await toClearCode(page);
  await page.getByRole('link', { name: 'Scan their code instead' }).click();
  await expect(page.getByText('Sent to their Clear app')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('In their Clear app')).toBeVisible();
});

test('a code that isn’t a member’s says so, and waits for the right one', async ({ page }) => {
  await fakeCamera(page, await QRCode.toDataURL('WIFI:S:MikesTire;T:WPA;P:tires123;;', { margin: 2, width: 300 }));
  await toClearCode(page);
  await page.getByRole('link', { name: 'Scan their code instead' }).click();
  await expect(page.getByRole('alert')).toContainText('isn’t a member’s Clear code', { timeout: 15_000 });
});

test('a custom tip', async ({ page }) => {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/new?preview=1&live=1&as=jen');
  await settle(page);
  for (const d of '50') await page.getByRole('button', { name: d, exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  await page.getByRole('button', { name: /^Cash/ }).first().click();
  await page.getByRole('radio', { name: 'Custom' }).click();
  const cont = page.getByRole('button', { name: /^Continue/ });
  await expect(cont).toBeDisabled();
  await page.getByRole('textbox', { name: 'Tip amount' }).fill('7.25');
  await expect(page.getByText('With a $7.25 tip')).toBeVisible();
  await expect(cont).toBeEnabled();
  await expect(cont).toContainText('$57.25');
});

test('offline: a line says cash still works', async ({ page, context }) => {
  await page.clock.setFixedTime(REFERENCE_NOW);
  await page.goto('/new?preview=1&live=1&as=jen');
  await settle(page);
  await expect(page.getByText('No connection')).toHaveCount(0);
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: 'No connection' })).toContainText('Cash still works');
  await context.setOffline(false);
  await expect(page.getByText('No connection')).toHaveCount(0);
});
