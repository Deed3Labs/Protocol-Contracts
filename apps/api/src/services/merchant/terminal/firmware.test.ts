import { beforeAll, describe, expect, test } from 'bun:test';
import { compareFirmware, firmwareSigningPayload, PointFirmware } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { firmwareForPoint, latestFirmware, newSigningKey, publishFirmware, signFirmware, trustedKeys, verifyFirmware, withdrawFirmware } from './firmware.js';
import { listHardware } from './hardware.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const key = newSigningKey('clear-test');
const other = newSigningKey('stranger');
const keys = trustedKeys(`clear-test:${key.publicKey}`);
const image = new Uint8Array(4096).map((_, i) => i % 256);
const release = (version: string, k = key, model: 'point' | 'point_large' = 'point') =>
  signFirmware({ privateKey: k.privateKey, keyId: k.keyId, model, version, url: `https://firmware.example/point/${model}-${version}.bin`, image });

describe('signing a release', () => {
  test('a manifest carries the image’s hash and size, and verifies against the trusted key', () => {
    const m = release('1.0.4');
    expect(PointFirmware.parse(m)).toEqual(m);
    expect(m).toMatchObject({ sizeBytes: 4096, minBattery: 40, keyId: 'clear-test' });
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyFirmware(m, keys)).toBe(true);
  });

  test('change one field and it no longer verifies; a stranger’s key is never trusted', () => {
    const m = release('1.0.4');
    expect(verifyFirmware({ ...m, url: 'https://evil.example/x.bin' }, keys)).toBe(false);
    expect(verifyFirmware({ ...m, sha256: '0'.repeat(64) }, keys)).toBe(false);
    expect(verifyFirmware({ ...m, minBattery: 0 }, keys)).toBe(false);
    expect(verifyFirmware(release('1.0.4', other), keys)).toBe(false);
  });

  test('what is signed is fixed, field by field, for the firmware to rebuild', () => {
    const { signature: _s, ...m } = release('1.0.4');
    expect(firmwareSigningPayload(m).split('\n')).toEqual(['clear-point-firmware/v1', 'point', '1.0.4', m.url, m.sha256, '4096', '40', 'clear-test']);
  });

  test('versions compare as numbers', () => {
    expect(compareFirmware('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareFirmware('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareFirmware('1.0.4', '1.0.4')).toBe(0);
  });
});

describe('publishing', () => {
  test('only signed, only trusted, only newer; the newest not withdrawn is offered', async () => {
    await expect(publishFirmware(db, { manifest: { ...release('1.0.3'), signature: release('1.0.2').signature }, keys })).rejects.toThrow('The signature doesn’t match');
    await expect(publishFirmware(db, { manifest: release('1.0.3', other), keys })).rejects.toThrow('Key stranger isn’t one this server trusts');
    await expect(publishFirmware(db, { manifest: release('1.0.3'), keys: new Map() })).rejects.toThrow('No trusted keys');
    await publishFirmware(db, { manifest: release('1.0.9'), keys });
    await publishFirmware(db, { manifest: release('1.0.10'), keys });
    await expect(publishFirmware(db, { manifest: release('1.0.10'), keys })).rejects.toThrow('isn’t newer than 1.0.10');
    expect((await latestFirmware(db, 'point'))?.version).toBe('1.0.10');
    expect(await latestFirmware(db, 'point_large')).toBeNull();
    expect(await withdrawFirmware(db, { model: 'point', version: '1.0.10' })).toBe(true);
    expect((await latestFirmware(db, 'point'))?.version).toBe('1.0.9');
    // Withdrawn stays withdrawn: the next is published above it, never in its place.
    await expect(publishFirmware(db, { manifest: release('1.0.10'), keys })).rejects.toThrow('isn’t newer');
  });

  test('a Point is offered its own model’s, and Health says whether it runs it', async () => {
    const s = await seedShop(db);
    await db.query(`INSERT INTO merchant.point_keys (code, model) VALUES ('FW01', 'point_large')`);
    const { claimPoint, recordHealth } = await import('./hardware.js');
    const claimed = await claimPoint(db, { merchant: s.merchant, staffId: s.staff.owner, request: { code: 'FW01' }, apiBase: 'https://api.example' });
    expect(await firmwareForPoint(db, claimed.device.id)).toBeNull();
    await publishFirmware(db, { manifest: release('2.1.0', key, 'point_large'), keys });
    expect((await firmwareForPoint(db, claimed.device.id))?.version).toBe('2.1.0');
    const point = { deviceId: claimed.device.id, merchant: s.merchant, code: 'FW01' };
    await recordHealth(db, point, { batteryPercent: 90, pluggedIn: true, rssi: -50, ssid: 'x', firmware: '2.0.9', case: null });
    const health = async () => ((await listHardware(db, s.merchant)).find((d) => d.id === claimed.device.id) as { health: { firmwareCurrent: boolean } }).health;
    expect((await health()).firmwareCurrent).toBe(false);
    await recordHealth(db, point, { batteryPercent: 90, pluggedIn: true, rssi: -50, ssid: 'x', firmware: '2.1.0', case: null });
    expect((await health()).firmwareCurrent).toBe(true);
  });
});
