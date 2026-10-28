import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { startPlannedRoute } from '../services/command/sections.js';
import { commandRouter } from './command.js';

/*
 * Field's own records (migration 0069): routes planned for the coming days (planned, changed, sent, taken back,
 * accepted, and today's route once accepted for today), the van's load, and the shops that said yes to a poster.
 * The field section is seeded, so its actions happen on the prototype's day, 21 Oct.
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
      adminEmails: () => ['kai@useclear.org'],
      appUrl: () => 'https://command.test',
      now: () => clock,
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  delete process.env.PROVIDER_FIELD;
});

type Who = { user: string; session?: string };
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(root + '/api/command' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (user: string): Promise<Who> => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;
const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, p)).rows as T[];
const field = async (who: Who) => (await call(who, 'GET', '/sections/field')).body;
const idOf = async (email: string) => (await q<{ id: string }>('SELECT id FROM command.people WHERE email = $1', [email]))[0].id;

const stop = (ref: string, shop: string, extra: Record<string, unknown> = {}) => ({ ref, kind: 'merchant', shop, city: 'Redlands', what: 'Follow up', why: 'Due today', mins: 30, ...extra });

let kai: Who, marcus: Who, kaiId: string, marcusId: string;
beforeAll(async () => {
  kai = await signIn('did:kai|kai@useclear.org');
  // someone with Propose on Field: plans their own routes only
  await call(kai, 'POST', '/invites', { email: 'marcus@useclear.org', name: 'Marcus Lee', group: 'outside' });
  marcus = await signIn('did:marcus|marcus@useclear.org');
  kaiId = await idOf('kai@useclear.org');
  marcusId = await idOf('marcus@useclear.org');
  expect((await call(kai, 'PATCH', `/people/${marcusId}/access`, { custom: { ...all(2), field: 3 } })).status).toBe(200);
});

describe('routes planned ahead', () => {
  let id = 0;
  test('an admin plans a route for someone, with its stops in order, and Plan reads it back', async () => {
    const r = await call(kai, 'POST', '/actions/field/route-plan', {
      day: '2026-10-22',
      who: marcusId,
      stops: [stop('c:m1', 'Mission Auto Care'), stop('p44', 'Mesa Laundry', { kind: 'poster', n: 44, design: 'C', eta: '09:20' })],
      miles: 12,
      minutes: 95,
      backBy: '10:35',
    });
    expect(r.status).toBe(200);
    id = r.body.result.id;
    const p = (await field(kai)).PLANS.find((x: any) => x.id === id);
    expect(p).toMatchObject({ who: marcusId, whoName: 'Marcus Lee', by: kaiId, status: 'draft', changed: false, miles: 12, minutes: 95, backBy: '10:35' });
    expect(new Date(p.day).toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(p.stops.map((s: any) => [s.ref, s.kind, s.n, s.eta])).toEqual([
      ['c:m1', 'merchant', null, null],
      ['p44', 'poster', 44, '09:20'],
    ]);
  });

  test('one route a person a day, and none in the past', async () => {
    expect((await call(kai, 'POST', '/actions/field/route-plan', { day: '2026-10-22', who: marcusId })).status).toBe(409);
    expect((await call(kai, 'POST', '/actions/field/route-plan', { day: '2026-10-20', who: kaiId })).body.code).toBe('PAST_DAY');
  });

  test('stops added, moved and taken off are saved whole; a stop twice is refused', async () => {
    const stops = [
      stop('p44', 'Mesa Laundry', { kind: 'poster', n: 44 }),
      stop('d:x', 'Highland Hardware', { kind: 'device', what: 'Swap the Point’s battery' }),
      stop('a:1', 'Kingston Vet', { kind: 'visit', what: 'Talk to the owner' }),
    ];
    expect((await call(kai, 'POST', '/actions/field/route-save', { id, stops, miles: 20, minutes: 120, backBy: '11:00' })).status).toBe(200);
    const p = (await field(kai)).PLANS.find((x: any) => x.id === id);
    expect(p.stops.map((s: any) => s.ref)).toEqual(['p44', 'd:x', 'a:1']);
    expect([p.status, p.changed, p.miles]).toEqual(['draft', false, 20]);
    expect((await call(kai, 'POST', '/actions/field/route-save', { id, stops: [stops[0], stops[0]] })).status).toBe(400);
  });

  test('sent, it waits for the person and is recorded for their phone; changed, it goes back to a draft', async () => {
    expect((await call(kai, 'POST', '/actions/field/route-send', { id, note: 'Bring design C' })).status).toBe(200);
    let p = (await field(kai)).PLANS.find((x: any) => x.id === id);
    expect([p.status, p.note, typeof p.sentAt]).toEqual(['sent', 'Bring design C', 'number']);
    expect((await q(`SELECT status FROM command.outbox WHERE kind = 'route-send'`))[0].status).toBe('queued');
    expect((await call(kai, 'POST', '/actions/field/route-save', { id, stops: p.stops.slice(1), miles: 9, minutes: 60 })).status).toBe(200);
    p = (await field(kai)).PLANS.find((x: any) => x.id === id);
    expect([p.status, p.changed, p.stops.length]).toEqual(['draft', true, 2]);
    expect((await call(kai, 'POST', '/actions/field/route-send', { id })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/field/route-take-back', { id })).status).toBe(200);
    expect((await field(kai)).PLANS.find((x: any) => x.id === id).status).toBe('draft');
    expect((await call(kai, 'POST', '/actions/field/route-take-back', { id })).status).toBe(409);
  });

  test('someone with Field access plans and accepts their own routes, never another’s', async () => {
    expect((await call(marcus, 'POST', '/actions/field/route-plan', { day: '2026-10-23', who: kaiId })).body.code).toBe('NOT_YOURS');
    const own = await call(marcus, 'POST', '/actions/field/route-plan', { day: '2026-10-23', who: marcusId, stops: [stop('c:m2', 'Orange Show Tires')] });
    expect(own.status).toBe(200);
    expect((await call(marcus, 'POST', '/actions/field/route-accept', { id: own.body.result.id })).status).toBe(200);
    expect((await field(marcus)).PLANS.find((x: any) => x.id === own.body.result.id).status).toBe('accepted');
    // Kai's route for Marcus is Marcus's to accept, and still Kai's to change; Kai's own is Kai's
    expect((await call(marcus, 'POST', '/actions/field/route-accept', { id })).status).toBe(200);
    const kais = await call(kai, 'POST', '/actions/field/route-plan', { day: '2026-10-26', who: kaiId, stops: [stop('c:m6', 'Inland Cycle Works')] });
    expect((await call(marcus, 'POST', '/actions/field/route-save', { id: kais.body.result.id, stops: [] })).body.code).toBe('NOT_YOURS');
    expect((await call(marcus, 'POST', '/actions/field/route-save', { id, stops: [], who: kaiId })).body.code).toBe('NOT_YOURS');
  });

  test('a route with no stops can’t be sent or accepted', async () => {
    const r = await call(kai, 'POST', '/actions/field/route-plan', { day: '2026-10-27', who: kaiId });
    expect((await call(kai, 'POST', '/actions/field/route-send', { id: r.body.result.id })).body.code).toBe('NO_STOPS');
    expect((await call(kai, 'POST', '/actions/field/route-accept', { id: r.body.result.id })).body.code).toBe('NO_STOPS');
  });

  test('accepted for today, a planned route becomes today’s route, once', async () => {
    // Marcus's route for the 23rd is accepted: the 23rd is today once the section reads the real clock
    process.env.PROVIDER_FIELD = 'live';
    try {
      const f = await field(kai);
      expect(new Date(f.ROUTE.day).toISOString().slice(0, 10)).toBe('2026-10-23');
      expect([f.ROUTE.staff, f.ROUTE.staffKey]).toEqual(['Marcus Lee', marcusId]);
      expect(f.STOPS.map((s: any) => [s.name, s.tasks.map((t: any) => [t.kind, t.t])])).toEqual([['Orange Show Tires', [['visit', 'Follow up']]]]);
      // a plan for today isn't ahead any more
      expect(f.PLANS.some((p: any) => new Date(p.day).toISOString().slice(0, 10) === '2026-10-23')).toBe(false);
      expect(await startPlannedRoute(db, '2026-10-23')).toBe(false);
      expect((await q(`SELECT count(*)::int AS n FROM command.route_stops WHERE day = '2026-10-23'`))[0].n).toBe(1);
    } finally {
      delete process.env.PROVIDER_FIELD;
    }
    // a poster stop is a poster task, so a scan on that day marks it
    expect(await startPlannedRoute(db, '2026-10-22')).toBe(true);
    const tasks = await q(`SELECT kind, poster, title FROM command.route_tasks WHERE day = '2026-10-22' ORDER BY stop_id`);
    expect(tasks.map((t) => t.kind)).toEqual(['device', 'visit']);
    // the seeded day keeps its own route
    expect(await startPlannedRoute(db, '2026-10-21')).toBe(false);
    expect((await q(`SELECT staff FROM command.routes WHERE day = '2026-10-21'`))[0].staff).toBe('Marcus Lee');
  });
});

describe('the van', () => {
  test('nothing is recorded until the load is, then today’s is read and the route says when it was loaded', async () => {
    expect((await field(kai)).VAN).toBeNull();
    expect((await call(kai, 'POST', '/actions/field/van', { posters: { A: 4, B: 3, C: 0 }, batteries: 2, rolls: 5, at: '08:35' })).status).toBe(200);
    const f = await field(kai);
    expect(f.VAN).toMatchObject({ loaded: '08:35', posters: { A: 4, B: 3 }, batteries: 2, rolls: 5, by: 'kai' });
    expect(f.ROUTE.loaded).toBe('08:35');
    // recorded again, it's replaced
    expect((await call(marcus, 'POST', '/actions/field/van', { posters: { B: 1 }, batteries: 0, rolls: 1 })).status).toBe(200);
    expect((await field(kai)).VAN).toMatchObject({ loaded: '14:00', posters: { B: 1 }, batteries: 0, rolls: 1, by: 'Marcus Lee' });
    expect((await call(kai, 'POST', '/actions/field/van', { posters: { a: 1 } })).status).toBe(400);
  });
});

describe('shops that said yes to a poster', () => {
  test('a yes from a visit is listed with when it was given; the same shop twice is refused', async () => {
    const r = await call(marcus, 'POST', '/actions/field/poster-yes', { shop: 'Magnolia Laundry', city: 'Riverside', card: 'm1', source: 'visit', note: 'Owner said the front window' });
    expect(r.status).toBe(200);
    const y = (await field(kai)).POSTER_YES.find((x: any) => x.id === r.body.result.id);
    expect(y).toMatchObject({ shop: 'Magnolia Laundry', city: 'Riverside', card: 'm1', source: 'visit', by: 'Marcus Lee', placed: null, n: null, note: 'Owner said the front window' });
    expect(new Date(y.agreed).toISOString().slice(0, 10)).toBe('2026-10-21');
    expect((await call(kai, 'POST', '/actions/field/poster-yes', { shop: 'magnolia laundry', city: 'Riverside' })).status).toBe(409);
  });

  test('placed, the poster is up in the list, and the shop shows as placed', async () => {
    const id = (await field(kai)).POSTER_YES.find((x: any) => x.shop === 'Magnolia Laundry').id;
    const r = await call(kai, 'POST', '/actions/field/poster-placed', { id, design: 'B' });
    expect(r.status).toBe(200);
    const f = await field(kai);
    const p = f.POSTERS.find((x: any) => x.n === r.body.result.n);
    expect([p.shop, p.city, p.design, p.status]).toEqual(['Magnolia Laundry', 'Riverside', 'B', 'up']);
    expect(f.POSTER_YES.find((x: any) => x.id === id)).toMatchObject({ n: r.body.result.n, design: 'B' });
    expect((await call(kai, 'POST', '/actions/field/poster-placed', { id, design: 'B' })).status).toBe(404);
    // placed, the shop can say yes again (another window, another poster)
    expect((await call(kai, 'POST', '/actions/field/poster-yes', { shop: 'Magnolia Laundry', city: 'Riverside', source: 'pipeline' })).status).toBe(200);
  });

  test('a shop that changes its mind is taken off', async () => {
    const r = await call(kai, 'POST', '/actions/field/poster-yes', { shop: 'Sierra Lakes Barber', city: 'Fontana' });
    expect((await call(kai, 'POST', '/actions/field/poster-no', { id: r.body.result.id, reason: 'New owner' })).status).toBe(200);
    expect((await field(kai)).POSTER_YES.some((x: any) => x.id === r.body.result.id)).toBe(false);
  });

  test('at Totals, the notes stay on the server', async () => {
    expect((await call(kai, 'PATCH', `/people/${marcusId}/access`, { custom: { ...all(2), field: 1 } })).status).toBe(200);
    const f = await field(marcus);
    expect(f.POSTER_YES.every((y: any) => y.note === null)).toBe(true);
    expect(f.PLANS.every((p: any) => p.note === null)).toBe(true);
    expect((await call(marcus, 'POST', '/actions/field/van', {})).status).toBe(403);
  });
});
