#!/usr/bin/env bun
/**
 * A fake Clear Drawer on the Bluetooth protocol's message layer, for firmware work and e2e runs
 * with no hardware (Clear Terminal, Phase 6). It reads one message per line on stdin, as hex, and
 * answers each with a JSON line:
 *
 *   pair <hex>    the pairing write        → {"ok":true} or {"ok":false,"why":"…"}
 *   open <hex>    a command write          → {"ok":true,"state":"open"} or {"ok":false,"refused":"replay"}
 *   shut          the till pushed closed   → {"ok":true,"state":"shut"}
 *
 *   bun scripts/fake-drawer.ts --sign --id hw_1 --key <base64> --counter 7
 *     prints the signed `open` the tablet would send, as hex, and exits.
 */
import { createInterface } from 'node:readline';
import { fromBase64 } from '../src/hardware/ble/bytes';
import { DRAWER_COMMAND, DRAWER_PAIR, DRAWER_SERVICE, DRAWER_STATE, signedOpen } from '../src/hardware/drawer/protocol';
import { fakeDrawer } from '../src/hardware/fakes/fakeDrawer';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s.trim(), 'hex'));
const say = (o: unknown) => console.log(JSON.stringify(o));

if (args.includes('--sign')) {
  const out = await signedOpen({ drawerId: opt('id') ?? '', key: fromBase64(opt('key') ?? ''), counter: Number(opt('counter') ?? Math.floor(Date.now() / 1000)), at: Date.now() });
  console.log(hex(out));
  process.exit(0);
}

const drawer = fakeDrawer({ shutAfterMs: null });
const link = drawer.peripheral.link();
let state = 'shut';
await link.notify(DRAWER_SERVICE, DRAWER_STATE, (v) => void (state = v[0] === 1 ? 'open' : 'shut'));

for await (const line of createInterface({ input: process.stdin })) {
  const [verb, body = ''] = line.trim().split(/\s+/, 2);
  try {
    if (verb === 'pair') {
      await link.write(DRAWER_SERVICE, DRAWER_PAIR, unhex(body));
      say({ ok: true });
    } else if (verb === 'open') {
      await link.write(DRAWER_SERVICE, DRAWER_COMMAND, unhex(body));
      say(drawer.lastRefusal ? { ok: false, refused: drawer.lastRefusal } : { ok: true, state });
    } else if (verb === 'shut') {
      drawer.shut();
      say({ ok: true, state });
    } else if (verb) say({ ok: false, why: `Not a message: ${verb}` });
  } catch (e) {
    say({ ok: false, why: e instanceof Error ? e.message : String(e) });
  }
}
