import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { runGoes } from '../services/command/actions.js';
import { merchantsSection } from '../services/command/sections.js';
import { TOTALS } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { join } from '../services/command/waitlist.js';
import { commandRouter } from './command.js';

/*
 * What Merchants keeps of its own (migration 0067): the payout runs, from proposing one to marking it paid,
 * with the approval read from the real proposal; the refurb line's units; the site's shop enquiries, what
 * they asked and what was done with them; and the shops' pre-orders, from the shop's reservations.
 */

let root = '';
let db: Db;
const clock = new Date('2026-10-23T17:00:00Z');

beforeAll(async () => {
  ({ db } = await testDb());
  await seedCommand(db);
  const identify = (req: Request, res: Response, next: NextFunction) => {
    const [id, email] = String(req.header('x-test-user') ?? '').split('|');
    if (!id) return res.status(401).end();
    req.auth = { walletAddress: '', profileUuid: id, email, emails: email ? [email] : [], token: 't' };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/command',
    commandRouter({
      db: async () => db,
      identify,
      isMember: async () => false,
      mail: async () => undefined,
      adminEmails: () => ['kai@useclear.org', 'second@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => clock,
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

type Who = { user: string; session?: string };
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(root + '/api/command' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
};
const signIn = async (user: string): Promise<Who> => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, p)).rows as T[];
const section = async (who: Who) => (await call(who, 'GET', '/sections/merchants')).body;

let kai: Who, second: Who;
beforeAll(async () => {
  kai = await signIn('did:kai|kai@useclear.org');
  second = await signIn('did:second|second@useclear.org');
});

describe('the monthly payout run', () => {
  const lines = [{ id: 'mesa', name: 'Mesa Laundry', sales: 640.2, fee: 12.8, red: 80, total: 707.4 }];
  let id = '';

  test('NET-30 goes 30 days after the month’s last day, or the weekday after', () => {
    // 30 Sep + 30 days is Fri 30 Oct; 31 Oct + 30 is Sun 30 Nov, so Mon 1 Dec
    expect(runGoes('2026-09')).toBe('2026-10-30');
    expect(runGoes('2026-10')).toBe('2026-11-30');
    expect(runGoes('2026-11')).toBe('2026-12-30');
    expect(runGoes('2025-11')).toBe('2025-12-30');
    expect(runGoes('2026-05')).toBe('2026-06-30');
    expect(runGoes('2026-07')).toBe('2026-08-31');
    expect(runGoes('2026-01')).toBe('2026-03-02');
  });

  test('proposed, it waits for a second person, and the page reads it from the proposal', async () => {
    const r = await call(kai, 'POST', '/actions/merchants/run', { total: 707.4, shops: 1, period: '2026-09', goes: '2026-10-30', lines });
    expect(r.status).toBe(202);
    id = r.body.proposal.id;
    expect(await q('SELECT * FROM command.payout_runs')).toEqual([]);
    const [run] = (await section(kai)).RUNS;
    expect(run).toMatchObject({
      id,
      status: 'waiting',
      period: '2026-09',
      goes: Date.UTC(2026, 9, 30),
      total: 707.4,
      shops: 1,
      lines,
      proposedBy: 'kai@useclear.org',
      approvedAt: null,
      sentAt: null,
      paidAt: null,
    });
  });

  test('approved, it’s the month’s run, recorded for the Ops Safe; only once a month', async () => {
    expect((await call(kai, 'POST', `/proposals/${id}/approve`)).status).toBe(403);
    expect((await call(second, 'POST', `/proposals/${id}/approve`)).status).toBe(200);
    const [rec] = await q('SELECT period, goes_on, total_cents, shops, lines, paid_at FROM command.payout_runs');
    expect(rec).toMatchObject({ period: '2026-09', total_cents: 70740, shops: 1, lines, paid_at: null });
    expect(new Date(rec.goes_on).toISOString().slice(0, 10)).toBe('2026-10-30');
    const [o] = await q(`SELECT status, proposal_id FROM command.outbox WHERE kind = 'run'`);
    expect(o).toEqual({ status: 'queued', proposal_id: id });
    const [run] = (await section(kai)).RUNS;
    expect(run).toMatchObject({ status: 'approved', approvedBy: 'second@useclear.org', sentAt: null });

    // a second run for September is refused when it's approved, and stays waiting
    const again = await call(kai, 'POST', '/actions/merchants/run', { total: 1, shops: 1, period: '2026-09' });
    const no = await call(second, 'POST', `/proposals/${again.body.proposal.id}/approve`);
    expect(no.status).toBe(409);
    expect(no.body.error?.code ?? no.body.code).toBe('RUN_DONE');
    expect((await q('SELECT status FROM command.proposals WHERE id = $1', [again.body.proposal.id]))[0].status).toBe('waiting');
    expect((await call(kai, 'POST', `/proposals/${again.body.proposal.id}/decline`)).status).toBe(200);
    expect((await section(kai)).RUNS[0]).toMatchObject({ status: 'withdrawn', total: 1 });
  });

  test('sent once its outbox row is in the Safe’s queue, then marked paid once', async () => {
    const [o] = await q(`SELECT id FROM command.outbox WHERE proposal_id = $1`, [id]);
    const [p] = await q(`SELECT id FROM command.people WHERE email = 'kai@useclear.org'`);
    await q(`UPDATE command.outbox SET status = 'sent' WHERE id = $1`, [o.id]);
    await q(
      `INSERT INTO command.safe_proposals (safe_tx_hash, outbox_id, safe_address, chain_id, nonce, tx, summary, status, prepared_by, proposed_by, proposed_at) VALUES ($1, $2, '0xsafe', 84532, 7, '{}', 'run', 'proposed', $3, $3, '2026-10-29T15:00:00Z')`,
      ['0x' + 'ab'.repeat(32), o.id, p.id],
    );
    expect((await section(kai)).RUNS.find((r: any) => r.id === id).sentAt).toBe(Date.parse('2026-10-29T15:00:00Z'));
    expect((await call(kai, 'POST', '/actions/merchants/run-paid', { run: id })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/merchants/run-paid', { run: id })).status).toBe(409);
    const run = (await section(kai)).RUNS.find((r: any) => r.id === id);
    expect(run.paidBy).toBe('kai@useclear.org');
    expect(run.paidAt).not.toBeNull();
  });
});

describe('the refurb line', () => {
  test('a unit is added, moved along, and ships only to a shop', async () => {
    const add = await call(kai, 'POST', '/actions/merchants/refurb-add', { model: 'Galaxy Tab A9', serial: 'R52X0001', cost: 61 });
    expect(add.status).toBe(200);
    const uid = add.body.result.id;
    expect((await call(kai, 'POST', '/actions/merchants/refurb-move', { id: uid, stage: 'repair' })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/merchants/refurb-move', { id: uid, stage: 'shipped' })).status).toBe(409);
    expect((await call(kai, 'POST', '/actions/merchants/refurb-move', { id: uid, stage: 'nowhere' })).status).toBe(400);
    expect((await call(kai, 'POST', '/actions/merchants/refurb-assign', { id: uid, shop: 'mesa', name: 'Mesa Laundry', ships: '2026-11-02' })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/merchants/refurb-move', { id: uid, stage: 'shipped' })).status).toBe(200);
    // shipped, it can't lose its shop; moved back, it's not shipped any more
    expect((await call(kai, 'POST', '/actions/merchants/refurb-assign', { id: uid, shop: null })).status).toBe(409);
    let [u] = (await section(kai)).REFURB;
    expect(u).toMatchObject({ id: uid, model: 'Galaxy Tab A9', serial: 'R52X0001', stage: 'shipped', cost: 61, shop: 'mesa', shopName: 'Mesa Laundry', ships: Date.UTC(2026, 10, 2) });
    expect(u.shippedAt).not.toBeNull();
    expect((await call(kai, 'POST', '/actions/merchants/refurb-move', { id: uid, stage: 'ready' })).status).toBe(200);
    [u] = (await section(kai)).REFURB;
    expect(u).toMatchObject({ stage: 'ready', shippedAt: null });
    expect((await call(kai, 'POST', '/actions/merchants/refurb-move', { id: 999, stage: 'ready' })).status).toBe(404);
  });
});

describe('shop enquiries', () => {
  let eid = 0;
  test('what they asked is kept, and the contact is masked until shown for a reason', async () => {
    await join(
      db,
      {
        as: 'shop',
        name: 'Ray Ortega',
        email: 'ray@missionauto.com',
        zip: '92373',
        note: 'Do you work with auto shops?',
        details: { business: 'Mission Auto Care', industry: 'Auto repair', ticketLow: '350', ticketHigh: '1500', jobsPerWeek: '40' },
      },
      clock,
    );
    const [e] = (await section(kai)).ENQ;
    eid = e.id;
    expect(e).toMatchObject({
      business: 'Mission Auto Care',
      kind: 'Auto repair',
      city: 'Redlands',
      from: 'Website',
      msg: 'Do you work with auto shops?',
      ticket: [350, 1500],
      jobs: 40,
      st: 'new',
      card: null,
    });
    expect(JSON.stringify(e)).not.toContain('Ray');
    expect(JSON.stringify(e)).not.toContain('ray@');

    expect((await call(kai, 'POST', `/merchants/enquiries/${eid}/reveal`, { reason: 'To call them back' })).body).toMatchObject({ first: 'Ray', last: 'Ortega', email: 'ray@missionauto.com' });
    expect((await q(`SELECT section, subject, field, reason FROM command.reveals WHERE subject = $1`, [`enquiry ${eid}`]))[0]).toEqual({
      section: 'merchants',
      subject: `enquiry ${eid}`,
      field: 'name',
      reason: 'To call them back',
    });
    expect((await call(kai, 'POST', '/merchants/enquiries/99999/reveal', { reason: 'x' })).status).toBe(404);
  });

  test('at Totals an enquiry has no contact and no question, and a run no names', async () => {
    const t = await merchantsSection(db, { level: TOTALS, reveal: false, now: clock });
    expect(t.ENQ.length).toBeGreaterThan(0);
    expect(t.ENQ.every((e) => !e.msg && !e.who.length)).toBe(true);
    expect(t.RUNS.every((r) => !r.proposedBy && !r.approvedBy && !r.paidBy)).toBe(true);
  });

  test('answered, turned down with why, opened again, then added to the pipeline with its card', async () => {
    expect((await call(kai, 'POST', '/actions/merchants/enquiry', { id: eid, state: 'replied' })).status).toBe(200);
    expect((await section(kai)).ENQ[0]).toMatchObject({ st: 'replied', by: 'kai@useclear.org' });
    expect((await call(kai, 'POST', '/actions/merchants/enquiry', { id: eid, state: 'notfit', why: 'Outside the area' })).status).toBe(200);
    expect((await section(kai)).ENQ[0]).toMatchObject({ st: 'notfit', why: 'Outside the area' });
    expect((await call(kai, 'POST', '/actions/merchants/enquiry', { id: eid, state: 'new' })).status).toBe(200);
    expect((await section(kai)).ENQ[0]).toMatchObject({ st: 'new', why: '', by: null });
    const card = {
      id: 'penq1',
      name: 'Mission Auto Care',
      kind: 'Auto repair',
      city: 'Redlands',
      stage: 'prospect',
      source: 'Website',
      log: [{ text: 'Added to the board', type: 'edit' }],
      enquiry: eid,
    };
    expect((await call(kai, 'POST', '/actions/merchants/card-save', card)).status).toBe(200);
    expect((await section(kai)).ENQ[0]).toMatchObject({ st: 'added', card: 'penq1' });
    expect((await call(kai, 'POST', '/actions/merchants/enquiry', { id: 99999, state: 'replied' })).status).toBe(404);
  });
});

describe('pre-orders', () => {
  test('live, they’re the shop’s reservations, with their shop and ship month', async () => {
    const was = process.env.PROVIDER_SHOP;
    process.env.PROVIDER_SHOP = 'live';
    try {
      await q(`INSERT INTO command.shop_live_preorders (payment_intent, line, shop, slug, variant, units, deposit_cents, state, placed_at, shop_id, ships) VALUES
        ('pi_000000aaaaaa', 1, 'Mesa Laundry', 'clear-point', 'Black', 2, 4000, 'held', '2026-10-20T10:00:00Z', '0x00000000000000000000000000000000000000bb', 'Jan 2027'),
        ('pi_000000bbbbbb', 1, 'A shop', 'no-such', 'Default', 1, 2500, 'refunded', '2026-10-21T10:00:00Z', NULL, NULL)`);
      const { PREORDERS } = await section(kai);
      expect(PREORDERS).toEqual([
        {
          id: 'aaaaaa-1',
          shop: 'Mesa Laundry',
          shopId: '0x00000000000000000000000000000000000000bb',
          product: 'Clear Point',
          variant: 'Black',
          units: 2,
          deposit: 40,
          state: 'held',
          placed: Date.parse('2026-10-20T10:00:00Z'),
          ships: 'Jan 2027',
        },
        { id: 'bbbbbb-1', shop: 'A shop', shopId: null, product: 'no-such', variant: 'Default', units: 1, deposit: 25, state: 'refunded', placed: Date.parse('2026-10-21T10:00:00Z'), ships: null },
      ]);
    } finally {
      if (was == null) delete process.env.PROVIDER_SHOP;
      else process.env.PROVIDER_SHOP = was;
    }
  });

  test('seeded, they’re the shop’s seeded pre-orders', async () => {
    const { PREORDERS } = await section(kai);
    expect(PREORDERS.length).toBe((await q('SELECT count(*)::int AS n FROM command.shop_preorders'))[0].n);
  });
});
