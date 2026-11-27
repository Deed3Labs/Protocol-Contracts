import { describe, expect, test } from 'bun:test';
import { createMockMerchantApi } from '../data/merchantApi/mock';
import { boostDet, fontNameOf, giveBackLine, givesLabel, limitLabel, offerRow, rateExample } from './shopAppModel';

/** Settings › Shop app's rows come out of Mi Casa's data exactly as section 8 draws them. */
const miCasa = () => createMockMerchantApi({ shop: 'micasa', delayMs: 0, viewer: 'stf_mike', now: () => '2026-10-16T02:46:00.000Z' }).api;

describe('Settings › Shop app, as drawn', () => {
  test('the rewards table', async () => {
    const api = miCasa();
    const [s, items] = await Promise.all([api.shopApp(), api.catalog()]);
    const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? null;
    expect(s.rewards.map((r) => [r.name, givesLabel(r, nameOf), limitLabel(r), r.cost])).toEqual([
      ['Free agua fresca', 'Item · Jamaica or Horchata, any size', 'Once a day', 75],
      ['Free churros', 'Item · Churros', 'Once a day', 150],
      ['Free taco plate', 'Item · any plate up to $14', '—', 300],
      ['Family tray, $20 off', '$20 off a Catering item', 'Clear members', 600],
    ]);
  });

  test('offers in the app, boosts, the rate and the give-back', async () => {
    const api = miCasa();
    const [s, codes] = await Promise.all([api.shopApp(), api.discountCodes()]);
    expect(codes.map((c) => offerRow(c, 'America/Los_Angeles'))).toEqual([
      { t: 'TACOTUE · Two tacos for $7', det: 'Tuesdays · from Discounts' },
      { t: 'TRAY10 · 10% off a tray', det: 'Ends Oct 31 · from Discounts' },
      { t: 'STAFF20 · 20% off', det: 'Staff only' },
    ]);
    expect(s.rules.boosts.map((b) => [b.name, boostDet(b), b.on])).toEqual([
      ['Double points · Tuesdays', 'Every Tuesday, all day', true],
      ['Happy hour · 2×', 'Weekdays 2–5pm', false],
      ['Catering · 3×', 'Items in Catering only', false],
    ]);
    expect(rateExample(s.rules, (n) => (n === 1 ? 'point' : 'points'))).toBe('A $24.00 order earns 24 points');
    // Mi Casa's Clear multiplier is Off, so the line has no Clear clause (rewards DECISIONS, Hard Stop 2).
    expect(giveBackLine(s.giveBack)).toBe('Gives back 3.3–4.7%.');
    expect(giveBackLine(await api.giveBack({ ...s.rules, clearMultiplier: 1.5 }))).toBe('Gives back 3.3–4.7%, or 5.0–7.0% paying with Clear.');
  });

  test('a font’s name comes from its file', () => {
    expect(fontNameOf('Casa-Display-Bold.woff2')).toBe('Casa Display');
    expect(fontNameOf('MiCasaSerif-Regular.ttf')).toBe('Mi Casa Serif');
  });
});
