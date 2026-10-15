import type { MakeContext, Surface } from '../print/labels';

/** A browser canvas for the label renderer, at the label's dots. */
export const browserCanvas: MakeContext = (width, height) => {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d') as unknown as Surface['ctx'] & {
    getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
  };
  return { ctx, getImageData: () => ctx.getImageData(0, 0, width, height) };
};
