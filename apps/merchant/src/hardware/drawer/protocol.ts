/**
 * The drawer's Bluetooth messages (docs/hardware/drawer-protocol.md, Phase 7). One service; an
 * `open` written to its command characteristic, signed with the key the drawer holds from pairing;
 * its state notified on another. A replayed or unsigned command does nothing at the drawer.
 */
export const DRAWER_SERVICE = '6c3a0001-7b52-4c1f-9d3e-5c6c65617201';
export const DRAWER_COMMAND = '6c3a0002-7b52-4c1f-9d3e-5c6c65617201';
export const DRAWER_STATE = '6c3a0003-7b52-4c1f-9d3e-5c6c65617201';

/** `open`, a counter that only goes up, the tablet's time, and an HMAC-SHA256 over them. */
export async function signedOpen(input: { drawerId: string; key: Uint8Array; counter: number; at: number }): Promise<Uint8Array> {
  const body = new Uint8Array(1 + 4 + 8);
  const view = new DataView(body.buffer);
  view.setUint8(0, 0x01);
  view.setUint32(1, input.counter);
  view.setBigUint64(5, BigInt(Math.floor(input.at / 1000)));
  const key = await crypto.subtle.importKey('raw', input.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array([...new TextEncoder().encode(input.drawerId), ...body])));
  const out = new Uint8Array(body.length + 16);
  out.set(body);
  // The first 16 bytes of the MAC: enough against forgery for a till, and one BLE write.
  out.set(signed.slice(0, 16), body.length);
  return out;
}

/** The state characteristic: 0 shut, 1 open. */
export const stateOf = (v: DataView) => (v.getUint8(0) === 1 ? 'opened' : 'shut') as 'opened' | 'shut';
