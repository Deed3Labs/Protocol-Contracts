import type { Receipt } from '@clear/merchant-contracts';
import { canvasPen, fitFill, fitText, type Canvas2D, type Pen, type TextStyle } from './pen';
import { amount, clock, count, dollars, stamp } from './format';

/**
 * What prints, laid out in printer dots at 203 an inch (terminal reference, section 4, "What they
 * look like", and section 12 for what a receipt carries). Each template is a pure function of its
 * data returning a size and a draw over a `Pen`; `renderToBitmap` turns that into the 1-bit image
 * every printer language takes.
 */

export const DPI = 203;
/** 4 inches. */
export const LABEL_WIDTH = 812;
/** An 80mm roll prints 72mm: 576 dots. */
export const RECEIPT80_WIDTH = 576;

export interface Layout {
  width: number;
  height: number;
  draw(pen: Pen): void;
}

export interface LabelLine {
  quantity: number;
  name: string;
  note?: string | null;
}

const MONO = (size: number): TextStyle => ({
  face: 'mono',
  size,
  tracking: 2.4,
});

// ---- Receipt (4 × 6 label, 80mm roll) ------------------------------------------------------------

interface Row {
  kind: 'row' | 'total';
  left: string;
  right: string;
}

/** The receipt's rows under the header, in the sticker page's order: lines, tax, total, tenders. */
function receiptRows(r: Receipt): {
  items: (Row & { cents: number })[];
  after: Row[];
} {
  const items = r.lines.map((l) => ({
    kind: 'row' as const,
    left: `${l.quantity} ${[l.name, ...l.options].join(', ')}`,
    right: amount(l.lineCents),
    cents: l.lineCents,
  }));
  const after: Row[] = [];
  if (r.discount)
    after.push({
      kind: 'row',
      left: r.discount.label,
      right: amount(-r.discount.amountCents),
    });
  after.push({
    kind: 'row',
    left: r.taxIncluded ? 'Tax included' : 'Tax',
    right: amount(r.taxCents),
  });
  if (r.tipCents) after.push({ kind: 'row', left: 'Tip', right: amount(r.tipCents) });
  after.push({
    kind: 'total',
    left: 'Total',
    right: dollars(r.totalCents + r.tipCents),
  });
  for (const t of r.tenders) {
    if (t.status === 'declined' || t.status === 'cancelled') continue;
    const paid = t.amountCents + t.tipCents;
    if (t.method === 'cash') {
      // The drawing's Cash row is what was handed over: the sale plus the change given back.
      after.push({
        kind: 'row',
        left: 'Cash',
        right: amount(paid + (t.changeCents ?? 0)),
      });
      if (t.changeCents)
        after.push({
          kind: 'row',
          left: 'Change',
          right: amount(t.changeCents),
        });
    } else {
      after.push({
        kind: 'row',
        left: t.method === 'card' ? (t.card ?? 'Card') : 'Clear',
        right: amount(paid),
      });
    }
  }
  if (r.refundedCents)
    after.push({
      kind: 'row',
      left: 'Refunded',
      right: amount(-r.refundedCents),
    });
  return { items, after };
}

interface ReceiptSize {
  width: number;
  margin: number;
  shop: number;
  mono: number;
  text: number;
  pitch: number;
  total: number;
  totalPitch: number;
  qr: number;
  foot: number;
}

const SIZE_4X6: ReceiptSize = {
  width: LABEL_WIDTH,
  margin: 36,
  shop: 64,
  mono: 24,
  text: 30,
  pitch: 56,
  total: 72,
  totalPitch: 100,
  qr: 260,
  foot: 26,
};
const SIZE_80: ReceiptSize = {
  width: RECEIPT80_WIDTH,
  margin: 16,
  shop: 48,
  mono: 20,
  text: 24,
  pitch: 46,
  total: 56,
  totalPitch: 82,
  qr: 220,
  foot: 22,
};

export interface ReceiptOptions {
  /** The shop's time zone; the device's own when absent. */
  timeZone?: string;
}

function receiptLayout(r: Receipt, z: ReceiptSize, opts: ReceiptOptions, fixedHeight: number | null): Layout {
  const { items, after } = receiptRows(r);
  const order = r.orderNumber === null ? null : `ORDER ${String(r.orderNumber).padStart(4, '0')}`;
  const head = [order, stamp(r.issuedAt, opts.timeZone)].filter(Boolean).join(' · ');
  const table = r.table ? r.table.toUpperCase() : null;
  const url = r.code ? `useclear.org/r/${r.code}` : null;

  const yShop = z.margin + Math.round(z.shop * 0.875);
  const yHead = yShop + z.mono * 2;
  const yTable = yHead + Math.round(z.mono * 1.5);
  const rowsTop = (table ? yTable : yHead) + Math.round(z.mono * 1.2);
  const afterHeight = after.reduce((h, row) => h + (row.kind === 'total' ? z.totalPitch : z.pitch), 0);
  // The foot, bottom up: the Clear line, the link, the QR above it.
  const footHeight = z.margin + Math.round(z.foot * 0.25) + (url ? Math.round(z.foot * 1.9) + z.mono + 10 + z.qr + 24 : z.foot + 24);

  let shown: Row[] = items;
  if (fixedHeight !== null) {
    // A label can't grow: past what fits, the last row sums the rest. The QR opens all of them.
    const room = Math.floor((fixedHeight - footHeight - rowsTop - afterHeight) / z.pitch);
    if (items.length > room) {
      const keep = Math.max(0, room - 1);
      const rest = items.slice(keep);
      shown = [
        ...items.slice(0, keep),
        {
          kind: 'row',
          left: `+ ${rest.length} more`,
          right: amount(rest.reduce((s, i) => s + i.cents, 0)),
        },
      ];
    }
  }
  const height = fixedHeight ?? rowsTop + shown.length * z.pitch + afterHeight + footHeight;
  const inner = z.width - z.margin * 2;
  const right = z.width - z.margin;

  return {
    width: z.width,
    height,
    draw(pen) {
      fitFill(pen, r.shop.name, z.margin, yShop, inner, {
        face: 'display',
        size: z.shop,
        weight: 800,
        tracking: -z.shop * 0.03,
      });
      fitFill(pen, head, z.margin, yHead, inner, MONO(z.mono));
      if (table) fitFill(pen, table, z.margin, yTable, inner, MONO(z.mono));

      let y = rowsTop;
      const text: TextStyle = { face: 'text', size: z.text };
      for (const row of [...shown, ...after]) {
        if (row.kind === 'total') {
          pen.line(z.margin, y + 12, right, y + 12, 3);
          const big: TextStyle = {
            face: 'display',
            size: z.total,
            weight: 800,
            align: 'right',
            tracking: -z.total * 0.03,
          };
          const base = y + z.totalPitch - 20;
          pen.fillText(row.left, z.margin, base, text);
          pen.fillText(row.right, right, base, big);
          y += z.totalPitch;
          continue;
        }
        const base = y + Math.round(z.pitch * 0.66);
        const w = pen.measureText(row.right, { ...text, align: 'right' });
        pen.fillText(row.right, right, base, { ...text, align: 'right' });
        fitFill(pen, row.left, z.margin, base, inner - w - 24, text);
        pen.line(z.margin, y + z.pitch, right, y + z.pitch, 2);
        y += z.pitch;
      }

      const yNext = height - z.margin - Math.round(z.foot * 0.25);
      const center = z.width / 2;
      fitFill(pen, 'Next time, pay with Clear and the shop keeps more of it.', center, yNext, inner, { face: 'text', size: z.foot, align: 'center' }, 14);
      if (url) {
        const yUrl = yNext - Math.round(z.foot * 1.9);
        pen.fillText(url, center, yUrl, { ...MONO(z.mono), align: 'center' });
        pen.qr?.(`https://${url}`, Math.round(center - z.qr / 2), yUrl - z.mono - 10 - z.qr, z.qr);
      }
    },
  };
}

/** The receipt on a 4 × 6 label: 812 × 1218 dots, the sticker receipt page's content top to bottom. */
export function receipt4x6(receipt: Receipt, opts: ReceiptOptions = {}): Layout {
  return receiptLayout(receipt, SIZE_4X6, opts, 1218);
}

/** The same receipt on an 80mm roll, one column, as long as it needs to be. */
export function receipt80mm(receipt: Receipt, opts: ReceiptOptions = {}): Layout {
  return receiptLayout(receipt, SIZE_80, opts, null);
}

// ---- Bag label (4 × 3) ---------------------------------------------------------------------------

export interface BagLabel {
  shop: string;
  /** "DoorDash". Null or absent prints TO GO. */
  partner?: string | null;
  orderNumber: number | string;
  customer?: string | null;
  /** Items in the whole order, and how many bags it went in. */
  items: number;
  bags: number;
  /** Which bag this label goes on, from 1. */
  bag: number;
  readyAt?: string | Date | null;
  sealedAt?: string | Date | null;
  lines: LabelLine[];
  timeZone?: string;
}

/** Three line rows fit between the rules (baselines 398, 444, 490). */
const BAG_ROWS = 3;

/** 812 × 609 dots, as drawn: shop and partner over a rule, the big order number, then the lines. */
export function bagLabel4x3(d: BagLabel): Layout {
  return {
    width: LABEL_WIDTH,
    height: 609,
    draw(pen) {
      const partner = (d.partner || 'TO GO').toUpperCase();
      const pStyle: TextStyle = { ...MONO(24), align: 'right' };
      const pWidth = Math.min(pen.measureText(partner, pStyle), 300);
      fitFill(pen, partner, 776, 64, 300, pStyle);
      fitFill(pen, d.shop, 36, 66, 740 - pWidth - 24, {
        face: 'text',
        size: 38,
        weight: 600,
      });
      pen.line(36, 92, 776, 92, 3);

      // The order number fills the left; three or four digits shrink to stay off the rule at 372.
      fitFill(pen, String(d.orderNumber), 28, 300, 330, { face: 'display', size: 230, weight: 800, tracking: -10 }, 90);
      pen.line(372, 112, 372, 330, 2);
      if (d.customer)
        fitFill(pen, d.customer, 398, 172, 378, {
          face: 'display',
          size: 60,
          weight: 800,
        });
      pen.fillText(`${count(d.items, 'ITEM')} · ${count(d.bags, 'BAG')}`, 400, 214, MONO(22));
      pen.fillText(`BAG ${d.bag} OF ${d.bags}`, 400, 250, MONO(22));
      if (d.readyAt) pen.fillText(`READY ${clock(d.readyAt, d.timeZone)}`, 400, 300, MONO(22));
      pen.line(36, 350, 776, 350, 3);

      let rows: LabelLine[] = d.lines;
      if (rows.length > BAG_ROWS) {
        const rest = d.lines.slice(BAG_ROWS - 1);
        rows = [
          ...d.lines.slice(0, BAG_ROWS - 1),
          {
            quantity: rest.reduce((s, l) => s + l.quantity, 0),
            name: `+ ${rest.length} more`,
          },
        ];
      }
      rows.forEach((l, i) => {
        const y = 398 + i * 46;
        pen.fillText(String(l.quantity), 36, y, MONO(26));
        let noteWidth = 0;
        if (l.note) {
          const f = fitText(pen, l.note, 300, {
            face: 'text',
            size: 24,
            align: 'right',
          });
          pen.fillText(f.text, 776, y, f.style);
          noteWidth = pen.measureText(f.text, f.style) + 24;
        }
        fitFill(pen, l.name, 82, y, 694 - noteWidth, {
          face: 'text',
          size: 30,
          weight: 600,
        });
      });

      pen.line(36, 537, 776, 537, 2);
      const sealed = d.sealedAt ? ` · SEALED ${clock(d.sealedAt, d.timeZone)}` : '';
      fitFill(pen, `STICK ACROSS THE FOLD${sealed}`, 36, 575, 740, MONO(20));
    },
  };
}

// ---- Kitchen ticket (4 × 3) ----------------------------------------------------------------------

export interface KitchenTicket {
  /** "Table 12". Without a table the ticket says the order: "Order 27". */
  table?: string | null;
  orderNumber?: number | string | null;
  /** "DINE IN", "TO GO". */
  service: string;
  sentAt: string | Date;
  lines: LabelLine[];
  ticket: number;
  /** Who sent it, by first name: "Jen". */
  sentBy: string;
  /** Set when one order runs over more than one ticket: "1 OF 2". */
  part?: { n: number; of: number };
  timeZone?: string;
}

/** A line's height on the ticket: 44 to its baseline, then 52 under it with a note or 22 without. */
const kitchenPitch = (l: LabelLine) => 44 + (l.note ? 52 : 22);
/** Rows start under the band (the first baseline is 176) and stop clear of the footer at 579. */
const KITCHEN_TOP = 132;
const KITCHEN_BOTTOM = 545;

/**
 * Split an order's lines over as many tickets as they need. A kitchen ticket never drops a line:
 * past what fits, the rest go on the next ticket, each marked "1 OF 2".
 */
export function kitchenTickets(d: KitchenTicket): KitchenTicket[] {
  const pages: LabelLine[][] = [[]];
  let y = KITCHEN_TOP;
  for (const l of d.lines) {
    const page = pages[pages.length - 1];
    if (page.length > 0 && y + kitchenPitch(l) > KITCHEN_BOTTOM) {
      pages.push([l]);
      y = KITCHEN_TOP + kitchenPitch(l);
    } else {
      page.push(l);
      y += kitchenPitch(l);
    }
  }
  if (pages.length === 1) return [d];
  return pages.map((lines, i) => ({
    ...d,
    lines,
    part: { n: i + 1, of: pages.length },
  }));
}

/** 812 × 609 dots, as drawn: an inverted band with the table and time, big lines, notes in caps. */
export function kitchenTicket4x3(d: KitchenTicket): Layout {
  return {
    width: LABEL_WIDTH,
    height: 609,
    draw(pen) {
      pen.fillRect(0, 0, LABEL_WIDTH, 104);
      const when = `${d.service.toUpperCase()} · ${clock(d.sentAt, d.timeZone)}`;
      const wStyle: TextStyle = { ...MONO(22), align: 'right', white: true };
      const wWidth = Math.min(pen.measureText(when, wStyle), 360);
      fitFill(pen, when, 776, 68, 360, wStyle);
      const title = d.table || (d.orderNumber != null ? `Order ${d.orderNumber}` : '');
      fitFill(pen, title, 36, 72, 740 - wWidth - 24, {
        face: 'display',
        size: 52,
        weight: 800,
        white: true,
      });

      const big: TextStyle = { face: 'display', size: 44, weight: 800 };
      let top = KITCHEN_TOP;
      for (const l of d.lines) {
        if (top + kitchenPitch(l) > KITCHEN_BOTTOM) break;
        const y = top + 44;
        fitFill(pen, String(l.quantity), 36, y, 56, big);
        fitFill(pen, l.name, 98, y, 678, big, 30);
        if (l.note) fitFill(pen, l.note.toUpperCase(), 100, y + 34, 676, MONO(22));
        top += kitchenPitch(l);
        pen.line(36, top, 776, top, 1);
      }

      const part = d.part ? ` · ${d.part.n} OF ${d.part.of}` : '';
      const foot = `TICKET ${d.ticket}${part} · SENT BY ${d.sentBy.toUpperCase()}`;
      fitFill(pen, foot, 36, 579, 480, MONO(20));
      pen.fillText('STICK ON THE RAIL', 776, 579, {
        ...MONO(20),
        align: 'right',
      });
    },
  };
}

// ---- Bitmap --------------------------------------------------------------------------------------

/** 1 bit a dot, rows padded to whole bytes, most significant bit first, 1 = black. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A canvas to draw on and read back. The browser passes an OffscreenCanvas's; tests pass a fake. */
export interface Surface {
  ctx: Canvas2D;
  getImageData(): { data: ArrayLike<number> };
  /** Paints a QR code onto this canvas; without one, receipts print the link alone. */
  qr?: Pen['qr'];
}
export type MakeContext = (width: number, height: number) => Surface;

export const bytesPerRow = (width: number) => Math.ceil(width / 8);

/**
 * Pack RGBA into 1-bit rows. Each dot is laid over white paper first (a transparent dot is paper),
 * then anything darker than mid-grey, luminance under 128, prints.
 */
export function packBitmap(rgba: ArrayLike<number>, width: number, height: number): Bitmap {
  const stride = bytesPerRow(width);
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Luminance in thousandths, in whole numbers, so mid-grey lands exactly on 128 and stays paper.
      const lum = 299 * rgba[i] + 587 * rgba[i + 1] + 114 * rgba[i + 2];
      const onPaper = 255_000 - (rgba[i + 3] * (255_000 - lum)) / 255;
      if (onPaper < 128_000) data[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, data };
}

/** Draw onto a fresh white canvas from `makeContext` and read it back as a 1-bit bitmap. */
export function renderToBitmap(draw: (pen: Pen) => void, width: number, height: number, makeContext: MakeContext): Bitmap {
  const surface = makeContext(width, height);
  const pen = canvasPen(surface.ctx, surface.qr);
  pen.fillRect(0, 0, width, height, true);
  draw(pen);
  return packBitmap(surface.getImageData().data, width, height);
}

/** `renderToBitmap` for a template's layout. */
export const renderLayout = (layout: Layout, makeContext: MakeContext): Bitmap => renderToBitmap(layout.draw, layout.width, layout.height, makeContext);
