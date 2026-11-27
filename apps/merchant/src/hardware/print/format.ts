/**
 * How the printed labels write money and time. Built from parts rather than a locale string:
 * newer ICU puts a narrow no-break space before AM/PM, which a label font may not have.
 */

/** `25.00`, `1,250.00`, `−5.00`: the receipt rows carry no dollar sign. */
export function amount(cents: number): string {
  const s = (Math.abs(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cents < 0 ? `−${s}` : s;
}

/** `$45.70`: the total. */
export function dollars(cents: number): string {
  const s = amount(cents);
  return s.startsWith('−') ? `−$${s.slice(1)}` : `$${s}`;
}

function parts(at: string | Date, timeZone?: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(at))) p[x.type] = x.value;
  return {
    month: p.month ?? '',
    day: p.day ?? '',
    hour: p.hour ?? '',
    minute: p.minute ?? '',
    period: (p.dayPeriod ?? '').toUpperCase(),
  };
}

/** `7:42 PM`, as the bag label and kitchen ticket write it. */
export function clock(at: string | Date, timeZone?: string): string {
  const p = parts(at, timeZone);
  return `${p.hour}:${p.minute} ${p.period}`;
}

/** `OCT 15 · 12:41PM`, as the sticker receipt writes it. */
export function stamp(at: string | Date, timeZone?: string): string {
  const p = parts(at, timeZone);
  return `${p.month.toUpperCase()} ${p.day} · ${p.hour}:${p.minute}${p.period}`;
}

/** `OCT 15, 2026`, for the test label. */
export function day(at: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
    .format(new Date(at))
    .toUpperCase();
}

/** `4 ITEMS`, `1 BAG`. */
export function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 'S'}`;
}
