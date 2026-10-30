import { beforeAll, describe, expect, test } from 'bun:test';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../db/db.js';
import { testDb } from '../db/testDb.js';
import { SECTIONS, type Levels } from '../services/command/levels.js';
import { seedCommand } from '../services/command/seed.js';
import { FIRST } from '../services/command/settings.js';
import { commandRouter } from './command.js';

/*
 * The redesign's server-side security (docs/ui-redesign-plan.md, Security): limits read from Settings,
 * a setting changed only by two people, the audit log chained and corrected rather than edited, and
 * every reveal of personal details logged with its reason, at Approve only.
 */

let base = '';
let db: Db;

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
});

type Who = { user: string; session?: string };
let kai: Who;
let dana: Who;
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.user, ...(who.session ? { 'x-command-session': who.session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: Object.fromEntries(r.headers), body: (await r.json().catch(() => ({}))) as any };
};
const signIn = async (user: string) => {
  const r = await call({ user }, 'POST', '/sessions', { deviceKey: `device-${user.replace(/\W/g, '')}-00000000`, keep: true, method: 'email' });
  return { user, session: r.body.session?.id as string };
};
const all = (n: number): Levels => Object.fromEntries(SECTIONS.map((s) => [s, n])) as Levels;
/** Someone outside the admins, with these levels. */
async function person(name: string, levels: Levels) {
  const email = `${name}@useclear.org`;
  await call(kai, 'POST', '/invites', { email, name, group: 'outside' });
  const who = await signIn(`did:${name}|${email}`);
  const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === email).id;
  expect((await call(kai, 'PATCH', `/people/${id}/access`, { custom: levels })).status).toBe(200);
  return who;
}
/** Someone outside the admins at Approve everywhere: giving Approve waits for a second person, Dana. */
async function approver(name: string) {
  const email = `${name}@useclear.org`;
  await call(kai, 'POST', '/invites', { email, name, group: 'outside' });
  const who = await signIn(`did:${name}|${email}`);
  const id = (await call(kai, 'GET', '/people')).body.people.find((p: any) => p.email === email).id;
  const r = await call(kai, 'PATCH', `/people/${id}/access`, { custom: all(4) });
  if (r.status === 202) expect((await call(dana, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
  else expect(r.status).toBe(200);
  return who;
}
const setting = async (id: string) => (await call(kai, 'GET', '/sections/settings')).body.SETTINGS.find((s: any) => s.id === id);
const restock = (cost: number) => call(kai, 'POST', '/actions/shop/restock', { id: 'lts', units: [{ option: 'Black', size: 'M', n: 4 }], cost });

describe('Settings', () => {
  test('every rule, with today’s limits as their first values and the locked ones saying where they’re decided', async () => {
    const r = await call(kai, 'GET', '/sections/settings');
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.SETTINGS.map((s: any) => [s.id, s]));
    expect(by.refund).toMatchObject({ kind: 'money', value: 50, changedBy: null, pending: null });
    expect(by.shopbuy.value).toBe(50);
    expect(by.reason.value).toBe(true);
    expect(by.retain).toMatchObject({ kind: 'lock', value: '7 years', where: 'records/docs' });
    // a change's old value is worked back to these, so they must be what migration 0057 stored
    for (const [id, v] of Object.entries(FIRST)) expect(by[id].value).toEqual(v);
    expect(Object.keys(FIRST).sort()).toEqual(r.body.SETTINGS.filter((s: any) => s.kind !== 'lock').map((s: any) => s.id).sort());
    expect(r.body.HISTORY).toEqual([]);
    // which ones the server reads where they apply, and which are only stored so far
    expect([by.refund.enforced, by.shopbuy.enforced, by.reason.enforced, by.wait.enforced, by.retain.enforced]).toEqual([true, true, true, false, null]);
  });

  test('changing one waits for a second person, who isn’t the proposer, and then it applies', async () => {
    const r = await call(kai, 'POST', '/actions/settings/change', { id: 'refund', value: 100, why: 'Hoodie returns are mostly $60 to $90' });
    expect(r.status).toBe(202);
    const pid = r.body.proposal.id;
    expect((await setting('refund')).pending).toMatchObject({ id: pid, to: 100, why: 'Hoodie returns are mostly $60 to $90' });
    expect((await setting('refund')).value).toBe(50);
    const own = await call(kai, 'POST', `/proposals/${pid}/approve`);
    expect(own.status).toBe(403);
    expect(own.body.error?.code ?? own.body.code).toBe('OWN_PROPOSAL');
    expect((await call(dana, 'POST', `/proposals/${pid}/approve`)).status).toBe(200);
    const after = await setting('refund');
    expect(after).toMatchObject({ value: 100, pending: null, approvedBy: expect.any(String) });
    expect(after.changedBy).not.toBe(after.approvedBy);
    // its history: from the old value to the new one, who proposed it and who approved it
    const h = (await call(kai, 'GET', '/sections/settings')).body.HISTORY;
    expect(h[0]).toMatchObject({ id: pid, set: 'refund', from: 50, to: 100, by: after.changedBy, approvedBy: after.approvedBy, why: 'Hoodie returns are mostly $60 to $90' });
  });

  test('a locked rule, an unknown one or a value out of range is refused before it waits for anyone', async () => {
    expect((await call(kai, 'POST', '/actions/settings/change', { id: 'retain', value: 1 })).status).toBe(400);
    expect((await call(kai, 'POST', '/actions/settings/change', { id: 'nope', value: 1 })).status).toBe(404);
    expect((await call(kai, 'POST', '/actions/settings/change', { id: 'margin', value: 140 })).status).toBe(400);
    expect((await call(kai, 'POST', '/actions/settings/change', { id: 'digest', value: '09:00' })).status).toBe(400);
  });

  test('the database refuses a change approved by the person who made it', async () => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM command.people WHERE email = 'kai@useclear.org'`);
    await expect(db.query(`UPDATE command.settings SET changed_by = $1, approved_by = $1 WHERE id = 'hold'`, [rows[0].id])).rejects.toThrow(/settings_second_person/);
  });

  test('a shop buy over the limit in Settings waits for a second person; under it, it runs', async () => {
    expect((await setting('shopbuy')).value).toBe(50);
    expect((await restock(60)).status).toBe(202);
    expect((await restock(40)).status).toBe(200);
    const r = await call(kai, 'POST', '/actions/settings/change', { id: 'shopbuy', value: 250 });
    expect((await call(dana, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    expect((await restock(60)).status).toBe(200);
    expect((await restock(300)).status).toBe(202);
    // the second change's old value is the one before it: 50, then 250
    const h = (await call(kai, 'GET', '/sections/settings')).body.HISTORY;
    expect(h.map((x: any) => [x.set, x.from, x.to])).toEqual([
      ['shopbuy', 50, 250],
      ['refund', 50, 100],
    ]);
  });

  test('Settings is a section with its own level: none of it at None', async () => {
    const none = all(2);
    none.settings = 0;
    const p = await person('nosettings', none);
    expect((await call(p, 'GET', '/sections/settings')).status).toBe(403);
    expect((await call(p, 'POST', '/actions/settings/change', { id: 'hold', value: 10 })).status).toBe(403);
  });

  test('at Totals, the values but no one’s name', async () => {
    const totals = all(2);
    totals.settings = 1;
    const p = await person('settingstotals', totals);
    const r = await call(p, 'GET', '/sections/settings');
    expect(r.status).toBe(200);
    const refund = r.body.SETTINGS.find((s: any) => s.id === 'refund');
    expect(refund.value).toBe(100);
    expect([refund.changedBy, refund.approvedBy]).toEqual([null, null]);
    expect(r.body.HISTORY.length).toBeGreaterThan(0);
    for (const h of r.body.HISTORY) expect([h.by, h.approvedBy]).toEqual([null, null]);
  });
});

describe('levels on every request', () => {
  test('someone at None everywhere but Home is refused every other section, the log, the reveals and every action', async () => {
    // with nothing at all they aren't a Command user (401); Totals on Home makes them one, so each section's own check is what refuses
    const levels = all(0);
    levels.home = 1;
    const p = await person('nobody', levels);
    expect((await call(p, 'GET', '/sections/home')).status).toBe(200);
    for (const s of ['members', 'growth', 'field', 'merchants', 'money', 'shop', 'contracts', 'governance', 'records', 'settings']) {
      expect((await call(p, 'GET', `/sections/${s}`)).status, s).toBe(403);
    }
    expect((await call(p, 'GET', '/audit')).status).toBe(403);
    expect((await call(p, 'GET', '/reveals')).status).toBe(403);
    expect((await call(p, 'POST', '/actions/shop/restock', { id: 'lts', units: [{ option: 'Black', size: 'M', n: 1 }], cost: 1 })).status).toBe(403);
    expect((await call(p, 'POST', '/members/1/reveal', { reason: 'x' })).status).toBe(403);
  });
});

describe('reveals', () => {
  test('a whole list with names is an export: without an approved one nothing is shown', async () => {
    for (const q of ['?reveal=1', '?reveal=1&reason=Calling%20about%20a%20failed%20transfer', '?reveal=1&export=00000000-0000-0000-0000-000000000000']) {
      const refused = await call(kai, 'GET', `/sections/members${q}`);
      expect(refused.status, q).toBe(403);
      expect(JSON.stringify(refused.body)).not.toContain('MEMBERS');
    }
  });

  test('an export waits for a second person, then works once, for its asker, and is logged with its reason', async () => {
    const asked = await call(kai, 'POST', '/actions/members/export', { reason: 'Calling about a failed transfer' });
    expect(asked.status).toBe(202);
    // not before it's approved, and never by the person who asked
    expect((await call(kai, 'GET', '/exports/mine')).body.exports).toEqual([]);
    expect((await call(kai, 'POST', `/proposals/${asked.body.proposal.id}/approve`)).status).toBe(403);
    const ok = await call(dana, 'POST', `/proposals/${asked.body.proposal.id}/approve`);
    expect(ok.status).toBe(200);
    const grant = ok.body.result.grant;
    // only the asker can use it: not the approver
    expect((await call(dana, 'GET', `/sections/members?reveal=1&export=${grant}`)).status).toBe(403);
    const r = await call(kai, 'GET', `/sections/members?reveal=1&export=${grant}`);
    expect(r.status).toBe(200);
    expect(r.body.names).toBe('shown');
    const log = (await call(kai, 'GET', '/reveals')).body.reveals;
    expect(log[0]).toMatchObject({ section: 'members', subject: '*', field: 'names', rows: r.body.MEMBERS.length, reason: 'Calling about a failed transfer', flagged: false, person_id: expect.any(String) });
    // once
    expect((await call(kai, 'GET', `/sections/members?reveal=1&export=${grant}`)).status).toBe(403);
    const mine = (await call(kai, 'GET', '/exports/mine')).body.exports;
    expect(mine[0]).toMatchObject({ id: grant, section: 'members', reason: 'Calling about a failed transfer', used_at: expect.any(String) });
    expect((await call(kai, 'GET', '/exports')).body.exports[0]).toMatchObject({ id: grant, approved_by: expect.any(String) });
  });

  test('an export is for its own section, can’t be asked for without a reason or below Approve, and lapses after a day', async () => {
    expect((await call(kai, 'POST', '/actions/members/export', {})).status).toBe(400);
    const see = all(2);
    const p = await person('seeexport', see);
    expect((await call(p, 'POST', '/actions/members/export', { reason: 'x' })).status).toBe(403);
    const asked = await call(kai, 'POST', '/actions/growth/export', { reason: 'Answering a form' });
    const grant = (await call(dana, 'POST', `/proposals/${asked.body.proposal.id}/approve`)).body.result.grant;
    expect((await call(kai, 'GET', `/sections/members?reveal=1&export=${grant}`)).status).toBe(403);
    // past its day: the route's clock is fixed at 23 Oct, so date the grant before it
    await db.query(`UPDATE command.export_grants SET approved_at = '2026-10-21T12:00:00Z', expires_at = '2026-10-22T12:00:00Z' WHERE id = $1`, [grant]);
    expect((await call(kai, 'GET', `/sections/growth?reveal=1&export=${grant}`)).status).toBe(403);
  });

  test('the database refuses an export approved by the person who asked', async () => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM command.people WHERE email = 'kai@useclear.org'`);
    await expect(
      db.query(`INSERT INTO command.export_grants (section, person_id, reason, approved_by, approved_at, expires_at) VALUES ('members', $1, 'x', $1, now(), now() + interval '1 day')`, [rows[0].id]),
    ).rejects.toThrow(/export_grants_second_person/);
  });

  test('one member’s name, for a reason; skipped in a rush it’s shown and flagged', async () => {
    const ap = await approver('approver1');
    const r = await call(ap, 'POST', '/members/1/reveal', { reason: 'Their bank link failed' });
    expect(r.status).toBe(200);
    expect(r.body.first).not.toContain('•');
    expect((await call(ap, 'POST', '/members/1/reveal', {})).status).toBe(400);
    expect((await call(ap, 'POST', '/members/1/reveal', { rush: true })).status).toBe(200);
    const [rush, reasoned] = (await call(kai, 'GET', '/reveals')).body.reveals;
    expect(rush).toMatchObject({ field: 'name', reason: '', flagged: true });
    expect(reasoned).toMatchObject({ field: 'name', reason: 'Their bank link failed', flagged: false });
    expect((await call(kai, 'GET', '/audit')).body.entries[0]).toMatchObject({ area: 'members', detail: 'No reason given: flagged' });
  });

  test('the page’s names and emails, for a reason: Approve only, logged as one reveal of the list, never cached', async () => {
    const ap = await approver('approver2');
    expect((await call(ap, 'POST', '/members/names', {})).status).toBe(400);
    const r = await call(ap, 'POST', '/members/names', { reason: 'Calling the members who haven’t funded' });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.body.names.length).toBeGreaterThan(0);
    expect(r.body.names[0]).toEqual({ id: expect.any(Number), no: expect.stringMatching(/^M-/), name: expect.any(String), email: null });
    expect(JSON.stringify(r.body.names)).not.toContain('•');
    expect((await call(kai, 'GET', '/reveals')).body.reveals[0]).toMatchObject({
      section: 'members',
      subject: '*',
      field: 'names and emails, on screen',
      rows: r.body.names.length,
      reason: 'Calling the members who haven’t funded',
      flagged: false,
    });
    const p = await person('seenames', all(2));
    expect((await call(p, 'POST', '/members/names', { reason: 'x' })).status).toBe(403);
  });

  test('an admin shows names, the list’s or one member’s, without a reason and without a log', async () => {
    const before = (await call(kai, 'GET', '/reveals')).body.reveals.length;
    const list = await call(kai, 'POST', '/members/names', {});
    expect(list.status).toBe(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(list.body.names)).not.toContain('•');
    const one = await call(kai, 'POST', '/members/1/reveal', {});
    expect(one.status).toBe(200);
    expect(one.body.first).not.toContain('•');
    expect((await call(kai, 'GET', '/reveals')).body.reveals.length).toBe(before);
    // a whole list taken away is still an export, admin or not
    expect((await call(kai, 'GET', '/sections/members?reveal=1')).status).toBe(403);
  });

  test('someone waiting is masked like a member, revealed one at a time for a reason, and never at Totals', async () => {
    const { rows } = await db.query<{ id: number }>(`INSERT INTO command.waitlist (email, name, zip, city, source, joined_at) VALUES ('wren@example.com', 'Wren Ito', '92373', 'Redlands', 'website', '2026-10-20T15:00:00Z') RETURNING id`);
    const no = `W-${String(rows[0].id).padStart(4, '0')}`;
    const masked = await call(kai, 'GET', '/sections/members');
    const w = masked.body.WAITLIST.find((x: any) => x.no === no);
    expect(w).toMatchObject({ id: 1_000_000 + rows[0].id, pos: expect.any(Number), city: 'Redlands', src: 'Website', joined: Date.parse('2026-10-20T15:00:00Z') });
    expect([w.first, w.last]).toEqual(['W•••', 'I••']);
    expect(JSON.stringify(masked.body)).not.toMatch(/Wren|wren@/);
    const r = await call(await approver('approver3'), 'POST', `/members/${w.id}/reveal`, { reason: 'Moving them up for the Redlands batch' });
    expect(r.body).toEqual({ id: w.id, no, first: 'Wren', last: 'Ito' });
    expect((await call(kai, 'GET', '/reveals')).body.reveals[0]).toMatchObject({ section: 'members', subject: no, field: 'name', reason: 'Moving them up for the Redlands batch' });
    const totals = all(2);
    totals.members = 1;
    const t = await person('waittotals', totals);
    const tr = await call(t, 'GET', '/sections/members');
    expect([tr.body.WAITLIST, tr.body.FORMS]).toEqual([null, null]);
    expect(JSON.stringify(tr.body)).not.toMatch(/Wren|W-\d/);
    expect((await call(t, 'POST', `/members/${w.id}/reveal`, { reason: 'x' })).status).toBe(403);
  });

  test('only at Approve: See gets the masked list whatever it asks, and can’t reveal one', async () => {
    const see = all(2);
    const p = await person('seeonly', see);
    const r = await call(p, 'GET', '/sections/members?reveal=1&export=00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(200);
    expect(r.body.names).toBe('masked');
    expect((await call(p, 'POST', '/members/1/reveal', { reason: 'x' })).status).toBe(403);
  });

  test('when Settings stops asking for a reason, a reveal without one isn’t flagged', async () => {
    const r = await call(kai, 'POST', '/actions/settings/change', { id: 'reason', value: false });
    expect((await call(dana, 'POST', `/proposals/${r.body.proposal.id}/approve`)).status).toBe(200);
    expect((await call(await approver('approver4'), 'POST', '/members/2/reveal', {})).status).toBe(200);
    expect((await call(kai, 'GET', '/reveals')).body.reveals[0]).toMatchObject({ subject: expect.any(String), flagged: false, reason: '' });
    const back = await call(kai, 'POST', '/actions/settings/change', { id: 'reason', value: true });
    await call(dana, 'POST', `/proposals/${back.body.proposal.id}/approve`);
  });

  test('nothing edits or removes a reveal', async () => {
    await expect(db.query(`UPDATE command.reveals SET reason = 'edited'`)).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM command.reveals')).rejects.toThrow(/append-only/);
  });
});

describe('the audit log', () => {
  test('each entry is chained to the one before it, and the chain holds', async () => {
    const r = await call(kai, 'GET', '/audit');
    expect(r.status).toBe(200);
    const e = r.body.entries;
    expect(e.length).toBeGreaterThan(5);
    for (let i = 0; i < e.length - 1; i++) {
      expect(Number(e[i].seq)).toBe(Number(e[i + 1].seq) + 1);
      expect(e[i].prev_hash).toBe(e[i + 1].hash);
    }
    expect(r.body.chain).toMatchObject({ ok: true, brokenAt: null, head: e[0].hash });
    // who did it, by id as well as by name, so the page shows the same person everywhere
    expect(e.find((x: any) => x.who !== 'System' && x.person_id)).toBeTruthy();
  });

  test('a mistake is corrected by a new entry pointing back; the old one is untouched', async () => {
    const before = (await call(kai, 'GET', '/audit')).body.entries;
    const target = before[3];
    expect((await call(kai, 'POST', `/audit/${target.id}/correct`, { note: 'This was batch 12, not 13' })).status).toBe(200);
    const after = (await call(kai, 'GET', '/audit')).body;
    expect(after.entries[0]).toMatchObject({ corrects: target.id, action: `Corrected: ${target.action}`, detail: 'This was batch 12, not 13' });
    expect(after.entries.find((x: any) => x.id === target.id)).toEqual(target);
    expect(after.chain.ok).toBe(true);
    expect((await call(kai, 'POST', `/audit/${target.id}/correct`, {})).status).toBe(400);
    expect((await call(kai, 'POST', '/audit/99999999/correct', { note: 'x' })).status).toBe(404);
  });

  test('nothing edits, removes or empties it', async () => {
    await expect(db.query(`UPDATE command.audit_log SET detail = 'edited'`)).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM command.audit_log')).rejects.toThrow(/append-only/);
    await expect(db.query('TRUNCATE command.audit_log')).rejects.toThrow(/append-only/);
  });

  test('an entry changed behind the trigger’s back breaks the chain at that entry', async () => {
    const e = (await call(kai, 'GET', '/audit')).body.entries[2];
    await db.query('ALTER TABLE command.audit_log DISABLE TRIGGER audit_log_append_only');
    await db.query(`UPDATE command.audit_log SET detail = detail || ' (tampered)' WHERE id = $1`, [e.id]);
    expect((await call(kai, 'GET', '/audit')).body.chain).toMatchObject({ ok: false, brokenAt: Number(e.seq) });
    // put it back: the chain holds again, which is how anyone can check it
    await db.query(`UPDATE command.audit_log SET detail = $2 WHERE id = $1`, [e.id, e.detail]);
    await db.query('ALTER TABLE command.audit_log ENABLE TRIGGER audit_log_append_only');
    expect((await call(kai, 'GET', '/audit')).body.chain.ok).toBe(true);
  });
});
