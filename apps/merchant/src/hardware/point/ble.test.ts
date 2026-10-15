import { describe, expect, test } from 'bun:test';
import type { ClaimedPoint } from '@clear/merchant-contracts';
import { fakePointRadio, type FakeNetwork } from '../fakes/fakePointRadio';
import { memoryCentral } from '../fakes/peripheral';
import { blePoints } from './ble';
import { bleEndpoints } from './provisioning/ble';
import { ProvisioningClient } from './provisioning/client';
import { POINT_PROV_SERVICE } from './ble';
import { CtrStream } from './provisioning/sec1';
import { Fields, Writer } from './provisioning/proto';

const NETWORKS: FakeNetwork[] = [
  { ssid: 'MiCasa-Guest', password: '', rssi: -48, auth: 0, portal: true },
  { ssid: 'MiCasa-Staff', password: 'tacos4ever', rssi: -55 },
  { ssid: 'MiCasa-Staff', password: 'tacos4ever', rssi: -70 },
  { ssid: 'Corp', password: 'x', rssi: -80, auth: 5 },
  { ssid: 'Neighbour', password: 'y', rssi: -75 },
];
const claimed = { provisioning: { secret: 's'.repeat(40), apiBase: 'https://api.example', expiresAt: '2026-10-15T20:10:00Z' } } as unknown as ClaimedPoint;

function rig(networks = NETWORKS) {
  const point = fakePointRadio({ code: 'A7K2', networks, battery: 82 });
  return { point, svc: blePoints(() => memoryCentral([point.peripheral]), { pollMs: 1 }) };
}

describe('protobuf, as provisioning uses it', () => {
  test('a negative signal strength, a zero left out, an empty message kept', () => {
    const b = new Writer().varint(3, -55).varint(2, 0).message(10, new Writer()).done();
    const f = new Fields(b);
    expect(f.int32(3)).toBe(-55);
    expect(f.has(2)).toBe(false);
    expect(f.has(10)).toBe(true);
  });

  test('the CTR stream runs on across messages, in both directions', async () => {
    const key = new Uint8Array(32).fill(7);
    const iv = new Uint8Array(16).fill(0xff); // the counter wraps from here
    const a = new CtrStream(key, iv);
    const b = new CtrStream(key, iv);
    const one = await a.xor(new Uint8Array(20).fill(1));
    const two = await a.xor(new Uint8Array(13).fill(2));
    expect([...(await b.xor(one))]).toEqual(new Array(20).fill(1));
    expect([...(await b.xor(two))]).toEqual(new Array(13).fill(2));
  });
});

describe('setting up a Point over Bluetooth (section 2)', () => {
  test('find: its code, firmware and battery, after a session with its code as proof', async () => {
    expect(await rig().svc.find('a7k2')).toEqual({ code: 'A7K2', firmware: '1.0.3', battery: 82 });
  });

  test('networks: one row per name at its strongest, strongest first; enterprise can’t take a Point', async () => {
    expect(await rig().svc.networks('A7K2')).toEqual([
      { ssid: 'MiCasa-Guest', det: 'Strong signal', usable: true },
      { ssid: 'MiCasa-Staff', det: 'Strong signal', usable: true },
      { ssid: 'Neighbour', det: 'Weak signal', usable: true },
      { ssid: 'Corp', det: 'Asks for a username, so a Point can’t use it', usable: false },
    ]);
  });

  test('provision: the setup secret, the Wi-Fi, joined, and Clear reached', async () => {
    const r = rig();
    await r.svc.provision('A7K2', { ssid: 'MiCasa-Staff', password: 'tacos4ever', claimed });
    expect(r.point.claim).toEqual({ code: 'A7K2', secret: 's'.repeat(40), apiBase: 'https://api.example' });
    expect(r.point.joined).toBe('MiCasa-Staff');
    expect(r.point.peripheral.connected).toBe(false);
  });

  test('a wrong password, a network it can’t see, and a sign-in page each say so', async () => {
    await expect(rig().svc.provision('A7K2', { ssid: 'MiCasa-Staff', password: 'nope', claimed })).rejects.toThrow('That password didn’t work');
    await expect(rig().svc.provision('A7K2', { ssid: 'Elsewhere', password: 'x', claimed })).rejects.toThrow('The Point can’t see that network');
    await expect(rig().svc.provision('A7K2', { ssid: 'MiCasa-Guest', password: '', claimed })).rejects.toThrow('Has a sign-in page, so a Point can’t use it');
  });

  test('without the Point’s code there is no session, so nothing else can be asked', async () => {
    const point = fakePointRadio({ code: 'A7K2', networks: NETWORKS });
    const link = await memoryCentral([point.peripheral]).connect(point.peripheral.id);
    const client = new ProvisioningClient(await bleEndpoints(link, POINT_PROV_SERVICE), 'ZZZZ');
    await expect(client.session()).rejects.toThrow('That isn’t this Point’s code');
    await expect(point.peripheral.link().write(POINT_PROV_SERVICE, '6c3a1006-7b52-4c1f-9d3e-5c6c65617201', new Uint8Array([1]))).rejects.toThrow('No session');
    expect(point.claim).toBeNull();
  });

  test('the secret never crosses in the clear', async () => {
    const r = rig();
    await r.svc.provision('A7K2', { ssid: 'MiCasa-Staff', password: 'tacos4ever', claimed });
    const seen = r.point.peripheral.writes.map((w) => new TextDecoder('latin1').decode(w.value)).join('');
    expect(seen).not.toContain('s'.repeat(40));
    expect(seen).not.toContain('tacos4ever');
  });
});
