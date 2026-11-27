import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { compareFirmware, firmwareSigningPayload, PointFirmware } from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';

/**
 * Point firmware releases (docs/hardware/point-device-api.md, 7).
 *
 * A release is a manifest signed with Ed25519. The private key stays with whoever releases (the
 * owner, kept in a password manager; later the firmware repo's release job behind an approval); this
 * server never holds it. It only checks a manifest against the public keys it trusts
 * (`POINT_FIRMWARE_KEYS`) before publishing it, and the Point checks again against the keys built
 * into it before installing. So a server that is broken into can withdraw an update, never forge one.
 */

export type PointModel = PointFirmware['model'];

export class FirmwareError extends Error {}

/** Ed25519's SPKI header: a raw 32-byte public key after it is the key as Node takes it. */
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const publicKeyOf = (raw: string) => createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(raw, 'base64')]), format: 'der', type: 'spki' });

/** A new signing key: the private half (PKCS#8, base64) for the key holder, the public half (raw 32 bytes, base64) for the firmware and `POINT_FIRMWARE_KEYS`. */
export function newSigningKey(keyId: string): { keyId: string; privateKey: string; publicKey: string } {
  if (!/^[a-z0-9-]{1,40}$/.test(keyId)) throw new FirmwareError('A key id is lower-case letters, digits and dashes');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    keyId,
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(SPKI_ED25519.length).toString('base64'),
  };
}

/** Sign an image's manifest. Runs where the private key is, never on the server. */
export function signFirmware(input: { privateKey: string; keyId: string; model: PointModel; version: string; url: string; image: Uint8Array; minBattery?: number }): PointFirmware {
  const unsigned = {
    model: input.model,
    version: input.version,
    url: input.url,
    sha256: createHash('sha256').update(input.image).digest('hex'),
    sizeBytes: input.image.length,
    minBattery: input.minBattery ?? 40,
    keyId: input.keyId,
  };
  const key = createPrivateKey({ key: Buffer.from(input.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const manifest = { ...unsigned, signature: sign(null, Buffer.from(firmwareSigningPayload(unsigned), 'utf8'), key).toString('base64') };
  const parsed = PointFirmware.safeParse(manifest);
  if (!parsed.success) throw new FirmwareError(parsed.error.issues[0]?.message ?? 'That manifest isn’t valid');
  return parsed.data;
}

/** `POINT_FIRMWARE_KEYS`: `keyId:base64,keyId:base64`, the public keys the firmware also carries. */
export function trustedKeys(env = process.env.POINT_FIRMWARE_KEYS ?? ''): Map<string, string> {
  const keys = new Map<string, string>();
  for (const pair of env.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [id, raw] = pair.split(':');
    if (id && raw && Buffer.from(raw, 'base64').length === 32) keys.set(id, raw);
  }
  return keys;
}

export function verifyFirmware(m: PointFirmware, keys: Map<string, string>): boolean {
  const raw = keys.get(m.keyId);
  if (!raw) return false;
  const { signature, ...unsigned } = m;
  try {
    return verify(null, Buffer.from(firmwareSigningPayload(unsigned), 'utf8'), publicKeyOf(raw), Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

interface ReleaseRow {
  model: PointModel;
  version: string;
  url: string;
  sha256: string;
  size_bytes: number;
  min_battery: number;
  key_id: string;
  signature: string;
}
const toManifest = (r: ReleaseRow): PointFirmware => ({
  model: r.model,
  version: r.version,
  url: r.url,
  sha256: r.sha256,
  sizeBytes: Number(r.size_bytes),
  minBattery: Number(r.min_battery),
  keyId: r.key_id,
  signature: r.signature,
});

/** The newest release for a model that hasn't been withdrawn. */
export async function latestFirmware(q: Queryable, model: PointModel): Promise<PointFirmware | null> {
  const { rows } = await q.query<ReleaseRow>('SELECT * FROM merchant.firmware_releases WHERE model = $1 AND withdrawn_at IS NULL', [model]);
  const newest = rows.sort((a, b) => compareFirmware(b.version, a.version))[0];
  return newest ? toManifest(newest) : null;
}

/** Publish a signed manifest: it must verify against a trusted key and be newer than any published for its model. */
export async function publishFirmware(db: Db, input: { manifest: unknown; keys?: Map<string, string> }): Promise<PointFirmware> {
  const parsed = PointFirmware.safeParse(input.manifest);
  if (!parsed.success) throw new FirmwareError(parsed.error.issues[0]?.message ?? 'That manifest isn’t valid');
  const m = parsed.data;
  const keys = input.keys ?? trustedKeys();
  if (!keys.size) throw new FirmwareError('No trusted keys: set POINT_FIRMWARE_KEYS');
  if (!verifyFirmware(m, keys)) throw new FirmwareError(keys.has(m.keyId) ? 'The signature doesn’t match the manifest' : `Key ${m.keyId} isn’t one this server trusts`);
  const { rows } = await db.query<{ version: string }>('SELECT version FROM merchant.firmware_releases WHERE model = $1', [m.model]);
  const newest = rows.map((r) => r.version).sort((a, b) => compareFirmware(b, a))[0];
  if (newest && compareFirmware(m.version, newest) <= 0) throw new FirmwareError(`${m.model} ${m.version} isn’t newer than ${newest}`);
  await db.query(
    `INSERT INTO merchant.firmware_releases (id, model, version, url, sha256, size_bytes, min_battery, key_id, signature) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [`fw_${randomUUID()}`, m.model, m.version, m.url, m.sha256, m.sizeBytes, m.minBattery, m.keyId, m.signature],
  );
  return m;
}

/** Withdraw a release: no Point is offered it again. */
export async function withdrawFirmware(db: Db, input: { model: PointModel; version: string }): Promise<boolean> {
  const { rows } = await db.query('UPDATE merchant.firmware_releases SET withdrawn_at = now() WHERE model = $1 AND version = $2 AND withdrawn_at IS NULL RETURNING id', [input.model, input.version]);
  return rows.length > 0;
}

/** What `GET /api/device/point/firmware` answers a Point: its model's newest, or null. */
export async function firmwareForPoint(q: Queryable, deviceId: string): Promise<PointFirmware | null> {
  const { rows } = await q.query<{ model: PointModel }>('SELECT model FROM merchant.point_keys WHERE device_id = $1', [deviceId]);
  return rows[0] ? latestFirmware(q, rows[0].model) : null;
}
