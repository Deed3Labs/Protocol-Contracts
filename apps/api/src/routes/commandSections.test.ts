import { beforeAll, describe, expect, test } from 'bun:test';
import { MEMBERS_FIGURES, SEED_FIGURES, mask } from '@clear/command-types';
import fieldFx from '@clear/command-types/src/fixtures/field.json';
import growthFigures from '@clear/command-types/src/fixtures/growth-figures.json';
import growthFx from '@clear/command-types/src/fixtures/growth.json';
import fixture from '@clear/command-types/src/fixtures/members.json';
import merchFx from '@clear/command-types/src/fixtures/merchants.json';
import merchFigures from '@clear/command-types/src/fixtures/merchants-figures.json';
import moneyFx from '@clear/command-types/src/fixtures/money.json';
import shopFx from '@clear/command-types/src/fixtures/shop.json';
import shopFigures from '@clear/command-types/src/fixtures/shop-figures.json';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { commandRouter } from './command.js';

/*
 * Phase 3: a seeded database serves each section exactly as the prototype draws it, and decides on
 * the server what each level gets to see. The prototype's own rows (the fixture) are the answer key.
 */

let base = '';
let db: Db;

beforeAll(async () => {
  ({ db } = await testDb());
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
      isMember: async (a) => a.profileUuid === 'did:member',
      mail: async () => undefined,
      adminEmails: () => ['kai@useclear.org', 'second@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => new Date('2026-10-23T17:00:00Z'),
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
});

const call = async (who: { user: string; session?: string }, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (user: string) => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;

describe('the seed', () => {
  test('loads the prototype’s 300 members, 13 batches and the Members figures, once', async () => {
    const first = await seedCommand(db);
    expect(first).toContain('300 members');
    expect(first).toContain('13 batches');
    expect(await seedCommand(db)).toEqual([]);
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM command.figures WHERE key LIKE 'members.%'`);
    expect(rows[0].n).toBe(Object.keys(MEMBERS_FIGURES).length);
    const all = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM command.figures');
    expect(all.rows[0].n).toBe(Object.keys(SEED_FIGURES).length);
    expect(first).toEqual(expect.arrayContaining(['102 posters', '8 forms', 'a route of 8 stops', '30 merchants', '32 board cards', '6 accounts', '6 bonds', '18 yield positions', '13 products', '19 orders', '6 pre-orders']));
  });

  test('never overwrites a figure a live job wrote', async () => {
    await db.query(`UPDATE command.figures SET value = '1501', source = 'live:members' WHERE key = 'members.waitlist.total'`);
    await seedCommand(db);
    expect((await db.query<{ value: number }>(`SELECT value FROM command.figures WHERE key = 'members.waitlist.total'`)).rows[0].value).toBe(1501);
    await db.query(`UPDATE command.figures SET value = '1500', source = 'seed' WHERE key = 'members.waitlist.total'`);
  });
});

describe('Members, as each level gets it', () => {
  let kai: { user: string; session: string };
  beforeAll(async () => {
    kai = await signIn('did:kai|kai@useclear.org');
  });

  test('names in full, when asked for, are the prototype’s rows exactly, and the asking is logged', async () => {
    const r = await call(kai, 'GET', '/sections/members?reveal=1');
    expect(r.status).toBe(200);
    expect(r.body.names).toBe('shown');
    expect(r.body.MEMBERS).toEqual(fixture.members);
    expect(r.body.BATCH_DATE).toEqual(fixture.batches.map((b) => b.sentAt));
    expect(r.body.B_ACT).toEqual(fixture.check.B_ACT);
    expect(r.body.B_OPEN).toEqual(fixture.check.B_OPEN);
    expect(r.body.NEXT_BATCH).toEqual(fixture.proposed);
    expect(r.body.figures).toEqual(JSON.parse(JSON.stringify(MEMBERS_FIGURES)));
    const log = (await call(kai, 'GET', '/audit')).body.entries;
    expect(log[0]).toMatchObject({ action: 'Showed member names', area: 'members', detail: '300 members' });
  });

  test('otherwise names leave the server masked, the way the page masks them', async () => {
    const r = await call(kai, 'GET', '/sections/members');
    expect(r.body.names).toBe('masked');
    expect(r.body.MEMBERS[0].first).toBe(mask(fixture.members[0].first));
    expect(r.body.MEMBERS.every((m: any) => m.first.includes('•') && m.last.includes('•'))).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(fixture.members[0].first + '"');
  });

  test('Totals gets no names, numbers, posters or dates; asking for names changes nothing', async () => {
    const totals = all(2);
    totals.members = 1;
    const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'kai@useclear.org');
    expect(id).toBeTruthy();
    // a second person with Totals on Members
    await call(kai, 'POST', '/invites', { email: 'totals@useclear.org', name: 'Totals', group: 'outside' });
    const t = await signIn('did:totals|totals@useclear.org');
    const tid = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'totals@useclear.org').id;
    expect((await call(kai, 'PATCH', `/people/${tid}/access`, { custom: totals })).status).toBe(200);
    for (const q of ['', '?reveal=1']) {
      const r = await call(t, 'GET', `/sections/members${q}`);
      expect(r.status).toBe(200);
      expect(r.body.names).toBe('none');
      for (const m of r.body.MEMBERS) {
        expect(m.first).toBeNull();
        expect(m.last).toBeNull();
        expect(m.no).toBe('');
        expect(m.poster).toBeNull();
        expect(m.joined).toBe(0);
        expect(m.opened).toBeUndefined();
      }
      // the charts still count right
      expect(r.body.B_ACT).toEqual(fixture.check.B_ACT);
      expect(r.body.MEMBERS.filter((m: any) => m.status === 'active').length).toBe(124);
    }
    const names = fixture.members.map((m) => m.first);
    const body = JSON.stringify((await call(t, 'GET', '/sections/members')).body);
    expect(names.some((n) => body.includes(`"${n}"`))).toBe(false);
  });

  test('None is refused', async () => {
    const member = await signIn('did:member|member@example.com');
    expect((await call(member, 'GET', '/sections/members')).status).toBe(403);
  });
});

describe('Growth and Field, as each level gets them', () => {
  let kai: { user: string; session: string };
  beforeAll(async () => {
    kai = await signIn('did:kai|kai@useclear.org');
  });

  test('Growth with names: the prototype’s posters, designs, inbox and figures exactly; the asking is logged', async () => {
    const r = await call(kai, 'GET', '/sections/growth?reveal=1');
    expect(r.status).toBe(200);
    expect(r.body.POSTERS).toEqual(growthFx.posters);
    expect(r.body.INBOX).toEqual(growthFx.forms);
    expect(r.body.DESIGNS).toEqual({
      A: { name: 'The neighbor', posters: 41, scans: 2011, joined: 501 },
      B: { name: '$10 on us', posters: 38, scans: 2104, joined: 465 },
      C: { name: 'The map', posters: 23, scans: 697, joined: 140 },
    });
    for (const [k, v] of Object.entries(growthFigures)) expect(r.body.figures[k]).toEqual(v);
    expect(r.body.figures['members.waitlist.median_days']).toBe(24);
    expect(r.body.MEMBER_SUMMARY).toEqual({ invited: 300, opened: 64, active: 124, funded: { Bank: 71, $5: 38, Deposit: 15 } });
    expect(r.body.NEXT_BATCH).toEqual({ number: 13 });
    expect((await call(kai, 'GET', '/audit')).body.entries[0]).toMatchObject({ action: 'Showed names on the forms', area: 'growth' });
  });

  test('Growth without asking: names and emails masked the way the page masks them', async () => {
    const r = await call(kai, 'GET', '/sections/growth');
    expect(r.body.INBOX[0].who).toEqual([mask(growthFx.forms[0].who[0]), mask(growthFx.forms[0].who[1])]);
    expect(r.body.INBOX[0].mail).toBe('m•••@g•••.com');
    expect(JSON.stringify(r.body.INBOX)).not.toContain(growthFx.forms[0].mail);
  });

  test('Growth at Totals (every member): no inbox at all, the rest the same', async () => {
    const member = await signIn('did:member|member@example.com');
    const r = await call(member, 'GET', '/sections/growth?reveal=1');
    expect(r.status).toBe(200);
    expect(r.body.INBOX).toBeNull();
    expect(r.body.names).toBe('none');
    expect(r.body.POSTERS).toEqual(growthFx.posters);
    expect(JSON.stringify(r.body)).not.toContain('@');
  });

  test('Field: the prototype’s route, stops, tasks and shops due later; None is refused', async () => {
    const r = await call(kai, 'GET', '/sections/field');
    expect(r.status).toBe(200);
    expect(r.body.ROUTE).toEqual(fieldFx.route);
    expect(r.body.STOPS).toEqual(fieldFx.stops);
    expect(r.body.LATER).toEqual(fieldFx.later);
    expect(r.body.SHOP_INFO).toEqual(fieldFx.shopInfo);
    expect(r.body.POSTERS).toEqual(growthFx.posters);
    const member = await signIn('did:member|member@example.com');
    expect((await call(member, 'GET', '/sections/field')).status).toBe(403);
  });
});

describe('Merchants, as each level gets it', () => {
  test('See and up: the prototype’s partners, signed shops, prospects, $10s owed, board and fleet, exactly', async () => {
    const kai = await signIn('did:kai|kai@useclear.org');
    const r = await call(kai, 'GET', '/sections/merchants');
    expect(r.status).toBe(200);
    expect(r.body.TX).toEqual(merchFx.tx);
    expect(r.body.SIGNED).toEqual(merchFx.signed);
    expect(r.body.PROSPECTS).toEqual(merchFx.prospects);
    expect(r.body.OWED).toEqual(merchFx.owed);
    expect(r.body.BOARD).toEqual(merchFx.board);
    expect(r.body.FLEET).toEqual(merchFx.fleet);
    for (const [k, v] of Object.entries(merchFigures)) expect(r.body.figures[k]).toEqual(v);
  });

  test('Totals (every member): the same shops and numbers, without the shops’ people', async () => {
    const member = await signIn('did:member|member@example.com');
    const r = await call(member, 'GET', '/sections/merchants');
    expect(r.status).toBe(200);
    expect(r.body.TX).toEqual(merchFx.tx);
    for (const c of r.body.BOARD) {
      expect(c.contact).toEqual({ name: '', role: '', phone: '', email: '' });
      expect(c.addr).toBe('');
    }
    const body = JSON.stringify(r.body);
    expect(body).not.toContain('555-0142');
    expect(body).not.toContain('ray@missionauto.com');
  });
});

describe('Money, built from the database', () => {
  test('the headline numbers, the yield pool and every series are the prototype’s, worked out on the server', async () => {
    const kai = await signIn('did:kai|kai@useclear.org');
    const r = await call(kai, 'GET', '/sections/money');
    expect(r.status).toBe(200);
    const c = moneyFx.check as Record<string, any>;
    expect(r.body.M).toEqual(c.M);
    expect(r.body.Y).toEqual(c.Y);
    expect(r.body.ACCTS).toEqual(c.ACCTS);
    for (const k of ['AP_BAL', 'UNSEC', 'AP_REQ', 'RTD_W', 'Y_ASSETS', 'Y_LENT']) expect(r.body[k]).toEqual(c[k]);
    expect(r.body.Y_DEP).toEqual(moneyFx.depositors);
    expect(r.body.BONDS).toEqual(moneyFx.bonds);
    expect(r.body.ENTRIES).toEqual(moneyFx.entries);
    expect(r.body.TX).toEqual(merchFx.tx);
    expect(r.body.MEMBER_SUMMARY).toEqual({ active: 124 });
    // what the shop holds for others: sales tax on the last 4 weeks, and the hardware deposits
    expect(r.body.SET_ASIDE).toEqual(shopFx.check.SET_ASIDE);
  });

  test('every member can read it (Totals); nothing in it names a member', async () => {
    const member = await signIn('did:member|member@example.com');
    const r = await call(member, 'GET', '/sections/money');
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('@');
  });
});

describe('Shop, built from the database', () => {
  const NOW = Date.UTC(2026, 9, 21, 14);
  const at = (v: number | null) => v ?? NOW;
  const units = (shopFigures as Record<string, any>)['shop.units_weekly'];

  test('the catalog, stock, shelf, orders, pre-orders, what’s coming and the returns are the prototype’s', async () => {
    const kai = await signIn('did:kai|kai@useclear.org');
    const r = await call(kai, 'GET', '/sections/shop');
    expect(r.status).toBe(200);
    expect(r.body.NOW).toBe(NOW);
    expect(r.body.PR).toEqual(shopFx.products.map((p: any) => ({ ...p, wk: units[p.id] })));
    expect(r.body.STK).toEqual(shopFx.stock);
    expect(r.body.SHELF_EV).toEqual(Object.fromEntries(Object.entries(shopFx.shelf).map(([id, ev]: [string, any]) => [id, ev.map(([s, a, b]: any[]) => [s, at(a), at(b)])])));
    expect(r.body.SHIST).toEqual(shopFx.history);
    expect(r.body.ORDERS).toEqual(shopFx.orders);
    expect(r.body.PRE).toEqual(shopFx.preorders);
    expect(r.body.INCOMING).toEqual(shopFx.incoming.map((x: any[]) => [x[0], x[1], x[2].map(([k, a, b]: any[]) => [k, at(a), at(b)]), x[3], x[4]]));
    expect(r.body.RETURNS).toEqual(shopFx.returns);
    expect(r.body.figures['shop.orders_weekly']).toEqual([9, 13, 13, 15, 18, 20, 17, 19]);
  });

  test('at Totals the orders carry no buyer, city or time, and the returns aren’t sent', async () => {
    const member = await signIn('did:member|member@example.com');
    const r = await call(member, 'GET', '/sections/shop');
    expect(r.status).toBe(200);
    expect(r.body.ORDERS).toHaveLength(shopFx.orders.length);
    for (const o of r.body.ORDERS) expect([o[1], o[2], o[3], o[9]]).toEqual([0, '', 0, '']);
    expect(r.body.RETURNS).toEqual([]);
    const text = JSON.stringify(r.body);
    for (const o of shopFx.orders as any[]) expect(text).not.toContain(o[2]);
  });
});
