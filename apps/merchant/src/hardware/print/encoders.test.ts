import { describe, expect, test } from 'bun:test';
import { DRAWER_PULSE, encodeFor, escposRaster, tsplBitmap, zplGraphic } from './encoders';
import type { Bitmap } from './labels';

const bytes = (...parts: (string | number[])[]) => [...parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p))];

/** 8 × 2: one byte a row. */
const small: Bitmap = {
  width: 8,
  height: 2,
  data: new Uint8Array([0b1011_0001, 0xff]),
};
/** 16 × 3: two bytes a row. */
const wide: Bitmap = {
  width: 16,
  height: 3,
  data: new Uint8Array([0x80, 0x01, 0x0f, 0xf0, 0xaa, 0x55]),
};

describe('ESC/POS raster', () => {
  test('init, GS v 0 with bytes per row and rows little-endian, the data, then feed and partial cut', () => {
    expect([...escposRaster(small)]).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0xb1, 0xff, 0x1d, 0x56, 66, 0]);
    expect([...escposRaster(wide)]).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 2, 0, 3, 0, 0x80, 0x01, 0x0f, 0xf0, 0xaa, 0x55, 0x1d, 0x56, 66, 0]);
  });
  test('kickDrawer puts the pin-2 pulse, ESC p 0 25 250, in front', () => {
    expect(DRAWER_PULSE).toEqual([0x1b, 0x70, 0x00, 25, 250]);
    expect([...escposRaster(small, { kickDrawer: true })]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0xb1, 0xff, 0x1d, 0x56, 66, 0]);
  });
  test('rows over 255 use the high byte; past 2303 rows the image goes as bands', () => {
    const tall: Bitmap = {
      width: 576,
      height: 2400,
      data: new Uint8Array(72 * 2400).fill(0x0f),
    };
    const out = escposRaster(tall);
    expect([...out.subarray(0, 10)]).toEqual([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 72, 0, 2303 & 0xff, 2303 >> 8]);
    const second = 10 + 72 * 2303;
    expect([...out.subarray(second, second + 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 72, 0, 97, 0]);
    expect(out.length).toBe(2 + 8 * 2 + 72 * 2400 + 4);
  });
});

describe('TSPL bitmap', () => {
  test('size, gap, clear, BITMAP with every bit flipped (mode 0: 1 is white), print one', () => {
    expect([...tsplBitmap(small, { widthMm: 101.6, heightMm: 76.2, gapMm: 3 })]).toEqual(
      bytes('SIZE 101.6 mm,76.2 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nBITMAP 0,0,1,2,0,', [0b0100_1110, 0x00], '\r\nPRINT 1,1\r\n'),
    );
    expect([...tsplBitmap(wide, { widthMm: 101.6, heightMm: 152.4, gapMm: 2 })]).toEqual(
      bytes('SIZE 101.6 mm,152.4 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nBITMAP 0,0,2,3,0,', [0x7f, 0xfe, 0xf0, 0x0f, 0x55, 0xaa], '\r\nPRINT 1,1\r\n'),
    );
  });
  test('row padding flips to white too', () => {
    const ten: Bitmap = {
      width: 10,
      height: 1,
      data: new Uint8Array([0xff, 0b1100_0000]),
    };
    const out = tsplBitmap(ten, { widthMm: 1, heightMm: 1, gapMm: 0 });
    const head = bytes('SIZE 1 mm,1 mm\r\nGAP 0 mm,0 mm\r\nCLS\r\nBITMAP 0,0,2,1,0,').length;
    expect([...out.subarray(head, head + 2)]).toEqual([0x00, 0b0011_1111]);
  });
});

describe('ZPL graphic', () => {
  test('total bytes twice, bytes per row, uppercase hex, uncompressed', () => {
    expect(new TextDecoder().decode(zplGraphic(small))).toBe('^XA^FO0,0^GFA,2,2,1,B1FF^FS^XZ');
    expect(new TextDecoder().decode(zplGraphic(wide))).toBe('^XA^FO0,0^GFA,6,6,2,80010FF0AA55^FS^XZ');
  });
});

describe('encodeFor', () => {
  test('dispatches on the printer language; the OS dialog takes no bytes', () => {
    expect(encodeFor('escpos', small, { kickDrawer: true })).toEqual(escposRaster(small, { kickDrawer: true }));
    expect(encodeFor('zpl', wide)).toEqual(zplGraphic(wide));
    const size = { widthMm: 101.6, heightMm: 76.2, gapMm: 3 };
    expect(encodeFor('tspl', wide, { label: size })).toEqual(tsplBitmap(wide, size));
    expect(encodeFor('tspl', wide)).toEqual(tsplBitmap(wide, { widthMm: 2, heightMm: 0.375, gapMm: 3 }));
    expect(encodeFor('os', small)).toBeNull();
  });
});
