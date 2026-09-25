import { canVoidOrder, clearCardFee, orderStatus, tenderTransition } from '@clear/merchant-contracts';
import type {
  AuditEntry,
  BankDeposit,
  CardAvailability,
  CardDeposit,
  CatalogItem,
  CloseDayResult,
  CountsView,
  DayReport,
  DiscountCode,
  DrawerSession,
  LineInput,
  MerchantApi,
  Order,
  OrderDiscount,
  OrderLine,
  OwnCount,
  Reader,
  Receipt,
  Refund,
  Reorder,
  PersonHours,
  ShiftNow,
  ShopSettings,
  StaffHours,
  StaffWeek,
  StockMovement,
  Tender,
  TenderEvent,
} from '@clear/merchant-contracts';
import { refundQuote, seesMoney, type ChargeState } from '@clear/domain';
import type { api as ApiClient, EnrolledDevice, MerchantCharge, MerchantProfile, PayoutPosition, Refund as ClearRefund, StaffMember } from '../apiClient';
import { price } from './pricing';
import * as seed from './seed';

/**
 * The older client's Clear-side calls (`api` in ../apiClient.ts), which the Charges pages, the
 * payout position and the roster still use. The mock answers them from the same state, so a Clear
 * charge raised in New Charge is the one Charges lists and a refund can be taken through.
 */
export type ClearSide = Pick<
  typeof ApiClient,
  | 'charges'
  | 'cancelCharge'
  | 'openRefundFor'
  | 'requestRefund'
  | 'checkOwnerCode'
  | 'authoriseRefund'
  | 'decideRefund'
  | 'withdrawRefund'
  | 'refundThreshold'
  | 'setRefundThreshold'
  | 'payouts'
  | 'staff'
  | 'roster'
  | 'resetPin'
  | 'removeStaff'
  | 'profile'
  | 'devices'
  | 'currentDevice'
  | 'renameDevice'
  | 'setIdleLock'
  | 'signOut'
>;

/**
 * The merchant API in memory (UI prompt, Phase 3): the demo, the preview and the tests. It keeps the
 * server's rules where the screens depend on them (pricing to the cent, the tender and order state
 * machines, blind counts, a manager's PIN for overrides) so the mock and the live app behave alike,
 * and it answers refusals the way the API does: an error carrying a sentence and a status.
 *
 * Switches reach every state in the reference files:
 *   stripe   connected | not_connected            (Settings › Payments, the card screen)
 *   drawer   none | open | balanced | short | disagree | closed   (Home, counting, Close the day)
 *   card     approve | decline                     (what the next tap does)
 *   clear    approve | decline | wait              (what the member does)
 *   delayMs  every call waits this long            (spinners, skeletons)
 *   failNext the next call to a method fails        (error states)
 */

export interface MockSwitches {
  stripe: 'connected' | 'not_connected';
  drawer: 'none' | 'open' | 'balanced' | 'short' | 'disagree' | 'closed';
  card: 'approve' | 'decline';
  clear: 'approve' | 'decline' | 'wait';
  delayMs: number;
}

export class MockApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.details = { error: code ?? 'refused', message };
  }
}

interface OrderRec {
  id: string;
  number: number;
  raisedBy: string;
  customer: string | null;
  businessDate: string;
  createdAt: string;
  voided: boolean;
  inputs: LineInput[];
  discount: (OrderDiscount & { percent: number | null; fixedCents: number | null }) | null;
}

const TODAY = seed.REFERENCE_DAY;

export function createMockMerchantApi(initial: Partial<MockSwitches> & { viewer?: string } = {}) {
  const switches: MockSwitches = { stripe: 'connected', drawer: 'open', card: 'approve', clear: 'wait', delayMs: 250, ...initial };
  let viewer = initial.viewer ?? seed.STAFF_ID.mike;
  let failNext: { method: string; message: string; status: number } | null = null;
  let n = 1000;
  const id = (p: string) => `${p}_mock_${++n}`;
  const now = () => new Date().toISOString();

  // ---- State -------------------------------------------------------------------------------------
  let settings: ShopSettings = { ...seed.SETTINGS };
  let shop = { ...seed.SHOP };
  let hours = structuredClone(seed.HOURS);
  const items = new Map<string, CatalogItem>(seed.catalog().map((i) => [i.id, i]));
  const movements: Array<StockMovement & { itemId: string }> = [];
  const reorders = new Map<string, Reorder>(seed.REORDERS.map((r) => [r.id, { ...r }]));
  const codes = new Map<string, DiscountCode>(seed.DISCOUNT_CODES.map((c) => [c.id, { ...c }]));
  const readers: Reader[] = seed.READERS.map((r) => ({ ...r }));
  const orders = new Map<string, OrderRec>();
  const tenders = new Map<string, Tender & { tipStaffId: string | null; syncs: number; applicationFeeCents: number }>();
  const refunds = new Map<string, Refund>();
  const audit: AuditEntry[] = [];
  const sessions = new Map<string, DrawerSession>();
  const counts = new Map<string, OwnCount[]>();
  const signoffs = new Map<string, string>();
  const reports = new Map<string, DayReport>();
  const deposits: BankDeposit[] = [];
  const cardDeposits: CardDeposit[] = [];
  let orderNumber = 0;
  // Shifts and hours: who is on, their breaks, and each person's usual week and this week.
  type ShiftRec = { staffId: string; startedAt: string; breakFrom: string | null; breakMinutes: number };
  const shifts = new Map<string, ShiftRec>(seed.SHIFTS.map((s) => [s.staffId, { ...s, breakFrom: null, breakMinutes: 0 }]));
  const staffHours = new Map<string, { usual: StaffHours | null; next: StaffHours | null; thisWeek: StaffHours | null }>(
    Object.entries(structuredClone(seed.STAFF_HOURS)).map(([k, v]) => [k, { ...v, next: null }]),
  );

  const who = (staffId: string) => seed.STAFF.find((s) => s.id === staffId);
  /** An owner changes anyone's shift or hours; a manager counter staff's and their own. */
  const mayManage = (staffId: string) => who(viewer)?.role === 'owner' || (who(viewer)?.role === 'manager' && (staffId === viewer || who(staffId)?.role === 'counter'));
  const bookedToday = (staffId: string) => {
    const h = staffHours.get(staffId);
    return (h?.thisWeek ?? h?.usual)?.days.find((d) => d.day === 1)?.open ?? null;
  };
  const shiftNow = (s: { staffId: string; startedAt: string; breakFrom: string | null; breakMinutes: number }): ShiftNow => ({
    staffId: s.staffId,
    name: who(s.staffId)!.name,
    role: who(s.staffId)!.role,
    startedAt: s.startedAt,
    onBreakSince: s.breakFrom,
    breakMinutes: s.breakMinutes,
    booked: bookedToday(s.staffId),
  });
  const personHours = (staffId: string): PersonHours => {
    if (!who(staffId)) refuse('That person is not on the team', 404, 'not_found');
    const h = staffHours.get(staffId);
    return { usual: h?.usual ?? null, next: h?.next ?? null, thisWeek: h?.thisWeek ?? null, nextWeekOf: '2026-09-28' };
  };
  const isManager = (staffId: string) => ['manager', 'owner'].includes(who(staffId)?.role ?? '');
  // Whose PIN is whose, as the server keeps them: a reset clears one, a first shift sets one.
  const pins = new Map<string, string>(Object.entries(seed.MOCK_PINS).map(([pin, staffId]) => [staffId, pin]));
  const removed = new Set<string>();
  const pinOf = (pin: string | null | undefined) => (pin ? ([...pins].find(([staffId, p]) => p === pin && !removed.has(staffId))?.[0] ?? null) : null);
  const refuse = (message: string, status = 409, code?: string): never => {
    throw new MockApiError(message, status, code);
  };
  const log = (action: string, e: Partial<AuditEntry> = {}) =>
    audit.unshift({ id: String(audit.length + 1), at: now(), actor: viewer, approver: null, ref: null, amountCents: null, detail: {}, ...e, action });

  // ---- Orders --------------------------------------------------------------------------------------
  function linesOf(rec: OrderRec) {
    return rec.inputs.map((l, i) => {
      if (l.itemId === null) return { id: `${rec.id}_l${i + 1}`, itemId: null, name: l.name, note: l.note, quantity: 1, unitCents: l.amountCents, options: [], taxKind: l.taxKind, category: null as string | null };
      const it = items.get(l.itemId);
      if (!it) refuse('That item isn’t in the catalogue', 422);
      const chosen = it!.optionGroups.flatMap((g) => g.options.filter((o) => l.optionIds.includes(o.id)).map((o) => ({ groupId: g.id, optionId: o.id, name: o.name, deltaCents: o.deltaCents })));
      const unit = it!.priceCents + chosen.reduce((s, o) => s + o.deltaCents, 0);
      return { id: `${rec.id}_l${i + 1}`, itemId: it!.id, name: it!.name, note: null, quantity: l.quantity, unitCents: unit, options: chosen, taxKind: it!.taxKind, category: it!.category };
    });
  }
  function toOrder(rec: OrderRec): Order {
    const lines = linesOf(rec);
    const spec = rec.discount ? { percent: rec.discount.percent, amountCents: rec.discount.fixedCents, categories: null } : null;
    const p = price(lines.map((l) => ({ lineCents: l.unitCents * l.quantity, taxKind: l.taxKind, category: l.category })), spec, { inclusive: settings.tax.pricesIncludeTax });
    const ts = [...tenders.values()].filter((t) => t.orderId === rec.id);
    const summary = orderStatus({ totalCents: p.total, voided: rec.voided }, ts);
    const orderLines: OrderLine[] = lines.map((l, i) => ({
      id: l.id,
      itemId: l.itemId,
      name: l.name,
      note: l.note,
      quantity: l.quantity,
      unitCents: l.unitCents,
      options: l.options,
      lineCents: l.unitCents * l.quantity,
      discountCents: p.shares[i]!,
      taxKind: l.taxKind,
      taxCents: p.taxes[i]!,
    }));
    return {
      id: rec.id,
      shop: shop.id,
      number: rec.number,
      name: null,
      raisedBy: rec.raisedBy,
      customer: rec.customer,
      status: summary.status,
      lines: orderLines,
      discount: rec.discount ? { kind: rec.discount.kind, codeId: rec.discount.codeId, label: rec.discount.label, amountCents: p.discount, reason: rec.discount.reason, approvedBy: rec.discount.approvedBy } : null,
      subtotalCents: p.subtotal,
      discountCents: p.discount,
      taxCents: p.tax,
      totalCents: p.total,
      taxIncluded: settings.tax.pricesIncludeTax,
      taxSource: 'address_rate',
      tipCents: summary.tipCents,
      remainingCents: summary.remainingCents,
      businessDate: rec.businessDate,
      createdAt: rec.createdAt,
    };
  }
  const orderRec = (orderId: string) => orders.get(orderId) ?? refuse('No such order', 404, 'not_found');
  const editable = (rec: OrderRec) => {
    const st = toOrder(rec).status;
    if (st !== 'open') refuse(st === 'paying' ? 'A payment has started on it; finish or void it first' : `A ${st} order can’t be changed`, 409, 'not_editable');
  };

  function moveStock(itemId: string, kind: StockMovement['kind'], quantity: number, orderId: string | null) {
    const it = items.get(itemId);
    if (!it?.stock) return;
    const s = { ...it.stock };
    if (kind === 'hold') s.held += quantity;
    if (kind === 'release') s.held = Math.max(0, s.held - quantity);
    if (kind === 'sell') {
      s.held = Math.max(0, s.held - quantity);
      s.onHand -= quantity;
    }
    if (kind === 'return' || kind === 'receive') s.onHand += quantity;
    if (kind === 'damage') s.onHand -= quantity;
    s.free = s.onHand - s.held;
    items.set(itemId, { ...it, stock: s });
    movements.unshift({ id: id('mov'), itemId, kind, quantity: ['release', 'sell', 'damage'].includes(kind) ? -quantity : quantity, reason: null, actor: viewer, orderId, reorderId: null, at: now() });
  }
  const stockLines = (rec: OrderRec) => rec.inputs.filter((l): l is Extract<LineInput, { itemId: string }> => l.itemId !== null);

  function newOrder(input: { lines: LineInput[]; customer: string | null }, opts: { by?: string; day?: string; createdAt?: string; moveStock?: boolean } = {}) {
    if (!input.lines.length) refuse('An order needs at least one line', 422, 'invalid');
    const rec: OrderRec = { id: id('ord'), number: ++orderNumber, raisedBy: opts.by ?? viewer, customer: input.customer, businessDate: opts.day ?? TODAY, createdAt: opts.createdAt ?? now(), voided: false, inputs: input.lines, discount: null };
    for (const l of stockLines(rec)) {
      const it = items.get(l.itemId);
      if (!it) refuse('That item isn’t in the catalogue', 422);
      if (opts.moveStock !== false && it!.stock && it!.stock.free < l.quantity) refuse(`Only ${it!.stock.free} ${it!.name} free`, 409, 'out_of_stock');
    }
    orders.set(rec.id, rec);
    if (opts.moveStock !== false) for (const l of stockLines(rec)) moveStock(l.itemId, 'hold', l.quantity, rec.id);
    return rec;
  }

  // ---- Tenders -------------------------------------------------------------------------------------
  const tender = (tenderId: string) => tenders.get(tenderId) ?? refuse('No such payment', 404, 'not_found');
  const publicTender = (t: Tender & Record<string, unknown>): Tender => {
    const { tipStaffId: _a, syncs: _b, applicationFeeCents: _c, ...rest } = t as Tender & { tipStaffId: unknown; syncs: unknown; applicationFeeCents: unknown };
    return rest;
  };
  function step(tenderId: string, event: TenderEvent) {
    const t = tender(tenderId);
    const next = tenderTransition({ method: t.method, status: t.status, amountCents: t.amountCents, tipCents: t.tipCents, refundedCents: t.refundedCents }, event);
    if (!next.ok) return t;
    const before = toOrder(orderRec(t.orderId)).status;
    const updated = { ...t, status: next.state.status, tipCents: next.state.tipCents, refundedCents: next.state.refundedCents };
    tenders.set(t.id, updated);
    settle(t.orderId, before);
    return updated;
  }
  /** Stock follows the order: sold once it's paid, released if it's voided. */
  function settle(orderId: string, before: Order['status']) {
    const rec = orderRec(orderId);
    const after = toOrder(rec).status;
    if (before !== 'paid' && after === 'paid') for (const l of stockLines(rec)) moveStock(l.itemId, 'sell', l.quantity, rec.id);
  }
  function checkNewTender(rec: OrderRec, amountCents: number, method: Tender['method']) {
    const o = toOrder(rec);
    if (o.status === 'voided' || o.status === 'paid' || o.status === 'refunded' || o.status === 'partly_refunded') refuse('That order is closed', 409, 'order_closed');
    if (method === 'card' && !settings.paymentMethods.card) refuse('Cards are off in Settings', 409, 'method_off');
    if (method === 'cash' && !settings.paymentMethods.cash) refuse('Cash is off in Settings', 409, 'method_off');
    if (amountCents > o.remainingCents) refuse(`Only ${o.remainingCents} cents are still owed`, 422, 'over_remaining');
    if (amountCents < o.remainingCents && !settings.paymentMethods.split) refuse('Splitting a payment is off in Settings', 409, 'split_off');
  }
  const openSession = () => [...sessions.values()].find((s) => s.status !== 'closed') ?? null;
  const keyed = new Map<string, string>();
  const replay = (key: string) => {
    const tenderId = keyed.get(key);
    return tenderId ? tenders.get(tenderId) : undefined;
  };
  function addTender(t: Omit<Tender, 'id' | 'createdAt' | 'refundedCents' | 'cardBrand' | 'cardLast4' | 'readerId' | 'clearChargeCode' | 'handedOverCents' | 'changeCents'> & Partial<Tender>, key: string, tipStaffId: string | null) {
    const full = { cardBrand: null, cardLast4: null, readerId: null, clearChargeCode: null, handedOverCents: null, changeCents: null, refundedCents: 0, createdAt: now(), ...t, id: id('tnd'), tipStaffId, syncs: 0, applicationFeeCents: 0 } as Tender & { tipStaffId: string | null; syncs: number; applicationFeeCents: number };
    tenders.set(full.id, full);
    keyed.set(key, full.id);
    return full;
  }

  // ---- The drawer ----------------------------------------------------------------------------------
  function expectedCash(sessionId: string) {
    const s = sessions.get(sessionId)!;
    const cash = [...tenders.values()].filter((t) => t.method === 'cash' && orders.get(t.orderId)?.businessDate === s.businessDate);
    const inCash = cash.reduce((sum, t) => sum + t.amountCents + t.tipCents - t.refundedCents, 0);
    return s.startingCashCents + inCash;
  }
  function countsView(sessionId: string, as: string): CountsView {
    const live = counts.get(sessionId) ?? [];
    const first = live.find((c) => !c.second);
    const second = live.find((c) => c.second);
    if (!first && !second) return { state: 'awaiting_first' };
    const needTwo = settings.twoCounts;
    if (needTwo && !(first && second)) return { state: 'awaiting_second', mine: live.find((c) => c.counter === as) ?? null };
    const expected = expectedCash(sessionId);
    if (first && second && first.totalCents !== second.totalCents) return { state: 'disagree', counts: [first, second] };
    const counted = (first ?? second)!.totalCents;
    const difference = counted - expected;
    return {
      state: 'compared',
      counts: first && second ? [first, second] : [(first ?? second)!],
      expectedCents: expected,
      differenceCents: difference,
      countsAgree: true,
      signoffNeeded: difference !== 0 && !signoffs.has(sessionId),
    };
  }
  const session = (sessionId: string) => sessions.get(sessionId) ?? refuse('No such drawer', 404, 'not_found');

  // ---- Seeding: the reference day, then the chosen drawer state -------------------------------------
  function seedDay() {
    for (const o of seed.ORDERS) {
      const rec = newOrder({ lines: o.lines, customer: o.customer }, { by: o.by, day: o.day, createdAt: seed.at(o.day, o.time), moveStock: false });
      const total = toOrder(rec).totalCents;
      const base = { orderId: rec.id, amountCents: total, createdAt: seed.at(o.day, o.time) };
      if (o.tender.method === 'clear') addTender({ ...base, method: 'clear', tipCents: 0, status: o.tender.status, clearChargeCode: o.tender.code }, id('seed'), o.by);
      if (o.tender.method === 'cash') addTender({ ...base, method: 'cash', tipCents: o.tender.tipCents, status: 'approved', handedOverCents: total + o.tender.tipCents, changeCents: 0 }, id('seed'), o.tender.tipBy ?? o.by);
      if (o.tender.method === 'card') {
        const t = addTender({ ...base, method: 'card', tipCents: o.tender.tipCents, status: switches.drawer === 'closed' ? 'captured' : 'authorised', cardBrand: o.tender.brand, cardLast4: o.tender.last4, readerId: 'rdr_front' }, id('seed'), o.by);
        t.applicationFeeCents = clearCardFee(total + o.tender.tipCents, shop.cardPlan);
      }
    }
    orderNumber = seed.ORDERS.length;
    if (switches.drawer === 'none') return finishSeed();
    const s: DrawerSession = { id: 'drw_reference', shop: shop.id, businessDate: TODAY, openedBy: seed.STAFF_ID.jen, startingCashCents: seed.DRAWER.startingCashCents, openedAt: seed.at(TODAY, '08:00'), closedAt: null, status: 'open' };
    sessions.set(s.id, s);
    const count = (counter: string, totalCents: number, second: boolean, time: string): OwnCount => ({ id: id('cnt'), counter, method: 'total', notes: null, totalCents, second, savedAt: seed.at(TODAY, time) });
    const expected = expectedCash(s.id);
    if (switches.drawer === 'balanced') counts.set(s.id, [count(seed.STAFF_ID.luis, expected, false, '17:30'), count(seed.STAFF_ID.mike, expected, true, '17:34')]);
    if (switches.drawer === 'short' || switches.drawer === 'closed') counts.set(s.id, [count(seed.STAFF_ID.luis, seed.DRAWER.countedCents, false, '17:30'), count(seed.STAFF_ID.mike, seed.DRAWER.countedCents, true, '17:34')]);
    if (switches.drawer === 'disagree') counts.set(s.id, [count(seed.STAFF_ID.luis, seed.DRAWER.countedCents, false, '17:30'), count(seed.STAFF_ID.mike, expected, true, '17:34')]);
    if (switches.drawer !== 'open') sessions.set(s.id, { ...s, status: 'counting' });
    if (switches.drawer === 'closed') {
      signoffs.set(s.id, seed.STAFF_ID.mike);
      const result = closeReport(s.id, seed.STAFF_ID.mike, seed.at(TODAY, '17:45'));
      reports.set(s.id, result);
    }
    finishSeed();
  }
  function finishSeed() {
    cardDeposits.push({ id: 'po_mock_0923', shop: shop.id, externalPayoutId: 'po_mock_0923', arrivalDate: seed.CARD_DEPOSIT.arrivalDate, grossCents: seed.CARD_DEPOSIT.grossCents, processorFeeCents: seed.CARD_DEPOSIT.processorFeeCents, clearFeeCents: seed.CARD_DEPOSIT.clearFeeCents, netCents: seed.CARD_DEPOSIT.grossCents - seed.CARD_DEPOSIT.processorFeeCents - seed.CARD_DEPOSIT.clearFeeCents, chargeCount: 1, status: 'in_transit' });
  }

  function closeReport(sessionId: string, closedBy: string, closedAt: string): DayReport {
    const s = sessions.get(sessionId)!;
    const view = countsView(sessionId, closedBy);
    if (view.state !== 'compared') refuse('Count the drawer first (two counts, blind)', 409, 'counts_needed');
    const v = view as Extract<CountsView, { state: 'compared' }>;
    const dayOrders = [...orders.values()].filter((o) => o.businessDate === s.businessDate && !o.voided).map(toOrder);
    const dayTenders = [...tenders.values()].filter((t) => dayOrders.some((o) => o.id === t.orderId) && ['approved', 'captured', 'authorised', 'partly_refunded', 'refunded'].includes(t.status));
    const byMethod: DayReport['byMethod'] = { card: { count: 0, cents: 0 }, cash: { count: 0, cents: 0 }, clear: { count: 0, cents: 0 } };
    for (const t of dayTenders) {
      const m = byMethod[t.method];
      m.count += 1;
      m.cents += t.amountCents + t.tipCents;
    }
    const tipsByStaff = dayTenders.filter((t) => t.tipCents > 0).map((t) => ({ staffId: t.tipStaffId ?? seed.STAFF_ID.jen, cents: t.tipCents, how: (t.method === 'cash' ? 'cash' : 'card') as 'cash' | 'card' }));
    const cashTips = tipsByStaff.filter((x) => x.how === 'cash').reduce((sum, x) => sum + x.cents, 0);
    const counted = v.counts[0].totalCents;
    const leave = Math.min(counted, settings.startingCashCents);
    const toBank = Math.max(0, counted - leave - cashTips);
    const report: DayReport = {
      id: `rpt_${sessionId}`,
      shop: shop.id,
      businessDate: s.businessDate,
      takenCents: dayTenders.reduce((sum, t) => sum + t.amountCents + t.tipCents, 0),
      byMethod,
      tipsCents: tipsByStaff.reduce((sum, x) => sum + x.cents, 0),
      tipsByStaff,
      taxCents: dayOrders.reduce((sum, o) => sum + o.taxCents, 0),
      discountsCents: dayOrders.reduce((sum, o) => sum + o.discountCents, 0),
      refundsCents: [...refunds.values()].filter((r) => r.status === 'succeeded' && dayTenders.some((t) => t.id === r.tenderId)).reduce((sum, r) => sum + r.amountCents, 0),
      drawer: { startingCashCents: s.startingCashCents, expectedCents: v.expectedCents, countedCents: counted, differenceCents: v.differenceCents, leaveCents: leave, toBankCents: toBank, signedOffBy: signoffs.get(sessionId) ?? null },
      closedBy,
      closedAt,
    };
    for (const t of dayTenders.filter((x) => x.method === 'card' && x.status === 'authorised')) tenders.set(t.id, { ...t, status: 'captured' });
    sessions.set(sessionId, { ...s, status: 'closed', closedAt });
    if (toBank > 0) deposits.push({ id: `dep_${sessionId}`, sessionId, amountCents: toBank, markedBy: null, markedAt: null });
    return report;
  }

  seedDay();

  // ---- The API -------------------------------------------------------------------------------------
  const wait = () => new Promise((r) => setTimeout(r, switches.delayMs));
  const api: MerchantApi = {
    shop: async () => shop,
    updateShop: async (patch) => {
      if (who(viewer)?.role !== 'owner') refuse('Only the owner changes the shop', 403);
      const { listing, ...rest } = patch as Partial<typeof shop> & { listing?: Partial<typeof shop.listing> };
      shop = { ...shop, ...rest, listing: { ...shop.listing, ...(listing ?? {}) } };
      return shop;
    },
    hours: async () => hours,
    saveHours: async (h) => {
      if (who(viewer)?.role !== 'owner') refuse('Only the owner changes the hours', 403);
      if (h.week.some((w) => w.open && w.open.to <= w.open.from)) refuse('It closes after it opens', 422, 'invalid');
      hours = { week: h.week.map((w) => ({ ...w })), dates: h.dates.map((d) => ({ ...d, label: d.label.trim() })) };
      return hours;
    },
    settings: async () => settings,
    updateSettings: async (patch) => {
      if (who(viewer)?.role !== 'owner') refuse('Only the owner changes settings', 403);
      settings = { ...settings, ...(patch as Partial<ShopSettings>), updatedAt: now() };
      return settings;
    },
    staff: async () => seed.STAFF,

    // ---- Shifts and hours (the reference's Tuesday: the week of Sep 21)
    shifts: async () => [...shifts.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(shiftNow),
    startBreak: async () => {
      const s = shifts.get(viewer) ?? refuse('You are not on shift', 409, 'not_on_shift');
      if (s.breakFrom) refuse('You are already on a break', 409, 'on_break');
      s.breakFrom = now();
      return shiftNow(s);
    },
    endBreak: async () => {
      const s = shifts.get(viewer) ?? refuse('You are not on shift', 409, 'not_on_shift');
      if (!s.breakFrom) refuse('You are not on a break', 409, 'not_on_break');
      s.breakMinutes += Math.floor((Date.now() - new Date(s.breakFrom!).getTime()) / 60000);
      s.breakFrom = null;
      return shiftNow(s);
    },
    endShift: async (staffId) => {
      if (!mayManage(staffId)) refuse('Only the owner ends a manager’s shift', 403, 'forbidden');
      shifts.delete(staffId);
    },
    staffWeek: async (): Promise<StaffWeek> => {
      const dates = Array.from({ length: 7 }, (_, i) => `2026-09-${String(21 + i).padStart(2, '0')}`);
      const staff = seed.STAFF.filter((s) => s.active && !removed.has(s.id));
      const plan = (sid: string) => staffHours.get(sid)?.thisWeek ?? staffHours.get(sid)?.usual ?? null;
      return {
        weekOf: dates[0]!,
        today: TODAY,
        days: dates.map((date, i) => ({ date, open: hours.dates.find((d) => d.date === date)?.open ?? (hours.dates.some((d) => d.date === date) ? null : hours.week[i]!.open) })),
        booked: Object.fromEntries(staff.filter((s) => plan(s.id)).map((s) => [s.id, dates.map((_, i) => plan(s.id)!.days.find((d) => d.day === i)?.open ?? null)])),
        usual: Object.fromEntries(staff.map((s) => [s.id, staffHours.get(s.id)?.usual ?? null])),
        lastShift: Object.fromEntries(staff.map((s) => [s.id, shifts.get(s.id)?.startedAt ?? null])),
      };
    },
    staffHours: async (staffId): Promise<PersonHours> => {
      if (staffId !== viewer && !isManager(viewer)) refuse('that needs a manager', 403, 'forbidden');
      return personHours(staffId);
    },
    saveStaffHours: async (staffId, input): Promise<PersonHours> => {
      if (!mayManage(staffId)) refuse('Only the owner sets a manager’s hours', 403, 'forbidden');
      if (new Set(input.hours.days.map((d) => d.day)).size !== input.hours.days.length) refuse('Each day once', 422, 'invalid');
      if (input.hours.days.some((d) => d.open.to <= d.open.from)) refuse('It closes after it opens', 422, 'invalid');
      const h = staffHours.get(staffId) ?? { usual: null, next: null, thisWeek: null };
      const days = { days: [...input.hours.days].sort((a, b) => a.day - b.day) };
      if (input.once) h.thisWeek = days;
      else if (!h.usual) h.usual = days;
      else h.next = days;
      staffHours.set(staffId, h);
      return personHours(staffId);
    },
    taxStatus: async () => ({ source: 'address_rate', stripe: switches.stripe === 'connected' ? 'setup_needed' : 'not_connected', rates: { goods: '7.75', labour: null, food: '7.75' }, pricesIncludeTax: settings.tax.pricesIncludeTax }),

    cardAvailability: async (): Promise<CardAvailability> => (switches.stripe === 'connected' ? { available: true } : { available: false, reason: 'not_connected' }),
    connectCards: async () => {
      if (who(viewer)?.role !== 'owner') refuse('Only the owner connects card processing', 403);
      return { url: 'https://connect.stripe.com/setup/mock' };
    },
    connectionToken: async () => {
      if (switches.stripe !== 'connected') refuse('This shop is not set up to take cards', 409, 'cards_unavailable');
      return { secret: 'pst_test_mock', locationId: 'tml_mock' };
    },
    readers: async () => (switches.stripe === 'connected' ? readers : []),
    registerSmartReader: async (input) => {
      const r: Reader = { id: id('rdr'), shop: shop.id, provider: 'stripe', type: 'smart', externalReaderId: `tmr_${input.registrationCode}`, label: input.label, locationId: 'tml_mock', lastSeenAt: now() };
      readers.push(r);
      return r;
    },
    recordReader: async (input) => {
      const existing = readers.find((r) => r.externalReaderId === input.externalReaderId);
      if (existing) return existing;
      const r: Reader = { id: id('rdr'), shop: shop.id, provider: 'stripe', type: input.type, externalReaderId: input.externalReaderId, label: input.label, locationId: 'tml_mock', lastSeenAt: now() };
      readers.push(r);
      return r;
    },

    catalog: async () => [...items.values()].filter((i) => !i.archivedAt),
    createItem: async (input) => {
      const it: CatalogItem = { id: id('itm'), shop: shop.id, name: input.name, detail: input.detail, category: input.category, priceCents: input.priceCents, costCents: input.costCents, taxKind: input.taxKind, stockTracked: input.stockTracked, stock: input.stockTracked ? { onHand: 0, held: 0, free: 0 } : null, reorderAt: input.reorderAt, optionGroups: [], archivedAt: null };
      items.set(it.id, it);
      return it;
    },
    updateItem: async (itemId, input) => {
      const it = items.get(itemId) ?? refuse('No such item', 404);
      const next = { ...it!, ...(input as Partial<CatalogItem>) };
      items.set(itemId, next);
      return next;
    },
    archiveItem: async (itemId) => {
      const it = items.get(itemId) ?? refuse('No such item', 404);
      const next = { ...it!, archivedAt: now() };
      items.set(itemId, next);
      return next;
    },
    saveOptionGroups: async (itemId, groups) => {
      const it = items.get(itemId) ?? refuse('No such item', 404);
      const next = { ...it!, optionGroups: groups.map((g, gi) => ({ ...g, id: id('grp'), position: g.position ?? gi, options: g.options.map((o) => ({ ...o, id: o.id && !o.id.startsWith('new') ? o.id : id('opt') })) })) };
      items.set(itemId, next);
      return next;
    },
    adjustStock: async (input) => {
      const it = items.get(input.itemId) ?? refuse('No such item', 404);
      if (!it!.stock) refuse('That item keeps no stock', 422);
      if (input.kind === 'count') {
        // A count sets the shelf to what was found; the movement records the difference.
        const delta = input.found - it!.stock!.onHand;
        const s = it!.stock!;
        items.set(input.itemId, { ...it!, stock: { onHand: input.found, held: s.held, free: input.found - s.held } });
        movements.unshift({ id: id('mov'), itemId: input.itemId, kind: 'count', quantity: delta, reason: input.reason, actor: viewer, orderId: null, reorderId: null, at: now() });
      } else moveStock(input.itemId, input.kind, input.quantity, null);
      return items.get(input.itemId)!;
    },
    stockHistory: async (itemId) => movements.filter((m) => m.itemId === itemId).map(({ itemId: _i, ...m }) => m),
    reorders: async () => [...reorders.values()],
    markReordered: async (input) => {
      const r: Reorder = { id: id('reo'), itemId: input.itemId, quantity: input.quantity, supplier: input.supplier, expectedOn: input.expectedOn, receivedQuantity: 0, status: 'open' };
      reorders.set(r.id, r);
      return r;
    },
    receiveReorder: async (reorderId, input) => {
      const r = reorders.get(reorderId) ?? refuse('No such reorder', 404);
      const received = r!.receivedQuantity + input.quantity;
      const next: Reorder = { ...r!, receivedQuantity: received, status: received >= r!.quantity ? 'received' : 'partly_received' };
      reorders.set(reorderId, next);
      moveStock(r!.itemId, 'receive', input.quantity, null);
      return next;
    },
    discountCodes: async () => [...codes.values()],
    createDiscountCode: async (input) => {
      const c: DiscountCode = { ...input, id: id('dsc'), uses: 0 };
      codes.set(c.id, c);
      return c;
    },

    createOrder: async (input) => {
      const rec = newOrder(input);
      log('order.raised', { ref: { type: 'order', id: rec.id } });
      return toOrder(rec);
    },
    updateOrder: async (orderId, input) => {
      const rec = orderRec(orderId);
      editable(rec);
      for (const l of stockLines(rec)) moveStock(l.itemId, 'release', l.quantity, rec.id);
      rec.inputs = input.lines;
      for (const l of stockLines(rec)) moveStock(l.itemId, 'hold', l.quantity, rec.id);
      return toOrder(rec);
    },
    order: async (orderId) => toOrder(orderRec(orderId)),
    orders: async ({ date }) => [...orders.values()].filter((o) => o.businessDate === date).map(toOrder).sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1)),
    orderHistory: async ({ from, to }) =>
      [...orders.values()]
        .filter((o) => o.businessDate >= from && o.businessDate <= to)
        .sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1))
        .map((o) => ({ ...toOrder(o), tenders: [...tenders.values()].filter((t) => t.orderId === o.id).map(publicTender) })),
    applyDiscount: async (orderId, input) => {
      const rec = orderRec(orderId);
      editable(rec);
      if (input.kind === 'code') {
        const code = [...codes.values()].find((c) => c.code.toUpperCase() === input.code.trim().toUpperCase());
        if (!code) refuse(`${input.code} isn’t a code here`, 422, 'code_unknown');
        rec.discount = { kind: 'code', codeId: code!.id, label: code!.percent ? `${code!.code} · ${code!.percent}% off` : code!.code, amountCents: 0, reason: null, approvedBy: null, percent: code!.percent, fixedCents: code!.amountCents };
      } else {
        const role = who(viewer)?.role ?? 'counter';
        const subtotal = toOrder({ ...rec, discount: null }).subtotalCents;
        const pct = input.percent ?? Math.ceil(((input.amountCents ?? 0) * 100) / Math.max(1, subtotal));
        const limit = settings.discountLimits[role as 'counter' | 'manager' | 'owner'];
        let approvedBy: string | null = null;
        if (limit !== null && pct > limit) {
          const approver = pinOf(input.approverPin);
          if (!input.approverPin) refuse('That’s more than you can give. A manager or owner can approve it with their PIN.', 403, 'needs_approval');
          if (!approver || approver === viewer || !isManager(approver)) refuse('That PIN isn’t a manager’s or owner’s', 403, 'approver_invalid');
          approvedBy = approver;
        }
        rec.discount = { kind: 'manual', codeId: null, label: input.percent !== null ? `${input.percent}% · ${input.reason}` : `$${((input.amountCents ?? 0) / 100).toFixed(2)} · ${input.reason}`, amountCents: 0, reason: input.reason, approvedBy, percent: input.percent, fixedCents: input.amountCents };
      }
      return toOrder(rec);
    },
    removeDiscount: async (orderId) => {
      const rec = orderRec(orderId);
      editable(rec);
      rec.discount = null;
      return toOrder(rec);
    },
    voidOrder: async (orderId, input) => {
      const rec = orderRec(orderId);
      const approver = pinOf(input.pin);
      if (!approver || !isManager(approver)) refuse('Voiding needs a manager’s or owner’s PIN', 403, 'approver_invalid');
      const ts = [...tenders.values()].filter((t) => t.orderId === rec.id);
      const o = toOrder(rec);
      const verdict = canVoidOrder({ totalCents: o.totalCents, voided: rec.voided }, ts);
      if (!verdict.ok) refuse(verdict.reason, 409, 'not_voidable');
      for (const t of ts) {
        if (t.status === 'pending' || t.status === 'authorised') step(t.id, { type: 'cancel' });
        if (t.method === 'cash' && t.status === 'approved') step(t.id, { type: 'refund', cents: t.amountCents + t.tipCents });
      }
      rec.voided = true;
      for (const l of stockLines(rec)) moveStock(l.itemId, o.status === 'paid' ? 'return' : 'release', l.quantity, rec.id);
      log('order.voided', { approver, ref: { type: 'order', id: rec.id }, amountCents: o.totalCents });
      return toOrder(rec);
    },

    discardOrder: async (orderId) => {
      const rec = orderRec(orderId);
      if (rec.voided) return toOrder(rec);
      const ts = [...tenders.values()].filter((t) => t.orderId === rec.id);
      if (ts.some((t) => t.status !== 'declined' && t.status !== 'cancelled')) refuse('A payment has started on it, so it’s voided (with a manager’s PIN) or refunded instead', 409, 'not_voidable');
      rec.voided = true;
      for (const l of stockLines(rec)) moveStock(l.itemId, 'release', l.quantity, rec.id);
      log('order.discarded', { ref: { type: 'order', id: rec.id } });
      return toOrder(rec);
    },
    tenders: async (orderId) => [...tenders.values()].filter((t) => t.orderId === orderId).map(publicTender),
    createCardTender: async (orderId, input) => {
      const again = replay(input.idempotencyKey);
      if (again) return { tenderId: again.id, clientSecret: `${again.id}_secret`, offlineLimitCents: null };
      if (switches.stripe !== 'connected') refuse('This shop is not set up to take cards', 409, 'cards_unavailable');
      const rec = orderRec(orderId);
      checkNewTender(rec, input.amountCents, 'card');
      if (!readers.some((r) => r.id === input.readerId)) refuse('That reader isn’t one of this shop’s', 422, 'reader_unknown');
      const before = toOrder(rec).status;
      const t = addTender({ orderId, method: 'card', amountCents: input.amountCents, tipCents: input.tipCents, status: 'pending', readerId: input.readerId }, input.idempotencyKey, rec.raisedBy);
      settle(orderId, before);
      return { tenderId: t.id, clientSecret: `${t.id}_secret`, offlineLimitCents: settings.offlineCards.enabled ? settings.offlineCards.limitCents : null };
    },
    presentTender: async (tenderId) => publicTender(tender(tenderId)),
    syncTender: async (tenderId) => {
      const t = tender(tenderId);
      if (t.method === 'card' && t.status === 'pending') {
        // The customer taps on the reader: approved, or declined, as the switch says.
        const next = switches.card === 'approve' ? step(t.id, { type: 'authorise' }) : step(t.id, { type: 'decline' });
        if (next.status === 'authorised') tenders.set(t.id, { ...tender(t.id), cardBrand: 'visa', cardLast4: '4242' });
      }
      if (t.method === 'clear' && t.status === 'pending') {
        const synced = { ...t, syncs: t.syncs + 1 };
        tenders.set(t.id, synced);
        // The member answers on the second look, unless the switch says they're still thinking.
        if (synced.syncs >= 2 && switches.clear !== 'wait') step(t.id, { type: switches.clear === 'approve' ? 'approve' : 'decline' });
      }
      return publicTender(tender(tenderId));
    },
    cancelTender: async (tenderId) => {
      const t = tender(tenderId);
      if (t.status === 'captured') refuse('A captured card is refunded, not voided', 409, 'wrong_state');
      return publicTender(step(t.id, { type: 'cancel' }));
    },
    adjustTip: async (tenderId, input) => {
      const t = tender(tenderId);
      if (t.status !== 'authorised') refuse('A tip changes only on an authorised card, before the day is closed', 409, 'wrong_state');
      return publicTender(step(t.id, { type: 'adjust_tip', tipCents: input.tipCents }));
    },
    createCashTender: async (orderId, input) => {
      const again = replay(input.idempotencyKey);
      if (again) return publicTender(again);
      const rec = orderRec(orderId);
      if (!openSession()) refuse('Open the drawer to take cash', 409, 'drawer_closed');
      const change = input.handedOverCents - input.amountCents - input.tipCents;
      if (change < 0) refuse(`That’s ${-change} cents short`, 422, 'short');
      checkNewTender(rec, input.amountCents, 'cash');
      const before = toOrder(rec).status;
      const t = addTender({ orderId, method: 'cash', amountCents: input.amountCents, tipCents: input.tipCents, status: 'approved', handedOverCents: input.handedOverCents, changeCents: change }, input.idempotencyKey, rec.raisedBy);
      settle(orderId, before);
      log('tender.cash_taken', { ref: { type: 'tender', id: t.id }, amountCents: input.amountCents + input.tipCents });
      return publicTender(t);
    },
    createClearTender: async (orderId, input) => {
      const again = replay(input.idempotencyKey);
      if (again) return publicTender(again);
      const rec = orderRec(orderId);
      checkNewTender(rec, input.amountCents, 'clear');
      const before = toOrder(rec).status;
      const t = addTender({ orderId, method: 'clear', amountCents: input.amountCents, tipCents: input.tipCents, status: 'pending', clearChargeCode: `CLR-${String(n).slice(-4)}` }, input.idempotencyKey, rec.raisedBy);
      settle(orderId, before);
      return publicTender(t);
    },
    sendReceipt: async () => undefined,
    receipt: async (orderId): Promise<Receipt> => {
      const o = toOrder(orderRec(orderId));
      const ts = [...tenders.values()].filter((t) => t.orderId === orderId);
      return {
        shop: { name: shop.name, address: shop.address ? `${shop.address.line1}, ${shop.address.city}, ${shop.address.region} ${shop.address.postalCode}` : null },
        orderNumber: o.number,
        businessDate: o.businessDate,
        issuedAt: now(),
        lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity, options: l.options.map((x) => x.name), note: l.note, lineCents: l.lineCents, discountCents: l.discountCents })),
        discount: o.discount ? { label: o.discount.label, amountCents: o.discountCents } : null,
        subtotalCents: o.subtotalCents,
        discountCents: o.discountCents,
        taxCents: o.taxCents,
        taxIncluded: o.taxIncluded,
        tipCents: o.tipCents,
        totalCents: o.totalCents + o.tipCents,
        tenders: ts.map((t) => ({ method: t.method, amountCents: t.amountCents, tipCents: t.tipCents, card: t.cardLast4 ? `${t.cardBrand ?? 'Card'} ••${t.cardLast4}` : null, changeCents: t.changeCents, status: t.status })),
        refundedCents: ts.reduce((s, t) => s + t.refundedCents, 0),
      };
    },

    requestRefund: async (input) => {
      const t = tender(input.tenderId);
      if (t.method === 'clear') refuse('A Clear payment is refunded through the Clear refund flow', 409, 'clear_flow');
      const left = t.amountCents + t.tipCents - t.refundedCents;
      if (input.amountCents > left) refuse(`Only ${left} cents can still be refunded on this payment`, 422, 'over_amount');
      const r: Refund = { id: id('rfd'), tenderId: t.id, amountCents: input.amountCents, items: input.items, reason: input.reason, requestedBy: viewer, approvedBy: null, status: 'requested', createdAt: now() };
      refunds.set(r.id, r);
      log('refund.requested', { ref: { type: 'refund', id: r.id }, amountCents: r.amountCents });
      return isManager(viewer) ? api.decideRefund(r.id, { decision: 'approve', pin: null }) : r;
    },
    decideRefund: async (refundId, input) => {
      const r = refunds.get(refundId) ?? refuse('No such refund', 404);
      const approver = isManager(viewer) ? viewer : pinOf(input.pin);
      if (!approver || !isManager(approver)) refuse('A refund is approved by a manager or owner, or with their PIN', 403, 'approver_invalid');
      if (input.decision === 'decline') {
        const declined = { ...r!, status: 'declined' as const, approvedBy: approver };
        refunds.set(refundId, declined);
        return declined;
      }
      step(r!.tenderId, { type: 'refund', cents: r!.amountCents });
      for (const i of r!.items.filter((x) => x.backInStock)) {
        const line = toOrder(orderRec(tender(r!.tenderId).orderId)).lines.find((l) => l.id === i.orderLineId);
        if (line?.itemId) moveStock(line.itemId, 'return', i.quantity, null);
      }
      const done = { ...r!, status: 'succeeded' as const, approvedBy: approver };
      refunds.set(refundId, done);
      log('refund.approved', { approver, ref: { type: 'refund', id: refundId }, amountCents: done.amountCents });
      return done;
    },

    drawer: async () => openSession(),
    openDrawer: async (input) => {
      if (openSession()) refuse('The drawer is already open', 409, 'already_open');
      const s: DrawerSession = { id: id('drw'), shop: shop.id, businessDate: TODAY, openedBy: viewer, startingCashCents: input.startingCashCents ?? settings.startingCashCents, openedAt: now(), closedAt: null, status: 'open' };
      sessions.set(s.id, s);
      return s;
    },
    saveCount: async (sessionId, input) => {
      const s = session(sessionId);
      if (s!.status === 'closed') refuse('This drawer is closed', 409, 'closed');
      const live = counts.get(sessionId) ?? [];
      const first = live.find((c) => !c.second);
      if (first && (live.some((c) => c.second) || !settings.twoCounts)) refuse('The drawer has been counted. If the counts disagree, one of you counts again.', 409, 'both_counted');
      if (first && first.counter === viewer) refuse('The second count is someone else’s', 409, 'someone_else');
      const total = input.method === 'total' ? input.totalCents : Object.entries(input.notes).reduce((sum, [d, q]) => sum + Number(d) * (q ?? 0), 0);
      counts.set(sessionId, [...live, { id: id('cnt'), counter: viewer, method: input.method, notes: input.method === 'notes' ? (input.notes as OwnCount['notes']) : null, totalCents: total, second: Boolean(first), savedAt: now() }]);
      sessions.set(sessionId, { ...s!, status: 'counting' });
      return countsView(sessionId, viewer);
    },
    counts: async (sessionId) => {
      session(sessionId);
      return countsView(sessionId, viewer);
    },
    recount: async (sessionId, input) => {
      const live = counts.get(sessionId) ?? [];
      const target = live.find((c) => c.second === (input.which === 'second'));
      const other = live.find((c) => c.second !== (input.which === 'second'));
      if (!target || !other) refuse('Both counts are needed before one is counted again', 409, 'not_compared');
      if (target!.totalCents === other!.totalCents) refuse('The counts agree; nothing to count again', 422);
      if (target!.counter !== viewer) refuse('Whoever made that count counts again', 409, 'someone_else');
      counts.set(sessionId, live.filter((c) => c !== target));
      return countsView(sessionId, viewer);
    },
    signOff: async (sessionId, input) => {
      const signer = pinOf(input.pin);
      if (!signer || !isManager(signer)) refuse('A difference is signed off by a manager or owner', 403, 'signer_invalid');
      const view = countsView(sessionId, signer!);
      if (view.state === 'disagree') refuse('The counts disagree: one of you counts again first', 409, 'counts_disagree');
      if (view.state !== 'compared') refuse('Both counts come first', 409, 'not_compared');
      if (view.state === 'compared' && view.differenceCents === 0) refuse('The drawer matches; nothing to sign', 409, 'no_difference');
      if (view.state === 'compared' && view.counts[0].counter === signer) refuse('Someone other than the first counter signs it off', 403, 'signer_invalid');
      signoffs.set(sessionId, signer!);
      log('drawer.signed_off', { approver: signer, ref: { type: 'drawer_session', id: sessionId }, amountCents: view.state === 'compared' ? view.differenceCents : null, detail: { note: input.note } });
      return countsView(sessionId, viewer);
    },
    closeDay: async (sessionId): Promise<CloseDayResult> => {
      const existing = reports.get(sessionId);
      if (existing) return { report: existing, captureFailures: [] };
      const view = countsView(sessionId, viewer);
      if (view.state === 'disagree') refuse('The counts disagree: one of you counts again first', 409, 'counts_disagree');
      if (view.state !== 'compared') refuse('Count the drawer first (two counts, blind)', 409, 'counts_needed');
      if (view.state === 'compared' && view.signoffNeeded) refuse(`The drawer is ${view.differenceCents < 0 ? 'short' : 'over'}: a manager or owner signs it off first`, 409, 'unsigned');
      const report = closeReport(sessionId, viewer, now());
      reports.set(sessionId, report);
      log('day.closed', { ref: { type: 'drawer_session', id: sessionId }, amountCents: report.drawer.countedCents });
      return { report, captureFailures: [] };
    },
    bankDeposits: async () => deposits,
    markDeposited: async (depositId) => {
      const i = deposits.findIndex((d) => d.id === depositId);
      if (i < 0) refuse('No such deposit', 404);
      deposits[i] = { ...deposits[i]!, markedBy: viewer, markedAt: now() };
      return deposits[i]!;
    },

    dayReports: async ({ from, to }) => [...reports.values()].filter((r) => r.businessDate >= from && r.businessDate <= to),
    cardDeposits: async ({ from, to }) => cardDeposits.filter((d) => d.arrivalDate >= from && d.arrivalDate <= to),
    overview: async ({ from, to }) => {
      const os = [...orders.values()].filter((o) => o.businessDate >= from && o.businessDate <= to && !o.voided).map(toOrder).filter((o) => ['paid', 'partly_refunded', 'refunded'].includes(o.status));
      const ts = [...tenders.values()].filter((t) => os.some((o) => o.id === t.orderId) && ['approved', 'captured', 'authorised', 'partly_refunded', 'refunded'].includes(t.status));
      const byMethod: DayReport['byMethod'] = { card: { count: 0, cents: 0 }, cash: { count: 0, cents: 0 }, clear: { count: 0, cents: 0 } };
      for (const t of ts) {
        const m = byMethod[t.method];
        m.count += 1;
        m.cents += t.amountCents + t.tipCents;
      }
      const tipBy = new Map<string, { cents: number; cashCents: number }>();
      for (const t of ts.filter((x) => x.tipCents > 0)) {
        const k = t.tipStaffId ?? seed.STAFF_ID.jen;
        const e = tipBy.get(k) ?? { cents: 0, cashCents: 0 };
        tipBy.set(k, { cents: e.cents + t.tipCents, cashCents: e.cashCents + (t.method === 'cash' ? t.tipCents : 0) });
      }
      const top = new Map<string, { itemId: string | null; name: string; quantity: number; cents: number }>();
      for (const o of os) for (const l of o.lines) {
        const k = l.itemId ?? 'quick';
        const e = top.get(k) ?? { itemId: l.itemId, name: l.itemId ? l.name : 'Quick sales', quantity: 0, cents: 0 };
        e.quantity += l.quantity;
        e.cents += l.lineCents;
        top.set(k, e);
      }
      return {
        from,
        to,
        takenCents: ts.reduce((s, t) => s + t.amountCents + t.tipCents, 0),
        orderCount: os.length,
        byMethod,
        discounts: { count: os.filter((o) => o.discountCents > 0).length, cents: os.reduce((s, o) => s + o.discountCents, 0) },
        tips: { cents: [...tipBy.values()].reduce((s, c) => s + c.cents, 0), byStaff: [...tipBy].map(([staffId, t]) => ({ staffId, name: who(staffId)?.name ?? staffId, ...t })) },
        taxCents: os.reduce((s, o) => s + o.taxCents, 0),
        refundsCents: [...refunds.values()].filter((r) => r.status === 'succeeded').reduce((s, r) => s + r.amountCents, 0),
        topItems: [...top.values()].sort((a, b) => b.cents - a.cents).slice(0, 5),
        dayReports: [...reports.values()].filter((r) => r.businessDate >= from && r.businessDate <= to),
      };
    },
    clearFeeBills: async () => [],
    audit: async () => audit,
  };

  // ---- The Clear side (the older client's calls) ----------------------------------------------------
  const clearRefunds = new Map<string, ClearRefund>();
  let refundLimitCents = 50000;
  /** Seeded charges nobody approved in 24 hours: expired, not cancelled at the counter. */
  const expired = new Set(seed.ORDERS.filter((o) => o.tender.method === 'clear' && o.tender.status === 'cancelled').map((o) => (o.tender as { code: string }).code));
  const clearTender = (code: string) => [...tenders.values()].find((t) => t.method === 'clear' && t.clearChargeCode === code) ?? refuse('No such charge', 404, 'not_found');
  const plusMinutes = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();
  function chargeState(t: Tender): ChargeState {
    const r = [...clearRefunds.values()].filter((x) => x.chargeCode === t.clearChargeCode).at(-1);
    if (r?.state === 'requested') return 'refund_requested';
    if (r?.state === 'approved' || r?.state === 'settled') return 'refunded';
    if (r?.state === 'declined') return 'refund_declined';
    if (t.status === 'pending') return 'waiting';
    if (t.status === 'approved') return 'approved';
    if (t.status === 'declined') return 'declined';
    return expired.has(t.clearChargeCode ?? '') ? 'expired' : 'cancelled';
  }
  function toCharge(t: Tender): MerchantCharge {
    const rec = orderRec(t.orderId);
    const code = t.clearChargeCode!;
    const amountCents = t.amountCents + t.tipCents;
    const state = chargeState(t);
    // How the member chose to pay, once they have: the reference's for the seeded charges.
    const splitInto = state === 'waiting' ? null : (seed.CLEAR_SPLITS[code] ?? 4);
    const bps = splitInto && splitInto > 1 ? shop.clearTier.overTimeBps : shop.clearTier.paidNowBps;
    const staffer = who(rec.raisedBy);
    return {
      code,
      amount: amountCents / 100,
      // Payout figures are owner-only on the server; a counter shift gets none.
      ...(seesMoney(who(viewer)?.role ?? 'counter') ? { payout: Math.round(amountCents * (1 - bps / 10000)) / 100 } : {}),
      state,
      splitInto,
      memberName: rec.customer,
      raisedBy: staffer?.name ?? null,
      raisedByStaffId: rec.raisedBy,
      createdAt: t.createdAt,
      expiresAt: plusMinutes(t.createdAt, 24 * 60),
      openedAt: seed.CLEAR_OPENED.has(code) || state !== 'waiting' ? plusMinutes(t.createdAt, 1) : null,
      resolvedAt: state === 'waiting' ? null : plusMinutes(t.createdAt, 3),
    };
  }
  const refund = (refundId: string) => clearRefunds.get(refundId) ?? refuse('No such refund', 404, 'not_found');
  function staffTarget(staffId: string) {
    const target = who(staffId);
    const me = who(viewer);
    if (!target || removed.has(staffId)) refuse('No such person at this shop.', 404, 'not_found');
    if (staffId === viewer) refuse('Someone else does this for you.', 403, 'forbidden');
    if (!(target!.role !== 'owner' && (me?.role === 'owner' || (me?.role === 'manager' && target!.role === 'counter')))) refuse('That needs the owner.', 403, 'forbidden');
    return target!;
  }
  const owedCents = seed.POSITION.owedCents;

  const devices: EnrolledDevice[] = [
    { id: 'preview', label: 'Counter tablet', idleLockSeconds: 300, enrolledAt: '2026-08-04T16:20:00.000Z', revokedAt: null, enrolledByName: 'Mike R.' },
  ];
  const device = (deviceId: string) => devices.find((x) => x.id === deviceId) ?? refuse('That tablet is not enrolled here', 404, 'not_found');
  const clear: ClearSide = {
    charges: async (opts = {}) =>
      [...tenders.values()]
        .filter((t) => t.method === 'clear' && t.clearChargeCode && (!opts.since || t.createdAt >= opts.since))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, opts.limit ?? 200)
        .map(toCharge),
    cancelCharge: async (code) => {
      const t = clearTender(code);
      if (t.status !== 'pending') refuse('Only a charge still waiting can be cancelled', 409, 'not_cancellable');
      step(t.id, { type: 'cancel' });
    },
    openRefundFor: async (code) => [...clearRefunds.values()].find((r) => r.chargeCode === code && r.state === 'requested') ?? null,
    requestRefund: async (input) => {
      const t = clearTender(input.chargeCode);
      if (chargeState(t) !== 'approved') refuse('Only a confirmed charge can be refunded', 409, 'not_refundable');
      const amount = (t.amountCents + t.tipCents) / 100;
      const q = refundQuote({ amount, splitInto: input.splitInto, ratePerCycle: input.ratePerCycle, cyclesCleared: input.cyclesCleared, discountRate: input.discountRate, nextPayout: input.nextPayoutCents / 100 });
      const r: ClearRefund = {
        id: id('rfd'),
        chargeCode: input.chargeCode,
        amountCents: Math.round(amount * 100),
        memberCents: Math.round(q.memberReceives * 100),
        carryKeptCents: Math.round(q.carryKept * 100),
        clawbackCents: Math.round(q.merchantClawback * 100),
        state: 'requested',
        requestedByName: who(viewer)?.name ?? 'Someone',
        decidedByName: null,
        requestedAt: now(),
        decidedAt: null,
        decidedVia: null,
      };
      clearRefunds.set(r.id, r);
      return r;
    },
    checkOwnerCode: async (code) => {
      const s = who(pinOf(code) ?? '');
      if (!s || !isManager(s.id)) refuse('That PIN was not recognised.', 401, 'bad_code');
      return { id: s!.id, name: s!.name, role: s!.role };
    },
    authoriseRefund: async (refundId, code, decision) => {
      const r = refund(refundId);
      const s = who(pinOf(code) ?? '');
      if (!s || !isManager(s.id)) refuse('That PIN was not recognised.', 401, 'bad_code');
      // The code path is bounded: at or over the limit it needs the owner's own device.
      if (decision === 'approve' && !(refundLimitCents > 0 && r.amountCents < refundLimitCents)) refuse('Over the limit a PIN can clear. The owner approves this on their own phone.', 403, 'over_limit');
      const next: ClearRefund = { ...r, state: decision === 'approve' ? 'approved' : 'declined', decidedByName: s!.name, decidedAt: now(), decidedVia: 'owner_code' };
      clearRefunds.set(r.id, next);
      return next;
    },
    decideRefund: async (refundId, decision) => {
      const r = refund(refundId);
      const me = who(viewer);
      if (me?.role !== 'owner' && !(me?.role === 'manager' && r.amountCents < refundLimitCents)) refuse('Only the owner can decide this refund', 403, 'forbidden');
      const next: ClearRefund = { ...r, state: decision === 'approve' ? 'approved' : 'declined', decidedByName: me!.name, decidedAt: now(), decidedVia: 'owner_device' };
      clearRefunds.set(r.id, next);
      return next;
    },
    withdrawRefund: async (refundId) => {
      if (refund(refundId).state !== 'requested') refuse('That refund has been decided', 409, 'decided');
      clearRefunds.delete(refundId);
    },
    refundThreshold: async () => ({ limitCents: refundLimitCents, maxCents: null }),
    setRefundThreshold: async (limitCents) => {
      if (who(viewer)?.role !== 'owner') refuse('Only the owner sets the limit', 403, 'forbidden');
      refundLimitCents = limitCents;
      return { limitCents };
    },
    payouts: async (): Promise<PayoutPosition> => {
      if (!seesMoney(who(viewer)?.role ?? 'counter')) refuse('Payouts are for an owner or a manager', 403, 'forbidden');
      return { ...seed.POSITION, owedCents, paid: seed.POSITION.paid.map((x) => ({ ...x })) };
    },
    staff: async (): Promise<StaffMember[]> =>
      seed.STAFF.map((s) => ({ ...s, active: s.active && !removed.has(s.id), pinSet: pins.has(s.id), chargesThisMonth: seed.CHARGES_THIS_MONTH[s.id] ?? 0 })),
    roster: async () =>
      seed.STAFF.filter((s) => s.active && !removed.has(s.id)).map(({ id: staffId, name, role }) => ({ id: staffId, name, role, pinSet: pins.has(staffId) })),
    // The server's rules (routes/merchant.ts, staffTarget): a manager resets or removes counter
    // staff, an owner counter staff and managers; never an owner, never yourself.
    resetPin: async (staffId, approverPin) => {
      const target = staffTarget(staffId);
      if (pins.get(viewer) !== approverPin) refuse('That did not match.', 401, 'bad_pin');
      pins.delete(target.id);
    },
    removeStaff: async (staffId) => {
      removed.add(staffTarget(staffId).id);
      shifts.delete(staffId);
    },
    profile: async (): Promise<MerchantProfile> => {
      const owner = who(viewer)?.role === 'owner';
      return { ...seed.PROFILE, name: shop.name, ...(owner ? seed.PROFILE_OWNER : {}) };
    },
    // End shift: signing out ends the viewer's shift, as DELETE /session does.
    signOut: async () => {
      shifts.delete(viewer);
    },
    // The shop's tablets: this one is the preview's "Counter tablet" (auth/AuthProvider.tsx).
    devices: async () => {
      if (who(viewer)?.role !== 'owner') refuse('Only the owner sees the tablets', 403, 'forbidden');
      return devices.map((x) => ({ ...x }));
    },
    currentDevice: async () => ({ merchant: '0x0000000000000000000000000000000000000000', device: { ...device('preview') } }),
    renameDevice: async (deviceId, label) => {
      if (who(viewer)?.role !== 'owner') refuse('Only the owner renames a tablet', 403, 'forbidden');
      device(deviceId).label = label;
    },
    setIdleLock: async (deviceId, seconds) => {
      if (who(viewer)?.role !== 'owner') refuse('Only the owner sets the lock', 403, 'forbidden');
      if (seconds < 60 || seconds > 3600) refuse('Between a minute and an hour', 400, 'validation');
      device(deviceId).idleLockSeconds = seconds;
    },
  };

  // Every call waits, and can be made to fail once, so loading and error states can be seen.
  const wrap = <T extends object>(methods: T): T =>
    Object.fromEntries(
      Object.entries(methods).map(([name, fn]) => [
        name,
        async (...args: unknown[]) => {
          await wait();
          if (failNext && failNext.method === name) {
            const f = failNext;
            failNext = null;
            throw new MockApiError(f.message, f.status);
          }
          return structuredClone(await (fn as (...a: unknown[]) => Promise<unknown>)(...args));
        },
      ]),
    ) as T;

  return {
    api: wrap(api) as MerchantApi,
    clear: wrap(clear),
    controls: {
      switches,
      /** Who's on shift: counts are blind to everyone but their own, and PIN rules follow the role. */
      setViewer: (staffId: string) => {
        viewer = staffId;
      },
      set: (next: Partial<MockSwitches>) => Object.assign(switches, next),
      failNext: (method: keyof MerchantApi | keyof ClearSide, message = 'Something went wrong. Take the ticket the usual way and try again.', status = 500) => {
        failNext = { method, message, status };
      },
    },
  };
}

export type MockMerchantApi = ReturnType<typeof createMockMerchantApi>;
