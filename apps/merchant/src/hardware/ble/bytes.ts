/** Bytes, as the Bluetooth and socket layers pass them. */

export const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
export const bytesOf = (v: DataView) => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const text = (b: Uint8Array) => new TextDecoder().decode(b);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
