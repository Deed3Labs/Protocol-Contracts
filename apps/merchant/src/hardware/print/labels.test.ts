import { describe, expect, test } from 'bun:test';
import type { Receipt } from '@clear/merchant-contracts';
import { bagLabel4x3, kitchenTicket4x3, kitchenTickets, packBitmap, receipt4x6, receipt80mm, renderToBitmap, type BagLabel, type KitchenTicket, type Layout } from './labels';
import type { Canvas2D, Pen, TextStyle } from './pen';

// ---- Fakes ---------------------------------------------------------------------------------------

interface Drawn {
  text: string;
  x: number;
  y: number;
  style: TextStyle;
  width: number;
}

/** A Pen that records what it's asked to draw. Glyphs are 0.55 of the size wide, plus tracking. */
function recorder() {
  const texts: Drawn[] = [];
  const lines: number[][] = [];
  const rects: number[][] = [];
  const qrs: { text: string; x: number; y: number; size: number }[] = [];
  const measure = (t: string, s: TextStyle) => t.length * (s.size * 0.55 + (s.tracking ?? 0));
  const pen: Pen = {
    fillRect: (x, y, w, h) => void rects.push([x, y, w, h]),
    fillText: (text, x, y, style) => void texts.push({ text, x, y, style, width: measure(text, style) }),
    measureText: measure,
    line: (x1, y1, x2, y2, w) => void lines.push([x1, y1, x2, y2, w]),
    strokeRect: (x, y, w, h) => void rects.push([x, y, w, h]),
    qr: (text, x, y, size) => void qrs.push({ text, x, y, size }),
  };
  return {
    pen,
    texts,
    lines,
    rects,
    qrs,
    strings: () => texts.map((t) => t.text),
  };
}

function draw(layout: Layout) {
  const r = recorder();
  layout.draw(r.pen);
  return r;
}

/** Every text, line and box sits on the paper. */
function expectInside(layout: Layout, r: ReturnType<typeof recorder>) {
  for (const t of r.texts) {
    const left = t.style.align === 'right' ? t.x - t.width : t.style.align === 'center' ? t.x - t.width / 2 : t.x;
    expect({
      text: t.text,
      left: left >= 0,
      right: left + t.width <= layout.width,
      y: t.y > 0 && t.y <= layout.height,
    }).toEqual({
      text: t.text,
      left: true,
      right: true,
      y: true,
    });
  }
  for (const [x1, y1, x2, y2] of r.lines)
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
    ])
      expect(x >= 0 && x <= layout.width && y >= 0 && y <= layout.height).toBe(true);
  for (const [x, y, w, h] of r.rects) expect(x >= 0 && y >= 0 && x + w <= layout.width && y + h <= layout.height).toBe(true);
  for (const q of r.qrs) expect(q.x >= 0 && q.y >= 0 && q.x + q.size <= layout.width && q.y + q.size <= layout.height).toBe(true);
}

const TZ = 'America/Los_Angeles';

/** The section-12 sticker receipt. */
const RECEIPT: Receipt = {
  shop: { name: 'Mi Casa Tacos', address: null },
  orderNumber: 142,
  businessDate: '2026-10-15',
  issuedAt: '2026-10-15T12:41:00-07:00',
  lines: [
    {
      name: 'Carne asada burrito',
      quantity: 2,
      options: [],
      note: null,
      lineCents: 2500,
      discountCents: 0,
    },
    {
      name: 'Chips and salsa',
      quantity: 1,
      options: [],
      note: null,
      lineCents: 450,
      discountCents: 0,
    },
    {
      name: 'Mexican Coke',
      quantity: 2,
      options: [],
      note: null,
      lineCents: 700,
      discountCents: 0,
    },
    {
      name: 'Churros',
      quantity: 1,
      options: [],
      note: null,
      lineCents: 575,
      discountCents: 0,
    },
  ],
  discount: null,
  subtotalCents: 4225,
  discountCents: 0,
  taxCents: 345,
  taxIncluded: false,
  tipCents: 0,
  totalCents: 4570,
  tenders: [
    {
      method: 'cash',
      amountCents: 4570,
      tipCents: 0,
      card: null,
      changeCents: 430,
      status: 'captured',
    },
  ],
  refundedCents: 0,
  table: null,
  code: '7KQ2M9XHRT',
};

const STICKER = [
  'Mi Casa Tacos',
  'ORDER 0142 · OCT 15 · 12:41PM',
  '25.00',
  '2 Carne asada burrito',
  '4.50',
  '1 Chips and salsa',
  '7.00',
  '2 Mexican Coke',
  '5.75',
  '1 Churros',
  '3.45',
  'Tax',
  'Total',
  '$45.70',
  '50.00',
  'Cash',
  '4.30',
  'Change',
  'Next time, pay with Clear and the shop keeps more of it.',
  'useclear.org/r/7KQ2M9XHRT',
];

// ---- Templates -----------------------------------------------------------------------------------

describe('receipt 4 × 6', () => {
  test('812 × 1218, the sticker page top to bottom, the QR over its link', () => {
    const layout = receipt4x6(RECEIPT, { timeZone: TZ });
    expect([layout.width, layout.height]).toEqual([812, 1218]);
    const r = draw(layout);
    expect(r.strings()).toEqual(STICKER);
    expect(r.qrs).toHaveLength(1);
    expect(r.qrs[0].text).toBe('https://useclear.org/r/7KQ2M9XHRT');
    const url = r.texts.find((t) => t.text.startsWith('useclear.org'))!;
    expect(r.qrs[0].y + r.qrs[0].size).toBeLessThan(url.y);
    const change = r.texts.find((t) => t.text === 'Change')!;
    expect(change.y).toBeLessThan(r.qrs[0].y);
    expectInside(layout, r);
  });
  test('a table, a card and a tip; no code means no QR or link', () => {
    const card: Receipt = {
      ...RECEIPT,
      table: 'Table 12, back patio',
      code: null,
      tipCents: 500,
      tenders: [
        {
          method: 'card',
          amountCents: 4570,
          tipCents: 500,
          card: 'Visa ending 4242',
          changeCents: null,
          status: 'captured',
        },
      ],
    };
    const r = draw(receipt4x6(card, { timeZone: TZ }));
    expect(r.strings()).toContain('TABLE 12, BACK PATIO');
    expect(r.strings()).toContain('Visa ending 4242');
    expect(r.strings()).toContain('$50.70');
    expect(r.strings()).not.toContain('Cash');
    expect(r.qrs).toHaveLength(0);
    expect(r.strings().some((s) => s.startsWith('useclear.org'))).toBe(false);
  });
  test('more lines than fit: the last row sums the rest, and it all stays on the label', () => {
    const many: Receipt = {
      ...RECEIPT,
      lines: Array.from({ length: 30 }, (_, i) => ({
        ...RECEIPT.lines[0],
        name: `Item ${i + 1}`,
        lineCents: 100,
      })),
    };
    const layout = receipt4x6(many, { timeZone: TZ });
    const r = draw(layout);
    const more = r.strings().find((s) => s.startsWith('+ '))!;
    const shown = r.strings().filter((s) => s.startsWith('2 Item')).length;
    expect(more).toBe(`+ ${30 - shown} more`);
    expect(r.strings()).toContain((((30 - shown) * 100) / 100).toFixed(2));
    expectInside(layout, r);
  });
  test('a name too long for the row is cut, not run into the amount', () => {
    const long: Receipt = {
      ...RECEIPT,
      lines: [
        {
          ...RECEIPT.lines[0],
          name: 'Carne asada burrito with everything on it and then some more things besides',
        },
      ],
    };
    const layout = receipt4x6(long, { timeZone: TZ });
    const r = draw(layout);
    expect(r.strings().some((s) => s.endsWith('…'))).toBe(true);
    expectInside(layout, r);
  });
});

describe('receipt 80mm', () => {
  test('576 dots across, the same content, as long as it needs', () => {
    const layout = receipt80mm(RECEIPT, { timeZone: TZ });
    expect(layout.width).toBe(576);
    const r = draw(layout);
    expect(r.strings()).toEqual(STICKER);
    expectInside(layout, r);
    const longer = receipt80mm({ ...RECEIPT, lines: [...RECEIPT.lines, ...RECEIPT.lines] }, { timeZone: TZ });
    expect(longer.height).toBeGreaterThan(layout.height);
    expect(
      draw(longer)
        .strings()
        .filter((s) => s === '1 Churros'),
    ).toHaveLength(2);
  });
});

/** The section-4 drawing. */
const BAG: BagLabel = {
  shop: 'Mi Casa Tacos',
  partner: 'DoorDash',
  orderNumber: 27,
  customer: 'Ana R.',
  items: 4,
  bags: 2,
  bag: 1,
  readyAt: '2026-10-15T19:42:00-07:00',
  sealedAt: '2026-10-15T19:44:00-07:00',
  lines: [
    { quantity: 2, name: 'Al pastor', note: 'no onion' },
    { quantity: 1, name: 'Nachos grande' },
    { quantity: 1, name: 'Churros', note: 'chocolate on the side' },
  ],
  timeZone: TZ,
};

describe('bag label 4 × 3', () => {
  test('as drawn', () => {
    const layout = bagLabel4x3(BAG);
    expect([layout.width, layout.height]).toEqual([812, 609]);
    const r = draw(layout);
    expect(r.strings()).toEqual([
      'DOORDASH',
      'Mi Casa Tacos',
      '27',
      'Ana R.',
      '4 ITEMS · 2 BAGS',
      'BAG 1 OF 2',
      'READY 7:42 PM',
      '2',
      'no onion',
      'Al pastor',
      '1',
      'Nachos grande',
      '1',
      'chocolate on the side',
      'Churros',
      'STICK ACROSS THE FOLD · SEALED 7:44 PM',
    ]);
    const at = (s: string) => r.texts.find((t) => t.text === s)!;
    expect([at('27').x, at('27').y, at('27').style.size]).toEqual([28, 300, 230]);
    expect([at('Al pastor').y, at('Nachos grande').y, at('Churros').y]).toEqual([398, 444, 490]);
    expect(r.lines).toEqual([
      [36, 92, 776, 92, 3],
      [372, 112, 372, 330, 2],
      [36, 350, 776, 350, 3],
      [36, 537, 776, 537, 2],
    ]);
    expectInside(layout, r);
  });
  test('no partner is TO GO; a four-digit order shrinks to stay left of the rule', () => {
    const r = draw(bagLabel4x3({ ...BAG, partner: null, orderNumber: 1042, bag: 2 }));
    expect(r.strings()).toContain('TO GO');
    expect(r.strings()).toContain('BAG 2 OF 2');
    const n = r.texts.find((t) => t.text === '1042')!;
    expect(n.x + n.width).toBeLessThanOrEqual(372);
  });
  test('more lines than three rows: two, then the rest counted', () => {
    const layout = bagLabel4x3({
      ...BAG,
      lines: [...BAG.lines, { quantity: 3, name: 'Horchata' }, { quantity: 1, name: 'Flan' }],
    });
    const r = draw(layout);
    expect(r.strings()).toContain('+ 3 more');
    expect(r.strings()).toContain('5');
    expect(r.strings()).not.toContain('Flan');
    expectInside(layout, r);
  });
});

/** The section-4 drawing. */
const TICKET: KitchenTicket = {
  table: 'Table 12',
  service: 'Dine in',
  sentAt: '2026-10-15T19:51:00-07:00',
  lines: [
    { quantity: 2, name: 'Al pastor', note: 'no onion' },
    { quantity: 1, name: 'Carne asada' },
    { quantity: 1, name: 'Churros', note: 'choc on side' },
  ],
  ticket: 3,
  sentBy: 'Jen',
  timeZone: TZ,
};

describe('kitchen ticket 4 × 3', () => {
  test('as drawn: the inverted band, the rows and rules where the drawing has them', () => {
    const layout = kitchenTicket4x3(TICKET);
    expect([layout.width, layout.height]).toEqual([812, 609]);
    const r = draw(layout);
    expect(r.rects).toEqual([[0, 0, 812, 104]]);
    expect(r.strings()).toEqual(['DINE IN · 7:51 PM', 'Table 12', '2', 'Al pastor', 'NO ONION', '1', 'Carne asada', '1', 'Churros', 'CHOC ON SIDE', 'TICKET 3 · SENT BY JEN', 'STICK ON THE RAIL']);
    const at = (s: string) => r.texts.find((t) => t.text === s)!;
    expect(at('Table 12').style.white).toBe(true);
    expect(at('DINE IN · 7:51 PM').style.white).toBe(true);
    expect([at('Al pastor').y, at('NO ONION').y, at('Carne asada').y, at('Churros').y, at('CHOC ON SIDE').y]).toEqual([176, 210, 272, 338, 372]);
    expect(r.lines.map((l) => l[1])).toEqual([228, 294, 390]);
    expectInside(layout, r);
  });
  test('no table: the order; a long order splits over tickets and drops nothing', () => {
    expect(draw(kitchenTicket4x3({ ...TICKET, table: null, orderNumber: 27 })).strings()).toContain('Order 27');
    const lines = Array.from({ length: 11 }, (_, i) => ({
      quantity: 1,
      name: `Dish ${i + 1}`,
      note: i % 2 ? 'extra hot' : null,
    }));
    const pages = kitchenTickets({ ...TICKET, lines });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.lines)).toEqual(lines);
    pages.forEach((p, i) => {
      const layout = kitchenTicket4x3(p);
      const r = draw(layout);
      expect(r.strings()).toContain(`TICKET 3 · ${i + 1} OF ${pages.length} · SENT BY JEN`);
      expect(r.strings().filter((s) => s.startsWith('Dish'))).toEqual(p.lines.map((l) => l.name));
      expectInside(layout, r);
    });
    expect(kitchenTickets(TICKET)).toEqual([TICKET]);
  });
});

// ---- Bitmap --------------------------------------------------------------------------------------

/** A canvas context that records calls, returning `image` when read. */
function fakeSurface(image: number[]) {
  const calls: string[] = [];
  const ctx: Canvas2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: (x, y, w, h) => void calls.push(`fillRect ${ctx.fillStyle} ${x},${y},${w},${h}`),
    strokeRect: () => {},
    fillText: (t) => void calls.push(`fillText ${t}`),
    measureText: (t) => ({ width: t.length * 10 }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  };
  return {
    calls,
    make: (w: number, h: number) => (calls.push(`make ${w}x${h}`), { ctx, getImageData: () => ({ data: image }) }),
  };
}

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

describe('renderToBitmap', () => {
  test('white paper first, then the drawing, then packed: MSB first, 1 black, rows padded', () => {
    // 10 × 2. Row 0: black at 0, 2, 9. Row 1: black at 8 only.
    const px = (x: number, y: number) => (y === 0 ? [0, 2, 9].includes(x) : x === 8);
    const image = Array.from({ length: 20 }, (_, i) => (px(i % 10, Math.floor(i / 10)) ? BLACK : WHITE)).flat();
    const s = fakeSurface(image);
    const b = renderToBitmap((pen) => pen.fillText('hi', 1, 1, { face: 'text', size: 10 }), 10, 2, s.make);
    expect(s.calls).toEqual(['make 10x2', 'fillRect #fff 0,0,10,2', 'fillText hi']);
    expect(b.width).toBe(10);
    expect(b.height).toBe(2);
    expect([...b.data]).toEqual([0b1010_0000, 0b0100_0000, 0b0000_0000, 0b1000_0000]);
  });
  test('threshold: luminance under 128 is black; transparent is paper', () => {
    const image = [
      [127, 127, 127, 255], // just dark enough
      [128, 128, 128, 255], // mid-grey: paper
      [255, 0, 0, 255], // red, luminance 76: black
      [0, 255, 0, 255], // green, 150: paper
      [0, 0, 0, 0], // transparent black: paper
      [0, 0, 0, 200], // mostly opaque black: black
      [0, 0, 255, 255], // blue, 29: black
      [255, 255, 255, 255],
    ].flat();
    expect([...packBitmap(image, 8, 1).data]).toEqual([0b1010_0110]);
  });
});
