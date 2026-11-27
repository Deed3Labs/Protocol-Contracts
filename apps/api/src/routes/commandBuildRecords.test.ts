import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { commandRouter } from './command.js';

/*
 * Build's own records (migration 0066), through the route: incidents (opened, updated, given to someone,
 * resolved, with their timeline), security findings (added, moved between states, a fix linked) and audits.
 * Each at Propose on Build; accepting a critical finding waits for a second person; See reads but doesn't
 * write; at Totals none of it carries a name or a note.
 */

let base = '';
let db: Db;
type Who = { user: string; session?: string };
let kai: Who, dana: Who, eng: Who, look: Who, tot: Who;
let engId = '',
  lookId = '';

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
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
async function person(name: string, levels: Levels) {
  const email = `${name}@useclear.org`;
  await call(kai, 'POST', '/invites', { email, name, group: 'outside' });
  const who = await signIn(`did:${name}|${email}`);
  const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === email).id;
  expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: levels })).status).toBe(200);
  return [who, id] as const;
}
const act = (who: Who, kind: string, body: unknown) => call(who, 'POST', `/actions/contracts/${kind}`, body);
const build = async (who: Who = kai) => (await call(who, 'GET', '/sections/contracts')).body;
// the seeded section's "now": 21 Oct 2026, 14:00
const NOW = Date.UTC(2026, 9, 21, 14);

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
      now: () => new Date('2026-10-23T17:00:00Z'),
    }),
  );
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/command`;
  kai = await signIn('did:kai|kai@useclear.org');
  dana = await signIn('did:dana|dana@useclear.org');
  [eng, engId] = await person('eng', { ...all(2), contracts: 3 });
  [look, lookId] = await person('look', all(2));
  [tot] = await person('tot', all(1));
});

describe('nothing recorded yet', () => {
  test('the section sends empty lists, and who can be given an incident', async () => {
    const b = await build();
    expect(b.INCIDENTS).toEqual([]);
    expect(b.FINDINGS).toEqual([]);
    expect(b.AUDITS).toEqual([]);
    // Propose or more on Build: the admins and eng, not look (See)
    const names = b.TEAM.map((p: any) => p.name);
    expect(names).toContain('eng');
    expect(names).not.toContain('look');
    expect(b.TEAM.find((p: any) => p.name === 'eng').id).toBe(engId);
  });
});

describe('incidents', () => {
  let id = 0;
  test('one is opened with when it began, who is on it, and its first lines', async () => {
    const r = await act(eng, 'incident-open', { title: 'Plaid sync 3 hours behind', severity: 'low', area: 'Money', note: 'Operating cash is 3 hours old.', at: NOW - 6 * 3600e3, owner: engId });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ done: true, queued: false });
    id = r.body.result.id;
    const i = (await build()).INCIDENTS.find((x: any) => x.id === id);
    expect(i).toMatchObject({
      t: 'Plaid sync 3 hours behind',
      sev: 'low',
      area: 'Money',
      contract: null,
      reached: false,
      at: NOW - 6 * 3600e3,
      opened: NOW,
      resolved: null,
      owner: { id: engId, name: 'eng' },
    });
    expect(i.ev).toEqual([
      [NOW - 6 * 3600e3, 'Began', ''],
      [NOW, 'Opened by eng, who is on it', 'eng'],
    ]);
  });

  test('what it refuses: a contract the map hasn’t, someone not on Build, a time to come, See', async () => {
    expect((await act(kai, 'incident-open', { title: 'x', contract: 'nope' })).status).toBe(404);
    expect((await act(kai, 'incident-open', { title: 'x', owner: lookId })).status).toBe(404);
    expect((await act(kai, 'incident-open', { title: 'x', at: NOW + 3600e3 })).status).toBe(400);
    expect((await act(kai, 'incident-open', { title: '' })).status).toBe(400);
    expect((await act(look, 'incident-open', { title: 'x' })).status).toBe(403);
    expect((await act(kai, 'incident-update', { id: 9999, line: 'x' })).status).toBe(404);
  });

  test('an update and a new owner go on its timeline', async () => {
    expect((await act(kai, 'incident-update', { id, line: 'Plaid’s status page shows delays' })).status).toBe(200);
    const me = (await build()).TEAM.find((p: any) => p.name === 'Kai' || p.name === 'kai@useclear.org');
    expect((await act(eng, 'incident-assign', { id, owner: me.id })).status).toBe(200);
    const i = (await build()).INCIDENTS.find((x: any) => x.id === id);
    expect(i.owner.id).toBe(me.id);
    expect(i.ev.slice(2).map((e: any) => e[1])).toEqual(['Plaid’s status page shows delays', `eng gave it to ${me.name}`]);
    expect((await act(kai, 'incident-assign', { id, owner: null })).status).toBe(200);
    expect((await build()).INCIDENTS.find((x: any) => x.id === id).owner).toBeNull();
  });

  test('resolving closes it once, and a resolved one takes no more updates', async () => {
    expect((await act(kai, 'incident-resolve', { id, resolution: 'Plaid caught up' })).status).toBe(200);
    const i = (await build()).INCIDENTS.find((x: any) => x.id === id);
    expect(i).toMatchObject({ resolved: NOW, resolution: 'Plaid caught up' });
    expect(i.ev.at(-1)[1]).toMatch(/^Resolved by .+: Plaid caught up$/);
    expect((await act(kai, 'incident-resolve', { id })).status).toBe(409);
    expect((await act(kai, 'incident-update', { id, line: 'more' })).status).toBe(409);
    expect((await act(kai, 'incident-assign', { id, owner: engId })).status).toBe(409);
  });

  test('open ones come first; on a contract, it names it', async () => {
    const r = await act(kai, 'incident-open', { title: 'Partner credit paused', severity: 'medium', contract: 'ti', reached: true });
    const b = await build();
    expect(b.INCIDENTS[0]).toMatchObject({ id: r.body.result.id, contract: 'ti', reached: true, resolved: null });
  });
});

describe('findings', () => {
  let crit = 0,
    med = 0;
  test('added with severity, contract, where and who found it', async () => {
    const r = await act(eng, 'finding-add', {
      title: 'Anyone can withdraw from the AssurancePool',
      severity: 'critical',
      contract: 'ap',
      area: 'withdraw and withdrawToken',
      foundBy: 'Internal review',
      note: 'Both are public.',
    });
    expect(r.status).toBe(200);
    crit = r.body.result.id;
    med = (await act(kai, 'finding-add', { title: 'RTD counts asset-backed credit in full', severity: 'medium', contract: 'cr', foundBy: 'Internal review', at: NOW - 11 * 864e5 })).body.result.id;
    expect((await act(kai, 'finding-add', { title: 'x', severity: 'severe', foundBy: 'me' })).status).toBe(400);
    expect((await act(kai, 'finding-add', { title: 'x', severity: 'low', foundBy: '' })).status).toBe(400);
    expect((await act(kai, 'finding-add', { title: 'x', severity: 'low', foundBy: 'me', contract: 'nope' })).status).toBe(404);
    const f = (await build()).FINDINGS.find((x: any) => x.id === crit);
    expect(f).toMatchObject({
      t: 'Anyone can withdraw from the AssurancePool',
      sev: 'critical',
      contract: 'ap',
      where: 'withdraw and withdrawToken',
      st: 'open',
      found: NOW,
      by: 'Internal review',
      note: 'Both are public.',
      pr: null,
      change: null,
    });
    expect((await build()).FINDINGS.find((x: any) => x.id === med).found).toBe(NOW - 11 * 864e5);
  });

  test('linking a fix to an open one puts it in progress; a PR or a change, not both', async () => {
    const r = await act(kai, 'finding-fix', { id: crit, pr: 131 });
    expect(r.body.result).toEqual({ state: 'fixing' });
    expect((await build()).FINDINGS.find((x: any) => x.id === crit)).toMatchObject({ st: 'fixing', pr: 131, change: null, stAt: NOW });
    expect((await act(kai, 'finding-fix', { id: crit, pr: 1, change: 'tx:0xabc' })).status).toBe(400);
    expect((await act(kai, 'finding-fix', { id: crit, change: 'tx:0xabc' })).status).toBe(200);
    expect((await build()).FINDINGS.find((x: any) => x.id === crit)).toMatchObject({ st: 'fixing', pr: null, change: 'tx:0xabc' });
  });

  test('states: fixed straight away; accepted needs a why; the same state twice is refused', async () => {
    expect((await act(kai, 'finding-state', { id: med, state: 'accepted' })).status).toBe(400);
    expect((await act(kai, 'finding-state', { id: med, state: 'accepted', note: 'No asset-backed credit until v2' })).body).toMatchObject({ done: true });
    expect((await build()).FINDINGS.find((x: any) => x.id === med)).toMatchObject({ st: 'accepted', stNote: 'No asset-backed credit until v2' });
    expect((await act(kai, 'finding-state', { id: med, state: 'accepted', note: 'again' })).status).toBe(409);
    expect((await act(look, 'finding-state', { id: med, state: 'open' })).status).toBe(403);
  });

  test('accepting a critical one waits for a second person, then runs', async () => {
    const r = await act(kai, 'finding-state', { id: crit, state: 'accepted', note: 'Pool is empty on testnet' });
    expect(r.status).toBe(202);
    expect((await build()).FINDINGS.find((x: any) => x.id === crit).st).toBe('fixing');
    expect((await call(dana, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    expect((await build()).FINDINGS.find((x: any) => x.id === crit).st).toBe('accepted');
    // back to fixed is one person's
    expect((await act(kai, 'finding-state', { id: crit, state: 'fixed' })).status).toBe(200);
  });
});

describe('audits', () => {
  test('recorded with who, the contracts, the day and the report', async () => {
    const r = await act(kai, 'audit', { kind: 'external', auditor: 'Spearbit', contracts: ['ap', 'ri', 'ap'], scope: 'v1.3 at 3f9a1c2', on: '2026-10-12', report: 'https://example.com/report.pdf' });
    expect(r.status).toBe(200);
    expect((await act(eng, 'audit', { kind: 'internal', auditor: 'Dana and Kai', contracts: ['cc'], on: '2026-11-30' })).status).toBe(200);
    const a = (await build()).AUDITS;
    expect(a.map((x: any) => x.auditor)).toEqual(['Dana and Kai', 'Spearbit']);
    expect(a[1]).toMatchObject({ kind: 'external', contracts: ['ap', 'ri'], scope: 'v1.3 at 3f9a1c2', on: Date.UTC(2026, 9, 12), report: 'https://example.com/report.pdf' });
  });

  test('refused: no contracts, one the map hasn’t, a report not over https, a day that isn’t one', async () => {
    const ok = { kind: 'internal', auditor: 'Kai', contracts: ['ap'], on: '2026-10-01' };
    expect((await act(kai, 'audit', { ...ok, contracts: [] })).status).toBe(400);
    expect((await act(kai, 'audit', { ...ok, contracts: ['nope'] })).status).toBe(404);
    expect((await act(kai, 'audit', { ...ok, report: 'http://example.com/r' })).status).toBe(400);
    expect((await act(kai, 'audit', { ...ok, report: 'javascript:alert(1)' })).status).toBe(400);
    expect((await act(kai, 'audit', { ...ok, on: '2026-02-31' })).status).toBe(400);
    expect((await act(look, 'audit', ok)).status).toBe(403);
  });
});

describe('at Totals', () => {
  test('no names, notes or timelines; what happened, how bad, where and when stay', async () => {
    const b = await build(tot);
    expect(b.TEAM).toEqual([]);
    expect(b.INCIDENTS.length).toBe(2);
    for (const i of b.INCIDENTS) expect(i).toMatchObject({ owner: null, note: '', resolution: '', ev: [] });
    for (const f of b.FINDINGS) expect(f).toMatchObject({ by: '', note: '', stNote: '' });
    expect(b.AUDITS.map((a: any) => a.auditor)).toEqual(['', 'Spearbit']);
    expect(JSON.stringify(b.INCIDENTS) + JSON.stringify(b.FINDINGS)).not.toMatch(/eng|Kai|Dana/);
  });
});
