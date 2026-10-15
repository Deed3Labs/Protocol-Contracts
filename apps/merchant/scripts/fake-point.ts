#!/usr/bin/env bun
/**
 * A fake Clear Point on the device API, for e2e runs with no hardware (Clear Terminal, Phase 6).
 *
 *   bun scripts/fake-point.ts --api http://localhost:3001 --code A7K2 --secret <from the claim>
 *   bun scripts/fake-point.ts --api … --key <device key>        already activated
 *
 *   --press call|bill    press a Pay case button after the first screen
 *   --health             report battery 82%, the Pay case and firmware 1.0.3 on start
 *   --stream             hold the event stream instead of long-polling
 *   --screens N          stop after N screens (default: run until stopped)
 *
 * Prints one JSON line per thing that happens: activated, health, state (each screen), pressed.
 */
import { FakePointDevice } from './lib/fakePoint';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const has = (name: string) => args.includes(`--${name}`);
const say = (o: unknown) => console.log(JSON.stringify(o));

const api = opt('api') ?? 'http://localhost:3001';
const point = new FakePointDevice(api, opt('key'));
const limit = Number(opt('screens') ?? Infinity);
let screens = 0;
let pressed = false;

async function onScreen(screen: unknown) {
  screens += 1;
  say({ event: 'state', etag: point.etag, screen });
  const press = opt('press');
  if (press && !pressed) {
    pressed = true;
    say({ event: 'pressed', ...(await point.press(press as 'call' | 'bill')) });
  }
  if (screens >= limit) process.exit(0);
}

try {
  if (!point.key) {
    const code = opt('code');
    const secret = opt('secret');
    if (!code || !secret) throw new Error('--code and --secret, or --key');
    say({ event: 'activated', deviceKey: await point.activate(code, secret) });
  }
  if (has('health')) {
    await point.health({ batteryPercent: 82, pluggedIn: false, rssi: -61, ssid: 'MiCasa-Staff', firmware: '1.0.3', case: { kind: 'pay', buttons: 'ok' } });
    say({ event: 'health' });
  }
  if (has('stream')) point.stream((s) => void onScreen(s));
  else
    for (;;) {
      const s = await point.state(screens > 0);
      if (s) await onScreen(s);
    }
} catch (e) {
  say({ event: 'error', message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
}
