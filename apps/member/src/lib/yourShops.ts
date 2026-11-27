import type { RewardsPointsName, YourShop } from '@/utils/apiClient';

/**
 * Your shops' words (rewards spec, section 6), the same as the rewards hub's tiles
 * (apps/rewards screens/hub.tsx `shopLine`): "128 points", "340 points · 160 to a free tire
 * rotation", "6 of 10 stamps".
 */
export function pointsWord(name: RewardsPointsName, count: number): string {
  const one = count === 1 || count === -1;
  if (name.kind === 'points') return one ? 'point' : 'points';
  if (name.kind === 'stars') return one ? 'star' : 'stars';
  return one ? name.one : name.many;
}

export function yourShopLine(s: YourShop): string {
  if (s.unit === 'visits' && s.cardSize) return `${s.points} of ${s.cardSize} ${pointsWord(s.pointsName, 2)}`;
  const base = `${s.points} ${pointsWord(s.pointsName, s.points)}`;
  return s.readyCount === 0 && s.next ? `${base} · ${s.next.toGo} to a ${s.next.name.replace(/^Free /i, 'free ')}` : base;
}

/** The type a shop's tile is set in: its heading preset, or its own font in front of the serif. */
const PRESET_FAMILY: Record<string, string> = {
  serif: "'Fraunces', Georgia, serif",
  grotesque: "'Archivo', 'Instrument Sans', sans-serif",
  rounded: "'Nunito', 'Instrument Sans', sans-serif",
  instrument_sans: "'Instrument Sans', system-ui, sans-serif",
};
export const tileFamily = (s: YourShop) => (s.brand.headingFont.kind === 'preset' ? (PRESET_FAMILY[s.brand.headingFont.preset] ?? PRESET_FAMILY.serif) : PRESET_FAMILY.serif);

/** Where a row opens: that shop inside the rewards hub, where the member is already signed in. */
export const REWARDS_URL = ((import.meta.env.VITE_REWARDS_URL as string | undefined) || 'https://rewards.useclear.org').replace(/\/+$/, '');
export const shopUrl = (slug: string) => `${REWARDS_URL}/shops/${encodeURIComponent(slug)}`;
