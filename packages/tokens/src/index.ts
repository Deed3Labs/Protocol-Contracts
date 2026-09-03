/**
 * Design tokens shared by the Clear apps: color, type scale, spacing, radii.
 *
 * The CSS custom properties in `tokens.css` are the source of truth — import that once at the root
 * of an app. These constants exist for the places CSS cannot reach: a canvas, a chart, a meta
 * theme-color, an inline SVG fill.
 *
 * Tokens and formatters are the whole shared design surface. Screen-level components stay in the
 * app that owns them, because a tablet counter app and a consumer phone app are different products
 * with different density and different vocabulary.
 */

export const color = {
  surface0: '#E8E5DD',
  surface1: '#F1EFE8',
  surface2: '#FAF9F5',
  border: '#D4D1C7',
  borderStrong: '#B4B2A9',
  borderAccent: '#7F77DD',
  textPrimary: '#2C2C2A',
  textSecondary: '#5F5E5A',
  textMuted: '#888780',
  textSuccess: '#0F6E56',
  textAccent: '#534AB7',
  bgSuccess: '#E3F3ED',
  bgAccent: '#E9E7FA',
} as const;

export const radius = { sm: 4, base: 8, lg: 12 } as const;

/** Dense by design — read at arm's length across a counter, not held in one hand. */
export const fontSize = {
  '2xs': 10,
  xs: 11.5,
  sm: 13,
  base: 15,
  md: 17,
  lg: 21,
  xl: 26,
  '2xl': 32,
  '3xl': 40,
} as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;

/**
 * The two points where the merchant layout rearranges.
 *
 * Above `twoColumn` the action sits left and its context right; between the two it becomes one
 * column with the action first; below `phone` it is the phone layout. Nothing is removed at any
 * width — only the arrangement changes.
 */
export const breakpoint = { phone: 520, twoColumn: 900 } as const;

export type ColorToken = keyof typeof color;
