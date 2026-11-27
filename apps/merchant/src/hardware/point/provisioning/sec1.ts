import { x25519 } from '@noble/curves/ed25519';

/**
 * Security 1 of ESP32 provisioning: an X25519 exchange, the shared secret XORed with SHA-256 of the
 * proof of possession, and AES-256-CTR from there. One counter stream runs through the whole
 * session, in both directions, in the order messages are sent: the verify step, then every request
 * and every response. Both ends keep it in step by encrypting and decrypting in the same order.
 */

export class CtrStream {
  private offset = 0;
  private readonly key: Promise<CryptoKey>;
  private readonly iv: Uint8Array;

  constructor(secret: Uint8Array, iv: Uint8Array) {
    if (secret.length !== 32 || iv.length !== 16) throw new Error('A 32-byte key and a 16-byte IV');
    this.key = crypto.subtle.importKey('raw', secret, 'AES-CTR', false, ['encrypt']);
    this.iv = iv;
  }

  /** XOR with the next `data.length` bytes of the stream (encrypting and decrypting are the same). */
  async xor(data: Uint8Array): Promise<Uint8Array> {
    const block = Math.floor(this.offset / 16);
    const skip = this.offset % 16;
    const counter = addToCounter(this.iv, block);
    const stream = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CTR', counter, length: 128 }, await this.key, new Uint8Array(skip + data.length)));
    this.offset += data.length;
    return data.map((b, i) => b ^ stream[skip + i]!);
  }
}

/** The 128-bit big-endian counter block, moved on by n blocks. */
function addToCounter(iv: Uint8Array, n: number): Uint8Array {
  const out = iv.slice();
  let carry = n;
  for (let i = 15; i >= 0 && carry > 0; i -= 1) {
    const sum = out[i]! + (carry & 0xff);
    out[i] = sum & 0xff;
    carry = Math.floor(carry / 256) + (sum >> 8);
  }
  return out;
}

export async function sharedSecret(ourPrivate: Uint8Array, theirPublic: Uint8Array, pop: string | null): Promise<Uint8Array> {
  const shared = x25519.getSharedSecret(ourPrivate, theirPublic);
  if (!pop) return shared;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pop)));
  return shared.map((b, i) => b ^ digest[i]!);
}

export const newKeyPair = () => {
  const priv = x25519.utils.randomPrivateKey();
  return { priv, pub: x25519.getPublicKey(priv) };
};
