import { randomBytes, randomUUID } from 'node:crypto';
import {
  AddDevice,
  ClaimPoint,
  compareFirmware,
  DEFAULT_IDLE_MODE,
  DrawerSettings,
  PointHealthReport,
  PointSettings,
  PrinterSettings,
  UpdateDevice,
  type ClaimedPoint,
  type Device,
  type DrawerKey,
  type PointHealth,
} from '@clear/merchant-contracts';
import type { Db, Queryable } from '../../../db/db.js';
import { decryptWithEnvelope, encryptWithEnvelope, isEnvelopeEncryptionConfigured } from '../../../utils/envelopeEncryption.js';
import { audit } from '../security/audit.js';
import { businessDate } from '../orders/orderService.js';
import { touchShop } from './bus.js';
import { latestFirmware } from './firmware.js';
import { secret, sha256 } from './codes.js';
import { pointStateFor } from './pointState.js';
import { TerminalError } from './errors.js';

export { TerminalError, TERMINAL_STATUS } from './errors.js';

/**
 * Counter hardware (terminal reference, sections 1–4): Points, drawers and printers, at
 * `/api/merchant/hardware`. The server keeps their settings and a Point's key; it never reaches a
 * drawer or a printer itself (the tablet does).
 */

const issue = (r: { error: { issues: Array<{ message: string }> } }, fallback: string) => r.error.issues[0]?.message ?? fallback;

interface HardwareRow {
  id: string;
  merchant: string;
  kind: 'point' | 'drawer' | 'printer';
  name: string;
  settings: Record<string, unknown> | string;
  created_at: Date | string;
}

const json = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);
const iso = (d: Date | string) => new Date(d).toISOString();

/**
 * The firmware a Point should run: its model's newest published release, or `POINT_FIRMWARE_LATEST`
 * before any release is published. Neither: every Point is current.
 */
const envFirmware = () => (process.env.POINT_FIRMWARE_LATEST || '').trim() || null;

async function shopZone(q: Queryable, merchant: string): Promise<string> {
  const { rows } = await q.query<{ timezone: string }>('SELECT timezone FROM merchant.profiles WHERE merchant = $1', [merchant]);
  return rows[0]?.timezone ?? 'America/Los_Angeles';
}

async function toDevice(q: Queryable, row: HardwareRow, now: Date): Promise<Device> {
  const base = { id: row.id, shop: row.merchant, name: row.name, createdAt: iso(row.created_at) };
  if (row.kind === 'point') {
    const { rows } = await q.query<{ code: string; model: 'point' | 'point_large'; health: Omit<PointHealth, 'lastSeenAt' | 'firmwareCurrent'> | string | null; last_seen_at: Date | string | null }>(
      'SELECT code, model, health, last_seen_at FROM merchant.point_keys WHERE device_id = $1',
      [row.id],
    );
    const k = rows[0]!;
    const reported = k.health ? json<Omit<PointHealth, 'lastSeenAt' | 'firmwareCurrent'>>(k.health) : null;
    const latest = (await latestFirmware(q, k.model))?.version ?? envFirmware();
    const current = (v: string) => latest === null || (/^\d+\.\d+\.\d+$/.test(v) ? compareFirmware(v, latest) >= 0 : v === latest);
    const health: PointHealth | null = reported && k.last_seen_at ? { ...reported, lastSeenAt: iso(k.last_seen_at), firmwareCurrent: current(reported.firmware) } : null;
    const { state } = await pointStateFor(q, row.id, now);
    return { ...base, kind: 'point', code: k.code, model: k.model, settings: json(row.settings) as PointSettings, health, showing: state };
  }
  if (row.kind === 'drawer') {
    const tz = await shopZone(q, row.merchant);
    const { rows: last } = await q.query<{ kind: 'opened' | 'shut'; at: Date | string }>(
      'SELECT kind, at FROM payments.drawer_events WHERE drawer_id = $1 ORDER BY at DESC, seq DESC LIMIT 1',
      [row.id],
    );
    const { rows: today } = await q.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM payments.drawer_events WHERE drawer_id = $1 AND kind = 'opened' AND reason <> 'key' AND (at AT TIME ZONE $2)::date = $3::date`,
      [row.id, tz, businessDate(tz, now)],
    );
    return {
      ...base,
      kind: 'drawer',
      settings: json(row.settings) as DrawerSettings,
      status: { open: last[0] ? last[0].kind === 'opened' : null, lastEventAt: last[0] ? iso(last[0].at) : null, opensToday: Number(today[0]?.n ?? 0) },
    };
  }
  return { ...base, kind: 'printer', settings: json(row.settings) as PrinterSettings };
}

export async function listHardware(q: Queryable, merchant: string, now = new Date()): Promise<Device[]> {
  const { rows } = await q.query<HardwareRow>(
    `SELECT * FROM merchant.hardware WHERE merchant = $1 AND removed_at IS NULL
      ORDER BY CASE kind WHEN 'point' THEN 0 WHEN 'drawer' THEN 1 ELSE 2 END, created_at`,
    [merchant],
  );
  return Promise.all(rows.map((r) => toDevice(q, r, now)));
}

async function hardwareRow(q: Queryable, merchant: string, id: string, kind?: HardwareRow['kind']): Promise<HardwareRow> {
  const { rows } = await q.query<HardwareRow>('SELECT * FROM merchant.hardware WHERE id = $1 AND merchant = $2 AND removed_at IS NULL', [id, merchant]);
  const row = rows[0];
  if (!row || (kind && row.kind !== kind)) throw new TerminalError(kind === 'point' ? 'No such Point' : kind === 'drawer' ? 'No such drawer' : 'No such device', 'not_found');
  return row;
}

export async function getDevice(q: Queryable, merchant: string, id: string, now = new Date()): Promise<Device> {
  return toDevice(q, await hardwareRow(q, merchant, id), now);
}

// ---- Checks across the shop's records ----------------------------------------------------------------

async function checkDrawer(q: Queryable, merchant: string, s: DrawerSettings): Promise<void> {
  if (s.pairedTabletId) {
    const { rows } = await q.query('SELECT 1 FROM merchant.devices WHERE id = $1 AND merchant = $2 AND revoked_at IS NULL', [s.pairedTabletId, merchant]);
    if (!rows[0]) throw new TerminalError('That tablet isn’t one of the shop’s', 'invalid');
  }
  if (s.cabledToPrinter && !s.printerId) throw new TerminalError('Pick the printer it’s cabled to', 'invalid');
  if (!s.cabledToPrinter && !s.bluetoothId) throw new TerminalError('A Bluetooth drawer needs its id', 'invalid');
  if (s.printerId) await hardwareRow(q, merchant, s.printerId, 'printer').catch(() => {
    throw new TerminalError('That printer isn’t one of the shop’s', 'invalid');
  });
}

async function checkPoint(q: Queryable, merchant: string, pointId: string, s: PointSettings): Promise<void> {
  if (s.tableId) {
    const { rows } = await q.query('SELECT 1 FROM merchant.tables WHERE id = $1 AND merchant = $2 AND removed_at IS NULL', [s.tableId, merchant]);
    if (!rows[0]) throw new TerminalError('That table isn’t one of the shop’s', 'invalid');
  }
  if (s.placement === 'table' && !s.tableId) throw new TerminalError('A Point at a table needs its table', 'invalid');
  if (s.readerId) {
    const { rows } = await q.query<{ type: string }>('SELECT type FROM merchant.readers WHERE id = $1 AND merchant = $2 AND removed_at IS NULL', [s.readerId, merchant]);
    if (!rows[0]) throw new TerminalError('That reader isn’t one of the shop’s', 'invalid');
    if (rows[0].type !== 'm2') throw new TerminalError('Only an M2 fits a Pay case', 'invalid');
    const { rows: other } = await q.query(
      `SELECT 1 FROM merchant.hardware WHERE merchant = $1 AND kind = 'point' AND removed_at IS NULL AND id <> $2 AND settings->>'readerId' = $3`,
      [merchant, pointId, s.readerId],
    );
    if (other[0]) throw new TerminalError('That reader is linked to another Point', 'taken');
  }
}

// ---- The drawer's key -------------------------------------------------------------------------------------

const KEY_CONTEXT = (drawerId: string) => `drawer-key:${drawerId}`;

function seal(key: string, drawerId: string): string {
  if (!isEnvelopeEncryptionConfigured()) return `plain:${key}`;
  const p = encryptWithEnvelope(key, KEY_CONTEXT(drawerId));
  const b = (x: Buffer) => x.toString('base64');
  return `env:${JSON.stringify({ c: b(p.ciphertext), i: b(p.iv), t: b(p.authTag), wc: b(p.wrappedKeyCiphertext), wi: b(p.wrappedKeyIv), wt: b(p.wrappedKeyAuthTag), v: p.keyVersion })}`;
}

function unseal(sealed: string, drawerId: string): string {
  if (sealed.startsWith('plain:')) return sealed.slice(6);
  const o = JSON.parse(sealed.slice(4)) as Record<string, string>;
  const b = (x: string) => Buffer.from(x, 'base64');
  return decryptWithEnvelope(
    { ciphertext: b(o.c!), iv: b(o.i!), authTag: b(o.t!), wrappedKeyCiphertext: b(o.wc!), wrappedKeyIv: b(o.wi!), wrappedKeyAuthTag: b(o.wt!), keyVersion: o.v! },
    KEY_CONTEXT(drawerId),
  );
}

async function newDrawerKey(tx: Queryable, drawerId: string): Promise<void> {
  const key = randomBytes(32).toString('base64');
  await tx.query(
    `INSERT INTO merchant.drawer_keys (drawer_id, key_id, key_sealed) VALUES ($1, $2, $3)
     ON CONFLICT (drawer_id) DO UPDATE SET key_id = EXCLUDED.key_id, key_sealed = EXCLUDED.key_sealed, created_at = now()`,
    [drawerId, `dk_${randomUUID().slice(0, 8)}`, seal(key, drawerId)],
  );
}

/** For an enrolled tablet, online: the drawer's key, which it keeps so the drawer opens offline. */
export async function drawerKey(q: Queryable, input: { merchant: string; drawerId: string }): Promise<DrawerKey> {
  await hardwareRow(q, input.merchant, input.drawerId, 'drawer');
  const { rows } = await q.query<{ key_id: string; key_sealed: string; created_at: Date | string }>('SELECT * FROM merchant.drawer_keys WHERE drawer_id = $1', [input.drawerId]);
  if (!rows[0]) throw new TerminalError('This drawer has no key yet; pair it again', 'not_found');
  return { drawerId: input.drawerId, keyId: rows[0].key_id, key: unseal(rows[0].key_sealed, input.drawerId), issuedAt: iso(rows[0].created_at) };
}

// ---- Adding, changing and removing -----------------------------------------------------------------------

/** Owners: a drawer or printer the tablet found. A drawer gets its signing key here. */
export async function addDevice(db: Db, input: { merchant: string; staffId: string; device: unknown }): Promise<Device> {
  const parsed = AddDevice.safeParse(input.device);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'That device isn’t valid'), 'invalid');
  const d = parsed.data;
  if (d.kind === 'drawer') await checkDrawer(db, input.merchant, d.settings);
  const id = `hw_${randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx.query('INSERT INTO merchant.hardware (id, merchant, kind, name, settings) VALUES ($1,$2,$3,$4,$5)', [id, input.merchant, d.kind, d.name, JSON.stringify(d.settings)]);
    if (d.kind === 'drawer') await newDrawerKey(tx, id);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: `hardware.added`, ref: { type: 'hardware', id }, detail: { kind: d.kind, name: d.name } });
  });
  return getDevice(db, input.merchant, id);
}

/** Owners. Each kind's settings are merged over what's there, then checked whole. */
export async function updateDevice(db: Db, input: { merchant: string; staffId: string; id: string; patch: unknown }): Promise<Device> {
  const parsed = UpdateDevice.safeParse(input.patch);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'That change isn’t valid'), 'invalid');
  const p = parsed.data;
  const row = await hardwareRow(db, input.merchant, input.id);
  const current = json<Record<string, unknown>>(row.settings);
  const part = row.kind === 'point' ? p.point : row.kind === 'drawer' ? p.drawer : p.printer;
  const other = (['point', 'drawer', 'printer'] as const).filter((k) => k !== row.kind).find((k) => p[k] !== undefined);
  if (other) throw new TerminalError(`That’s a ${row.kind}, not a ${other}`, 'invalid');
  let next: Record<string, unknown> = { ...current, ...(part ?? {}) };
  if (row.kind === 'point') {
    // A Point moved to a new place starts on that place's idle screen, unless the change says which.
    const placement = (part as { placement?: keyof typeof DEFAULT_IDLE_MODE } | undefined)?.placement;
    if (placement && placement !== current.placement && !(part as { idleMode?: string }).idleMode) next.idleMode = DEFAULT_IDLE_MODE[placement];
    if (placement && placement !== 'table') next.tableId = (part as { tableId?: string | null }).tableId ?? null;
    const whole = PointSettings.safeParse(next);
    if (!whole.success) throw new TerminalError(issue(whole, 'Those settings aren’t valid'), 'invalid');
    await checkPoint(db, input.merchant, row.id, whole.data);
    next = whole.data;
  } else if (row.kind === 'drawer') {
    const whole = DrawerSettings.safeParse(next);
    if (!whole.success) throw new TerminalError(issue(whole, 'Those settings aren’t valid'), 'invalid');
    await checkDrawer(db, input.merchant, whole.data);
    next = whole.data;
  } else {
    const whole = PrinterSettings.safeParse(next);
    if (!whole.success) throw new TerminalError(issue(whole, 'Those settings aren’t valid'), 'invalid');
    next = whole.data;
  }
  await db.transaction(async (tx) => {
    await tx.query('UPDATE merchant.hardware SET name = COALESCE($3, name), settings = $4, updated_at = now() WHERE id = $1 AND merchant = $2', [
      row.id,
      input.merchant,
      p.name ?? null,
      JSON.stringify(next),
    ]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'hardware.changed', ref: { type: 'hardware', id: row.id }, detail: { kind: row.kind } });
  });
  touchShop(input.merchant);
  return getDevice(db, input.merchant, row.id);
}

/**
 * Owners: unpair. A Point's key stops working and it can be claimed again (it goes back to its setup
 * screen); a drawer's key is dropped.
 */
export async function removeDevice(db: Db, input: { merchant: string; staffId: string; id: string }): Promise<void> {
  const row = await hardwareRow(db, input.merchant, input.id);
  await db.transaction(async (tx) => {
    await tx.query('UPDATE merchant.hardware SET removed_at = now() WHERE id = $1', [row.id]);
    if (row.kind === 'point') {
      await tx.query('UPDATE merchant.point_keys SET device_id = NULL, key_hash = NULL, provisioning_hash = NULL, provisioning_expires_at = NULL WHERE device_id = $1', [row.id]);
    }
    if (row.kind === 'drawer') await tx.query('DELETE FROM merchant.drawer_keys WHERE drawer_id = $1', [row.id]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'hardware.removed', ref: { type: 'hardware', id: row.id }, detail: { kind: row.kind } });
  });
  touchShop(input.merchant);
}

// ---- Points: claim, activate, and what they report -------------------------------------------------------------

const PROVISION_MS = 10 * 60_000;

/**
 * Add a Point, step 1: binds an unclaimed Point to the shop, at a table until step 3 says otherwise,
 * and hands back a one-time secret for the tablet to pass it over Bluetooth with the Wi-Fi. A Point
 * this shop claimed that never activated can be claimed again (a fresh secret).
 */
export async function claimPoint(db: Db, input: { merchant: string; staffId: string; request: unknown; apiBase: string; now?: Date }): Promise<ClaimedPoint> {
  const parsed = ClaimPoint.safeParse(input.request);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'That isn’t a Point’s code'), 'invalid');
  const code = parsed.data.code;
  const now = input.now ?? new Date();
  const provisioning = secret();
  const expiresAt = new Date(now.getTime() + PROVISION_MS);
  const deviceId = await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ device_id: string | null; key_hash: string | null; owner: string | null }>(
      `SELECT k.device_id, k.key_hash, h.merchant AS owner FROM merchant.point_keys k LEFT JOIN merchant.hardware h ON h.id = k.device_id WHERE k.code = $1 FOR UPDATE OF k`,
      [code],
    );
    const k = rows[0];
    if (!k) throw new TerminalError('No Point has that code', 'not_found');
    if (k.device_id && (k.owner !== input.merchant || k.key_hash)) throw new TerminalError('That Point is already set up. Unpair it first', 'taken');
    let id = k.device_id;
    if (!id) {
      id = `hw_${randomUUID()}`;
      const settings: PointSettings = {
        placement: 'table',
        tableId: null,
        idleMode: DEFAULT_IDLE_MODE.table,
        showcaseCategories: [],
        mixUp: false,
        byTimeOfDay: false,
        readerId: null,
        buttons: { call: true, bill: 'send_bill' },
        suggestBeforePaying: false,
        oneMoreRound: false,
      };
      await tx.query('INSERT INTO merchant.hardware (id, merchant, kind, name, settings) VALUES ($1,$2,\'point\',$3,$4)', [id, input.merchant, `Point ${code}`, JSON.stringify(settings)]);
      await tx.query('INSERT INTO merchant.point_states (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING', [id]);
    }
    await tx.query('UPDATE merchant.point_keys SET device_id = $2, provisioning_hash = $3, provisioning_expires_at = $4 WHERE code = $1', [code, id, sha256(provisioning), expiresAt]);
    await audit(tx, { merchant: input.merchant, actor: input.staffId, action: 'hardware.point_claimed', ref: { type: 'hardware', id }, detail: { code } });
    return id;
  });
  const device = await getDevice(db, input.merchant, deviceId, now);
  if (device.kind !== 'point') throw new Error('claimed hardware is not a Point');
  return { device, provisioning: { secret: provisioning, apiBase: input.apiBase, expiresAt: expiresAt.toISOString() } };
}

/** The Point, once, with the secret the tablet gave it: its own device key. */
export async function activatePoint(db: Db, input: { code: string; secret: string; now?: Date }): Promise<{ deviceKey: string }> {
  const now = input.now ?? new Date();
  const key = secret();
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ device_id: string | null; provisioning_hash: string | null; provisioning_expires_at: Date | string | null }>(
      'SELECT device_id, provisioning_hash, provisioning_expires_at FROM merchant.point_keys WHERE code = $1 FOR UPDATE',
      [input.code.toUpperCase()],
    );
    const k = rows[0];
    if (!k?.device_id || !k.provisioning_hash || k.provisioning_hash !== sha256(input.secret)) throw new TerminalError('That setup code isn’t right', 'forbidden');
    if (!k.provisioning_expires_at || new Date(k.provisioning_expires_at).getTime() <= now.getTime()) throw new TerminalError('Setup took too long. Add the Point again', 'expired');
    await tx.query('UPDATE merchant.point_keys SET key_hash = $2, provisioning_hash = NULL, provisioning_expires_at = NULL, last_seen_at = $3 WHERE code = $1', [
      input.code.toUpperCase(),
      sha256(key),
      now,
    ]);
  });
  return { deviceKey: key };
}

export interface PointIdentity {
  deviceId: string;
  merchant: string;
  code: string;
}

/** A Point, by the key it sends. Null for an unknown key or an unpaired Point. */
export async function pointByKey(q: Queryable, key: string): Promise<PointIdentity | null> {
  if (!key || key.length < 32) return null;
  const { rows } = await q.query<{ device_id: string; merchant: string; code: string }>(
    `SELECT k.device_id, h.merchant, k.code FROM merchant.point_keys k JOIN merchant.hardware h ON h.id = k.device_id
      WHERE k.key_hash = $1 AND h.removed_at IS NULL`,
    [sha256(key)],
  );
  return rows[0] ? { deviceId: rows[0].device_id, merchant: rows[0].merchant, code: rows[0].code } : null;
}

/** Battery, signal, firmware and the case, as the Point last said. */
export async function recordHealth(q: Queryable, point: PointIdentity, report: unknown, now = new Date()): Promise<void> {
  const parsed = PointHealthReport.safeParse(report);
  if (!parsed.success) throw new TerminalError(issue(parsed, 'That report isn’t valid'), 'invalid');
  await q.query('UPDATE merchant.point_keys SET health = $2, last_seen_at = $3 WHERE device_id = $1', [point.deviceId, JSON.stringify(parsed.data), now]);
}

/** A Point was heard from: its last seen moves on. */
export async function sawPoint(q: Queryable, point: PointIdentity, now = new Date()): Promise<void> {
  await q.query('UPDATE merchant.point_keys SET last_seen_at = $2 WHERE device_id = $1', [point.deviceId, now]);
}
