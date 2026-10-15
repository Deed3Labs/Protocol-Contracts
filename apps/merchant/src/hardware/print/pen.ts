/**
 * The little drawing surface the print templates draw on. Templates only ever see a `Pen`, so the
 * same layout runs on a real canvas in the browser and on a recording fake in tests. Units are
 * printer dots: 203 to the inch, so a 4-inch label is 812 dots across.
 */

/** The three faces of the terminal drawings: Bricolage Grotesque, Instrument Sans, IBM Plex Mono. */
export type Face = 'display' | 'text' | 'mono';

export interface TextStyle {
  face: Face;
  /** Dots. */
  size: number;
  weight?: 400 | 600 | 800;
  align?: 'left' | 'right' | 'center';
  /** Paper-coloured text, for the kitchen ticket's inverted band. */
  white?: boolean;
  /** Letter spacing in dots, as the drawings set it (the mono lines use 2.4). */
  tracking?: number;
}

export interface Pen {
  fillRect(x: number, y: number, w: number, h: number, white?: boolean): void;
  /** `y` is the baseline, as in the drawings' SVG. */
  fillText(text: string, x: number, y: number, style: TextStyle): void;
  measureText(text: string, style: TextStyle): number;
  line(x1: number, y1: number, x2: number, y2: number, width: number): void;
  strokeRect(x: number, y: number, w: number, h: number, width: number): void;
  /** Draws a QR code for `text` filling the square at x, y. Absent: the template prints the link alone. */
  qr?(text: string, x: number, y: number, size: number): void;
}

/** What `canvasPen` needs from a 2D context: a subset an OffscreenCanvas or HTMLCanvasElement context has. */
export interface Canvas2D {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing?: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
}

const FAMILY: Record<Face, string> = {
  display: '"Bricolage Grotesque", "Instrument Sans", system-ui, sans-serif',
  text: '"Instrument Sans", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
};

const INK = '#000';
const PAPER = '#fff';

/**
 * A Pen over a canvas context. Letter spacing is set only where the canvas supports it; where it
 * doesn't, text draws and measures without it, so fitting still agrees with what prints.
 */
export function canvasPen(ctx: Canvas2D, qr?: Pen['qr']): Pen {
  const tracks = 'letterSpacing' in ctx;
  const set = (s: TextStyle) => {
    ctx.font = `${s.weight ?? 400} ${s.size}px ${FAMILY[s.face]}`;
    ctx.textAlign = s.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    if (tracks) ctx.letterSpacing = `${s.tracking ?? 0}px`;
  };
  const fillRect = (x: number, y: number, w: number, h: number, white?: boolean) => {
    ctx.fillStyle = white ? PAPER : INK;
    ctx.fillRect(x, y, w, h);
  };
  return {
    fillRect,
    fillText(text, x, y, s) {
      set(s);
      ctx.fillStyle = s.white ? PAPER : INK;
      ctx.fillText(text, x, y);
    },
    measureText(text, s) {
      set(s);
      return ctx.measureText(text).width;
    },
    line(x1, y1, x2, y2, width) {
      // Rules are filled as whole dots. A 1-wide stroke on a whole-dot y is anti-aliased into two
      // half-grey rows, and both fall to white at the 1-bit threshold.
      const w = Math.max(1, Math.round(width));
      if (y1 === y2) return fillRect(Math.min(x1, x2), Math.round(y1 - w / 2), Math.abs(x2 - x1), w);
      if (x1 === x2) return fillRect(Math.round(x1 - w / 2), Math.min(y1, y2), w, Math.abs(y2 - y1));
      ctx.strokeStyle = INK;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },
    strokeRect(x, y, w, h, width) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = width;
      ctx.strokeRect(x, y, w, h);
    },
    qr,
  };
}

/**
 * Fit text into `width`: shrink it (tracking with it) down to `minSize`, then cut it with an
 * ellipsis. Names and notes are typed by staff and can be any length; the label can't grow.
 */
export function fitText(pen: Pen, text: string, width: number, style: TextStyle, minSize = Math.round(style.size * 0.7)): { text: string; style: TextStyle } {
  let s = style;
  while (pen.measureText(text, s) > width && s.size > minSize) {
    const size = Math.max(minSize, s.size - 2);
    s = {
      ...s,
      size,
      tracking: style.tracking === undefined ? undefined : (style.tracking * size) / style.size,
    };
  }
  if (pen.measureText(text, s) <= width) return { text, style: s };
  let cut = text;
  while (cut.length > 1 && pen.measureText(`${cut}…`, s) > width) cut = cut.slice(0, -1);
  return { text: `${cut.trimEnd()}…`, style: s };
}

/** Draws text fitted into `width` (see `fitText`). */
export function fitFill(pen: Pen, text: string, x: number, y: number, width: number, style: TextStyle, minSize?: number): void {
  const f = fitText(pen, text, width, style, minSize);
  pen.fillText(f.text, x, y, f.style);
}
