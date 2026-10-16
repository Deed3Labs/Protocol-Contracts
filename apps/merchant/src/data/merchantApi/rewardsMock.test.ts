import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from './mock';

/**
 * Rewards in the mock, as sections 8 and 9 draw them: Mi Casa's Shop app, and Sofia added at the
 * cart at 7:46pm on Thursday, October 15. The figures are the server's (rewards DECISIONS › Figures).
 */
const NOW = '2026-10-16T02:46:00.000Z';
const miCasa = (as = 'stf_jen') => {
  const m = createMockMerchantApi({ shop: 'micasa', delayMs: 0, now: () => NOW });
  m.controls.setViewer(as);
  return m;
};
const table6 = [
  { itemId: 'itm_pastor', quantity: 2, optionIds: [] },
  { itemId: 'itm_horchata', quantity: 1, optionIds: [] },
  { itemId: 'itm_jamaica', quantity: 1, optionIds: [] },
];

describe('section 9: Sofia at the cart', () => {
  test('$16.00 of food is $17.33; her code adds her; the agua fresca makes it $13.55 and earns 12', async () => {
    const { api, controls } = miCasa();
    const o = await api.createOrder({ lines: table6, customer: null });
    expect([o.taxCents, o.totalCents]).toEqual([133, 1733]);
    expect(await api.orderCustomer(o.id)).toEqual({ status: 'none' });

    const added = await api.addCustomer(o.id, { via: 'code', code: controls.rewards.codeFor('sofia')! });
    if (added.status !== 'added') throw new Error('not added');
    expect(added.customer).toMatchObject({ firstName: 'Sofia', lastInitial: 'M', isClearMember: true, canPayWithClear: true, lastVisit: { table: 'Table 6' } });
    expect(added.customer.membership!.points).toBe(128);
    expect(added.customer.membership!.readyRewards[0]).toMatchObject({ name: 'Free agua fresca', cost: 75, amountCents: 350, matches: { label: '1 × Jamaica' }, locked: false });
    expect(added.customer.membership!.nextReward).toMatchObject({ name: 'Free churros', toGo: 22 });
    expect(added.earnsPoints).toBe(16);
    // Never a balance: the view is strict.
    expect(Object.keys(added.customer).sort()).toEqual(['canPayWithClear', 'firstName', 'isClearMember', 'lastInitial', 'lastVisit', 'membership']);

    const withReward = await api.applyDiscount(o.id, { kind: 'reward', rewardId: 'rwd_agua' });
    expect(withReward).toMatchObject({ discountCents: 350, taxCents: 105, totalCents: 1355, discount: { kind: 'reward', label: 'Free agua fresca', rewardId: 'rwd_agua', points: 75 }, member: { memberId: 'rwp_sofia', addedVia: 'code', addedBy: 'stf_jen' } });
    expect((await api.orderCustomer(o.id)) as { earnsPoints: number }).toMatchObject({ earnsPoints: 12 });
    await expect(api.removeCustomer(o.id)).rejects.toThrow('Undo their reward first');

    // Clear goes straight to her, with nothing to scan.
    const t = await api.createClearTender(o.id, { amountCents: 1355, tipCents: 0, idempotencyKey: 'k-t6' });
    expect(await api.sendClearCharge(t.id, { to: 'customer' })).toEqual({ to: 'customer', label: 'their Clear app, text and email' });
  });

  test('paid, the reward’s points come off and what it earned goes on: 128 − 75 + 12 = 65', async () => {
    const { api, controls } = miCasa();
    const o = await api.createOrder({ lines: table6, customer: null });
    controls.rewards.add(o.id, 'sofia');
    await api.applyDiscount(o.id, { kind: 'reward', rewardId: 'rwd_agua' });
    await api.createCashTender(o.id, { amountCents: 1355, tipCents: 0, handedOverCents: 2000, idempotencyKey: 'k-cash' });
    const next = await api.createOrder({ lines: table6, customer: null });
    controls.rewards.add(next.id, 'sofia');
    expect(await api.orderCustomer(next.id)).toMatchObject({ customer: { membership: { points: 65 } } });
  });

  test('an item reward follows the cart, and a code takes its place rather than stacking', async () => {
    const { api, controls } = miCasa();
    const o = await api.createOrder({ lines: table6, customer: null });
    controls.rewards.add(o.id, 'sofia');
    await api.applyDiscount(o.id, { kind: 'reward', rewardId: 'rwd_agua' });
    const noJamaica = await api.updateOrder(o.id, { lines: table6.slice(0, 2) });
    expect(noJamaica.discountCents).toBe(350);
    const coded = await api.applyDiscount(o.id, { kind: 'code', code: 'STAFF20' });
    expect(coded.discount).toMatchObject({ kind: 'code' });
    await api.removeCustomer(o.id);
    expect(await api.orderCustomer(o.id)).toEqual({ status: 'none' });
  });

  test('Dev L. is a Clear member who hasn’t joined: no points, and Ask them to join', async () => {
    const { api, controls } = miCasa();
    const o = await api.createOrder({ lines: table6, customer: null });
    const s = await api.addCustomer(o.id, { via: 'code', code: controls.rewards.codeFor('dev')! });
    expect(s).toMatchObject({ status: 'added', customer: { firstName: 'Dev', isClearMember: true, membership: null, lastVisit: null }, earnsPoints: null });
    await expect(api.applyDiscount(o.id, { kind: 'reward', rewardId: 'rwd_agua' })).rejects.toThrow('haven’t joined');
    expect(await api.inviteCustomer(o.id)).toEqual({ sentAt: NOW });
  });

  test('a bare wallet adds nobody; a number waits on their phone, whoever it is', async () => {
    const { api } = miCasa();
    const o = await api.createOrder({ lines: table6, customer: null });
    await expect(api.addCustomer(o.id, { via: 'code', code: '0x50f1a00000000000000000000000000000000142' })).rejects.toThrow('open the code again');
    expect(await api.addCustomer(o.id, { via: 'phone', phone: '(909) 555-0123' })).toMatchObject({ status: 'pending' });
    expect(await api.orderCustomer(o.id)).toMatchObject({ status: 'pending' });
  });

  test('Marco has points but no Clear: the Clear-members reward is shown locked', async () => {
    const { api, controls } = miCasa();
    const o = await api.createOrder({ lines: table6, customer: null });
    controls.rewards.add(o.id, 'marco');
    const s = await api.orderCustomer(o.id);
    expect(s).toMatchObject({ status: 'added', customer: { isClearMember: false, canPayWithClear: false, membership: { points: 42, readyRewards: [] } } });
  });
});

describe('section 8: Settings › Shop app', () => {
  test('as drawn: the link, the members, Off for Clear, and gives back 3.3–4.7%', async () => {
    const { api } = miCasa('stf_mike');
    const s = await api.shopApp();
    expect(s).toMatchObject({ link: 'useclear.org/s/micasa', members: { joined: 214, thisWeek: 38, withClear: 61 }, canEdit: true, rules: { unit: 'dollars', pointsPer: 1, perAmountCents: 100, keepTheChange: true, clearMultiplier: 1, joinBonus: 25, expiry: 'never' } });
    expect(s.rewards.map((r) => [r.name, r.cost])).toEqual([
      ['Free agua fresca', 75],
      ['Free churros', 150],
      ['Free taco plate', 300],
      ['Family tray, $20 off', 600],
    ]);
    expect(s.giveBack).toMatchObject({ low: 3.3, high: 4.7, lowWithClear: null, highWithClear: null });
    expect(s.app.offerCodeIds).toEqual(['dsc_tacotue', 'dsc_tray10']);
    expect(s.fonts.map((f) => f.name)).toEqual(['Casa Display']);
  });

  test('the counter sees it and can’t change it; an offer switch moves it in or out of the app', async () => {
    const jen = miCasa('stf_jen').api;
    expect((await jen.shopApp()).canEdit).toBe(false);
    await expect(jen.updateShopApp({ enabled: false })).rejects.toThrow('owners and managers');
    const { api } = miCasa('stf_luis');
    expect(await api.updateOffer('dsc_staff20', { showInApp: true, audience: 'members' })).toMatchObject({ showInApp: true, audience: 'members' });
    expect((await api.shopApp()).app.offerCodeIds).toEqual(['dsc_tacotue', 'dsc_tray10', 'dsc_staff20']);
    await api.updateOffer('dsc_tacotue', { showInApp: false });
    expect((await api.discountCodes()).find((c) => c.code === 'TACOTUE')?.showInApp).toBe(false);
  });

  test('Own domain: a subdomain is a CNAME to Vercel, pending until it’s seen', async () => {
    const { api } = miCasa('stf_mike');
    expect(await api.setDomain({ domain: 'Rewards.MiCasaTacos.com' })).toMatchObject({ domain: 'rewards.micasatacos.com', status: 'pending', record: { type: 'CNAME', name: 'rewards', value: 'cname.vercel-dns.com' } });
    expect(await api.checkDomain()).toMatchObject({ status: 'pending', checkedAt: NOW });
  });

  test('a reward saves and shows; the give-back moves with the rules before they’re saved', async () => {
    const { api } = miCasa('stf_mike');
    const s = await api.shopApp();
    const g = await api.giveBack({ ...s.rules, clearMultiplier: 1.5 });
    // 1.5× is the spec's drawing: 5.0–7.0% paying with Clear.
    expect([g.lowWithClear, g.highWithClear]).toEqual([5, 7]);
    const r = await api.createReward({ name: 'Free flan', gives: { kind: 'item', itemIds: ['itm_flan'], maxCents: null }, cost: 120, limit: 'none', clearMembersOnly: false, note: null });
    const after = await api.shopApp();
    expect(after.rewards.at(-1)).toEqual(r);
    // $6.00 for 120 points is 5.0%, the new top.
    expect(after.giveBack.high).toBe(5);
  });
});
