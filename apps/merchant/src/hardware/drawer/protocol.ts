import { concat, utf8 } from '../ble/bytes';

/**
 * The drawer's Bluetooth messages (docs/hardware/drawer-protocol.md, Phase 7). One service:
 *
 *   command  write   `open`, signed with the key the drawer holds from pairing
 *   state    notify  0 shut, 1 open
 *   pair     write   the drawer's id and key, once: a drawer takes it while it has no key, and again
 *                    only after its button is held for a reset
 *
 * A replayed, stale or unsigned command does nothing at the drawer: no error, no open.
 */
export const DRAWER_SERVICE = '6c3a0001-7b52-4c1f-9d3e-5c6c65617201';
export const DRAWER_COMMAND = '6c3a0002-7b52-4c1f-9d3e-5c6c65617201';
export const DRAWER_STATE = '6c3a0003-7b52-4c1f-9d3e-5c6c65617201';
export const DRAWER_PAIR = '6c3a0004-7b52-4c1f-9d3e-5c6c65617201';

export const OP_OPEN = 0x01;
export const OP_PAIR = 0x02;
/** How far the tablet's clock and the drawer's may disagree. */
export const DRAWER_CLOCK_SKEW_S = 300;
/** The MAC's first 16 bytes: enough against forgery for a till, and the command fits one write. */
export const MAC_BYTES = 16;

const hmacKey = (raw: Uint8Array | CryptoKey) =>
  raw instanceof Uint8Array ? crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) : Promise.resolve(raw);

/** The bytes a command's MAC covers: the drawer's id, then the command without its MAC. */
export async function macOf(key: Uint8Array | CryptoKey, drawerId: string, body: Uint8Array): Promise<Uint8Array> {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(key), concat(utf8(drawerId), body));
  return new Uint8Array(mac).slice(0, MAC_BYTES);
}

/** `open` (1 byte), a counter that only goes up (4), the tablet's time in seconds (8), the MAC (16). */
export async function signedOpen(input: { drawerId: string; key: Uint8Array | CryptoKey; counter: number; at: number }): Promise<Uint8Array> {
  const body = new Uint8Array(1 + 4 + 8);
  const v = new DataView(body.buffer);
  v.setUint8(0, OP_OPEN);
  v.setUint32(1, input.counter);
  v.setBigUint64(5, BigInt(Math.floor(input.at / 1000)));
  return concat(body, await macOf(input.key, input.drawerId, body));
}

/** Pairing: `pair` (1), the time (8, which sets the drawer's clock), the id's length (1) and id, the key (32). */
export function pairingMessage(input: { drawerId: string; key: Uint8Array; at: number }): Uint8Array {
  const id = utf8(input.drawerId);
  if (id.length > 64) throw new Error('A drawer id is at most 64 bytes');
  if (input.key.length !== 32) throw new Error('A drawer key is 32 bytes');
  const head = new Uint8Array(1 + 8 + 1);
  const v = new DataView(head.buffer);
  v.setUint8(0, OP_PAIR);
  v.setBigUint64(1, BigInt(Math.floor(input.at / 1000)));
  v.setUint8(9, id.length);
  return concat(head, id, input.key);
}

/** The state characteristic: 0 shut, 1 open. */
export const stateOf = (b: Uint8Array) => (b[0] === 1 ? 'opened' : 'shut') as 'opened' | 'shut';

/**
 * The next counter. It only goes up, and a tablet that lost its count (reinstalled, storage
 * cleared) starts again from the clock, which is ahead of any count it had: opens are rare, seconds
 * aren't.
 */
export const nextCounter = (last: number, nowMs: number) => Math.min(0xffffffff, Math.max(last + 1, Math.floor(nowMs / 1000)));
