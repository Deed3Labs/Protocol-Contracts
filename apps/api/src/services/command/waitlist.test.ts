import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { commandJoinRouter } from '../../routes/command.js';
import { ActionError, actionFor } from './actions.js';
import { SEE, TOTALS, type Level } from './levels.js';
import type { MemberSource } from './memberSource.js';
import { membersSection } from './sections.js';
import { cityOfZip, inviteCode, inviteEmail, inviteLink, sendBatch, sendInvites, waitlistFigures } from './waitlist.js';

/*
 * Phase 7b: the site's join form fills the waitlist; a batch, once two people agree, gives the next
 * people waiting a code each and queues their emails, which a job sends; and Members is the member
 * app's accounts matched to their invites by the code onboarding sent back.
 */

const NOW = new Date('2026-10-24T17:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let db: Db;
let url = '';
const env = { members: process.env.PROVIDER_MEMBERS };
beforeAll(async () => {
  ({ db } = await testDb());
  const app = express();
  app.use(express.json());
  app.use('/join', commandJoinRouter({ db: async () => db, now: () => NOW }));
  const server = app.listen(0);
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/join`;
});
afterAll(() => {
  if (env.members == null) delete process.env.PROVIDER_MEMBERS;
  else process.env.PROVIDER_MEMBERS = env.members;
});
const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('the site’s join form', () => {
  test('“I want to join” is a place on the waitlist, and a form submission', async () => {
    expect((await post({ as: 'member', name: 'Ana Maria Ruiz', email: 'Ana@Example.com', zip: '92373', note: 'Near the university' })).status).toBe(201);
    const { rows } = await db.query<any>('SELECT email, name, zip, city, source, note FROM command.waitlist');
    expect(rows).toEqual([{ email: 'ana@example.com', name: 'Ana Maria Ruiz', zip: '92373', city: 'Redlands', source: 'website', note: 'Near the university' }]);
    const f = await db.query<any>(`SELECT first_name, last_name, form, city, status FROM command.form_submissions`);
    expect(f.rows).toEqual([{ first_name: 'Ana', last_name: 'Maria Ruiz', form: 'Waitlist', city: 'Redlands', status: 'New' }]);
  });

  test('asking again keeps their place, and says the same thing', async () => {
    expect((await post({ as: 'member', name: 'Ana R', email: 'ana@example.com', zip: '92501' })).status).toBe(201);
    expect((await db.query<any>(`SELECT name, city FROM command.waitlist`)).rows).toEqual([{ name: 'Ana Maria Ruiz', city: 'Redlands' }]);
  });

  test('a shop’s answer is kept with what it said, not put on the waitlist', async () => {
    expect((await post({ as: 'shop', name: 'Rosa Tacos', email: 'rosa@tacos.test', zip: '92410', business: 'Rosa’s Tacos', industry: 'Food', '<bad>': 'x', jobsPerWeek: '' })).status).toBe(201);
    const { rows } = await db.query<any>(`SELECT form, city, details FROM command.form_submissions WHERE email = 'rosa@tacos.test'`);
    expect(rows).toEqual([{ form: 'Shop enquiry', city: 'San Bernardino', details: { business: 'Rosa’s Tacos', industry: 'Food' } }]);
    expect((await db.query(`SELECT 1 FROM command.waitlist WHERE email = 'rosa@tacos.test'`)).rows).toHaveLength(0);
  });

  test('a bad email or ZIP is refused, and nothing is kept', async () => {
    expect((await post({ as: 'member', name: 'X', email: 'not-an-email' })).status).toBe(400);
    expect((await post({ as: 'member', name: 'X', email: 'x@y.test', zip: '9237' })).status).toBe(400);
    expect((await db.query(`SELECT 1 FROM command.waitlist WHERE email = 'x@y.test'`)).rows).toHaveLength(0);
  });

  test('a ZIP outside the Inland Empire table shows as itself', () => {
    expect([cityOfZip('92374'), cityOfZip('94110'), cityOfZip('')]).toEqual(['Redlands', 'ZIP 94110', '']);
  });
});

describe('a batch', () => {
  beforeAll(async () => {
    // four more waiting: one from a poster, one in Riverside, the oldest in San Bernardino
    const add = (email: string, name: string, zip: string, joined: Date, source = 'website') =>
      db.query(`INSERT INTO command.waitlist (email, name, zip, city, source, joined_at) VALUES ($1, $2, $3, $4, $5, $6)`, [email, name, zip, cityOfZip(zip), source, joined]);
    await db.query(`UPDATE command.waitlist SET joined_at = $1`, [day(20)]);
    await add('bo@example.com', 'Bo Chen', '92410', day(40));
    await add('cy@example.com', 'Cy Park', '92501', day(10), 'poster');
    await add('di@example.com', 'Di Lee', '92501', day(5));
    await add('ed@example.com', 'Ed Fox', '92346', day(1));
  });

  test('codes have nothing to misread', () => {
    const codes = Array.from({ length: 200 }, inviteCode);
    expect(codes.every((c) => /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(200);
  });

  test('on the seed it’s recorded only; live, the next people waiting get codes, and their emails are queued', async () => {
    const a = actionFor('members', 'batch')!;
    delete process.env.PROVIDER_MEMBERS;
    const kai = { id: 'p1', privyId: null, name: 'Kai', email: 'kai@useclear.org', title: '' };
    expect(await db.transaction((tx) => a.apply!({ tx, person: kai, approver: null, at: NOW }, { size: 2, order: 'posters' }))).toBeUndefined();
    expect((await db.query('SELECT 1 FROM command.waitlist WHERE batch IS NOT NULL')).rows).toHaveLength(0);

    process.env.PROVIDER_MEMBERS = 'live';
    const r = await db.transaction((tx) => a.apply!({ tx, person: kai, approver: null, at: NOW }, { size: 2, order: 'posters' }));
    expect(r).toEqual({ number: 1, size: 2 });
    const { rows } = await db.query<any>('SELECT email, batch, invite_code, email_state FROM command.waitlist WHERE batch IS NOT NULL ORDER BY email');
    // posters first, then the longest waiting
    expect(rows.map((x) => [x.email, x.batch, x.email_state])).toEqual([
      ['bo@example.com', 1, 'queued'],
      ['cy@example.com', 1, 'queued'],
    ]);
    const b = (await db.query<any>('SELECT * FROM command.batches WHERE number = 1')).rows[0];
    expect(b).toMatchObject({ size: 2, status: 'sent', proposed_by: 'Kai', from_posters: 1, from_website: 1, live: true });
  });

  test('oldest first takes the longest waiting; with nobody waiting there’s nothing to send', async () => {
    await db.transaction((tx) => sendBatch(tx, 10, 'oldest', 'Kai', NOW));
    expect((await db.query('SELECT 1 FROM command.waitlist WHERE batch IS NULL')).rows).toHaveLength(0);
    const a = actionFor('members', 'batch')!;
    const kai = { id: 'p1', privyId: null, name: 'Kai', email: null, title: '' };
    await expect(db.transaction((tx) => a.apply!({ tx, person: kai, approver: null, at: NOW }, { size: 5, order: 'oldest' }))).rejects.toBeInstanceOf(ActionError);
    // the website's waitlist submission now says Invited
    expect((await db.query<any>(`SELECT status FROM command.form_submissions WHERE email = 'ana@example.com'`)).rows[0].status).toBe('Invited');
  });
});

describe('the invite emails', () => {
  test('each queued one is sent once; a failure is tried again 10 minutes later, 5 times at most', async () => {
    const sent: string[] = [];
    let down = true;
    const mail = async (m: { to: string; subject: string; text: string }) => {
      if (down && m.to === 'bo@example.com') throw new Error('Resend refused the email (503)');
      sent.push(m.to);
    };
    expect(await sendInvites(db, mail, NOW)).toEqual({ sent: 4, failed: 1 });
    expect(await sendInvites(db, mail, NOW)).toEqual({ sent: 0, failed: 0 });
    down = false;
    expect(await sendInvites(db, mail, new Date(NOW.getTime() + 11 * 60_000))).toEqual({ sent: 1, failed: 0 });
    expect(sent.sort()).toEqual(['ana@example.com', 'bo@example.com', 'cy@example.com', 'di@example.com', 'ed@example.com']);
    const { rows } = await db.query<any>(`SELECT email_state, email_tries FROM command.waitlist WHERE email = 'bo@example.com'`);
    expect(rows[0]).toEqual({ email_state: 'sent', email_tries: 2 });
  });

  test('the email carries the code in its link, and promises nothing about credit', () => {
    const e = inviteEmail({ name: 'Ana Maria Ruiz', joined_at: new Date('2026-10-04T00:00:00Z'), invite_code: 'ABCDE-23456' }, { COMMAND_INVITE_URL: 'https://app.test/' });
    expect(e.text).toContain('Hi Ana,');
    expect(e.text).toContain('on October 4');
    expect(e.text).toContain('https://app.test/?invite=ABCDE-23456');
    expect(e.text).not.toMatch(/credit|approved|loan/i);
    expect(inviteLink('X Y', { COMMAND_INVITE_URL: 'https://app.test' })).toBe('https://app.test/?invite=X%20Y');
  });
});

describe('Members, live', () => {
  const codeOf = async (email: string) => (await db.query<any>('SELECT invite_code FROM command.waitlist WHERE email = $1', [email])).rows[0].invite_code;
  let source: MemberSource;
  beforeAll(async () => {
    process.env.PROVIDER_MEMBERS = 'live';
    const ana = await codeOf('ana@example.com');
    const bo = await codeOf('bo@example.com');
    source = {
      roster: async ({ names }) => [
        // Ana signed up with her code, funded from her bank and spent at Rosa's
        { id: 7, createdAt: day(-0.5).getTime(), lastSeen: NOW.getTime(), inviteCode: ana, wallets: ['0xa'], name: names ? 'Ana Ruiz' : null, email: names ? 'ana.ruiz@example.com' : null, city: 'Redlands' },
        // Bo signed up with his code, nothing yet
        { id: 8, createdAt: NOW.getTime(), lastSeen: null, inviteCode: bo, wallets: ['0xb'], name: names ? 'Bo Chen' : null, phone: names ? '+19095550188' : null, wallet: names ? '0xb' : null, city: null },
        // someone who came another way
        { id: 9, createdAt: day(60).getTime(), lastSeen: day(2).getTime(), inviteCode: null, wallets: ['0xc'], name: names ? 'Cher' : null, city: 'Fontana' },
      ],
      milestones: async () =>
        new Map([
          ['0xa', { funded: { at: NOW.getTime() - 3600e3, with: 'bank' as const }, spend: { at: NOW.getTime() - 600e3, shop: 'Rosa’s Tacos' } }],
          ['0xc', { funded: { at: day(50).getTime(), with: 'deposit' as const } }],
        ]),
    };
  });
  const read = (level: Level = SEE, reveal = false) => membersSection(db, { level, reveal, now: NOW, memberSource: source });

  test('an account is matched to its invite by its code; one without came some other way', async () => {
    const m = await read(SEE, true);
    const by = Object.fromEntries(m.MEMBERS.map((x) => [x.no || x.first, x]));
    expect(by['M-0007']).toMatchObject({ first: 'Ana', last: 'Ruiz', batch: 2, status: 'active', fund: 'Bank', spend: 'Rosa’s Tacos', city: 'Redlands', src: 'Website' });
    expect(by['M-0008']).toMatchObject({ first: 'Bo', batch: 1, status: 'opened', city: 'San Bernardino' });
    expect(by['M-0009']).toMatchObject({ first: 'Cher', last: null, batch: 0, status: 'active', fund: 'Deposit', city: 'Fontana' });
    // invited and not signed up yet: Cy, Di, Ed
    expect(m.MEMBERS.filter((x) => x.status === 'invited').map((x) => x.first).sort()).toEqual(['Cy', 'Di', 'Ed']);
    expect(m.names).toBe('shown');
  });

  test('names leave masked unless asked for, and at Totals not at all', async () => {
    const masked = await read();
    expect(masked.MEMBERS.find((x) => x.no === 'M-0007')!.first).not.toBe('Ana');
    // an email comes with a name, only when names are asked for
    expect(JSON.stringify(masked)).not.toContain('ana.ruiz@example.com');
    expect((await read(SEE, true)).MEMBERS.find((x) => x.no === 'M-0007')!.email).toBe('ana.ruiz@example.com');
    // so do their phone and smart account
    expect((await read(SEE, true)).MEMBERS.find((x) => x.no === 'M-0008')).toMatchObject({ phone: '+19095550188', wallet: '0xb' });
    expect(JSON.stringify(masked)).not.toMatch(/\+19095550188|"wallet"/);
    const totals = await read(TOTALS);
    expect(totals.MEMBERS.every((x) => x.first == null && x.no === '' && x.invited === 0)).toBe(true);
    // the figures are the same at every level: worked out before the rows lose their dates
    expect(totals.figures['members.weekly.active_total']).toEqual(masked.figures['members.weekly.active_total']);
    expect((totals.figures['members.weekly.active_total'] as number[]).at(-1)).toBe(2);
  });

  test('each live batch’s opened and active, and the waitlist’s own figures', async () => {
    const m = await read();
    expect(m.BATCH_DATE).toHaveLength(2);
    expect([m.B_ACT, m.B_OPEN]).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(m.figures['members.waitlist.total']).toBe(0);
    expect((m.figures['members.weekly.active_total'] as number[]).at(-1)).toBe(2);
    expect(m.NEXT_BATCH).toBeNull();
  });

  test('the waitlist’s figures are the page’s shapes', async () => {
    await db.query(`INSERT INTO command.waitlist (email, name, zip, city, source, joined_at) VALUES ('fy@example.com', 'Fy', '92373', 'Redlands', 'poster', $1), ('gu@example.com', 'Gu', '92501', 'Riverside', 'website', $2)`, [day(30), day(3)]);
    const f = await waitlistFigures(db, NOW.getTime());
    expect(f['members.waitlist.total']).toBe(2);
    expect(f['members.waitlist.wait_buckets']).toHaveLength(6);
    expect(f['members.waitlist.cities']).toEqual([['Redlands', 1], ['Riverside', 1], ['Other', 0]]);
    expect((f['members.next_batch.preview'] as any)[25]).toEqual({ wk: [1, 1, 0], src: [1, 1], city: [1, 1, 0] });
  });

  test('the waitlist’s people, in line and masked, never at Totals; the invited keep their waitlist number', async () => {
    const m = await read();
    expect(m.WAITLIST!.map((w) => [w.pos, w.city, w.src])).toEqual([
      [1, 'Redlands', 'Poster'],
      [2, 'Riverside', 'Website'],
    ]);
    expect(m.WAITLIST!.every((w) => /^W-\d{4}$/.test(w.no) && w.id > 1_000_000 && w.first!.includes('•'))).toBe(true);
    expect((await read(SEE, true)).WAITLIST!.map((w) => w.first)).toEqual(['Fy', 'Gu']);
    // invited and not signed up: the number they had on the waitlist, and the same id
    const cy = m.MEMBERS.find((x) => x.status === 'invited' && x.city === 'Riverside' && x.src === 'Poster')!;
    const { rows } = await db.query<{ id: number }>(`SELECT id FROM command.waitlist WHERE email = 'cy@example.com'`);
    expect([cy.id, cy.no]).toEqual([1_000_000 + rows[0].id, `W-${String(rows[0].id).padStart(4, '0')}`]);
    const totals = await read(TOTALS);
    expect([totals.WAITLIST, totals.FORMS]).toEqual([null, null]);
    expect(JSON.stringify(totals)).not.toMatch(/W-\d|Fy|Gu|example\.com/);
  });

  test('each batch’s size and how far its people got, at every level', async () => {
    const want = [
      [1, 2, 1, 0, 0],
      [2, 3, 1, 1, 1],
    ];
    for (const level of [SEE, TOTALS] as Level[]) expect((await read(level)).BATCHES.map((b) => [b.number, b.size, b.opened, b.active, b.spent])).toEqual(want);
  });

  test('the join form’s last 30 days, newest first, masked, and how many', async () => {
    const m = await read();
    // Ana asked twice (the second time from a Riverside ZIP): each answer is a row; the shop's isn't here
    expect(m.FORMS!.map((f) => [f.type, f.city, f.st])).toEqual([
      ['Waitlist', 'Riverside', 'Invited'],
      ['Waitlist', 'Redlands', 'Invited'],
    ]);
    expect(m.FORMS![0].who[0]).toContain('•');
    expect(m.FORMS![0].mail).not.toContain('ana@');
    expect(m.figures['members.forms.month']).toBe(2);
    expect((await read(TOTALS)).figures['members.forms.month']).toBe(2);
  });

  test('a proposed batch says who it would take, in its order, and they’re who it sends', async () => {
    const { rows: pp } = await db.query<{ id: string }>(`INSERT INTO command.people (email, name) VALUES ('marcus@useclear.org', 'Marcus') RETURNING id`);
    const body = { size: 5, order: 'cities', cities: ['Riverside'] };
    await db.query(`INSERT INTO command.proposals (kind, area, summary, payload, proposed_by) VALUES ('action', 'members', 'x', $1, $2)`, [JSON.stringify({ section: 'members', kind: 'batch', body }), pp[0].id]);
    const m = await read();
    const gu = m.WAITLIST!.find((w) => w.city === 'Riverside')!;
    expect(m.NEXT_BATCH).toMatchObject({ number: 3, size: 5, proposedBy: 'Marcus', order: 'cities', ids: [gu.id], fromPosters: 0, fromWebsite: 1, proposedAt: expect.any(Number) });
    expect(m.figures['members.next_batch.number']).toBe(4);
    // at Totals, how many, never who
    expect((await read(TOTALS)).NEXT_BATCH).not.toHaveProperty('ids');
    // what sends is the same: only Riverside, though Fy waited longer
    await db.transaction(async (tx) => {
      expect(await sendBatch(tx, 5, 'cities', 'Kai', NOW, { cities: ['Riverside'] })).toEqual({ number: 3, size: 1 });
      expect((await tx.query<any>(`SELECT name FROM command.waitlist WHERE batch = 3`)).rows).toEqual([{ name: 'Gu' }]);
      throw Object.assign(new Error('roll back'), { rollback: true });
    }).catch((e) => expect(e.rollback).toBe(true));
    await db.query(`DELETE FROM command.proposals WHERE proposed_by = $1`, [pp[0].id]);
  });

  test('a batch of shops’ posters or of people picked by hand takes only them', async () => {
    const m = await read();
    const fy = m.WAITLIST!.find((w) => w.city === 'Redlands')!;
    await db.query(`UPDATE command.waitlist SET poster = 'P-003' WHERE name = 'Fy'`);
    const a = actionFor('members', 'batch')!;
    // the body says which: an empty list is refused
    expect(a.body.safeParse({ size: 5, order: 'picked' }).success).toBe(false);
    expect(a.body.safeParse({ size: 5, order: 'shops', posters: [] }).success).toBe(false);
    expect(await a.summary(a.body.parse({ size: 5, order: 'cities', cities: ['Riverside', 'Colton'] }), db)).toBe('Send the next batch of 5 invites from Riverside, Colton');
    const kai = { id: 'p1', privyId: null, name: 'Kai', email: null, title: '' };
    for (const [b, who] of [
      [{ size: 5, order: 'shops', posters: ['P-003'] }, ['Fy']],
      [{ size: 5, order: 'picked', ids: [fy.id + 1, fy.id] }, ['Fy', 'Gu']],
    ] as const) {
      await db.transaction(async (tx) => {
        await a.apply!({ tx, person: kai, approver: null, at: NOW }, a.body.parse(b));
        expect((await tx.query<any>(`SELECT name FROM command.waitlist WHERE batch = 3 ORDER BY name`)).rows.map((r: any) => r.name)).toEqual([...who]);
        throw Object.assign(new Error('roll back'), { rollback: true });
      }).catch((e) => expect(e.rollback).toBe(true));
    }
  });

  test('live with no member source says so', async () => {
    await expect(membersSection(db, { level: SEE, reveal: false, now: NOW })).rejects.toThrow(/PROVIDER_MEMBERS=live reads the member app/);
  });
});
