import type { PrinterSettings } from '@clear/merchant-contracts';
import { bytesPerRow, type Bitmap } from './labels';

/**
 * A 1-bit bitmap into the bytes each printer language takes. Everything prints as one image, so
 * the label looks the same on every printer and no printer font is involved.
 */

const ascii = (s: string) => new TextEncoder().encode(s);

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** ESC p 0 25 250: a pulse on pin 2, which opens a drawer cabled to the printer. */
export const DRAWER_PULSE = [0x1b, 0x70, 0x00, 25, 250];

/** Epson's ceiling on one `GS v 0` image's height; taller receipts go as several bands. */
const ESCPOS_MAX_ROWS = 2303;

/**
 * ESC/POS: initialise, the raster (`GS v 0`, normal density), then feed to the cutter and cut
 * partway (`GS V 66 0`), leaving a tab so the receipt doesn't drop.
 */
export function escposRaster(b: Bitmap, opts: { kickDrawer?: boolean } = {}): Uint8Array {
  const stride = bytesPerRow(b.width);
  const parts: (Uint8Array | number[])[] = [];
  if (opts.kickDrawer) parts.push(DRAWER_PULSE);
  parts.push([0x1b, 0x40]);
  for (let y = 0; y < b.height; y += ESCPOS_MAX_ROWS) {
    const rows = Math.min(ESCPOS_MAX_ROWS, b.height - y);
    parts.push([0x1d, 0x76, 0x30, 0x00, stride & 0xff, stride >> 8, rows & 0xff, rows >> 8]);
    parts.push(b.data.subarray(y * stride, (y + rows) * stride));
  }
  parts.push([0x1d, 0x56, 66, 0]);
  return concat(parts);
}

export interface LabelSize {
  widthMm: number;
  heightMm: number;
  /** The gap between labels on the roll. */
  gapMm: number;
}

/**
 * TSPL (TSC, Xprinter, most 4-inch label printers): size the label, clear, the bitmap, print one.
 * BITMAP mode 0 takes 1 as white, the other way round from ours, so every bit is flipped; the row
 * padding flips to white with it.
 */
export function tsplBitmap(b: Bitmap, size: LabelSize): Uint8Array {
  const stride = bytesPerRow(b.width);
  const data = b.data.map((x) => ~x & 0xff);
  return concat([ascii(`SIZE ${size.widthMm} mm,${size.heightMm} mm\r\nGAP ${size.gapMm} mm,0 mm\r\nCLS\r\nBITMAP 0,0,${stride},${b.height},0,`), data, ascii('\r\nPRINT 1,1\r\n')]);
}

/** ZPL (Zebra): one graphic field at the corner, ASCII hex, uncompressed. ZPL's 1 is black, like ours. */
export function zplGraphic(b: Bitmap): Uint8Array {
  const stride = bytesPerRow(b.width);
  let hex = '';
  for (const x of b.data) hex += x.toString(16).toUpperCase().padStart(2, '0');
  return ascii(`^XA^FO0,0^GFA,${b.data.length},${b.data.length},${stride},${hex}^FS^XZ`);
}

export type PrinterLanguage = PrinterSettings['language'];

export interface EncodeOptions {
  kickDrawer?: boolean;
  /** TSPL needs the label's size. Absent: the bitmap's own, at 8 dots a millimetre, 3mm gaps. */
  label?: LabelSize;
}

/**
 * Bytes for the printer's language. `os` is the system print dialog (`lib/printReceipt.ts`), which
 * takes no bytes: null.
 */
export function encodeFor(language: PrinterLanguage, b: Bitmap, opts: EncodeOptions = {}): Uint8Array | null {
  switch (language) {
    case 'escpos':
      return escposRaster(b, { kickDrawer: opts.kickDrawer });
    case 'tspl':
      return tsplBitmap(
        b,
        opts.label ?? {
          widthMm: b.width / 8,
          heightMm: b.height / 8,
          gapMm: 3,
        },
      );
    case 'zpl':
      return zplGraphic(b);
    case 'os':
      return null;
  }
}
