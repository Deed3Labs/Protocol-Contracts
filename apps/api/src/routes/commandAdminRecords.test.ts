import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import type { MemberSource } from '../services/command/memberSource.js';
import { governanceSection, homeSection } from '../services/command/sections.js';
import { seedCommand } from '../services/command/seed.js';
import { commandRouter } from './command.js';

/*
 * The records Command keeps for cells that had nothing to read (migration 0068): agreement versions and
 * who accepted which (Governance), the organization's profile, connections' key age and the events worth
 * a look (Settings), and notes and tags on people (Members).
 */

let base = '';
let db: Db;
let server: ReturnType<ReturnType<typeof express>['listen']>;

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
      adminEmails: () => ['kai@useclear.org', 'dana@useclear.org'],
      appUrl: () => 'https://command.test',
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
  kai = await signIn('did:kai|kai@useclear.org');
  dana = await signIn('did:dana|dana@useclear.org');
});
afterAll(() => server?.close());

type Who = { user: string; session?: string };
let kai: Who;
let dana: Who;
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (user: string, device = `device-${user.replace(/\W/g, '')}-00000000`) => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: device, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;
async function person(name: string, levels: Levels) {
  const email = `${name}@useclear.org`;
  await call(kai, 'POST', '/invites', { email, name, group: 'outside' });
  const who = await signIn(`did:${name}|${email}`);
  const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === email).id;
  expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: levels })).status).toBe(200);
  return who;
}
const settings = async (who: Who = kai) => (await call(who, 'GET', '/sections/settings')).body;
const governance = async (who: Who = kai) => (await call(who, 'GET', '/sections/governance')).body;
const members = async (who: Who = kai) => (await call(who, 'GET', '/sections/members')).body;

describe('Governance → agreement versions', () => {
  test('none recorded: every agreement has no versions yet, and the data room’s terms are counted', async () => {
    const g = await governance();
    expect(g.VERS).toEqual({});
    expect(g.TERMS).toEqual([]);
  });

  test('a draft is one person’s; adopting it waits for a second, who isn’t the one who asked', async () => {
    const d = await call(kai, 'POST', '/actions/governance/version-draft', {
      agreement: 'mem21',
      version: 'v2.1',
      changes: ['+ Savings-backed credit', '~ Fees move to a schedule the board sets'],
      decidedBy: 'Co-op board',
      terms: 'membership_terms@2026-03',
    });
    expect(d.status).toBe(200);
    expect((await governance()).VERS.mem21).toMatchObject([{ v: 'v2.1', st: 'draft', by: 'Co-op board', terms: 'membership_terms@2026-03', draftedBy: expect.any(String), approvedBy: null }]);
    // the same version again, or one of an agreement that isn't there, is refused
    expect((await call(kai, 'POST', '/actions/governance/version-draft', { agreement: 'mem21', version: 'v2.1' })).status).toBe(409);
    expect((await call(kai, 'POST', '/actions/governance/version-draft', { agreement: 'nope', version: 'v1.0' })).status).toBe(404);
    expect((await call(kai, 'POST', '/actions/governance/version-draft', { agreement: 'mem21', version: 'two' })).status).toBe(400);
    expect((await call(kai, 'POST', '/actions/governance/version-draft', { agreement: 'mem21', version: 'v3', changes: ['no sign'] })).status).toBe(400);

    const a = await call(kai, 'POST', '/actions/governance/version-adopt', { agreement: 'mem21', version: 'v2.1', onDay: '2026-08-14' });
    expect(a.status).toBe(202);
    expect((await call(kai, 'POST', `/proposals/${a.body.proposal.id}/approve`)).status).toBe(403);
    expect((await call(dana, 'POST', `/proposals/${a.body.proposal.id}/approve`)).status).toBe(200);
    const v = (await governance()).VERS.mem21[0];
    expect(v).toMatchObject({ v: 'v2.1', st: 'in', at: Date.UTC(2026, 7, 14, 12), replaced: null });
    expect(v.adoptedBy).not.toBe(v.approvedBy);
    expect(v.approvedBy).toEqual(expect.any(String));
  });

  test('adopting the next replaces the one in force that day; a draft that isn’t one, or an earlier day, is refused', async () => {
    await call(kai, 'POST', '/actions/governance/version-draft', { agreement: 'mem21', version: 'v2.2', changes: ['+ Hardship pause, one cycle'], decidedBy: 'Member vote' });
    // a day before the one in force was adopted
    const early = await call(kai, 'POST', '/actions/governance/version-adopt', { agreement: 'mem21', version: 'v2.2', onDay: '2026-08-01' });
    expect(early.status).toBe(202);
    expect((await call(dana, 'POST', `/proposals/${early.body.proposal.id}/approve`)).status).toBe(409);
    const a = await call(dana, 'POST', '/actions/governance/version-adopt', { agreement: 'mem21', version: 'v2.2', onDay: '2026-10-01' });
    expect((await call(kai, 'POST', `/proposals/${a.body.proposal.id}/approve`)).status).toBe(200);
    const V = (await governance()).VERS.mem21;
    expect(V.map((v: any) => [v.v, v.st, v.replaced])).toEqual([
      ['v2.1', 'old', Date.UTC(2026, 9, 1, 12)],
      ['v2.2', 'in', null],
    ]);
    // the agreement shows the version in force
    const c = (await call(kai, 'GET', '/sections/contracts')).body;
    expect(c.AGR.find((x: any) => x.id === 'mem21').ver).toBe('v2.2');
    // it's not a draft any more: refused before it waits for anyone
    expect((await call(kai, 'POST', '/actions/governance/version-adopt', { agreement: 'mem21', version: 'v2.2' })).status).toBe(409);
  });

  test('the database keeps a version from being in force without a second person', async () => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM command.people WHERE email = 'kai@useclear.org'`);
    await expect(
      db.query(`INSERT INTO command.agreement_versions (agreement_id, version, status, adopted_at, adopted_by, approved_by) VALUES ('mem21', 'v9', 'old', now(), $1, $1)`, [rows[0].id]),
    ).rejects.toThrow(/agreement_versions_second_person/);
  });

  test('who has accepted which: the member app’s acceptances, counted, when Members is live', async () => {
    const was = process.env.PROVIDER_MEMBERS;
    process.env.PROVIDER_MEMBERS = 'live';
    try {
      const src: MemberSource = {
        roster: async () => [],
        milestones: async () => new Map(),
        terms: async () => [{ doc: 'membership_terms', version: '2026-03', n: 12, first: Date.UTC(2026, 2, 3), last: Date.UTC(2026, 9, 20) }],
      };
      await db.query(`INSERT INTO command.terms_acceptances (person_id, version) SELECT id, 'data-room-v1' FROM command.people WHERE email = 'kai@useclear.org'`);
      const g = await governanceSection(db, { level: 2, reveal: false, now: new Date(), memberSource: src });
      expect(g.TERMS).toEqual([
        { key: 'membership_terms@2026-03', doc: 'membership_terms', version: '2026-03', n: 12, first: Date.UTC(2026, 2, 3), last: Date.UTC(2026, 9, 20), who: 'members' },
        { key: 'data-room@data-room-v1', doc: 'data-room', version: 'data-room-v1', n: 1, first: expect.any(Number), last: expect.any(Number), who: 'team' },
      ]);
      // at Totals, no one's name on a version
      const t = (await governanceSection(db, { level: 1, reveal: false, now: new Date(), memberSource: src })) as any;
      for (const v of t.VERS.mem21) expect([v.adoptedBy, v.approvedBy, v.draftedBy]).toEqual([null, null, null]);
    } finally {
      if (was == null) delete process.env.PROVIDER_MEMBERS;
      else process.env.PROVIDER_MEMBERS = was;
    }
  });

  test('Home sends the entities as Governance does, for its small tree', async () => {
    const g = (await governanceSection(db, { level: 1, reveal: false, now: new Date() })) as any;
    const h = (await homeSection(db, { level: 1, reveal: false, now: new Date() })) as any;
    expect(g.ENT.length).toBeGreaterThan(0);
    expect(h.ENT).toEqual(g.ENT);
  });
});

describe('Settings → the profile', () => {
  test('each part starts unset and changes only with a second person', async () => {
    const by = Object.fromEntries((await settings()).SETTINGS.map((s: any) => [s.id, s]));
    for (const id of ['org_name', 'org_site', 'org_help', 'org_tz', 'org_fy', 'org_cur']) expect(by[id]).toMatchObject({ sec: 'org', value: '', pending: null });
    const r = await call(kai, 'POST', '/actions/settings/change', { id: 'org_name', value: 'Clear Co-op', why: 'Our registered name' });
    expect(r.status).toBe(202);
    expect((await call(dana, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    const after = (await settings()).SETTINGS.find((s: any) => s.id === 'org_name');
    expect(after).toMatchObject({ value: 'Clear Co-op', changedBy: expect.any(String), approvedBy: expect.any(String) });
    expect((await settings()).HISTORY[0]).toMatchObject({ set: 'org_name', from: '', to: 'Clear Co-op' });
  });

  test('each part is checked for what it is before it waits for anyone', async () => {
    const ok = [
      ['org_site', 'useclear.org'],
      ['org_site', 'https://useclear.org/help'],
      ['org_help', 'help@useclear.org'],
      ['org_tz', 'America/Los_Angeles'],
      ['org_fy', 'July'],
      ['org_cur', 'USD'],
    ];
    for (const [id, value] of ok) expect((await call(kai, 'POST', '/actions/settings/change', { id, value })).status, `${id} ${value}`).toBe(202);
    const bad = [
      ['org_name', 'X'],
      ['org_site', 'not a site'],
      ['org_help', 'help.useclear.org'],
      ['org_tz', 'Pacific Time'],
      ['org_tz', 'Mars/Olympus'],
      ['org_fy', 'Juli'],
      ['org_cur', 'usd'],
      ['org_cur', 'DOLLARS'],
    ];
    for (const [id, value] of bad) expect((await call(kai, 'POST', '/actions/settings/change', { id, value })).status, `${id} ${value}`).toBe(400);
  });
});

describe('Settings → key age', () => {
  test('a connection with no swap recorded isn’t listed; a recorded one is, newest first, with who', async () => {
    expect((await settings()).KEYS).toEqual([]);
    expect((await call(kai, 'POST', '/actions/settings/key-rotated', { connection: 'stripe', on: '2026-07-01', note: 'Restricted key' })).status).toBe(200);
    expect((await call(dana, 'POST', '/actions/settings/key-rotated', { connection: 'stripe', note: 'Swapped after the audit' })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/settings/key-rotated', { connection: 'plaid', on: '2026-09-15' })).status).toBe(200);
    const K = (await settings()).KEYS;
    expect(K.map((k: any) => [k.connection, k.n, k.note])).toEqual([
      ['plaid', 1, ''],
      ['stripe', 2, 'Swapped after the audit'],
    ]);
    expect(K[0].at).toBe(Date.UTC(2026, 8, 15, 12));
    expect(K[1].by).toEqual(expect.any(String));
  });

  test('an unknown connection or a day still to come is refused', async () => {
    expect((await call(kai, 'POST', '/actions/settings/key-rotated', { connection: 'nope' })).status).toBe(400);
    expect((await call(kai, 'POST', '/actions/settings/key-rotated', { connection: 'stripe', on: '2999-01-01' })).status).toBe(400);
  });
});

describe('Settings → worth a look', () => {
  test('joins, new devices, a reveal with no reason and a device gone quiet, from what’s already kept; at Totals, no names', async () => {
    // a second device for Kai, a reveal in a rush, and a device last seen ten days ago
    await signIn('did:kai|kai@useclear.org', 'device-kai-the-new-phone-00');
    expect((await call(kai, 'POST', '/members/1/reveal', { rush: true })).status).toBe(200);
    await db.query(
      `INSERT INTO command.devices (person_id, device_key, label, first_seen, last_seen) SELECT id, 'device-dana-old-laptop-0000', 'Dana’s old laptop', now() - interval '20 days', now() - interval '10 days' FROM command.people WHERE email = 'dana@useclear.org'`,
    );
    const W = (await settings()).WORTH;
    const kinds = W.map((w: any) => w.kind);
    expect(kinds.filter((k: string) => k === 'join').length).toBeGreaterThanOrEqual(2);
    expect(kinds).toContain('device');
    expect(W.find((w: any) => w.kind === 'noreason')).toMatchObject({ who: expect.any(String), what: expect.stringContaining('name') });
    expect(W.find((w: any) => w.kind === 'quiet')).toMatchObject({ what: 'Dana’s old laptop' });
    // newest first
    expect(W.map((w: any) => w.at)).toEqual([...W.map((w: any) => w.at)].sort((a: number, b: number) => b - a));
    const totals = all(2);
    totals.settings = 1;
    const p = await person('worthtotals', totals);
    for (const w of (await settings(p)).WORTH) expect([w.personId, w.who]).toEqual([null, null]);
  });
});

describe('Members → notes and tags', () => {
  test('a note and tags on someone, by their masked number, with who wrote it', async () => {
    expect((await members()).NOTES).toEqual({});
    expect((await call(kai, 'POST', '/actions/members/note', { subject: 'M-0001', text: 'Asked about the bank link · call back Friday' })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/members/tag', { subject: 'M-0001', tag: 'Follow up' })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/members/tag', { subject: 'M-0001', tag: 'Follow up' })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/members/tag', { subject: 'W-0012', tag: 'Spanish speaker' })).status).toBe(200);
    const m = await members();
    expect(m.NOTES['M-0001']).toEqual([{ t: 'Asked about the bank link · call back Friday', by: expect.any(String), at: expect.any(Number) }]);
    expect(m.TAGS).toEqual({ 'M-0001': ['Follow up'], 'W-0012': ['Spanish speaker'] });
    expect((await call(kai, 'POST', '/actions/members/untag', { subject: 'M-0001', tag: 'Follow up' })).status).toBe(200);
    expect((await members()).TAGS).toEqual({ 'W-0012': ['Spanish speaker'] });
    expect((await call(kai, 'POST', '/actions/members/untag', { subject: 'M-0001', tag: 'Follow up' })).status).toBe(404);
  });

  test('never contact details, and never anything but a masked number', async () => {
    for (const text of ['Her email is ana.ruiz@gmail.com', 'Call (909) 555-0134', 'Text 9095550134'])
      expect((await call(kai, 'POST', '/actions/members/note', { subject: 'M-0001', text })).status, text).toBe(400);
    expect((await call(kai, 'POST', '/actions/members/tag', { subject: 'M-0001', tag: 'ana@x.co' })).status).toBe(400);
    for (const subject of ['Ana Ruiz', '1', 'M-1', 'X-0001']) expect((await call(kai, 'POST', '/actions/members/note', { subject, text: 'Hi' })).status, subject).toBe(400);
  });

  test('at Totals there are none: each is about one person', async () => {
    const totals = all(2);
    totals.members = 1;
    const p = await person('notestotals', totals);
    const m = await members(p);
    expect([m.NOTES, m.TAGS]).toEqual([null, null]);
  });
});
