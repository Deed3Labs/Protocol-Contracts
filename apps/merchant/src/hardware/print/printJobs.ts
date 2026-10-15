import type { PrinterSettings, Receipt } from '@clear/merchant-contracts';
import { encodeFor, type LabelSize } from './encoders';
import { day } from './format';
import {
  LABEL_WIDTH,
  RECEIPT80_WIDTH,
  bagLabel4x3,
  kitchenTicket4x3,
  kitchenTickets,
  receipt4x6,
  receipt80mm,
  renderLayout,
  type BagLabel,
  type KitchenTicket,
  type Layout,
  type MakeContext,
} from './labels';
import { fitFill, type TextStyle } from './pen';

const MONO: TextStyle = { face: 'mono', size: 22, tracking: 2.4 };

/** Something to print, before it knows which printer. */
export type PrintJob =
  | {
      kind: 'receipt';
      receipt: Receipt;
      /** Open a drawer cabled to this printer first. */ kickDrawer?: boolean;
    }
  /** Without `bag`, one label for each bag: BAG 1 OF 2, BAG 2 OF 2. */
  | { kind: 'bagLabel'; label: Omit<BagLabel, 'bag'> & { bag?: number } }
  | { kind: 'kitchenTicket'; ticket: KitchenTicket }
  | { kind: 'test'; shop: string; printer: string; at?: Date };

type Paper = PrinterSettings['paper'];

const HEIGHT: Record<Paper, number | null> = {
  receipt80: null,
  label4x6: 1218,
  label4x3: 609,
};

/** "Print a test label" (Settings › Printers): plain, just enough to see the printer and paper line up. */
export function testLabel(d: { shop: string; printer: string; paper: Paper; at?: Date; timeZone?: string }): Layout {
  const roll = d.paper === 'receipt80';
  const width = roll ? RECEIPT80_WIDTH : LABEL_WIDTH;
  const m = roll ? 16 : 36;
  return {
    width,
    height: HEIGHT[d.paper] ?? 300,
    draw(pen) {
      fitFill(pen, d.shop, m, 66, width - m * 2, {
        face: 'text',
        size: 38,
        weight: 600,
      });
      pen.line(m, 92, width - m, 92, 3);
      fitFill(pen, d.printer, m, 172, width - m * 2, {
        face: 'display',
        size: 60,
        weight: 800,
      });
      pen.fillText(roll ? 'Clear 80mm · 203 dpi' : 'Clear 4-inch · 203 dpi', m, 214, MONO);
      pen.fillText(day(d.at ?? new Date(), d.timeZone), m, 250, MONO);
    },
  };
}

export class PaperMismatch extends Error {}

/** The pages a job prints on this paper, in order. */
export function jobLayouts(job: PrintJob, paper: Paper, opts: { timeZone?: string } = {}): Layout[] {
  switch (job.kind) {
    case 'receipt':
      if (paper === 'receipt80') return [receipt80mm(job.receipt, opts)];
      if (paper === 'label4x6') return [receipt4x6(job.receipt, opts)];
      throw new PaperMismatch('A receipt needs a 4 × 6 label or a receipt roll');
    case 'bagLabel': {
      // 4 × 3 drawings print on 4 × 3 labels, or at the top of a 4 × 6 one.
      if (paper === 'receipt80') throw new PaperMismatch('A bag label needs a 4-inch label printer');
      const { label } = job;
      const tz = label.timeZone ?? opts.timeZone;
      const bags = label.bag ? [label.bag] : Array.from({ length: Math.max(1, label.bags) }, (_, i) => i + 1);
      return bags.map((bag) => bagLabel4x3({ ...label, bag, timeZone: tz }));
    }
    case 'kitchenTicket':
      if (paper === 'receipt80') throw new PaperMismatch('A kitchen ticket needs a 4-inch label printer');
      return kitchenTickets({
        ...job.ticket,
        timeZone: job.ticket.timeZone ?? opts.timeZone,
      }).map(kitchenTicket4x3);
    case 'test':
      return [
        testLabel({
          shop: job.shop,
          printer: job.printer,
          paper,
          at: job.at,
          timeZone: opts.timeZone,
        }),
      ];
  }
}

/** The label stock TSPL is told about: the paper, not the drawing, so a 4 × 3 on 4 × 6 feeds a whole label. */
function labelSize(paper: Paper, height: number): LabelSize {
  if (paper === 'label4x6') return { widthMm: 101.6, heightMm: 152.4, gapMm: 3 };
  if (paper === 'label4x3') return { widthMm: 101.6, heightMm: 76.2, gapMm: 3 };
  return { widthMm: 72, heightMm: Math.ceil(height / 8), gapMm: 0 };
}

/**
 * Everything the printer is sent for a job: each page rendered and encoded, back to back. Null for
 * a printer on the system print dialog, which `lib/printReceipt.ts` handles.
 */
export function jobBytes(job: PrintJob, printer: Pick<PrinterSettings, 'language' | 'paper'>, makeContext: MakeContext, opts: { timeZone?: string } = {}): Uint8Array | null {
  if (printer.language === 'os') return null;
  const pages = jobLayouts(job, printer.paper, opts).map((layout, i) => {
    const bitmap = renderLayout(layout, makeContext);
    const kickDrawer = i === 0 && job.kind === 'receipt' && !!job.kickDrawer;
    return encodeFor(printer.language, bitmap, {
      kickDrawer,
      label: labelSize(printer.paper, bitmap.height),
    }) as Uint8Array;
  });
  const out = new Uint8Array(pages.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pages) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
