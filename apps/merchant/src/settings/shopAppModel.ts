import { FONT_PRESETS, type Boost, type DiscountCode, type EarnRules, type FontRef, type GiveBack, type Reward, type UploadedFont } from '@clear/merchant-contracts';

/**
 * Settings › Shop app's words, from the shop's data (rewards spec, section 8). Each is a rule, so the
 * drawn rows ("TACOTUE · Two tacos for $7", "Item · Jamaica or Horchata, any size") come out of the
 * codes and rewards as they are, and a shop's own read the same way.
 */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAYS_PLURAL = DAYS.map((d) => `${d}s`);

export const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
const pct = (n: number) => n.toFixed(1);

/** "2–5pm", "11am–2pm", "5:30–9pm" */
export function spanLabel(from: string, to: string): string {
  const part = (t: string) => {
    const [h, m] = t.split(':').map(Number) as [number, number];
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { text: m ? `${h12}:${String(m).padStart(2, '0')}` : `${h12}`, pm: h >= 12 };
  };
  const a = part(from);
  const b = part(to);
  return a.pm === b.pm ? `${a.text}–${b.text}${b.pm ? 'pm' : 'am'}` : `${a.text}${a.pm ? 'pm' : 'am'}–${b.text}${b.pm ? 'pm' : 'am'}`;
}

/** "Weekdays", "Tuesdays", "Fri and Sat", or the days listed. */
function daysLabel(days: number[]): string {
  const s = [...days].sort((a, b) => a - b);
  if (s.length === 7) return 'Every day';
  if (s.join() === '0,1,2,3,4') return 'Weekdays';
  if (s.join() === '5,6') return 'Weekends';
  if (s.length === 1) return DAYS_PLURAL[s[0]!]!;
  return s.map((d) => DAYS[d]!.slice(0, 3)).join(', ').replace(/, ([^,]*)$/, ' and $1');
}

/** A boost's second line: "Every Tuesday, all day", "Weekdays 2–5pm", "Items in Catering only". */
export function boostDet(b: Pick<Boost, 'scope'>): string {
  const s = b.scope;
  if (s.kind === 'days') return s.days.length === 1 ? `Every ${DAYS[s.days[0]!]}, all day` : `${daysLabel(s.days)}, all day`;
  if (s.kind === 'hours') return `${daysLabel(s.days)} ${spanLabel(s.span.from, s.span.to)}`;
  return `Items in ${s.categories.join(' and ')} only`;
}

/** The rewards table's Gives column. */
export function givesLabel(r: Pick<Reward, 'gives' | 'note'>, nameOf: (itemId: string) => string | null): string {
  const g = r.gives;
  if (g.kind === 'item') {
    // A long list reads as its note ("any plate up to $14"); a short one names the items.
    if (g.itemIds.length > 2 && r.note) return `Item · ${r.note}`;
    const names = g.itemIds.map(nameOf).filter((n): n is string => Boolean(n));
    const listed = names.length ? names.join(' or ') : 'an item';
    return `Item · ${listed}${r.note ? `, ${r.note}` : ''}`;
  }
  const on = g.categories === null ? 'the order' : `a ${g.categories.join(' or ')} item`;
  return g.kind === 'amount' ? `${dollars(g.amountCents)} off ${on}` : `${g.percent}% off ${on}`;
}

/** The Limit column: Clear members only says so first. */
export function limitLabel(r: Pick<Reward, 'limit' | 'clearMembersOnly'>): string {
  if (r.clearMembersOnly) return 'Clear members';
  return r.limit === 'daily' ? 'Once a day' : r.limit === 'weekly' ? 'Once a week' : '—';
}

/** When an offer works: "Tuesdays", "Ends Oct 31", "Nov", or nothing. */
export function offerWhen(c: Pick<DiscountCode, 'days' | 'startsAt' | 'endsAt'>, timeZone: string): string {
  if (c.days?.length) return daysLabel(c.days);
  const fmt = (d: string | Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone, ...o }).format(new Date(d));
  const last = c.endsAt ? new Date(Date.parse(c.endsAt) - 1) : null;
  if (c.startsAt && last && fmt(c.startsAt, { year: 'numeric', month: 'short' }) === fmt(last, { year: 'numeric', month: 'short' })) return fmt(c.startsAt, { month: 'short' });
  if (last) return `Ends ${fmt(last, { month: 'short', day: 'numeric' })}`;
  return '';
}

/**
 * An offer's row: the code and what it gives ("TACOTUE · Two tacos for $7"), then when it works.
 * An offer named for its day reads as what it gives; one named for its deal reads as its name.
 */
export function offerRow(c: DiscountCode, timeZone: string): { t: string; det: string } {
  const deal = c.offer
    ? /[\d%$]/.test(c.offer.title)
      ? c.offer.title
      : (c.offer.detail.split(',')[0] ?? c.offer.title)
    : c.percent !== null
      ? `${c.percent}% off`
      : `${dollars(c.amountCents ?? 0)} off`;
  const when = offerWhen(c, timeZone);
  return { t: `${c.code} · ${deal}`, det: when ? `${when} · from Discounts` : c.offer?.detail || 'From Discounts' };
}

/** "Gives back 3.3–4.7%, or 5.0–7.0% paying with Clear." */
export function giveBackLine(g: GiveBack): string {
  if (g.low === null || g.high === null) return 'Add a reward to see what you give back.';
  const range = (a: number, b: number) => (a === b ? `${pct(a)}%` : `${pct(a)}–${pct(b)}%`);
  const clear = g.lowWithClear !== null && g.highWithClear !== null ? `, or ${range(g.lowWithClear, g.highWithClear)} paying with Clear` : '';
  return `Gives back ${range(g.low, g.high)}${clear}.`;
}

/** The Rate row's example: "A $24.00 order earns 24 points". */
export function rateExample(rules: Pick<EarnRules, 'pointsPer' | 'perAmountCents'>, word: (n: number) => string): string {
  const order = 2400;
  const points = Math.floor(order / rules.perAmountCents) * rules.pointsPer;
  return `A $24.00 order earns ${points} ${word(points)}`;
}

/** The CSS family for a font choice: a preset's stack, or the shop's upload in front of the serif. */
export function fontFamily(ref: FontRef, fonts: UploadedFont[]): string {
  if (ref.kind === 'preset') return FONT_PRESETS[ref.preset].family;
  const f = fonts.find((x) => x.id === ref.fontId);
  return f ? `'${f.name}', ${FONT_PRESETS.serif.family}` : FONT_PRESETS.serif.family;
}

/** A font's name from its file: "Casa-Display-Bold.woff2" is Casa Display. */
export function fontNameOf(fileName: string): string {
  const base = fileName.replace(/\.(woff2?|otf|ttf)$/i, '').replace(/[-_]+/g, ' ');
  const words = base.split(/\s+/).filter((w) => !/^(thin|light|regular|medium|semibold|bold|extrabold|black|italic|variable|vf)$/i.test(w));
  return (words.join(' ') || base).replace(/([a-z])([A-Z])/g, '$1 $2').trim().slice(0, 40) || 'My font';
}

/** "186 KB" */
export const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** The saved rules as a save of them: everything but the version. */
export function rulesInput(r: EarnRules) {
  return {
    unit: r.unit,
    pointsPer: r.pointsPer,
    perAmountCents: r.perAmountCents,
    visitMinCents: r.visitMinCents,
    cardSize: r.cardSize,
    keepTheChange: r.keepTheChange,
    clearMultiplier: r.clearMultiplier,
    boosts: r.boosts,
    joinBonus: r.joinBonus,
    birthdayRewardId: r.birthdayRewardId,
    referralBonus: r.referralBonus,
    expiry: r.expiry,
  };
}
