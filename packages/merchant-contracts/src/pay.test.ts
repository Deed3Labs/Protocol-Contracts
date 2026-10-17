import { describe, expect, test } from 'bun:test';
import { allowedOrigin, CreatePaymentLink, JoinBasics, Order, pasteInPrompt, siteLabel, sourceHasStaff, TEST_MEMBER } from './index';

describe('Add a site', () => {
  test('a bare host is https, and the path is dropped', () => {
    expect(allowedOrigin('micasatacos.com')).toEqual({ ok: true, origin: 'https://micasatacos.com', testOnly: false });
    expect(allowedOrigin('https://Order.MiCasaTacos.com/catering/checkout?x=1')).toEqual({ ok: true, origin: 'https://order.micasatacos.com', testOnly: false });
  });
  test('http only for localhost, and localhost is test only', () => {
    expect(allowedOrigin('http://localhost:3000')).toEqual({ ok: true, origin: 'http://localhost:3000', testOnly: true });
    expect(allowedOrigin('http://micasatacos.com')).toMatchObject({ ok: false });
  });
  test('no wildcards, IP addresses, other schemes or single words', () => {
    for (const bad of ['*.micasatacos.com', 'https://203.0.113.7', 'ftp://micasatacos.com', 'intranet', 'https://user:pw@micasatacos.com', '']) {
      expect(allowedOrigin(bad).ok).toBe(false);
    }
  });
  test('Developers lists the host', () => {
    expect(siteLabel('https://order.micasatacos.com')).toBe('order.micasatacos.com');
    expect(siteLabel('http://localhost:3000')).toBe('http://localhost:3000');
  });
});

describe('the paste-in prompt', () => {
  test("is the spec's, with the shop's key", () => {
    expect(pasteInPrompt('clear_pk_live_mc8Q2v')).toBe(
      'Add Pay with Clear to this site.\nRead https://useclear.org/llms.txt first.\nUse publishable key clear_pk_live_mc8Q2v.\n' +
        'Attach it to the existing checkout button; do not add a new button.\nNever put the amount in the browser: create the payment on the server\n' +
        'with CLEAR_SECRET_KEY from the environment, and fulfil orders from the\npayment.succeeded webhook, not from the page.',
    );
  });
});

describe('Send a link', () => {
  test("§5's link: the taco tray, a note, 7 days, over time allowed", () => {
    expect(
      CreatePaymentLink.safeParse({ for: 'item', itemId: 'itm_tray12', quantity: 1, note: 'Saturday pickup, 11:30am', expires: '7d', allowOverTime: true }).success,
    ).toBe(true);
  });
  test('an amount under $0.50 is refused', () => {
    expect(CreatePaymentLink.safeParse({ for: 'amount', amountCents: 49, note: null, expires: 'never', allowOverTime: false }).success).toBe(false);
  });
});

describe('orders without staff', () => {
  const base = {
    id: 'ord_1', shop: '0xshop', number: null, name: null, customer: null, status: 'open', lines: [], discount: null,
    subtotalCents: 14900, discountCents: 0, taxCents: 1248, totalCents: 16148, taxIncluded: false, taxSource: 'address_rate',
    tipCents: 0, remainingCents: 16148, businessDate: '2026-10-16', createdAt: '2026-10-16T17:40:00Z',
  };
  test('a link order has no one who raised it', () => {
    expect(Order.parse({ ...base, raisedBy: null, source: 'link', sourceDetail: 'micasa-tray12', livemode: true }).raisedBy).toBeNull();
  });
  test('only online and link orders may go without', () => {
    expect(['counter', 'point', 'phone', 'online', 'link'].map((s) => sourceHasStaff(s as never))).toEqual([true, true, true, false, false]);
  });
  test('an older response, with no source, still parses', () => {
    expect(Order.safeParse({ ...base, raisedBy: 'stf_ana' }).success).toBe(true);
  });
});

describe('joining in the modal', () => {
  test("step 1 is Marco's basics and nothing more", () => {
    const marco = { legalName: 'Marco Alvarez', dateOfBirth: '1991-04-12', zip: '91762', street: '418 W 6th St, Ontario, CA' };
    expect(JoinBasics.parse(marco)).toEqual(marco);
    expect(JoinBasics.parse({ ...marco, ssn: '123-45-6789' })).not.toHaveProperty('ssn');
  });
  test('the test member', () => {
    expect(TEST_MEMBER).toEqual({ phone: '(555) 010-0100', e164: '+15550100100', code: '000000' });
  });
});
