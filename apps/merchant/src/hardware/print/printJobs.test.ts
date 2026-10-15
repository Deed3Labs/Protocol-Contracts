import { describe, expect, test } from 'bun:test';
import type { Receipt } from '@clear/merchant-contracts';
import type { Canvas2D, Pen, TextStyle } from './pen';
import type { MakeContext } from './labels';
import { PaperMismatch, jobBytes, jobLayouts, testLabel, type PrintJob } from './printJobs';

/** A blank canvas: every read comes back white paper, and each size asked for is kept. */
function blank() {
  const sizes: string[] = [];
  const make: MakeContext = (w, h) => {
    sizes.push(`${w}x${h}`);
    const ctx: Canvas2D = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
      measureText: (t) => ({ width: t.length * 12 }),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
    };
    return {
      ctx,
      getImageData: () => ({
        data: new Uint8ClampedArray(w * h * 4).fill(255),
      }),
    };
  };
  return { sizes, make };
}

const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const RECEIPT: Receipt = {
  shop: { name: 'Mi Casa Tacos', address: null },
  orderNumber: 142,
  businessDate: '2026-10-15',
  issuedAt: '2026-10-15T12:41:00-07:00',
  lines: [
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
  subtotalCents: 575,
  discountCents: 0,
  taxCents: 47,
  taxIncluded: false,
  tipCents: 0,
  totalCents: 622,
  tenders: [
    {
      method: 'cash',
      amountCents: 622,
      tipCents: 0,
      card: null,
      changeCents: 378,
      status: 'captured',
    },
  ],
  refundedCents: 0,
  code: '7KQ2M9XHRT',
};

const BAG: PrintJob = {
  kind: 'bagLabel',
  label: {
    shop: 'Mi Casa Tacos',
    partner: null,
    orderNumber: 27,
    customer: 'Ana R.',
    items: 4,
    bags: 2,
    readyAt: null,
    sealedAt: null,
    lines: [],
  },
};

describe('the template follows the paper', () => {
  test('a receipt: 80mm roll or 4 × 6 label; not a 4 × 3', () => {
    expect(jobLayouts({ kind: 'receipt', receipt: RECEIPT }, 'receipt80')[0].width).toBe(576);
    expect(jobLayouts({ kind: 'receipt', receipt: RECEIPT }, 'label4x6').map((l) => [l.width, l.height])).toEqual([[812, 1218]]);
    expect(() => jobLayouts({ kind: 'receipt', receipt: RECEIPT }, 'label4x3')).toThrow(PaperMismatch);
  });
  test('bag labels: one for each bag unless one is asked for; not on a roll', () => {
    expect(jobLayouts(BAG, 'label4x3').map((l) => [l.width, l.height])).toEqual([
      [812, 609],
      [812, 609],
    ]);
    expect(
      jobLayouts(
        {
          kind: 'bagLabel',
          label: {
            ...(BAG.kind === 'bagLabel' ? BAG.label : ({} as never)),
            bag: 2,
          },
        },
        'label4x6',
      ),
    ).toHaveLength(1);
    expect(() => jobLayouts(BAG, 'receipt80')).toThrow(PaperMismatch);
  });
  test('a kitchen ticket on a label; not on a roll', () => {
    const job: PrintJob = {
      kind: 'kitchenTicket',
      ticket: {
        table: 'Table 12',
        service: 'Dine in',
        sentAt: '2026-10-15T19:51:00-07:00',
        lines: [],
        ticket: 3,
        sentBy: 'Jen',
      },
    };
    expect(jobLayouts(job, 'label4x3')).toHaveLength(1);
    expect(() => jobLayouts(job, 'receipt80')).toThrow(PaperMismatch);
  });
});

describe('jobBytes', () => {
  test('ESC/POS receipt on a roll, the drawer pulse first when asked', () => {
    const c = blank();
    const out = jobBytes({ kind: 'receipt', receipt: RECEIPT, kickDrawer: true }, { language: 'escpos', paper: 'receipt80' }, c.make)!;
    expect([...out.subarray(0, 11)]).toEqual([0x1b, 0x70, 0x00, 25, 250, 0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00]);
    expect([out[11], out[12]]).toEqual([72, 0]);
    expect(c.sizes[0].startsWith('576x')).toBe(true);
    expect([...out.subarray(-4)]).toEqual([0x1d, 0x56, 66, 0]);
    const plain = jobBytes({ kind: 'receipt', receipt: RECEIPT }, { language: 'escpos', paper: 'receipt80' }, blank().make)!;
    expect([...plain.subarray(0, 2)]).toEqual([0x1b, 0x40]);
  });
  test('TSPL bag labels, back to back, sized to the label stock', () => {
    const out = text(jobBytes(BAG, { language: 'tspl', paper: 'label4x3' }, blank().make)!);
    expect(count(out, 'SIZE 101.6 mm,76.2 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nBITMAP 0,0,102,609,0,')).toBe(2);
    expect(count(out, 'PRINT 1,1\r\n')).toBe(2);
    const onSix = text(jobBytes(BAG, { language: 'tspl', paper: 'label4x6' }, blank().make)!);
    expect(onSix.startsWith('SIZE 101.6 mm,152.4 mm')).toBe(true);
  });
  test('ZPL receipt on a 4 × 6: a blank page is all zeros', () => {
    const out = text(jobBytes({ kind: 'receipt', receipt: RECEIPT }, { language: 'zpl', paper: 'label4x6' }, blank().make)!);
    const total = 102 * 1218;
    expect(out).toBe(`^XA^FO0,0^GFA,${total},${total},102,${'0'.repeat(total * 2)}^FS^XZ`);
  });
  test('the OS dialog takes no bytes, and nothing is drawn for it', () => {
    const c = blank();
    expect(jobBytes({ kind: 'receipt', receipt: RECEIPT }, { language: 'os', paper: 'receipt80' }, c.make)).toBeNull();
    expect(c.sizes).toEqual([]);
  });
});

describe('test label', () => {
  test('shop, printer, the paper, today', () => {
    const texts: string[] = [];
    const pen: Pen = {
      fillRect: () => {},
      fillText: (t: string) => void texts.push(t),
      measureText: (t: string, s: TextStyle) => t.length * s.size * 0.55,
      line: () => {},
      strokeRect: () => {},
    };
    const at = new Date('2026-10-15T19:51:00-07:00');
    const layout = testLabel({
      shop: 'Mi Casa Tacos',
      printer: 'Counter printer',
      paper: 'label4x3',
      at,
      timeZone: 'America/Los_Angeles',
    });
    layout.draw(pen);
    expect([layout.width, layout.height]).toEqual([812, 609]);
    expect(texts).toEqual(['Mi Casa Tacos', 'Counter printer', 'Clear 4-inch · 203 dpi', 'OCT 15, 2026']);
    expect(jobLayouts({ kind: 'test', shop: 'A', printer: 'B' }, 'receipt80')[0].width).toBe(576);
  });
});
