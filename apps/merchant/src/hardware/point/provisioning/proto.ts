/**
 * Just enough protobuf for ESP32 provisioning's messages: varints (enums, bools, uints and the
 * negative int32 of a signal strength), and length-delimited bytes and sub-messages. Field numbers
 * are in `messages.ts`, from Espressif's .proto files.
 */

export type Field = { no: number; varint: bigint } | { no: number; bytes: Uint8Array };

export class Writer {
  private parts: number[] = [];

  private raw(n: bigint) {
    let v = BigInt.asUintN(64, n);
    while (v >= 0x80n) {
      this.parts.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    this.parts.push(Number(v));
  }

  /** An enum, a uint or a bool. Proto3 leaves zeros out, so this does too unless `always`. */
  varint(no: number, v: number | boolean | bigint, always = false): this {
    const n = typeof v === 'boolean' ? (v ? 1n : 0n) : BigInt(v);
    if (n === 0n && !always) return this;
    this.raw(BigInt((no << 3) | 0));
    this.raw(n);
    return this;
  }

  bytes(no: number, b: Uint8Array | string): this {
    const v = typeof b === 'string' ? new TextEncoder().encode(b) : b;
    this.raw(BigInt((no << 3) | 2));
    this.raw(BigInt(v.length));
    this.parts.push(...v);
    return this;
  }

  /** A sub-message: written even when empty, which is how a oneof says which it is. */
  message(no: number, m: Writer): this {
    return this.bytes(no, m.done());
  }

  done(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

export function read(b: Uint8Array): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = () => {
    let v = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= b.length) throw new Error('A varint ran past the message');
      const x = b[i++]!;
      v |= BigInt(x & 0x7f) << shift;
      if (!(x & 0x80)) return v;
      shift += 7n;
    }
  };
  while (i < b.length) {
    const tag = Number(varint());
    const no = tag >> 3;
    const type = tag & 7;
    if (type === 0) out.push({ no, varint: varint() });
    else if (type === 2) {
      const len = Number(varint());
      if (i + len > b.length) throw new Error('A field ran past the message');
      out.push({ no, bytes: b.slice(i, i + len) });
      i += len;
    } else if (type === 5) i += 4;
    else if (type === 1) i += 8;
    else throw new Error(`Wire type ${type} isn't one provisioning uses`);
  }
  return out;
}

/** Reading a message's fields by number, with proto3's zero for what's absent. */
export class Fields {
  private readonly f: Field[];
  constructor(b: Uint8Array) {
    this.f = read(b);
  }
  has(no: number) {
    return this.f.some((x) => x.no === no);
  }
  uint(no: number): number {
    const x = this.f.find((y) => y.no === no);
    return x && 'varint' in x ? Number(BigInt.asUintN(32, x.varint)) : 0;
  }
  int32(no: number): number {
    const x = this.f.find((y) => y.no === no);
    return x && 'varint' in x ? Number(BigInt.asIntN(32, x.varint)) : 0;
  }
  bool(no: number) {
    return this.uint(no) !== 0;
  }
  bytes(no: number): Uint8Array {
    const x = this.f.find((y) => y.no === no);
    return x && 'bytes' in x ? x.bytes : new Uint8Array();
  }
  all(no: number): Uint8Array[] {
    return this.f.filter((y): y is { no: number; bytes: Uint8Array } => y.no === no && 'bytes' in y).map((y) => y.bytes);
  }
  message(no: number): Fields {
    return new Fields(this.bytes(no));
  }
}
