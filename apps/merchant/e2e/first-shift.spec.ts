import { expect, test, type Page } from '@playwright/test';

/**
 * A first shift on the counter tablet: somebody added in Staff has no PIN, so the shift screen
 * offers "Pick a PIN"; they pick four digits, confirm them, and their shift starts.
 *
 * Signing in only shows without the preview's stand-in session, so this stubs the API the tablet
 * talks to (the routes themselves are covered by apps/api's `e2e:staff`, over HTTP on Postgres).
 */

const ANA = { id: 'stf_ana', name: 'Ana Ruiz', role: 'counter', pinSet: false };
const ROSTER = [{ id: 'stf_jen', name: 'Jen R.', role: 'counter', pinSet: true }, ANA];

async function tablet(page: Page, firstPin: (pin: string) => { status: number; body: unknown }) {
  const sent: string[] = [];
  await page.route('**/api/merchant/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/merchant/device') return json(200, { merchant: '0xshop', device: { id: 'dev1', label: 'Counter tablet', idleLockSeconds: 300, enrolledAt: '2026-09-01T00:00:00Z', revokedAt: null } });
    if (url.pathname === '/api/merchant/session' && route.request().method() === 'GET') return json(401, { message: 'no session' });
    if (url.pathname === '/api/merchant/roster') return json(200, { staff: ROSTER });
    if (url.pathname === `/api/merchant/staff/${ANA.id}/first-pin`) {
      const pin = JSON.parse(route.request().postData() ?? '{}').pin as string;
      sent.push(pin);
      const r = firstPin(pin);
      return json(r.status, r.body);
    }
    return json(404, { message: 'not in this test' });
  });
  // An enrolled tablet keeps its device token; the server says what it is.
  await page.addInitScript(() => window.localStorage.setItem('clear.merchant.device', 'dev-token'));
  await page.goto('/');
  return sent;
}

const type = async (page: Page, digits: string) => {
  for (const d of digits) await page.getByRole('dialog').getByRole('button', { name: d, exact: true }).click();
};

test.beforeEach(({}, info) => test.skip(info.project.name !== 'landscape', 'one layout is enough for the flow'));

test('someone with no PIN picks one, confirms it, and their shift starts', async ({ page }) => {
  const sent = await tablet(page, () => ({ status: 200, body: { token: 't', expiresAt: '2026-09-26T00:00:00Z', staff: { id: ANA.id, name: ANA.name, role: 'counter' }, merchant: '0xshop' } }));
  const card = page.locator('.c-si-p', { hasText: 'Ana Ruiz' });
  await expect(card).toContainText('First shift');
  await card.getByRole('button', { name: 'Pick a PIN' }).click();
  await expect(page.getByRole('dialog', { name: 'Pick your PIN' })).toBeVisible();

  // Two different sets of four: it says so and starts again, and nothing is sent.
  await type(page, '5555');
  await type(page, '5556');
  await expect(page.getByRole('alert')).toContainText('didn’t match');
  expect(sent).toEqual([]);

  await type(page, '5555');
  await type(page, '5555');
  await expect.poll(() => sent).toEqual(['5555']);
  await expect(page.getByRole('dialog', { name: 'Pick your PIN' })).toHaveCount(0);
});

test('a PIN somebody else has is refused in the server’s words, and they pick again', async ({ page }) => {
  await tablet(page, () => ({ status: 409, body: { error: 'Taken', message: 'Pick different four digits.' } }));
  await page.locator('.c-si-p', { hasText: 'Ana Ruiz' }).getByRole('button', { name: 'Pick a PIN' }).click();
  await type(page, '4321');
  await type(page, '4321');
  await expect(page.getByRole('alert')).toContainText('Pick different four digits.');
  // Back to the first box, ready for new digits.
  await expect(page.getByRole('dialog', { name: 'Pick your PIN' })).toBeVisible();
});
