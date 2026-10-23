import { expect, test, type Page } from '@playwright/test';
import { APP, PROTO } from '../playwright.config';
import { canonical, open } from './pages';

/**
 * Sign-in, every state, against the prototype: the start, a bad email, the passkey wait, the code
 * boxes (typing, paste, backspace), checking the code, the investor's terms and the welcome.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== 'wide', 'sign-in parity runs at one width'));

async function both(steps: (p: Page) => Promise<void>, browser: import('@playwright/test').Browser) {
  const proto = await browser.newPage();
  const app = await browser.newPage();
  await open(proto, PROTO, 'login');
  await open(app, APP, 'login');
  await steps(proto);
  await steps(app);
  return { proto, app };
}

const cases: Record<string, (p: Page) => Promise<void>> = {
  start: async () => {},
  'bad email': async (p) => {
    await p.fill('#sgnEmail', 'not-an-email');
    await p.click('#sgnForm button[type=submit]');
  },
  passkey: async (p) => {
    await p.click('[data-sgn="passkey"]');
  },
  'code boxes': async (p) => {
    await p.fill('#sgnEmail', 'marcus@useclear.org');
    await p.click('#sgnForm button[type=submit]');
  },
  'code typed, then a backspace': async (p) => {
    await p.fill('#sgnEmail', 'marcus@useclear.org');
    await p.click('#sgnForm button[type=submit]');
    await p.keyboard.type('123');
    await p.keyboard.press('Backspace');
  },
  'checking the code': async (p) => {
    await p.fill('#sgnEmail', 'someone@example.com');
    await p.click('#sgnForm button[type=submit]');
    await p.keyboard.type('123456');
  },
  'investor terms': async (p) => {
    await p.fill('#sgnEmail', 'lena@harborcap.com');
    await p.click('#sgnForm button[type=submit]');
    await p.keyboard.type('123456');
    await p.waitForSelector('[data-sgn="terms-ok"]');
  },
};

for (const [name, steps] of Object.entries(cases)) {
  test(`sign-in matches the prototype: ${name}`, async ({ browser }) => {
    const { proto, app } = await both(steps, browser);
    expect(await canonical(app, '#loginRoot')).toBe(await canonical(proto, '#loginRoot'));
    const values = (p: Page) => p.$$eval('#sgnCode input', (ins) => ins.map((i) => (i as HTMLInputElement).value).join(''));
    expect(await values(app)).toBe(await values(proto));
  });
}

test('sign-in lands on the same page with the same view', async ({ browser }) => {
  const { proto, app } = await both(async (p) => {
    await p.fill('#sgnEmail', 'someone@example.com');
    await p.click('#sgnForm button[type=submit]');
    await p.keyboard.type('123456');
    await p.waitForSelector('body:not(.signed-out)', { timeout: 10_000 });
  }, browser);
  for (const sel of ['#railNav', '#main', '.who']) expect(await canonical(app, sel), sel).toBe(await canonical(proto, sel));
});
