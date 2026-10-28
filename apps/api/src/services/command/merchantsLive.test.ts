import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { SEE, TOTALS } from './levels.js';
import { merchantsLive, merchantsSection } from './sections.js';

/*
 * Merchants, live: the shops in the merchant app's own tables (merchant.profiles, its tiers, its
 * hardware and Points' check-ins) and their Clear charges (charge_requests), against tables with the
 * merchant app's columns. Nothing in it is made up: what the merchant app doesn't record is empty.
 */

const NOW = new Date('2026-10-24T17:00:00Z');
const A = '0x00000000000000000000000000000000000000aa';
const B = '0x00000000000000000000000000000000000000bb';
const C = '0x00000000000000000000000000000000000000cc';
const D = '0x00000000000000000000000000000000000000dd';

let db: Db;
const envMerchants = process.env.PROVIDER_MERCHANTS;
beforeAll(async () => {
  ({ db } = await testDb());
  await db.exec(`
    -- the lazy columns merchantDb.ts creates, beyond the ones testDb stands in
    ALTER TABLE merchant.profiles ADD COLUMN IF NOT EXISTS category TEXT, ADD COLUMN IF NOT EXISTS town TEXT,
      ADD COLUMN IF NOT EXISTS payout_terms TEXT NOT NULL DEFAULT 'Net-30', ADD COLUMN IF NOT EXISTS partner_since DATE,
      ADD COLUMN IF NOT EXISTS clear_signer_quorum_id TEXT;
    CREATE TABLE charge_requests (code TEXT PRIMARY KEY, merchant_address TEXT NOT NULL, amount_cents BIGINT NOT NULL, status TEXT NOT NULL, plan_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL, resolved_at TIMESTAMPTZ);

    INSERT INTO merchant.profiles (merchant, name, category, town, founding, clear_tier, payout_terms, partner_since, clear_signer_quorum_id, created_at) VALUES
      ('${A}', 'Rosa’s Panadería', 'Bakery', 'Redlands', true, 'founding', 'Net-14', '2026-08-01', 'kq_a', '2026-08-01T10:00:00Z'),
      ('${B}', 'Mesa Laundry', NULL, NULL, false, 'standard', 'Net-30', '2026-09-01', 'kq_b', '2026-09-01T10:00:00Z'),
      ('${C}', 'Fontana Tacos', 'Restaurant', 'Fontana', false, 'standard', 'Net-30', NULL, NULL, '2026-10-20T18:00:00Z'),
      ('${D}', 'Redlands Tire & Lube', 'Auto and tires', 'Redlands', false, 'standard', 'Net-30', '2026-10-10', 'kq_d', '2026-10-10T10:00:00Z');
    UPDATE merchant.profiles SET address_city = 'San Bernardino' WHERE merchant = '${B}';

    INSERT INTO charge_requests (code, merchant_address, amount_cents, status, plan_id, created_at, resolved_at) VALUES
      ('a1', '${A}', 1000, 'approved', 1, '2026-10-05T10:00:00Z', '2026-10-05T10:01:00Z'),
      ('a2', '${A.toUpperCase().replace('0X', '0x')}', 2500, 'approved', NULL, '2026-10-06T10:00:00Z', '2026-10-06T10:01:00Z'),
      ('a3', '${A}', 300, 'approved', 2, '2026-09-30T23:55:00Z', '2026-10-01T00:10:00Z'),
      ('a4', '${A}', 500, 'refunded', 3, '2026-10-07T10:00:00Z', '2026-10-07T10:01:00Z'),
      ('a5', '${A}', 9999, 'pending', NULL, '2026-10-08T10:00:00Z', NULL),
      ('a6', '${A}', 4000, 'approved', 4, '2026-09-15T10:00:00Z', '2026-09-15T10:01:00Z'),
      ('a7', '${A}', 700, 'approved', 5, '2026-08-15T10:00:00Z', '2026-08-15T10:01:00Z'),
      ('a8', '${A}', 800, 'approved', 6, '2026-11-01T10:00:00Z', '2026-11-01T10:01:00Z'),
      ('b1', '${B}', 1200, 'declined', NULL, '2026-10-05T10:00:00Z', '2026-10-05T10:01:00Z'),
      ('b2', '${B}', 1200, 'expired', NULL, '2026-10-05T11:00:00Z', NULL),
      ('d1', '${D}', 79400, 'approved', 7, '2026-10-12T10:00:00Z', '2026-10-12T10:01:00Z');

    INSERT INTO merchant.hardware (id, merchant, kind, name, settings, created_at, removed_at) VALUES
      ('pt_a1', '${A}', 'point', 'Counter', '{"placement":"counter"}', '2026-08-02T10:00:00Z', NULL),
      ('pt_a4', '${A}', 'point', 'Table 4', '{"placement":"table"}', '2026-08-02T10:01:00Z', NULL),
      ('pt_a6', '${A}', 'point', 'Table 6', '{"placement":"table"}', '2026-08-02T10:02:00Z', NULL),
      ('pt_old', '${A}', 'point', 'Old one', '{"placement":"counter"}', '2026-08-02T10:03:00Z', '2026-09-01T10:00:00Z'),
      ('pr_a', '${A}', 'printer', 'Kitchen', '{}', '2026-08-02T10:04:00Z', NULL),
      ('pt_c', '${C}', 'point', 'Front', '{"placement":"counter"}', '2026-10-21T10:00:00Z', NULL),
      ('pt_d', '${D}', 'point', 'Bay', '{"placement":"door"}', '2026-10-11T10:00:00Z', NULL);
    INSERT INTO merchant.point_keys (code, device_id, health, last_seen_at) VALUES
      ('A001', 'pt_a1', '{"batteryPercent":90,"pluggedIn":true}', '2026-10-24T16:58:00Z'),
      ('A004', 'pt_a4', '{"batteryPercent":12,"pluggedIn":false}', '2026-10-24T16:59:00Z'),
      ('A006', 'pt_a6', '{"batteryPercent":70,"pluggedIn":false}', '2026-10-24T15:40:00Z'),
      ('C001', 'pt_c', NULL, NULL),
      ('D001', 'pt_d', '{"batteryPercent":15,"pluggedIn":true}', '2026-10-24T16:59:30Z');
    INSERT INTO merchant.readers (id, merchant, provider, type, external_reader_id, label) VALUES
      ('rdr_a', '${A}', 'stripe', 'm2', 'STRM2-1', 'Bay M2'),
      ('rdr_tap', '${A}', 'stripe', 'tap_to_pay', 'TTP-1', 'Phone');
    INSERT INTO merchant.devices (id, merchant, label, revoked_at) VALUES
      ('dev_a', '${A}', 'Counter tablet', NULL),
      ('dev_lost', '${A}', 'Lost tablet', '2026-10-01T10:00:00Z');

    -- Command's own CRM: one card, with a person on it
    INSERT INTO command.merchant_stage (id, position, name, kind, city, stage, owner, per_month_cents, next_step, contact, source, address, notes)
      VALUES ('p0', 0, 'Mission Auto Care', 'Auto repair', 'Redlands', 'talking', 'Marcus', 900000, 'Demo Thu', '{"name":"Ray Ortega","role":"Owner","phone":"(909) 555-0142","email":"ray@missionauto.com"}', 'Walk-in', '12 Orange St', 'Wants a demo');
  `);
});
afterAll(() => {
  if (envMerchants == null) delete process.env.PROVIDER_MERCHANTS;
  else process.env.PROVIDER_MERCHANTS = envMerchants;
});

const read = (o: { level?: number; now?: Date } = {}) => merchantsLive(db, { level: (o.level ?? SEE) as any, reveal: false, now: o.now ?? NOW, charges: db });

describe('Merchants, live from the merchant app', () => {
  test('a shop with a Clear sale is transacting: its tier’s fee, its terms, this and last month’s approved charges, every plan opened, its hardware', async () => {
    const r = await read();
    expect(r.TX).toEqual([
      // Oct: 1000 + 2500 + 300 (raised in Sept, approved in Oct); the refund and the pending code aren't sales; Sept: 4000
      // with no chain reader the cap isn't known; losses aren't recorded: empty
      [A, 'Rosa’s Panadería', 'Bakery', 'Redlands', 1, 2, 'NET-14', null, 0, 6, 0, 38, 3, 40, 'Point · 2 Table Points · Tap · Counter · Printer'],
      [D, 'Redlands Tire & Lube', 'Auto and tires', 'Redlands', 0, 2.5, 'NET-30', null, 0, 1, 0, 794, 1, 0, 'Point'],
    ]);
  });

  test('each shop’s cap is MerchantRegistry’s, none when it has none; its hits are the sales refused over it this week', async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS charge_cap_hits (id BIGSERIAL PRIMARY KEY, merchant_address TEXT NOT NULL, amount_cents BIGINT NOT NULL, cap_cents BIGINT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const day = (d: number) => new Date(NOW.getTime() - d * 86400e3).toISOString();
    await db.query('INSERT INTO charge_cap_hits (merchant_address, amount_cents, cap_cents, at) VALUES ($1, 250000, 200000, $2), ($1, 210000, 200000, $3), ($1, 300000, 200000, $4)', [A.toUpperCase(), day(1), day(6), day(9)]);
    const asked: unknown[] = [];
    // MerchantRegistry's caps; TermIssuer's plan 4 (September's $40 sale) has $25 of it repaid
    const chain = {
      read: async (calls: any[]) => (
        asked.push(...calls), calls.map((c) => (c.fn === 'planAt' ? [A, 40_000_000n, 15_000_000n, 25_000_000n] : c.args[0] === A ? 2_000_000_000n : 0n))
      ),
    };
    const r = await merchantsLive(db, { level: SEE as any, reveal: false, now: NOW, charges: db, chain });
    // (the PayoutPool's claims list its shops too: merchantCount and merchantAt)
    expect(asked.filter((c: any) => c.contract === 'MerchantRegistry' && !['merchantCount', 'merchantAt'].includes(c.fn)).every((c: any) => c.fn === 'approvalCapOf')).toBe(true);
    expect(asked.filter((c: any) => c.contract === 'TermIssuer').map((c: any) => [c.fn, c.args[0]])).toEqual([['planAt', 4n]]);
    // A: $2,000 and two refused in the last 7 days (the third is older); D: no cap, none refused
    expect(r.TX.map((t: any) => [t[0], t[7], t[8]])).toEqual([[A, 2000, 2], [D, null, 0]]);
    // last month's sales (the next run): what went on plans and what members repaid on them
    expect(r.COLLECTED).toEqual({ [A]: { now: 0, plans: 40, repaid: 25, count: 1 } });
    await db.query('DROP TABLE charge_cap_hits');
  });

  test('each shop’s payouts are the PayoutPool’s unpaid claims, with their payout window; none read without the chain', async () => {
    const sec = (t: string) => BigInt(Date.parse(t) / 1000);
    // claim 0 is paid; 1 is Rosa’s NET-14, claimed on the 20th; 2 is Tire & Lube’s NET-30
    const claims = [
      [A, 5_000_000n, sec('2026-10-01T00:00:00Z'), sec('2026-10-15T00:00:00Z'), true],
      [A, 41_260_000n, sec('2026-10-20T00:00:00Z'), sec('2026-11-03T00:00:00Z'), false],
      [D, 794_000_000n, sec('2026-10-12T00:00:00Z'), sec('2026-11-11T00:00:00Z'), false],
    ];
    const chain = {
      read: async (calls: any[]) =>
        calls.map((c) =>
          ({ claimCount: 3n, nextUnpaid: 1n, held: 0n, queuedTotal: 0n, shortfall: 0n, reserveToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', merchantCount: 0n, decimals: 6n, claimAt: c.args ? claims[Number(c.args[0])] : undefined })[c.fn as string] ?? 0n,
        ),
    };
    const r = await merchantsLive(db, { level: SEE as any, reveal: false, now: NOW, charges: db, chain });
    expect(r.CLAIMS).toEqual([
      { id: 1, shop: A, name: 'Rosa’s Panadería', amount: 41.26, due: Date.parse('2026-11-03T00:00:00Z'), net: 14 },
      { id: 2, shop: D, name: 'Redlands Tire & Lube', amount: 794, due: Date.parse('2026-11-11T00:00:00Z'), net: 30 },
    ]);
    expect((await read()).CLAIMS).toBeNull();
  });

  test('a shop with no Clear sale yet is signed, or signing while Clear’s signer isn’t on its wallet', async () => {
    const r = await read();
    expect(r.SIGNED).toEqual([
      [B, 'Mesa Laundry', '', 'San Bernardino'],
      [C, 'Fontana Tacos', 'Restaurant', 'Fontana', 'signing'],
    ]);
  });

  test('the month is the calendar month of now: in November, October is last month', async () => {
    const r = await read({ now: new Date('2026-11-03T12:00:00Z') });
    const a = r.TX.find((t) => t[0] === A)!;
    expect(a.slice(11, 14)).toEqual([8, 1, 38]);
    expect(r.asOf).toBe(Date.UTC(2026, 10, 3));
  });

  test('the fleet: each shop’s Points as the merchant app rates them, problems first, in the shop’s own time', async () => {
    const r = await read();
    expect(r.FLEET).toEqual([
      // Table 6 last heard 08:40 in Los Angeles; Table 4 is on battery under 20%; the removed Point is gone
      [A, { P: ['on'], t: ['low', 'off'] }, 'Table 4 battery low · Table 6 offline since 08:40', '1 min ago'],
      [C, { P: ['off'] }, 'Front not heard from yet', 'Never'],
      // plugged in, so 15% isn't low
      [D, { P: ['on'] }, '', 'Now'],
    ]);
  });

  test('nothing owed is made up, the day is today, and the newest partner is the newest shop', async () => {
    const r = await read();
    expect(r.OWED).toEqual({});
    expect(r.asOf).toBe(Date.UTC(2026, 9, 24));
    expect(r.figures['merchants.newest_partner']).toEqual({ name: 'Fontana Tacos', joined: Date.parse('2026-10-20T18:00:00Z') });
  });

  test('the board is Command’s own CRM; at Totals its cards keep no people or addresses', async () => {
    const see = await read();
    expect(see.PROSPECTS).toEqual([['Mission Auto Care', 'Auto repair', 'Redlands', 9000, 'Marcus', 'Demo Thu', 'talking']]);
    expect(see.BOARD[0]).toMatchObject({ id: 'p0', contact: { name: 'Ray Ortega' }, addr: '12 Orange St', note: 'Wants a demo' });

    const totals = await read({ level: TOTALS });
    expect(totals.BOARD[0]).toMatchObject({ contact: { name: '', role: '', phone: '', email: '' }, addr: '' });
    expect(totals.BOARD[0]).not.toHaveProperty('note');
    const body = JSON.stringify(totals);
    for (const s of ['Ray Ortega', '555-0142', 'ray@missionauto.com', 'Orange St']) expect(body).not.toContain(s);
    // the shops and their numbers are the same at every level
    expect(totals.TX).toEqual(see.TX);
  });

  test('every card keeps its owner, value, next step and flag, whatever its stage, so saving one whole loses none', async () => {
    await db.query(`INSERT INTO command.merchant_stage (id, position, name, kind, city, stage, owner, per_month_cents, next_step, contact, source, address, notes, flag)
      VALUES ('p1', 1, 'Inland Cycle Works', 'Bikes', 'Redlands', 'signing', 'Dana', 120000, 'Sign the agreement', '{}', 'Poster', '', '', true)`);
    try {
      const r = await read();
      expect(r.BOARD.find((c) => c.id === 'p1')).toMatchObject({ stage: 'signing', owner: 'Dana', val: 1200, next: 'Sign the agreement', flag: true });
      expect(r.BOARD.find((c) => c.id === 'p0')).toMatchObject({ stage: 'talking', owner: 'Marcus', val: 9000, next: 'Demo Thu' });
    } finally {
      await db.query(`DELETE FROM command.merchant_stage WHERE id = 'p1'`);
    }
  });

  test('PROVIDER_MERCHANTS=live reads it instead of throwing', async () => {
    process.env.PROVIDER_MERCHANTS = 'live';
    const r = await merchantsSection(db, { level: SEE, reveal: false, now: NOW, charges: db });
    expect(r.TX.map((t) => t[0])).toEqual([A, D]);
  });
});
