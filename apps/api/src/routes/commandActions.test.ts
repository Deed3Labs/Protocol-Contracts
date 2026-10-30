import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { commandRouter, commandSharedRouter } from './command.js';

/*
 * Each section's own actions: Command's records saved straight away, outside acts recorded in the
 * outbox and never carried out, and anything over a section's limit waiting for a second person.
 * Files are stored, downloaded with a log row, and shared by links that expire.
 */

let root = '';
let db: Db;
let clock = new Date('2026-10-23T17:00:00Z');

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
  app.use('/api/command/shared', commandSharedRouter({ db: async () => db, now: () => clock }));
  app.use(
    '/api/command',
    commandRouter({
      db: async () => db,
      identify,
      isMember: async (a) => a.profileUuid === 'did:member',
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
const call = async (who: Who, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const raw = body instanceof Uint8Array;
  const r = await fetch(root + '/api/command' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, headers: r.headers, body: (type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer())) as any };
};
const signIn = async (user: string): Promise<Who> => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;
const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, p)).rows as T[];

let kai: Who, second: Who;
beforeAll(async () => {
  kai = await signIn('did:kai|kai@useclear.org');
  second = await signIn('did:second|second@useclear.org');
});

describe('Command’s own records, saved straight away', () => {
  test('a replaced poster is up again, and the change is logged', async () => {
    const r = await call(kai, 'POST', '/actions/growth/poster-replaced', { n: 44 });
    expect(r.status).toBe(200);
    expect(r.body.queued).toBe(false);
    const [p] = await q(`SELECT status, hung_at FROM command.posters WHERE n = 44`);
    expect(p.status).toBe('up');
    // a seeded section's actions happen on the prototype's day
    expect(new Date(p.hung_at).toISOString().slice(0, 10)).toBe('2026-10-21');
    expect((await q(`SELECT action, result FROM command.audit_log WHERE action = 'Replaced poster P-044'`))[0].result).toBe('done');
  });

  test('a campaign’s cost is recorded and removed, each with its own log line', async () => {
    const r = await call(kai, 'POST', '/actions/growth/campaign-cost', { campaign: 'design:A', kind: 'print', amount: 28.8, spentOn: '2026-10-20', note: '12 posters' });
    expect(r.status).toBe(200);
    const [c] = await q(`SELECT id, campaign, kind, amount_cents, spent_on, note FROM command.campaign_costs WHERE id = $1`, [r.body.result.id]);
    expect([c.campaign, c.kind, c.amount_cents, new Date(c.spent_on).toISOString().slice(0, 10), c.note]).toEqual(['design:A', 'print', 2880, '2026-10-20', '12 posters']);
    expect(await q(`SELECT 1 FROM command.audit_log WHERE action = 'Recorded $28.80 of printing for poster design A'`)).toHaveLength(1);
    // not a campaign, not a kind, nothing spent
    expect((await call(kai, 'POST', '/actions/growth/campaign-cost', { campaign: 'A', kind: 'print', amount: 1, spentOn: '2026-10-20' })).status).toBe(400);
    expect((await call(kai, 'POST', '/actions/growth/campaign-cost', { campaign: 'utm:fall', kind: 'coffee', amount: 1, spentOn: '2026-10-20' })).status).toBe(400);
    expect((await call(kai, 'POST', '/actions/growth/campaign-cost', { campaign: 'utm:fall', kind: 'ads', amount: 0, spentOn: '2026-10-20' })).status).toBe(400);
    const gone = await call(kai, 'POST', '/actions/growth/campaign-cost-remove', { id: Number(c.id) });
    expect(gone.status).toBe(200);
    expect(await q(`SELECT 1 FROM command.campaign_costs WHERE id = $1`, [c.id])).toHaveLength(0);
    expect(await q(`SELECT 1 FROM command.audit_log WHERE action = 'Removed $28.80 of printing from poster design A'`)).toHaveLength(1);
    expect((await call(kai, 'POST', '/actions/growth/campaign-cost-remove', { id: Number(c.id) })).status).toBe(404);
  });

  test('a field scan updates the poster and today’s route task', async () => {
    const [t] = await q(`SELECT poster FROM command.route_tasks WHERE kind = 'poster' AND poster IS NOT NULL LIMIT 1`);
    const r = await call(kai, 'POST', '/actions/field/scan', { n: t.poster, outcome: 'missing', note: 'Board taken down' });
    expect(r.status).toBe(200);
    expect((await q(`SELECT status FROM command.posters WHERE n = $1`, [t.poster]))[0].status).toBe('missing');
    const [task] = await q(`SELECT outcome, note, done_at FROM command.route_tasks WHERE poster = $1`, [t.poster]);
    expect([task.outcome, task.note, task.done_at]).toEqual(['Missing', 'Board taken down', '14:00']);
  });

  test('a new board card with its log, then taken off the board', async () => {
    const card = { id: 'n-test', name: 'Test Bakery', kind: 'Bakery', city: 'Redlands', stage: 'prospect', owner: 'Kai', val: 1200, next: 'Visit', log: [{ text: 'Walked in', type: 'visit' }] };
    expect((await call(kai, 'POST', '/actions/merchants/card-save', card)).status).toBe(200);
    let board = (await call(kai, 'GET', '/sections/merchants')).body.BOARD;
    const c = board.find((x: any) => x.id === 'n-test');
    expect(c.name).toBe('Test Bakery');
    expect(c.log.map((l: any[]) => [l[1], l[3]])).toEqual([['Walked in', 'visit']]);
    expect((await call(kai, 'POST', '/actions/merchants/card-save', { ...card, stage: 'talking', log: [{ text: 'Moved to Talking', type: 'stage' }] })).status).toBe(200);
    expect((await q(`SELECT count(*)::int AS n FROM command.merchant_activity WHERE stage_id = 'n-test'`))[0].n).toBe(2);
    expect((await call(kai, 'POST', '/actions/merchants/card-remove', { id: 'n-test', reason: 'Closed down' })).status).toBe(200);
    board = (await call(kai, 'GET', '/sections/merchants')).body.BOARD;
    expect(board.some((x: any) => x.id === 'n-test')).toBe(false);
    expect((await q(`SELECT removed_reason FROM command.merchant_stage WHERE id = 'n-test'`))[0].removed_reason).toBe('Closed down');
  });

  test('a card sells in person, at its address, or online; a save that leaves it out keeps it', async () => {
    const card = { id: 'n-sells', name: 'Web Only Bikes', kind: 'Bikes', city: 'Redlands', stage: 'prospect', addr: '12 Orange St' };
    expect((await call(kai, 'POST', '/actions/merchants/card-save', card)).status).toBe(200);
    const read = async () => (await call(kai, 'GET', '/sections/merchants')).body.BOARD.find((x: any) => x.id === 'n-sells');
    // every card so far was a storefront, so one saved without saying sells in person
    expect([(await read()).sells, (await read()).addr]).toEqual(['in_person', '12 Orange St']);
    expect((await call(kai, 'POST', '/actions/merchants/card-save', { ...card, sells: 'online', addr: '', log: [{ text: 'Edited the details · now sells online, address', type: 'edit' }] })).status).toBe(200);
    expect([(await read()).sells, (await read()).addr]).toEqual(['online', '']);
    // a page that doesn't know about sells (an older one) saves the card without it, and it stays online
    expect((await call(kai, 'POST', '/actions/merchants/card-save', { ...card, addr: '', next: 'Send the Pay with Clear API docs' })).status).toBe(200);
    expect((await read()).sells).toBe('online');
    expect((await call(kai, 'POST', '/actions/merchants/card-save', { ...card, sells: 'phone' })).status).toBe(400);
  });

  test('a product draft is saved from what was typed, not the prototype’s sample', async () => {
    const r = await call(kai, 'POST', '/actions/shop/product-add', { line: 'graphic', name: 'Graphic Tee', variant: 'Test Print', price: 44, cost: [9, 5, 1, 1], options: ['Black'], sizes: ['S', 'M'] });
    expect(r.status).toBe(200);
    const id = r.body.result.id;
    const shop = (await call(kai, 'GET', '/sections/shop')).body;
    const p = shop.PR.find((x: any) => x.id === id);
    expect([p.v, p.st, p.price]).toEqual(['Test Print', 'draft', 44]);
    expect(shop.STK[id]).toEqual({ Black: [0, 0] });
    // the live catalog is a content file elsewhere: the change waits in the outbox for Phase 7
    expect((await q(`SELECT kind, status FROM command.outbox WHERE kind = 'product-add'`))[0]).toEqual({ kind: 'product-add', status: 'queued' });
  });

  test('an order moves only forward, and packing records the label to buy', async () => {
    expect((await call(kai, 'POST', '/actions/shop/ship', { order: '1094' })).status).toBe(409);
    expect((await call(kai, 'POST', '/actions/shop/pack', { order: '1094' })).status).toBe(200);
    expect((await q(`SELECT state FROM command.shop_orders WHERE id = '1094'`))[0].state).toBe('packed');
    expect((await q(`SELECT count(*)::int AS n FROM command.outbox WHERE kind = 'pack'`))[0].n).toBe(1);
  });

  test('a filing moves on once, and Governance’s agenda takes what was typed', async () => {
    const [f] = await q(`SELECT position, id FROM command.filings WHERE status = 'none' ORDER BY position LIMIT 1`);
    expect((await call(kai, 'POST', '/actions/governance/filing-start', { id: f.id, position: f.position, owner: 'Accountant' })).status).toBe(200);
    expect((await call(kai, 'POST', '/actions/governance/filing-start', { id: f.id, position: f.position })).status).toBe(409);
    expect((await call(kai, 'POST', '/actions/governance/agenda-item', { title: 'Approve the 2027 calendar', kind: 'discuss' })).status).toBe(200);
    const agenda = (await call(kai, 'GET', '/sections/governance')).body.AGENDA;
    // the owner is whoever added it, as the audit log names them
    expect(agenda.at(-1)).toEqual(['Approve the 2027 calendar', 5, 'kai@useclear.org', 'discuss']);
  });
});

describe('the two-person rule and the outbox', () => {
  test('a refund over $50 waits for a second person, then is recorded, never paid', async () => {
    const r = await call(kai, 'POST', '/actions/shop/refund', { order: '1093', reason: 'Wrong size', amount: 98 });
    expect(r.status).toBe(202);
    const id = r.body.proposal.id;
    // nothing changed yet
    expect((await q(`SELECT state FROM command.shop_orders WHERE id = '1093'`))[0].state).toBe('paid');
    const waiting = (await call(second, 'GET', '/proposals?area=all')).body.proposals;
    expect(waiting.some((p: any) => p.id === id && p.area === 'shop')).toBe(true);
    expect((await call(kai, 'POST', `/proposals/${id}/approve`)).status).toBe(403);
    expect((await call(second, 'POST', `/proposals/${id}/approve`)).status).toBe(200);
    expect((await q(`SELECT state FROM command.shop_orders WHERE id = '1093'`))[0].state).toBe('refund');
    const [o] = await q(`SELECT o.status, p.email AS by, a.email AS approver FROM command.outbox o JOIN command.people p ON p.id = o.requested_by JOIN command.people a ON a.id = o.approved_by WHERE o.kind = 'refund'`);
    expect(o).toEqual({ status: 'queued', by: 'kai@useclear.org', approver: 'second@useclear.org' });
  });

  test('a refund under $50 needs nobody else', async () => {
    expect((await call(kai, 'POST', '/actions/shop/refund', { order: '1076', reason: 'Wrong size', amount: 40 })).status).toBe(200);
  });

  test('money moves and on-chain changes always wait for a second person', async () => {
    for (const [path, body] of [
      ['/actions/money/top', { amount: 1116.89 }],
      ['/actions/merchants/cap', { id: 'rosas', cap: 150 }],
      ['/actions/merchants/run', { total: 9510.65, shops: 11 }],
    ] as const) {
      expect((await call(kai, 'POST', path, body)).status).toBe(202);
    }
  });

  test('someone at Totals can’t act, and a bad body is refused', async () => {
    await call(kai, 'POST', '/invites', { email: 'look@useclear.org', name: 'Look', group: 'outside' });
    const look = await signIn('did:look|look@useclear.org');
    const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === 'look@useclear.org').id;
    expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: all(1) })).status).toBe(200);
    expect((await call(look, 'POST', '/actions/growth/poster-replaced', { n: 1 })).status).toBe(403);
    expect((await call(kai, 'POST', '/actions/growth/poster-replaced', { n: 'one' })).status).toBe(400);
    expect((await call(kai, 'POST', '/actions/growth/no-such', {})).status).toBe(404);
  });
});

describe('files', () => {
  const pdf = new TextEncoder().encode('%PDF-1.4\n% a test document\n');
  let docId = '';

  test('a document is stored, listed and downloaded, with each step logged', async () => {
    expect((await call(kai, 'POST', '/files?section=records&name=evil.html', new TextEncoder().encode('<script>'), { 'content-type': 'text/html' })).status).toBe(415);
    const up = await call(kai, 'POST', '/files?section=records&name=EIN letter', pdf, { 'content-type': 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body.file.name).toBe('EIN letter.pdf');
    const add = await call(kai, 'POST', '/actions/records/document-add', { title: 'EIN letter · The Deed & Title Co.', kind: 'filing', entity: 'dt', file: up.body.file.id });
    expect(add.status).toBe(200);
    docId = add.body.result.id;
    expect((await call(kai, 'GET', '/sections/records')).body.DOCS[0][1]).toBe('EIN letter · The Deed & Title Co.');
    const dl = await call(kai, 'GET', `/documents/${docId}/file`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.compare(dl.body, Buffer.from(pdf))).toBe(0);
    expect((await q(`SELECT count(*)::int AS n FROM command.audit_log WHERE action = 'Downloaded EIN letter · The Deed & Title Co.'`))[0].n).toBe(1);
    // a seeded document has no file behind it yet
    expect((await call(kai, 'GET', '/documents/d13/file')).status).toBe(404);
  });

  test('a new version replaces the file and keeps the old one', async () => {
    const up = await call(kai, 'POST', '/files?section=records&name=EIN letter v2', pdf, { 'content-type': 'application/pdf' });
    const r = await call(kai, 'POST', '/actions/records/document-version', { id: docId, file: up.body.file.id, note: 'Corrected the address' });
    expect(r.body.result.version).toBe('v1.1');
    expect((await q(`SELECT count(*)::int AS n FROM command.document_versions WHERE document_id = $1`, [docId]))[0].n).toBe(2);
  });

  test('a share link opens without signing in until it expires, and each open is logged', async () => {
    const s = await call(kai, 'POST', `/documents/${docId}/share`, { days: 1, forWhom: 'Our accountant' });
    expect(s.status).toBe(201);
    const open = await fetch(root + s.body.path);
    expect(open.status).toBe(200);
    expect(Buffer.from(await open.arrayBuffer()).toString()).toContain('%PDF');
    expect((await q(`SELECT who FROM command.audit_log WHERE action LIKE 'Opened EIN letter%'`))[0].who).toBe('Link · Our accountant');
    clock = new Date(clock.getTime() + 2 * 86400_000);
    expect((await fetch(root + s.body.path)).status).toBe(404);
    expect((await fetch(root + '/api/command/shared/not-a-token')).status).toBe(404);
  });
});
