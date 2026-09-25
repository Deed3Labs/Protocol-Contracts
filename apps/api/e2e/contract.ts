/**
 * Contract conformance: the merchant app's real client (apps/merchant/src/data/merchantApi/real.ts)
 * against the real API, every method of `MerchantApi`, each response parsed with the contract's own
 * schema. Where the two disagree, the app would break at run time; this finds it first.
 *
 *   DATABASE_URL=postgres://…         an empty Postgres 16
 *   STRIPE_SECRET_KEY=sk_test_…       optional; with it (and E2E_STRIPE_ACCOUNT) the card methods run
 *   E2E_STRIPE_ACCOUNT=acct_…         against Stripe test mode and its simulated reader
 *   bun e2e/contract.ts
 */
import * as C from '@clear/merchant-contracts';
import type { MerchantApi } from '@clear/merchant-contracts';
import Stripe from 'stripe';
import { realMerchantApi, type Transport } from '../../merchant/src/data/merchantApi/real.js';
import { bootApi, PINS, seedShop } from './harness.js';

const PORT = Number(process.env.E2E_PORT || 3998);
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const ACCOUNT = (process.env.E2E_STRIPE_ACCOUNT || '').trim();
if (!DATABASE_URL) throw new Error('DATABASE_URL must point at an empty Postgres');
if (KEY && !KEY.startsWith('sk_test_')) throw new Error('STRIPE_SECRET_KEY must be a TEST key');
const withCards = Boolean(KEY && ACCOUNT);

const server = await bootApi({ port: PORT, databaseUrl: DATABASE_URL, stripeKey: withCards ? KEY : null });
const shop = await seedShop({ databaseUrl: DATABASE_URL, stripeAccount: withCards ? ACCOUNT : null });
const origin = server.base.replace(/\/api$/, '');

type Who = keyof typeof shop.token;
/** The app's transport, minus the browser: the chosen person's session, errors as the app sees them. */
const transport = (who: Who): Transport => async <T>(path: string, init: RequestInit = {}) => {
  const r = await fetch(`${origin}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shop.token[who]}`, ...init.headers } });
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((body as { message?: string } | null)?.message ?? `HTTP ${r.status}`), { status: r.status });
  return body as T;
};
const as = (who: Who): MerchantApi => realMerchantApi(transport(who));
const owner = as('owner');
const manager = as('manager');
const jen = as('jen');
const luis = as('luis');

const rows: Array<{ method: string; ok: boolean; note: string }> = [];
/** A contract schema, typed by what's used: the API and the contracts carry separate zod copies. */
type Schema = { safeParse(value: unknown): { success: true } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } };

async function check<T>(method: string, schema: Schema | null, run: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await run();
    if (!schema) {
      rows.push({ method, ok: true, note: 'no body' });
      return value;
    }
    const parsed = schema.safeParse(value);
    rows.push({ method, ok: parsed.success, note: parsed.success ? '' : parsed.error.issues.slice(0, 3).map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ') });
    return value;
  } catch (error) {
    const expected = Boolean((error as { expected?: boolean }).expected);
    rows.push({ method, ok: expected, note: expected ? `skipped: ${(error as Error).message}` : `threw: ${(error as Error).message}` });
    return undefined;
  }
}
const skip = (method: string, why: string) => rows.push({ method, ok: true, note: `skipped: ${why}` });
const key = (() => {
  let n = 0;
  return () => `contract-${Date.now()}-${++n}`;
})();
const today = new Date().toISOString().slice(0, 10);
const range = { from: '2000-01-01', to: '2100-01-01' };

try {
  // ---- The shop
  await check('shop', C.Shop, () => owner.shop());
  await check('updateShop', C.Shop, () => owner.updateShop({ timezone: 'America/Los_Angeles' }));
  await check('settings', C.ShopSettings, () => owner.settings());
  await check('updateSettings', C.ShopSettings, () => owner.updateSettings({}));
  await check('staff', C.Staff.array(), () => manager.staff());
  await check('saveHours', C.ShopHours, () =>
    owner.saveHours({ week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: day < 6 ? { from: '08:00', to: '18:00' } : null })), dates: [{ date: '2026-11-26', label: 'Thanksgiving', open: null }] }),
  );
  await check('hours', C.ShopHours, () => jen.hours());

  // ---- Shifts: a PIN on an enrolled tablet starts one (POST /session), signing out ends it.
  const enrolled = await fetch(`${origin}/api/merchant/devices`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shop.token.owner}` }, body: JSON.stringify({ label: 'Counter tablet' }) }).then((r) => r.json() as Promise<{ deviceToken: string }>);
  const pinIn = await fetch(`${origin}/api/merchant/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clear-Device': enrolled.deviceToken }, body: JSON.stringify({ pin: PINS.jen, staffId: shop.staff.jen.id }) });
  if (!pinIn.ok) throw new Error(`PIN sign-in failed: ${pinIn.status}`);
  const jenShift = (await pinIn.json()) as { token: string };
  const onNow = await check('shifts', C.ShiftNow.array(), () => jen.shifts());
  if (onNow?.map((s) => s.staffId).join() !== shop.staff.jen.id) throw new Error(`expected Jen alone on shift, got ${JSON.stringify(onNow)}`);
  await check('startBreak', C.ShiftNow, () => jen.startBreak());
  await check('endBreak', C.ShiftNow, () => jen.endBreak());
  await check('saveStaffHours', C.PersonHours, () => manager.saveStaffHours(shop.staff.jen.id, { hours: { days: [0, 1, 2, 3, 4].map((day) => ({ day, open: { from: '08:00', to: '16:00' } })) }, once: false }));
  await check('staffHours', C.PersonHours, () => jen.staffHours(shop.staff.jen.id));
  await check('staffWeek', C.StaffWeek, () => jen.staffWeek());
  // A counter shift can't end someone else's; a manager can end a counter shift.
  const refused = await jen.endShift(shop.staff.luis.id).then(() => 'ok', (e: { status?: number }) => e.status);
  if (refused !== 403) throw new Error(`a counter shift ended someone else's: ${refused}`);
  await check('endShift', null, () => manager.endShift(shop.staff.jen.id));
  if ((await jen.shifts()).length) throw new Error('Jen is still on shift after a manager ended it');
  // Signing out ends your own.
  await fetch(`${origin}/api/merchant/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clear-Device': enrolled.deviceToken }, body: JSON.stringify({ pin: PINS.jen, staffId: shop.staff.jen.id }) });
  if ((await jen.shifts()).length !== 1) throw new Error('a second PIN did not start a new shift');
  await fetch(`${origin}/api/merchant/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${jenShift.token}` } });
  if ((await jen.shifts()).length) throw new Error('signing out did not end the shift');
  await check('taxStatus', C.TaxStatus, () => owner.taxStatus());
  await check('setup', C.SetupProgress, () => manager.setup());

  // ---- Cards
  await check('cardAvailability', C.CardAvailability, () => jen.cardAvailability());
  let reader: C.Reader | undefined;
  if (withCards) {
    await check('connectCards', null, () => owner.connectCards());
    await check('connectionToken', C.ConnectionToken, () => jen.connectionToken());
    reader = await check('registerSmartReader', C.Reader, () => manager.registerSmartReader({ registrationCode: 'simulated-wpe', label: 'Front counter' }));
    await check('recordReader', C.Reader, () => jen.recordReader({ type: 'm2', externalReaderId: `STRM2-${Date.now()}`, label: 'Bay M2' }));
  } else ['connectCards', 'connectionToken', 'registerSmartReader', 'recordReader'].forEach((m) => skip(m, 'no Stripe test key'));
  await check('readers', C.Reader.array(), () => jen.readers());

  // ---- The catalogue and stock
  const tire = await check('createItem', C.CatalogItem, () => manager.createItem({ name: 'Michelin Defender2', detail: null, category: 'Tires', priceCents: 18900, costCents: 13200, taxKind: 'exempt', stockTracked: true, reorderAt: 2 }));
  if (!tire) throw new Error('createItem failed; nothing further can run');
  await check('updateItem', C.CatalogItem, () => manager.updateItem(tire.id, { detail: '225/65R17' }));
  await check('saveOptionGroups', C.CatalogItem, () => manager.saveOptionGroups(tire.id, [{ name: 'Road hazard', rule: 'one', required: false, position: 0, options: [{ id: 'new', name: 'Warranty', deltaCents: 2000, position: 0 }] }] as never));
  await check('adjustStock', C.CatalogItem, () => manager.adjustStock({ itemId: tire.id, kind: 'receive', quantity: 8, reason: null }));
  await check('stockHistory', C.StockMovement.array(), () => manager.stockHistory(tire.id));
  await check('importCatalog', C.ImportResult, () =>
    manager.importCatalog({ rows: [{ name: 'Michelin Defender2', detail: '225/65R17', category: 'Tires', priceCents: 18900, costCents: 13200, quantity: 2, reorderAt: null }, { name: 'Valve stem', detail: null, category: null, priceCents: 500, costCents: null, quantity: 40, reorderAt: 10 }] }),
  );
  const reorder = await check('markReordered', C.Reorder, () => manager.markReordered({ itemId: tire.id, quantity: 4, supplier: 'ATD', expectedOn: null }));
  await check('reorders', C.Reorder.array(), () => manager.reorders());
  if (reorder) await check('receiveReorder', C.Reorder, () => manager.receiveReorder(reorder.id, { quantity: 4 }));
  await check('createDiscountCode', C.DiscountCode, () => manager.createDiscountCode({ code: 'FALL10', percent: 10, amountCents: null, appliesTo: { all: true }, startsAt: null, endsAt: null, oncePerCustomer: false }));
  await check('discountCodes', C.DiscountCode.array(), () => manager.discountCodes());
  const labour = (name: string, amountCents: number) => ({ itemId: null, name, note: null, amountCents, taxKind: 'labour' as const });

  // ---- The drawer, orders and tenders
  await check('drawer (none open)', null, () => jen.drawer());
  const drawer = await check('openDrawer', C.DrawerSession, () => jen.openDrawer({ startingCashCents: 15000 }));
  await check('drawer', C.DrawerSession, () => jen.drawer());
  const o = await check('createOrder', C.Order, () => jen.createOrder({ lines: [{ itemId: tire.id, quantity: 1, optionIds: [] }], customer: 'Ray C.' }));
  if (!o) throw new Error('createOrder failed; nothing further can run');
  await check('updateOrder', C.Order, () => jen.updateOrder(o.id, { lines: [{ itemId: tire.id, quantity: 2, optionIds: [] }] }));
  await check('applyDiscount', C.Order, () => jen.applyDiscount(o.id, { kind: 'code', code: 'FALL10' }));
  await check('removeDiscount', C.Order, () => jen.removeDiscount(o.id));
  await check('order', C.Order, () => jen.order(o.id));
  await check('orders', C.Order.array(), () => jen.orders({ date: today }));
  const cashTender = await check('createCashTender', C.Tender, () => jen.createCashTender(o.id, { amountCents: 10000, tipCents: 0, handedOverCents: 10000, idempotencyKey: key() }));
  await check('tenders', C.Tender.array(), () => jen.tenders(o.id));
  await check('orderHistory', C.OrderWithTenders.array(), () => jen.orderHistory({ from: today, to: today }));
  // A Clear charge needs the shop registered on chain, which a local database isn't: a clean
  // refusal (a sentence, a 4xx) is the right answer here, and it's recorded as such.
  await check('createClearTender', C.Tender, () =>
    jen.createClearTender(o.id, { amountCents: 1000, tipCents: 0, idempotencyKey: key() }).catch((error: Error & { status?: number }) => {
      if (error.status && error.status < 500 && /Clear couldn/.test(error.message)) return Promise.reject(Object.assign(new Error(`refused cleanly (${error.status}): ${error.message}`), { expected: true }));
      throw error;
    }),
  );

  // Sending needs a waiting Clear charge, which a shop not active on chain can't raise: a cash
  // tender is refused as "no such Clear payment", which is the route, the client and the error shape.
  if (cashTender)
    await check('sendClearCharge', C.ClearChargeSent, () =>
      jen.sendClearCharge(cashTender.id, { to: 'phone', phone: '(909) 555-0177' }).catch((error: Error & { status?: number }) => {
        if (error.status === 404) return Promise.reject(Object.assign(new Error(`refused cleanly (404): ${error.message}`), { expected: true }));
        throw error;
      }),
    );

  let cardTender: string | undefined;
  if (withCards && reader) {
    const stripe = new Stripe(KEY);
    const card = async (orderId: string, amountCents: number) => {
      const start = await check('createCardTender', C.CardTenderStart, () => jen.createCardTender(orderId, { amountCents, tipCents: 0, readerId: reader!.id, idempotencyKey: key() }));
      await check('presentTender', C.Tender, () => jen.presentTender(start!.tenderId));
      await stripe.testHelpers.terminal.readers.presentPaymentMethod(reader!.externalReaderId, { type: 'card_present', card_present: { number: '4242424242424242' } }, { stripeAccount: ACCOUNT });
      let t: C.Tender | undefined;
      for (let i = 0; i < 20 && (!t || t.status === 'pending'); i++) {
        t = await check('syncTender', C.Tender, () => jen.syncTender(start!.tenderId));
        await new Promise((r) => setTimeout(r, 800));
      }
      return t!;
    };
    const paid = await jen.order(o.id);
    const t = await card(o.id, paid.remainingCents);
    cardTender = t.id;
    await check('adjustTip', C.Tender, () => jen.adjustTip(t.id, { tipCents: 500 }));
    // A card started and stopped, and an order voided with the manager's PIN.
    const v = await jen.createOrder({ lines: [labour('Rotation', 4000)], customer: null });
    const stopped = await jen.createCardTender(v.id, { amountCents: 4000, tipCents: 0, readerId: reader.id, idempotencyKey: key() });
    await check('cancelTender', C.Tender, () => jen.cancelTender(stopped.tenderId));
    const w = await jen.createOrder({ lines: [labour('Patch', 3000)], customer: null });
    await card(w.id, 3000);
    await check('voidOrder', C.Order, () => jen.voidOrder(w.id, { pin: PINS.manager }));
  } else ['createCardTender', 'presentTender', 'syncTender', 'adjustTip', 'cancelTender', 'voidOrder'].forEach((m) => skip(m, 'no Stripe test key'));
  await check('receipt', C.Receipt, () => jen.receipt(o.id));
  const walked = await jen.createOrder({ lines: [labour('Walked away', 2000)], customer: null });
  await check('discardOrder', C.Order, () => jen.discardOrder(walked.id));
  await check('sendReceipt', null, () => jen.sendReceipt(o.id, { by: 'none', to: null }));

  // ---- Counting and closing: the counts disagree, one recounts, they agree $1 short, it's signed off.
  if (drawer) {
    await check('saveCount', C.CountsView, () => jen.saveCount(drawer.id, { method: 'total', totalCents: 24900 }));
    await check('saveCount (second)', C.CountsView, () => luis.saveCount(drawer.id, { method: 'total', totalCents: 24800 }));
    await check('counts', C.CountsView, () => jen.counts(drawer.id));
    await check('recount', C.CountsView, () => luis.recount(drawer.id, { which: 'second' }));
    await check('saveCount (again)', C.CountsView, () => luis.saveCount(drawer.id, { method: 'total', totalCents: 24900 }));
    const view = await luis.counts(drawer.id);
    if (view.state === 'compared' && view.signoffNeeded) await check('signOff', C.CountsView, () => luis.signOff(drawer.id, { note: 'Counted twice', pin: PINS.manager }));
    else skip('signOff', 'the drawer matched');
    await check('closeDay', C.CloseDayResult, () => luis.closeDay(drawer.id));
    const deposits = await check('bankDeposits', C.BankDeposit.array(), () => manager.bankDeposits());
    if (deposits?.[0]) await check('markDeposited', C.BankDeposit, () => manager.markDeposited(deposits[0]!.id));
    else skip('markDeposited', 'no deposit');
  }

  // ---- Refunds (the card was captured at close)
  if (cardTender) {
    const asked = await check('requestRefund', C.Refund, () => jen.requestRefund({ tenderId: cardTender!, amountCents: 1000, items: [], reason: 'Goodwill', idempotencyKey: key() }));
    if (asked) await check('decideRefund', C.Refund, () => manager.decideRefund(asked.id, { decision: 'approve', pin: null }));
  } else ['requestRefund', 'decideRefund'].forEach((m) => skip(m, 'no card captured'));

  // ---- Reports
  await check('dayReports', C.DayReport.array(), () => manager.dayReports(range));
  await check('cardDeposits', C.CardDeposit.array(), () => manager.cardDeposits(range));
  await check('overview', C.Overview, () => manager.overview(range));
  await check('clearFeeBills', C.ClearFeeBill.array(), () => manager.clearFeeBills());
  await check('audit', C.AuditEntry.array(), () => owner.audit(range));
  await check('reconciliation', C.Reconciliation, () => manager.reconciliation());
  // Nothing has run the nightly reconciliation here, so there's no flag to explain: a made-up one is
  // refused as "not this shop's", which is the route, the client and the error shape.
  await check('explainFlag', C.ReconciliationFlag, () =>
    manager.explainFlag('flag_none', { note: 'Checked in Stripe' }).catch((error: Error & { status?: number }) => {
      if (error.status === 404) return Promise.reject(Object.assign(new Error(`refused cleanly (404): ${error.message}`), { expected: true }));
      throw error;
    }),
  );
  await check('archiveItem', C.CatalogItem, () => manager.archiveItem(tire.id));
} finally {
  server.stop();
  await shop.end();
}

const failed = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? (r.note.startsWith('skipped') ? 'SKIP' : 'OK  ') : 'FAIL'}  ${r.method}${r.note ? `  — ${r.note}` : ''}`);
console.log(`\n${rows.length - failed.length}/${rows.length} conform`);
process.exit(failed.length ? 1 : 0);
