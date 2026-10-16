import { describe, expect, test } from 'bun:test';
import { shopUrl, yourShopLine } from './yourShops';
import type { YourShop } from '@/utils/apiClient';

const shop = (s: Partial<YourShop>): YourShop => ({
  slug: 'micasa',
  name: 'Mi Casa Tacos',
  brand: { logoUrl: null, monogram: 'MC', colour: '#B4532A', onColour: '#FBF3EA', headingFont: { kind: 'preset', preset: 'serif' } },
  pointsName: { kind: 'points' },
  unit: 'dollars',
  points: 128,
  cardSize: null,
  readyCount: 1,
  next: { name: 'Free churros', toGo: 22 },
  ...s,
});

describe('Your shops, as section 6 draws them', () => {
  test('points, or what the next reward is when nothing is ready, or stamps on the card', () => {
    expect(yourShopLine(shop({}))).toBe('128 points');
    expect(yourShopLine(shop({ name: 'Mike’s Tire', points: 340, readyCount: 0, next: { name: 'Free tire rotation', toGo: 160 } }))).toBe('340 points · 160 to a free tire rotation');
    expect(yourShopLine(shop({ unit: 'visits', points: 6, cardSize: 10, pointsName: { kind: 'custom', one: 'stamp', many: 'stamps' } }))).toBe('6 of 10 stamps');
  });
  test('a row opens that shop inside the rewards hub', () => {
    expect(shopUrl('mikes-tire')).toBe('https://rewards.useclear.org/shops/mikes-tire');
  });
});
