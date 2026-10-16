import { BRAND_PRESETS, FONT_PRESETS, type Brand, type FontRef } from '@clear/merchant-contracts';
import type { CSSProperties } from 'react';

/** Clear's own look, for the hub's top level and anything that isn't a shop's. */
export const CLEAR_LOOK: CSSProperties = {
  ['--b' as string]: BRAND_PRESETS.ink.colour,
  ['--bi' as string]: BRAND_PRESETS.ink.onColour,
  ['--bf' as string]: 'var(--font-display)',
  ['--bp' as string]: BRAND_PRESETS.ink.paper,
  ['--b2' as string]: BRAND_PRESETS.ink.paper2,
};

export function fontFamily(f: FontRef, uploaded: Record<string, string>, fallback: string): string {
  if (f.kind === 'preset') return FONT_PRESETS[f.preset].family;
  return uploaded[f.fontId] ? `'shop-${f.fontId}', ${fallback}` : fallback;
}

/** A shop's look as the spec's CSS variables: --b colour, --bi on it, --bf headings, --bp paper, --b2 under it. */
export function brandStyle(brand: Brand, uploaded: Record<string, string> = {}): CSSProperties {
  return {
    ['--b' as string]: brand.colour,
    ['--bi' as string]: brand.onColour,
    ['--bf' as string]: fontFamily(brand.headingFont, uploaded, "'Instrument Sans', sans-serif"),
    ['--bt' as string]: brand.textFont.kind === 'preset' && brand.textFont.preset === 'instrument_sans' ? 'var(--font-text)' : fontFamily(brand.textFont, uploaded, 'var(--font-text)'),
    ['--bp' as string]: brand.paper,
    ['--b2' as string]: brand.paper2,
  };
}

/** An uploaded font, loaded once from its URL. */
export function loadShopFonts(fonts: Record<string, string>): void {
  for (const [id, url] of Object.entries(fonts)) {
    const name = `shop-${id}`;
    if ([...document.fonts].some((f) => f.family === name)) continue;
    const face = new FontFace(name, `url(${url}) format('woff2')`);
    void face.load().then((f) => document.fonts.add(f)).catch(() => undefined);
  }
}

/** The logo tile's own colours, for a list row of several shops. */
export const tileStyle = (b: Pick<Brand, 'colour' | 'onColour'> & { headingFont?: FontRef }, headingFamily?: string, uploaded: Record<string, string> = {}): CSSProperties => ({
  background: b.colour,
  color: b.onColour,
  fontFamily: headingFamily ?? (b.headingFont ? fontFamily(b.headingFont, uploaded, 'var(--font-display)') : undefined),
});
