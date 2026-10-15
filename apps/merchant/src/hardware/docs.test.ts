import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRAWER_ANSWER_MS } from './drawer/types';
import { DRAWER_CLOCK_SKEW_S, DRAWER_COMMAND, DRAWER_PAIR, DRAWER_SERVICE, DRAWER_STATE, MAC_BYTES, OP_OPEN, OP_PAIR, pairingMessage, signedOpen } from './drawer/protocol';
import { fakePointRadio } from './fakes/fakePointRadio';
import { DRAWER_PULSE } from './print/encoders';
import { POINT_PROV_SERVICE, pointName } from './point/ble';

/*
 * docs/hardware is what the firmware is built from (Clear Terminal, Phase 7). These keep it and the
 * tablet's code saying the same thing: a constant changed here without the doc, or the other way
 * round, fails.
 */
const docs = join(import.meta.dir, '../../../../docs/hardware');
const drawerDoc = readFileSync(join(docs, 'drawer-protocol.md'), 'utf8');
const pointDoc = readFileSync(join(docs, 'point-device-api.md'), 'utf8');

describe('drawer-protocol.md', () => {
  test('the service and its characteristics', () => {
    for (const uuid of [DRAWER_SERVICE, DRAWER_COMMAND, DRAWER_STATE, DRAWER_PAIR]) expect(drawerDoc).toContain(uuid);
  });

  test('the byte layouts: an open is 29 bytes with a 16-byte MAC; a pairing message as drawn', async () => {
    const open = await signedOpen({ drawerId: 'hw_1', key: new Uint8Array(32), counter: 7, at: 1_760_000_000_000 });
    expect(open.length).toBe(29);
    expect(open[0]).toBe(OP_OPEN);
    expect(MAC_BYTES).toBe(16);
    expect(drawerDoc).toContain('0       1     0x01  (open)');
    expect(drawerDoc).toContain('13      16    MAC');
    const pair = pairingMessage({ drawerId: 'hw_1', key: new Uint8Array(32), at: 0 });
    expect(pair[0]).toBe(OP_PAIR);
    expect(pair.length).toBe(10 + 4 + 32);
    expect(pairingMessage({ drawerId: 'h'.repeat(64), key: new Uint8Array(32), at: 0 }).length).toBe(106);
    expect(drawerDoc).toContain('up to 106 bytes');
  });

  test('the timings and the printer kick', () => {
    expect(drawerDoc).toContain(`${DRAWER_CLOCK_SKEW_S} seconds`);
    expect(drawerDoc).toContain(`${DRAWER_ANSWER_MS / 1000} seconds (\`DRAWER_ANSWER_MS\`)`);
    expect(drawerDoc).toContain(DRAWER_PULSE.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
  });
});

describe('point-device-api.md', () => {
  test('the provisioning service, the advertised name and every endpoint the fake Point has', () => {
    expect(pointDoc).toContain(POINT_PROV_SERVICE);
    expect(pointDoc).toContain('`CLEAR-<code>`');
    expect(pointName('a7k2')).toBe('CLEAR-A7K2');
    const names = [...fakePointRadio({ code: 'A7K2', networks: [] }).peripheral.services.get(POINT_PROV_SERVICE)!.values()].map((c) => c.description);
    for (const n of names) expect(pointDoc).toContain(`\`${n}\``);
  });

  test('the device API routes', () => {
    for (const route of ['POST /api/device/point/activate', 'GET /api/device/point/state', 'GET /api/device/point/stream', 'POST /api/device/point/health', 'POST /api/device/point/event']) {
      expect(pointDoc).toContain(route);
    }
  });
});
