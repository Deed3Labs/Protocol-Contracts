import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CreateCardTender, CreateCashTender, CreateClearTender, DiscountRequest, LineInput, RequestRefund, SaveCount, SignOff } from '@clear/merchant-contracts';
import type { Db } from '../../../db/db.js';
import { seedShop, testDb } from '../../../db/testDb.js';
import { captureCardTender, createCardTender, syncCardTender } from '../cards/cardTenders.js';
import { connectorStore } from '../cards/connectorStore.js';
import { fakeProvider } from '../cards/fakeProvider.js';
import { closeDay, saveCount, signOff } from '../drawer/closeService.js';
import { openDrawer } from '../drawer/drawerService.js';
import { applyDiscount, createOrder, type OrderDeps } from '../orders/orderService.js';
import { createCashTender, voidOrder } from '../orders/payments.js';
import { requestRefund } from '../orders/refunds.js';
import { fakeTax } from '../tax/fakeTax.js';
import { auditTrail } from './audit.js';
import { MAX_FAILURES, PinLocked, pinGate, pinLockedHandler, recordPinFailure, WINDOW_MS } from './pinGuard.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

let seq = 0;
const key = () => `sec-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const today = () => new Date().toISOString().slice(0, 10);

describe('PIN entry is rate limited', () => {
  test('ten wrong PINs in fifteen minutes shut the shop; it opens as the oldest ages out', async () => {
    const merchant = `0xpin${++seq}`;
    // Relative to now, not a fixed date: recording a failure clears any older than a day by the real
    // clock, so a fixed date wiped its own fixture once it was a day in the past.
    const t0 = new Date(Date.now() - 5 * 60_000);
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      await recordPinFailure(db, { merchant, source: 'approval', at: new Date(t0.getTime() + i * 1000) });
    }
    expect(await pinGate(db, merchant, new Date(t0.getTime() + 60_000))).toEqual({ allowed: true });
    await recordPinFailure(db, { merchant, source: 'session', at: new Date(t0.getTime() + 9_000) });
    const shut = await pinGate(db, merchant, new Date(t0.getTime() + 60_000));
    expect(shut).toEqual({ allowed: false, retryInSeconds: WINDOW_MS / 1000 - 60 });
    // Open again once the first failure leaves the window, and shut on the next wrong one.
    expect(await pinGate(db, merchant, new Date(t0.getTime() + WINDOW_MS + 1))).toEqual({ allowed: true });
  });

  test('shared by every PIN the shop checks, and a correct PIN doesn’t reset it', async () => {
    // The counter is per shop and there's nothing that clears it: typing one's own PIN between
    // guesses at a manager's buys no more guesses. (The old in-memory limiter reset on any success.)
    const merchant = `0xpin${++seq}`;
    for (let i = 0; i < MAX_FAILURES; i++) await recordPinFailure(db, { merchant, source: i % 2 ? 'session' : 'approval' });
    expect((await pinGate(db, merchant)).allowed).toBe(false);
    expect((await pinGate(db, `0xother${seq}`)).allowed).toBe(true);
    const src = readFileSync(join(import.meta.dir, '../staffStore.ts'), 'utf8');
    expect(src).not.toMatch(/clearFailures|attempts\.delete|new Map</);
  });

  test('a shut shop answers 429 with when to try again, on any path', () => {
    const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
    const res = {
      setHeader: (k: string, v: string) => (sent.headers[k] = v),
      status: (n: number) => ((sent.status = n), res),
      json: (b: unknown) => (sent.body = b),
    };
    let passed: unknown = null;
    pinLockedHandler(new PinLocked(240), {} as never, res as never, (e) => (passed = e ?? 'next'));
    expect(sent).toMatchObject({ status: 429, headers: { 'Retry-After': '240' }, body: { error: 'Too many attempts', retryInSeconds: 240 } });
    expect(passed).toBeNull();
    const other = new Error('something else');
    pinLockedHandler(other, {} as never, res as never, (e) => (passed = e));
    expect(passed).toBe(other);
  });
});

describe('the audit log', () => {
  test('a day’s money actions: who, what, approved by whom, and when', async () => {
    const s = await seedShop(db);
    const card = fakeProvider();
    const acct = `acct_sec_${s.merchant.slice(-6)}`;
    const cc = await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    const reader = `rdr_sec_${s.merchant.slice(-6)}`;
    await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [reader, s.merchant, cc.id, `M2-${reader}`]);
    const managerPin = async (_m: string, pin: string) => (pin === '4321' ? { id: s.staff.manager, role: 'manager' as const } : null);
    const deps: OrderDeps = { taxApi: null, pinCheck: managerPin };

    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    // A cash sale with a manager's discount over Jen's limit.
    const a = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Patch', note: null, amountCents: 5000, taxKind: 'labour' }] });
    await applyDiscount(db, deps, { merchant: s.merchant, orderId: a.id, staff: { id: s.staff.jen, role: 'counter' }, request: { kind: 'manual', percent: 20, amountCents: null, reason: 'Regular', approverPin: '4321' } });
    const cash = await createCashTender(db, { merchant: s.merchant, orderId: a.id, staffId: s.staff.jen, tender: { amountCents: 4000, tipCents: 0, handedOverCents: 4000, idempotencyKey: key() } });
    await requestRefund(db, { card: null, pinCheck: managerPin }, { merchant: s.merchant, staff: { id: s.staff.owner, role: 'owner' }, request: { tenderId: cash.id, amountCents: 1000, items: [], reason: 'Came back', idempotencyKey: key() } });

    // A card sale, voided with the manager's PIN.
    const b = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Tires', note: null, amountCents: 12000, taxKind: 'goods' }] });
    const start = await createCardTender(db, card.provider, { merchant: s.merchant, orderId: b.id, staffId: s.staff.jen, amountCents: 12000, tipCents: 0, readerId: reader, idempotencyKey: key() });
    card.tap([...card.payments.keys()].at(-1)!);
    await syncCardTender(db, card.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: s.staff.jen });
    await voidOrder(db, { card: card.provider, clear: null as never, pinCheck: managerPin }, { merchant: s.merchant, orderId: b.id, staffId: s.staff.jen, pin: '4321', today: b.businessDate });

    // A card sale captured at close; the drawer is $5 short, signed off by the manager.
    const c = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [{ itemId: null, name: 'Alignment', note: null, amountCents: 9000, taxKind: 'labour' }] });
    const c1 = await createCardTender(db, card.provider, { merchant: s.merchant, orderId: c.id, staffId: s.staff.jen, amountCents: 9000, tipCents: 0, readerId: reader, idempotencyKey: key() });
    card.tap([...card.payments.keys()].at(-1)!);
    await syncCardTender(db, card.provider, { merchant: s.merchant, tenderId: c1.tenderId, actor: s.staff.jen });
    const { rows: sess } = await db.query<{ id: string }>(`SELECT id FROM payments.drawer_sessions WHERE merchant = $1 AND status <> 'closed'`, [s.merchant]);
    const sessionId = sess[0]!.id;
    await saveCount(db, { merchant: s.merchant, sessionId, staffId: s.staff.jen, count: { method: 'total', totalCents: 15000 + 3000 - 500 } });
    await saveCount(db, { merchant: s.merchant, sessionId, staffId: s.staff.luis, count: { method: 'total', totalCents: 15000 + 3000 - 500 } });
    await signOff(db, { pinCheck: managerPin }, { merchant: s.merchant, sessionId, staffId: s.staff.luis, signOff: { note: 'Change error', pin: '4321' } });
    await closeDay(db, { card: card.provider }, { merchant: s.merchant, sessionId, staffId: s.staff.luis });

    const trail = await auditTrail(db, { merchant: s.merchant, from: today(), to: today() });
    const by = (action: string) => trail.filter((e) => e.action === action);
    // Approvals by PIN carry who asked and who approved.
    expect(by('order.discount_applied')).toMatchObject([{ actor: s.staff.jen, approver: s.staff.manager, amountCents: 1000, ref: { type: 'order', id: a.id } }]);
    expect(by('order.voided')).toMatchObject([{ actor: s.staff.jen, approver: s.staff.manager, amountCents: 12000 }]);
    expect(by('drawer.signed_off')).toMatchObject([{ actor: s.staff.luis, approver: s.staff.manager, amountCents: -500 }]);
    expect(by('refund.approved')).toMatchObject([{ actor: s.staff.owner, approver: s.staff.owner, detail: { byPin: false } }]);
    // The money itself: tenders, the processor's steps, cash out, counts, the close.
    expect(by('tender.cash_taken')).toMatchObject([{ actor: s.staff.jen, amountCents: 4000 }]);
    expect(by('refund.requested')).toHaveLength(1);
    expect(by('refund.cash_given')).toMatchObject([{ amountCents: 1000 }]);
    expect(by('tender.card_started')).toHaveLength(2);
    expect(by('card.authorised')).toHaveLength(2);
    expect(by('card.cancelled')).toMatchObject([{ actor: s.staff.manager, ref: { id: start.tenderId } }]);
    expect(by('card.captured')).toMatchObject([{ actor: s.staff.luis, ref: { id: c1.tenderId }, amountCents: 9000 }]);
    expect(by('drawer.opened')).toMatchObject([{ actor: s.staff.jen, amountCents: 15000 }]);
    expect(by('drawer.counted')).toHaveLength(2);
    expect(by('day.closed')).toMatchObject([{ actor: s.staff.luis }]);
    // Every booking, from the ledger service itself.
    expect(by('booked.cash_sale')).toMatchObject([{ actor: s.staff.jen, ref: { type: 'order', id: a.id } }]);
    expect(by('booked.card_sale').length).toBeGreaterThan(0);
    expect(by('booked.reversal').length).toBeGreaterThan(0); // the voided card sale
    expect(by('booked.cash_refund')).toMatchObject([{ actor: s.staff.owner, amountCents: 1000 }]);
    expect(by('booked.drawer_short')).toMatchObject([{ actor: s.staff.luis, amountCents: 500 }]);
    // No PIN ever lands in it.
    expect(JSON.stringify(trail)).not.toContain('4321');
  });

  test('is append-only, and written by one module', async () => {
    const s = await seedShop(db);
    await openDrawer(db, { merchant: s.merchant, staffId: s.staff.jen });
    await expect(db.query(`UPDATE payments.audit_log SET actor = 'someone' WHERE merchant = $1`, [s.merchant])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM payments.audit_log WHERE merchant = $1', [s.merchant])).rejects.toThrow('append-only');

    const src = join(import.meta.dir, '../../..');
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') && !d.name.endsWith('.test.ts') ? [join(dir, d.name)] : []));
    const writers = files(src)
      .filter((f) => /INSERT\s+INTO\s+payments\.audit_log/i.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(src.length + 1));
    expect(writers).toEqual(['services/merchant/security/audit.ts']);
  });
});

describe('no fee or tax is taken from the client', () => {
  const SMUGGLED = { applicationFeeCents: 0, feeCents: 0, clearFeeCents: 0, processorFeeCents: 0, taxCents: 0, taxRate: 0, taxRatePpm: 0, taxIncluded: true, totalCents: 1, subtotalCents: 1 };
  const keys = Object.keys(SMUGGLED);

  test('every money request drops them before the server sees it', () => {
    const cases: Array<[string, { parse: (v: unknown) => unknown }, Record<string, unknown>]> = [
      ['card tender', CreateCardTender, { amountCents: 100, tipCents: 0, readerId: 'rdr_1', idempotencyKey: 'k-12345678' }],
      ['cash tender', CreateCashTender, { amountCents: 100, tipCents: 0, handedOverCents: 100, idempotencyKey: 'k-12345678' }],
      ['Clear tender', CreateClearTender, { amountCents: 100, tipCents: 0, idempotencyKey: 'k-12345678' }],
      ['catalog line', LineInput, { itemId: 'itm_1', quantity: 1, optionIds: [] }],
      ['quick sale', LineInput, { itemId: null, name: 'x', note: null, amountCents: 100, taxKind: 'goods' }],
      ['discount', DiscountRequest, { kind: 'manual', percent: 10, amountCents: null, reason: 'r', approverPin: null }],
      ['refund', RequestRefund, { tenderId: 'tnd_1', amountCents: 100, items: [], reason: null, idempotencyKey: 'k-12345678' }],
      ['count', SaveCount, { method: 'total', totalCents: 100 }],
      ['sign-off', SignOff, { note: 'n', pin: '1234' }],
    ];
    for (const [name, schema, valid] of cases) {
      const out = schema.parse({ ...valid, ...SMUGGLED }) as Record<string, unknown>;
      // A field the request really has (a count's own total) isn't smuggled.
      expect({ name, leaked: keys.filter((k) => k in out && !(k in valid)) }).toEqual({ name, leaked: [] });
    }
  });

  test('no route reads a fee or a tax off the request', () => {
    const dir = join(import.meta.dir, '../../../routes');
    const offenders = readdirSync(dir)
      .filter((f) => f.startsWith('merchant') && f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .flatMap((f) => (readFileSync(join(dir, f), 'utf8').match(/req\.(body|query)\??\.\w*(fee|Fee|tax|Tax|total|Total)\w*/g) ?? []).map((m) => `${f}: ${m}`));
    expect(offenders).toEqual([]);
  });

  test('smuggled into a sale anyway, they change nothing the server works out', async () => {
    const s = await seedShop(db);
    await db.query(`UPDATE merchant.profiles SET address_line1 = '412 Colton Ave', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92374' WHERE merchant = $1`, [s.merchant]);
    const tax = fakeTax();
    const deps: OrderDeps = { taxApi: tax.api, pinCheck: async () => null };
    const line = { itemId: null, name: 'Tires', note: null, amountCents: 10000, taxKind: 'goods' as const, ...SMUGGLED };
    const o = await createOrder(db, deps, { merchant: s.merchant, staffId: s.staff.jen, lines: [line] as never });
    // 7.75% on goods, from the shop's address, not the 0 the client sent.
    expect(o).toMatchObject({ subtotalCents: 10000, taxCents: 775, totalCents: 10775 });

    const card = fakeProvider();
    const acct = `acct_smg_${s.merchant.slice(-6)}`;
    const cc = await connectorStore.insert(db, { merchant: s.merchant, provider: 'stripe', externalAccountId: acct, connectedBy: s.staff.owner });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: acct, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
    const reader = `rdr_smg_${s.merchant.slice(-6)}`;
    await db.query(`INSERT INTO merchant.readers (id, merchant, connector_id, provider, type, external_reader_id, label) VALUES ($1,$2,$3,'stripe','m2',$4,'M2')`, [reader, s.merchant, cc.id, `M2-${reader}`]);
    const start = await createCardTender(db, card.provider, { merchant: s.merchant, orderId: o.id, staffId: s.staff.jen, amountCents: 10775, tipCents: 0, readerId: reader, idempotencyKey: key(), ...SMUGGLED } as never);
    card.tap([...card.payments.keys()].at(-1)!);
    await syncCardTender(db, card.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    await captureCardTender(db, card.provider, { merchant: s.merchant, tenderId: start.tenderId, actor: null });
    // Clear's 30¢ on a sale over $10, worked out on the server.
    expect(card.calls.captures.at(-1)).toMatchObject({ amountCents: 10775, applicationFeeCents: 30 });
  });
});
