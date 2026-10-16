import {
  ApproveNoSale,
  DEFAULT_IDLE_MODE,
  DrawerEventBatch,
  HOLD_SECONDS,
  ORDER_READY_SECONDS,
  POINT_PAID_SECONDS,
  SeatParty,
  TABLE_READY_SECONDS,
  TABLE_REQUEST_SECONDS,
  pointShowing,
  type Alert,
  type Device,
  type DrawerEvent,
  type LineInput,
  type MerchantApi,
  type Order,
  type PickupOrder,
  type PointSettings,
  type PointState,
  type PrinterSettings,
  type ServiceType,
  type TableRequest,
  type TableView,
  type Waitlist,
  type WaitlistParty,
} from '@clear/merchant-contracts';
import { seesMoney } from '@clear/domain';
import { MENU, ORDER_0142, PICKUPS, POINTS, TAB_12, TABLES, WAITLIST, CATEGORY_ORDER } from '../../terminal/reference';

/**
 * Clear Terminal in the mock (terminal reference): Points, the drawer and printers, tables and the
 * wait list, Call and Bill, alerts and Order ready. What a Point shows goes through the contracts'
 * own `pointShowing`, as the server's does. For `&shop=micasa` it starts at Mi Casa's dinner, as the
 * reference draws it; any other shop starts with nothing paired.
 */

type Kind<K extends PointState['kind']> = Extract<PointState, { kind: K }>;

export interface TerminalHost {
  micasa: boolean;
  /** `&calls=open`: Table 12's Call is open (section 13b's strip). Otherwise its bill shows, as section 1 draws it. */
  callOpen: boolean;
  /** `&seat=before`: Ana is still waiting and Table 6 is free (section 8b's Seat sheet). */
  anaWaiting: boolean;
  shopId: string;
  day: string;
  at: (day: string, hhmm: string) => string;
  now: () => string;
  id: (prefix: string) => string;
  viewer: () => string;
  roleOf: (staffId: string) => 'counter' | 'manager' | 'owner' | undefined;
  nameOf: (staffId: string) => string;
  pinOf: (pin: string | null | undefined) => string | null;
  refuse: (message: string, status?: number, code?: string) => never;
  /** Raise an order the way the mock's createOrder does, and read one back. */
  raise: (
    lines: LineInput[],
    opts: {
      by: string;
      customer?: string | null;
      createdAt?: string;
      number?: number;
    },
  ) => string;
  order: (orderId: string) => Order;
  /** Pay it: a cash tender for the whole of it. */
  payCash: (orderId: string, opts: { by: string; at: string; handedOverCents?: number }) => void;
  settings: () => {
    tableService?: boolean;
    drawerNoSaleRoles?: 'managers' | 'anyone';
    noSaleNeedsPin?: boolean;
  };
  openDrawerSession: () => { id: string } | null;
}

interface PointRec {
  id: string;
  code: string;
  name: string;
  model: 'point' | 'point_large';
  settings: PointSettings;
  battery: number;
  pluggedIn: boolean;
  case: boolean;
  createdAt: string;
  base: Kind<'idle'> | Kind<'bill'> | Kind<'paid'> | Kind<'test'>;
}

interface TableRec {
  id: string;
  number: number;
  label: string | null;
  area: string | null;
  seats: number;
  seatedAt: string | null;
  tabOrderId: string | null;
  hold: {
    partyId: string;
    showName: boolean;
    seatedAt: string;
    expiresAt: string;
  } | null;
  /** Who is there, from seated to cleared: a wait-list party's name and size, or a walk-in's (Tables v2). */
  party?: { name: string | null; size: number } | null;
}

interface PartyRec {
  id: string;
  name: string;
  size: number;
  phone: string | null;
  textConsent: boolean;
  rank: number;
  quotedMinutes: number;
  state: WaitlistParty['state'];
  tableId: string | null;
  joinedAt: string;
  readyAt: string | null;
  /** When the almost-ready text went (Text: almost ready). */
  notifiedAt?: string | null;
  seatedAt: string | null;
}

export interface OrderMeta {
  tableId: string | null;
  serviceType: ServiceType | null;
  deliveryPartner: string | null;
  calledAt: string | null;
  pickedUpAt: string | null;
  billSentAt: string | null;
}

const PAID = ['paid', 'refunded', 'partly_refunded'];
const plus = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString();
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

export function createTerminalMock(h: TerminalHost) {
  const points = new Map<string, PointRec>();
  const drawers = new Map<
    string,
    {
      id: string;
      name: string;
      createdAt: string;
      settings: Extract<Device, { kind: 'drawer' }>['settings'];
    }
  >();
  const printers = new Map<string, { id: string; name: string; createdAt: string; settings: PrinterSettings }>();
  const tables = new Map<string, TableRec>();
  const parties = new Map<string, PartyRec>();
  const requests = new Map<string, TableRequest & { expiresAt: string }>();
  const alerts = new Map<string, Alert>();
  const events: Array<DrawerEvent & { seq: number; approvedBy: string | null }> = [];
  const approvals = new Map<
    string,
    {
      requestedBy: string;
      approvedBy: string | null;
      expiresAt: string;
      reason: string;
      note: string | null;
    }
  >();
  const meta = new Map<string, OrderMeta>();
  let categoryOrder: string[] = [];
  let seq = 0;
  /** Order ready's names: who to call. */
  const pickupNames = new Map<string, string | null>();

  const metaOf = (orderId: string): OrderMeta =>
    meta.get(orderId) ?? {
      tableId: null,
      serviceType: null,
      deliveryPartner: null,
      calledAt: null,
      pickedUpAt: null,
      billSentAt: null,
    };
  const setMeta = (orderId: string, patch: Partial<OrderMeta>) => meta.set(orderId, { ...metaOf(orderId), ...patch });
  const paidAt = (orderId: string) => h.order(orderId).createdAt;

  // ---- What a Point shows ----------------------------------------------------------------------------
  function showing(p: PointRec, nowIso = h.now()): PointState {
    const t = Date.parse(nowIso);
    let base: PointRec['base'] = p.base;
    if (base.kind === 'bill') {
      const o = h.order(base.orderId);
      if (PAID.includes(o.status)) base = { kind: 'paid', orderId: o.id, since: lastPaid(o.id) };
      else if (o.status === 'voided') base = { kind: 'idle', mode: p.settings.idleMode };
    }
    if (base.kind === 'test' && t - Date.parse(base.since) > 60_000) base = { kind: 'idle', mode: p.settings.idleMode };
    let hold: Kind<'held'> | null = null;
    const table = p.settings.tableId ? tables.get(p.settings.tableId) : undefined;
    if (table?.hold && !(table.tabOrderId && h.order(table.tabOrderId).lines.length)) {
      const party = parties.get(table.hold.partyId);
      hold = {
        kind: 'held',
        tableId: table.id,
        partyName: table.hold.showName && party ? firstName(party.name) : null,
        partySize: party?.size ?? 1,
        seatedAt: table.hold.seatedAt,
        expiresAt: table.hold.expiresAt,
      };
    }
    const req = [...requests.values()].filter((r) => r.pointId === p.id && r.state === 'open' && Date.parse(r.expiresAt) > t).sort((a, b) => b.at.localeCompare(a.at))[0];
    const request: Kind<'called'> | Kind<'bill_asked'> | null = req
      ? {
          kind: req.kind === 'call' ? 'called' : 'bill_asked',
          requestId: req.id,
          since: req.at,
          expiresAt: req.expiresAt,
        }
      : null;
    const al = [...alerts.values()].filter((a) => a.pointId === p.id && !a.clearedAt && Date.parse(a.expiresAt) > t).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const alert: Kind<'alert'> | null = al
      ? {
          kind: 'alert',
          alertId: al.id,
          since: al.createdAt,
          expiresAt: al.expiresAt,
        }
      : null;
    return pointShowing({ base, hold, request, alert, idleMode: p.settings.idleMode }, new Date(nowIso));
  }
  const paidTimes = new Map<string, string>();
  const lastPaid = (orderId: string) => paidTimes.get(orderId) ?? paidAt(orderId);

  function pointDevice(p: PointRec): Device {
    return {
      id: p.id,
      shop: h.shopId,
      name: p.name,
      createdAt: p.createdAt,
      kind: 'point',
      code: p.code,
      model: p.model,
      settings: p.settings,
      health: {
        batteryPercent: p.battery,
        pluggedIn: p.pluggedIn,
        rssi: -58,
        ssid: 'MiCasa-Staff',
        firmware: '1.0.3',
        case: p.case ? { kind: 'pay', buttons: 'ok' } : null,
        firmwareCurrent: true,
        lastSeenAt: h.now(),
      },
      showing: showing(p),
    };
  }

  // ---- Tables ------------------------------------------------------------------------------------------
  function tableView(t: TableRec, nowIso = h.now()): TableView {
    const o = t.tabOrderId ? h.order(t.tabOrderId) : null;
    const lines = o?.lines.length ?? 0;
    const holdLive = !!t.hold && Date.parse(t.hold.expiresAt) > Date.parse(nowIso) && lines === 0;
    const m = o ? metaOf(o.id) : null;
    const status: TableView['status'] = holdLive ? 'held' : o && PAID.includes(o.status) ? 'paid' : m?.billSentAt ? 'bill_sent' : lines ? 'ordering' : t.seatedAt || o ? 'seated' : 'free';
    const point = [...points.values()].find((p) => p.settings.tableId === t.id);
    const req = [...requests.values()].filter((r) => r.tableId === t.id && r.state === 'open' && Date.parse(r.expiresAt) > Date.parse(nowIso))[0];
    return {
      id: t.id,
      shop: h.shopId,
      number: t.number,
      label: t.label,
      area: t.area,
      seats: t.seats,
      status,
      hold: holdLive
        ? {
            ...t.hold!,
            partyName: firstName(parties.get(t.hold!.partyId)?.name ?? ''),
          }
        : null,
      request: req ? strip(req) : null,
      seatedAt: status === 'free' ? null : (t.seatedAt ?? t.hold?.seatedAt ?? null),
      orderId: status === 'free' ? null : t.tabOrderId,
      tabCents: o && status !== 'free' ? o.totalCents : null,
      billSentAt: m?.billSentAt ?? null,
      paidAt: o && PAID.includes(o.status) ? lastPaid(o.id) : null,
      point: point ? { id: point.id, showing: showing(point, nowIso) } : null,
      party: status === 'free' ? null : (t.party ?? (t.hold ? { name: firstName(parties.get(t.hold.partyId)?.name ?? ''), size: parties.get(t.hold.partyId)?.size ?? 1 } : null)),
    };
  }
  const strip = (r: TableRequest & { expiresAt: string }): TableRequest => {
    const { expiresAt: _e, ...rest } = r;
    return rest;
  };
  const table = (tableId: string) => tables.get(tableId) ?? h.refuse('No such table', 404, 'not_found');

  const viewOf = (p: PartyRec, position: number): WaitlistParty => ({
    id: p.id,
    name: p.name,
    size: p.size,
    phone: p.phone,
    textConsent: p.textConsent,
    position,
    quotedMinutes: p.quotedMinutes,
    state: p.state,
    tableId: p.tableId,
    joinedAt: p.joinedAt,
    readyAt: p.readyAt,
    notifiedAt: p.notifiedAt ?? null,
  });

  function waitlist(): Waitlist {
    const live = [...parties.values()].filter((p) => p.state === 'waiting' || p.state === 'notified').sort((a, b) => a.rank - b.rank);
    const seated = [...parties.values()].filter((p) => p.state === 'seated').sort((a, b) => (b.seatedAt ?? '').localeCompare(a.seatedAt ?? ''));
    return {
      parties: [...seated.map((p) => viewOf(p, 1)), ...live.map((p, i) => viewOf(p, i + 1))],
      quotedMinutes: live.length * 5,
    };
  }
  // A party off the list (no show, removed) is still answered, at the position it last had.
  const partyView = (id: string) => waitlist().parties.find((p) => p.id === id) ?? viewOf(parties.get(id)!, 1);

  function attachTab(tableId: string, orderId: string, at: string) {
    const t = table(tableId);
    if (t.tabOrderId && !PAID.includes(h.order(t.tabOrderId).status)) h.refuse(`Table ${t.number} has a tab open; add to it instead`, 409, 'locked');
    t.tabOrderId = orderId;
    t.seatedAt = t.seatedAt ?? t.hold?.seatedAt ?? at;
    t.hold = null;
    setMeta(orderId, { tableId, serviceType: 'dine_in' });
  }

  function showOrder(p: PointRec, orderId: string, at: string, by: string) {
    p.base = { kind: 'bill', orderId, since: at };
    setMeta(orderId, { billSentAt: at });
    const tableId = metaOf(orderId).tableId ?? p.settings.tableId;
    if (tableId) {
      const t = tables.get(tableId);
      if (t) t.hold = null;
      for (const r of requests.values()) {
        if (r.tableId === tableId && r.kind === 'bill' && r.state === 'open')
          Object.assign(r, {
            state: 'bill_sent',
            answeredBy: by,
            answeredAt: at,
            billCents: h.order(orderId).totalCents,
          });
      }
    }
  }

  // ---- The reference's dinner ----------------------------------------------------------------------------
  if (h.micasa) {
    const at = (hhmm: string) => h.at(h.day, hhmm);
    const created = at('09:00');
    for (const t of TABLES)
      tables.set(`tbl_${t.number}`, {
        id: `tbl_${t.number}`,
        number: t.number,
        label: null,
        area: t.area,
        seats: t.seats,
        seatedAt: null,
        tabOrderId: null,
        hold: null,
      });
    for (const p of POINTS) {
      const tableId = p.table ? `tbl_${p.table}` : null;
      // The floor draws Table 14's Point on the Menu (DECISIONS › Terminal Phase 4).
      const idleMode = p.table === 14 ? 'menu' : p.idleMode;
      points.set(p.id, {
        id: p.id,
        code: p.code,
        name: p.name,
        model: p.model,
        settings: {
          placement: p.placement,
          tableId,
          idleMode,
          showcaseCategories: ['Tacos', 'Drinks', 'Dessert'],
          mixUp: true,
          byTimeOfDay: false,
          readerId: p.readerId,
          buttons: p.buttons,
          suggestBeforePaying: false,
          oneMoreRound: false,
        },
        battery: p.battery,
        pluggedIn: p.pluggedIn,
        case: p.case,
        createdAt: created,
        base: { kind: 'idle', mode: idleMode },
      });
    }
    drawers.set('hw_drawer', {
      id: 'hw_drawer',
      name: 'Clear Drawer',
      createdAt: created,
      settings: {
        bluetoothId: 'C1:EA:4F:2A',
        pairedTabletId: 'preview',
        cabledToPrinter: false,
        printerId: null,
      },
    });
    printers.set('hw_counter_printer', {
      id: 'hw_counter_printer',
      name: 'Counter printer',
      createdAt: created,
      settings: {
        connection: 'wifi',
        model: 'Clear 4-inch',
        address: '192.168.1.40:9100',
        language: 'tspl',
        paper: 'label4x6',
        prints: { receipt: 'ask', bagLabel: 'always', kitchenTicket: null },
      },
    });
    printers.set('hw_kitchen', {
      id: 'hw_kitchen',
      name: 'Kitchen',
      createdAt: created,
      settings: {
        connection: 'wifi',
        model: 'Rollo',
        address: '192.168.1.41:9100',
        language: 'tspl',
        paper: 'label4x3',
        prints: { receipt: null, bagLabel: null, kitchenTicket: 'always' },
      },
    });
    categoryOrder = [...CATEGORY_ORDER];

    const item = (ref: string, n: number): LineInput => ({
      itemId: `itm_${ref}`,
      quantity: n,
      optionIds: [],
    });
    // A tab by its total: the reference draws only the figure on the tile.
    const tabOf = (cents: number): LineInput[] => [
      {
        itemId: null,
        name: 'Dinner',
        note: null,
        amountCents: cents,
        taxKind: 'exempt',
      },
    ];
    const seat = (n: number, hhmm: string) => (table(`tbl_${n}`).seatedAt = at(hhmm));
    const tabFor = (n: number, lines: LineInput[], hhmm: string, opts: { billSent?: string; paid?: string } = {}) => {
      const orderId = h.raise(lines, { by: 'stf_jen', createdAt: at(hhmm) });
      attachTab(`tbl_${n}`, orderId, at(hhmm));
      if (opts.billSent) setMeta(orderId, { billSentAt: at(opts.billSent) });
      if (opts.paid) {
        h.payCash(orderId, { by: 'stf_jen', at: at(opts.paid) });
        paidTimes.set(orderId, at(opts.paid));
      }
      return orderId;
    };
    // Lunch at the counter: order 0142 in cash, and Order ready's three.
    const o142 = h.raise(
      ORDER_0142.lines.map(([r, q]) => item(r, q)),
      { by: 'stf_jen', createdAt: at('12:41'), number: ORDER_0142.number },
    );
    h.payCash(o142, {
      by: 'stf_jen',
      at: at('12:41'),
      handedOverCents: ORDER_0142.handedOverCents,
    });
    setMeta(o142, { serviceType: 'to_go' });
    for (const p of PICKUPS) {
      const id = h.raise([item('pastor', p.items)], {
        by: 'stf_jen',
        customer: null,
        createdAt: at(p.paid.replace('pm', '')),
        number: p.number,
      });
      h.payCash(id, { by: 'stf_jen', at: at(p.paid.replace('pm', '')) });
      paidTimes.set(id, at(p.paid.replace('pm', '')));
      setMeta(id, {
        serviceType: p.service,
        calledAt: p.called ? at(p.called.replace('pm', '')) : null,
        pickedUpAt: p.picked ? at(p.picked.replace('pm', '')) : null,
      });
      pickupNames.set(id, p.name);
    }
    // Dinner (section 8, with the addenda).
    seat(2, '19:48');
    tabFor(2, tabOf(3150), '19:48');
    seat(4, '19:12');
    const t4 = tabFor(4, tabOf(6200), '19:12', { billSent: '20:00' });
    seat(7, '19:55');
    tabFor(9, tabOf(2740), '19:10', { paid: '19:58' });
    seat(12, '19:19');
    const t12 = tabFor(
      12,
      TAB_12.lines.map(([r, q]) => item(r, q)),
      '19:19',
      { billSent: '19:42' },
    );
    points.get('hw_t12')!.base = {
      kind: 'bill',
      orderId: t12,
      since: at('19:42'),
    };
    let rank = 0;
    for (const w of WAITLIST) {
      const id = `pty_${w.name.toLowerCase()}`;
      parties.set(id, {
        id,
        name: w.name,
        size: w.size,
        phone: w.phone,
        textConsent: Boolean(w.phone),
        rank: ++rank,
        quotedMinutes: w.quoted,
        state: h.anaWaiting && w.name === 'Ana' ? 'waiting' : w.state,
        tableId: w.table && !h.anaWaiting ? `tbl_${w.table}` : null,
        joinedAt: at('19:40'),
        readyAt: null,
        seatedAt: w.state === 'seated' && !h.anaWaiting ? at('19:58') : null,
      });
    }
    // Ana joined at 7:44: she has waited 14 minutes when the Seat sheet opens at 7:58.
    parties.get('pty_ana')!.joinedAt = at('19:44');
    if (!h.anaWaiting) table('tbl_6').hold = {
      partyId: 'pty_ana',
      showName: true,
      seatedAt: at('19:58'),
      expiresAt: plus(at('19:58'), HOLD_SECONDS),
    };
    // Calls and bills (13b).
    const req = (id: string, n: number, pointId: string, kind: 'call' | 'bill', hhmm: string, more: Partial<TableRequest>) =>
      requests.set(id, {
        id,
        tableId: `tbl_${n}`,
        pointId,
        kind,
        at: at(hhmm),
        state: 'open',
        answeredBy: null,
        answeredAt: null,
        billCents: null,
        expiresAt: plus(at(hhmm), TABLE_REQUEST_SECONDS),
        ...more,
      });
    if (h.callOpen) req('treq_12', 12, 'hw_t12', 'call', '19:59', {});
    req('treq_4', 4, 'hw_t4', 'bill', '20:00', {
      state: 'bill_sent',
      answeredAt: at('20:00'),
      billCents: h.order(t4).totalCents,
    });
    req('treq_9', 9, 'hw_t9', 'call', '19:57', {
      state: 'answered',
      answeredBy: 'stf_luis',
      answeredAt: at('20:01'),
    });
    // The drawer today: 21 opens with a sale, two No sales, and the key once (section 6).
    const ev = (hhmm: string, e: Partial<DrawerEvent> & { reason: 'sale' | 'no_sale' | 'key' }, approvedBy: string | null = null) =>
      events.push({
        kind: 'opened',
        clientId: h.id('evt'),
        drawerId: 'hw_drawer',
        at: at(hhmm),
        staffId: 'stf_jen',
        orderId: null,
        noSale: null,
        approvalId: null,
        ...e,
        seq: ++seq,
        approvedBy,
      } as DrawerEvent & { seq: number; approvedBy: string | null });
    for (let i = 0; i < 21; i += 1) ev(`${String(10 + Math.floor(i / 3)).padStart(2, '0')}:${String((i % 3) * 15 + 5).padStart(2, '0')}`, { reason: 'sale' });
    ev(
      '11:04',
      {
        reason: 'no_sale',
        noSale: { reason: 'change_for_note', note: 'a $50' },
      },
      'stf_mike',
    );
    ev('14:15', {
      reason: 'no_sale',
      staffId: 'stf_luis',
      noSale: { reason: 'counting', note: null },
    });
    ev('12:41', { reason: 'key', orderId: o142 });
    events.push({
      kind: 'shut',
      clientId: h.id('evt'),
      drawerId: 'hw_drawer',
      at: at('19:50'),
      staffId: 'stf_jen',
      seq: ++seq,
      approvedBy: null,
    } as DrawerEvent & { seq: number; approvedBy: string | null });
  }

  // ---- The API ---------------------------------------------------------------------------------------------
  const owner = () => h.roleOf(h.viewer()) === 'owner' || h.refuse('that needs full access', 403, 'forbidden');
  const pointRec = (id: string) => points.get(id) ?? h.refuse('No such Point', 404, 'not_found');

  const list = (): Device[] => [
    ...[...points.values()].map(pointDevice),
    ...[...drawers.values()].map((d) => {
      const mine = events.filter((e) => e.drawerId === d.id).sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
      const last = mine[mine.length - 1];
      return {
        id: d.id,
        shop: h.shopId,
        name: d.name,
        createdAt: d.createdAt,
        kind: 'drawer' as const,
        settings: d.settings,
        // Opens the drawer made itself: with the key, it didn't (section 6 counts those apart).
        status: {
          open: last ? last.kind === 'opened' && last.reason !== 'key' : null,
          lastEventAt: last?.at ?? null,
          opensToday: mine.filter((e) => e.kind === 'opened' && e.reason !== 'key').length,
        },
      };
    }),
    ...[...printers.values()].map((p) => ({
      id: p.id,
      shop: h.shopId,
      name: p.name,
      createdAt: p.createdAt,
      kind: 'printer' as const,
      settings: p.settings,
    })),
  ];

  const api: Pick<
    MerchantApi,
    | 'categoryOrder'
    | 'saveCategoryOrder'
    | 'hardware'
    | 'addDevice'
    | 'updateDevice'
    | 'removeDevice'
    | 'claimPoint'
    | 'showOnPoint'
    | 'drawerKey'
    | 'saveDrawerEvents'
    | 'approveNoSale'
    | 'drawerDay'
    | 'floor'
    | 'saveTables'
    | 'seatTable'
    | 'moveTable'
    | 'clearTable'
    | 'waitlist'
    | 'addParty'
    | 'updateParty'
    | 'seatParty'
    | 'notifyParty'
    | 'noShowParty'
    | 'tableRequests'
    | 'answerTableRequest'
    | 'createAlert'
    | 'clearAlert'
    | 'pickups'
    | 'markPickedUp'
  > = {
    categoryOrder: async () => ({ names: [...categoryOrder] }),
    saveCategoryOrder: async (input) => {
      if (!seesMoney(h.roleOf(h.viewer()) ?? 'counter')) h.refuse('that needs a manager', 403, 'forbidden');
      categoryOrder = [...input.names];
      return { names: [...categoryOrder] };
    },
    hardware: async () => list(),
    addDevice: async (input) => {
      owner();
      const id = h.id('hw');
      if (input.kind === 'drawer')
        drawers.set(id, {
          id,
          name: input.name,
          createdAt: h.now(),
          settings: input.settings as never,
        });
      else
        printers.set(id, {
          id,
          name: input.name,
          createdAt: h.now(),
          settings: input.settings as PrinterSettings,
        });
      return list().find((d) => d.id === id)!;
    },
    updateDevice: async (deviceId, input) => {
      owner();
      const p = points.get(deviceId);
      if (p) {
        const placement = input.point?.placement;
        const next = { ...p.settings, ...(input.point ?? {}) } as PointSettings;
        if (placement && placement !== p.settings.placement && !input.point?.idleMode) next.idleMode = DEFAULT_IDLE_MODE[placement];
        if (next.readerId && [...points.values()].some((o) => o.id !== p.id && o.settings.readerId === next.readerId)) h.refuse('That reader is linked to another Point', 409, 'taken');
        p.settings = next;
        if (input.name) p.name = input.name;
      } else if (drawers.has(deviceId)) {
        const d = drawers.get(deviceId)!;
        d.settings = { ...d.settings, ...(input.drawer ?? {}) };
        if (input.name) d.name = input.name;
      } else if (printers.has(deviceId)) {
        const d = printers.get(deviceId)!;
        d.settings = {
          ...d.settings,
          ...(input.printer ?? {}),
        } as PrinterSettings;
        if (input.name) d.name = input.name;
      } else h.refuse('No such device', 404, 'not_found');
      return list().find((d) => d.id === deviceId)!;
    },
    removeDevice: async (deviceId) => {
      owner();
      if (!points.delete(deviceId) && !drawers.delete(deviceId) && !printers.delete(deviceId)) h.refuse('No such device', 404, 'not_found');
    },
    claimPoint: async (input) => {
      owner();
      const code = input.code.trim().toUpperCase();
      if (!/^[0-9A-HJKMNP-TV-Z]{4}$/.test(code)) h.refuse('That isn’t a Point’s code', 422, 'invalid');
      if ([...points.values()].some((p) => p.code === code)) h.refuse('That Point is already set up. Unpair it first', 409, 'taken');
      const id = h.id('hw');
      const rec: PointRec = {
        id,
        code,
        name: `Point ${code}`,
        model: 'point',
        settings: {
          placement: 'table',
          tableId: null,
          idleMode: 'number',
          showcaseCategories: [],
          mixUp: false,
          byTimeOfDay: false,
          readerId: null,
          buttons: { call: true, bill: 'send_bill' },
          suggestBeforePaying: false,
          oneMoreRound: false,
        },
        battery: 100,
        pluggedIn: false,
        case: false,
        createdAt: h.now(),
        base: { kind: 'idle', mode: 'number' },
      };
      points.set(id, rec);
      return {
        device: pointDevice(rec) as Extract<Device, { kind: 'point' }>,
        provisioning: {
          secret: 'mock-provisioning-secret-0000000000000',
          apiBase: 'https://api.example',
          expiresAt: plus(h.now(), 600),
        },
      };
    },
    showOnPoint: async (pointId, input) => {
      const p = pointRec(pointId);
      const at = h.now();
      if (input.kind === 'order') {
        const o = h.order(input.orderId);
        if (o.status !== 'open' && o.status !== 'paying') h.refuse('That order is already settled', 409, 'conflict');
        showOrder(p, input.orderId, at, h.viewer());
      } else if (input.kind === 'alert') {
        const a = alerts.get(input.alertId) ?? h.refuse('No such alert', 404, 'not_found');
        a.pointId = pointId;
      } else if (input.kind === 'test') p.base = { kind: 'test', since: at };
      else p.base = { kind: 'idle', mode: p.settings.idleMode };
      return pointDevice(p) as Extract<Device, { kind: 'point' }>;
    },
    drawerKey: async (drawerId) => {
      if (!drawers.has(drawerId)) h.refuse('No such drawer', 404, 'not_found');
      return {
        drawerId,
        keyId: 'dk_mock',
        key: 'bW9jay1kcmF3ZXIta2V5LW9mLTMyLWJ5dGVzLWxvbmc=',
        issuedAt: h.now(),
      };
    },
    saveDrawerEvents: async (input) => {
      const parsed = DrawerEventBatch.safeParse(input);
      if (!parsed.success) h.refuse(parsed.error.issues[0]?.message ?? 'Those drawer events aren’t valid', 422, 'invalid');
      let saved = 0;
      let duplicates = 0;
      for (const e of parsed.data!.events) {
        if (events.some((x) => x.clientId === e.clientId)) {
          duplicates += 1;
          continue;
        }
        let approvedBy: string | null = null;
        if (e.kind === 'opened' && e.reason === 'no_sale') {
          const a = e.approvalId ? approvals.get(e.approvalId) : undefined;
          if (!a) h.refuse('That No sale wasn’t approved', 403, 'forbidden');
          if (events.some((x) => x.kind === 'opened' && x.approvalId === e.approvalId)) h.refuse('That approval opened the drawer already', 409, 'conflict');
          approvedBy = a!.approvedBy;
        }
        events.push({ ...e, seq: ++seq, approvedBy });
        saved += 1;
      }
      return { saved, duplicates };
    },
    approveNoSale: async (input) => {
      const r = ApproveNoSale.parse(input);
      const s = h.settings();
      const everyone = s.drawerNoSaleRoles === 'anyone';
      const me = h.viewer();
      const role = h.roleOf(me) ?? 'counter';
      let approvedBy: string | null = null;
      if (s.noSaleNeedsPin === false && (everyone || seesMoney(role))) approvedBy = null;
      else {
        if (!r.pin) h.refuse(everyone ? 'Your PIN' : 'A manager’s or owner’s PIN', 403, 'forbidden');
        const who = h.pinOf(r.pin);
        if (!who) h.refuse('That PIN isn’t right', 403, 'forbidden');
        const theirs = h.roleOf(who!) ?? 'counter';
        if (everyone ? !(who === me || seesMoney(theirs)) : !seesMoney(theirs)) h.refuse('That needs a manager’s or owner’s PIN', 403, 'forbidden');
        approvedBy = who === me && !seesMoney(theirs) ? null : who;
      }
      const id = h.id('nsa');
      const expiresAt = plus(h.now(), 120);
      approvals.set(id, {
        requestedBy: me,
        approvedBy,
        expiresAt,
        reason: r.reason,
        note: r.note,
      });
      return { approvalId: id, approvedBy, expiresAt };
    },
    drawerDay: async () => {
      const opened = events.filter((e) => e.kind === 'opened').sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq) as Array<
        Extract<DrawerEvent, { kind: 'opened' }> & { approvedBy: string | null }
      >;
      return {
        opens: opened.filter((e) => e.reason !== 'key').length,
        withSale: opened.filter((e) => e.reason === 'sale' || e.reason === 'refund').length,
        noSales: opened
          .filter((e) => e.reason === 'no_sale')
          .map((e) => ({
            at: e.at,
            staffId: e.staffId,
            reason: e.noSale!.reason,
            note: e.noSale!.note,
            approvedBy: e.approvedBy,
          })),
        withKey: opened
          .filter((e) => e.reason === 'key')
          .map((e) => ({
            at: e.at,
            orderId: e.orderId,
            orderNumber: e.orderId ? h.order(e.orderId).number : null,
          })),
      };
    },
    floor: async () => ({
      tables: [...tables.values()].sort((a, b) => a.number - b.number).map((t) => tableView(t)),
      waitlist: waitlist(),
      requests: [...requests.values()].sort((a, b) => b.at.localeCompare(a.at)).map(strip),
    }),
    saveTables: async (input) => {
      if (!seesMoney(h.roleOf(h.viewer()) ?? 'counter')) h.refuse('that needs a manager', 403, 'forbidden');
      const numbers = input.tables.map((t) => t.number);
      if (new Set(numbers).size !== numbers.length) h.refuse('Each table number once', 422, 'invalid');
      const keep = new Set(input.tables.map((t) => t.id).filter(Boolean));
      for (const t of tables.values()) if (!keep.has(t.id) && (t.tabOrderId || t.hold || t.seatedAt)) h.refuse(`Table ${t.number} has people at it; clear it first`, 409, 'conflict');
      for (const t of [...tables.values()]) if (!keep.has(t.id)) tables.delete(t.id);
      for (const t of input.tables) {
        const id = t.id ?? h.id('tbl');
        const was = tables.get(id);
        tables.set(id, {
          id,
          number: t.number,
          label: t.label ?? null,
          area: t.area ?? null,
          seats: t.seats,
          seatedAt: was?.seatedAt ?? null,
          tabOrderId: was?.tabOrderId ?? null,
          hold: was?.hold ?? null,
        });
      }
      return api.floor();
    },
    seatTable: async (tableId, input = {}) => {
      const t = table(tableId);
      const held = t.hold ? parties.get(t.hold.partyId) : null;
      // A held party sits down; a free table takes a walk-in, with how many and an optional name.
      t.party = t.party ?? (held ? { name: firstName(held.name), size: held.size } : { name: input.name?.trim() || null, size: input.size ?? t.seats });
      t.seatedAt = t.seatedAt ?? t.hold?.seatedAt ?? h.now();
      t.hold = null;
      return tableView(t);
    },
    moveTable: async (tableId, input) => {
      const from = table(tableId);
      const to = table(input.toTableId);
      const fromView = tableView(from);
      if (fromView.status === 'free') h.refuse(`Table ${from.number} has nobody to move`, 409, 'conflict');
      if (tableView(to).status !== 'free') h.refuse(`Table ${to.number} isn’t free`, 409, 'conflict');
      // The tab, the bill if sent, the party and their name on the Point go; the table they left is free.
      Object.assign(to, { seatedAt: from.seatedAt, tabOrderId: from.tabOrderId, hold: from.hold, party: from.party ?? fromView.party ?? null });
      Object.assign(from, { seatedAt: null, tabOrderId: null, hold: null, party: null });
      const fromPoint = [...points.values()].find((p) => p.settings.tableId === from.id);
      const toPoint = [...points.values()].find((p) => p.settings.tableId === to.id);
      if (toPoint && fromPoint) toPoint.base = fromPoint.base;
      if (fromPoint) fromPoint.base = { kind: 'idle', mode: fromPoint.settings.idleMode };
      for (const p of parties.values()) if (p.tableId === from.id && p.state === 'seated') p.tableId = to.id;
      return { from: tableView(from), to: tableView(to) };
    },
    clearTable: async (tableId) => {
      const t = table(tableId);
      if (t.tabOrderId && !PAID.includes(h.order(t.tabOrderId).status) && h.order(t.tabOrderId).status !== 'voided') h.refuse('Its tab isn’t paid yet', 409, 'conflict');
      Object.assign(t, { seatedAt: null, tabOrderId: null, hold: null, party: null });
      for (const r of requests.values())
        if (r.tableId === t.id && r.state === 'open')
          Object.assign(r, {
            state: 'answered',
            answeredBy: h.viewer(),
            answeredAt: h.now(),
          });
      for (const p of points.values()) if (p.settings.tableId === t.id) p.base = { kind: 'idle', mode: p.settings.idleMode };
      return tableView(t);
    },
    waitlist: async () => waitlist(),
    addParty: async (input) => {
      const id = h.id('pty');
      const waiting = [...parties.values()].filter((p) => p.state === 'waiting').length;
      parties.set(id, {
        id,
        name: input.name.trim(),
        size: input.size,
        phone: input.phone ?? null,
        textConsent: Boolean(input.phone) && input.textConsent,
        rank: Date.now(),
        quotedMinutes: input.quotedMinutes ?? (waiting + 1) * 5,
        state: 'waiting',
        tableId: null,
        joinedAt: h.now(),
        readyAt: null,
        seatedAt: null,
      });
      return partyView(id);
    },
    updateParty: async (partyId, input) => {
      const p = parties.get(partyId) ?? h.refuse('No such party', 404, 'not_found');
      if (input.tableId !== undefined) p.tableId = input.tableId;
      if (input.state) p.state = input.state;
      if (input.position !== undefined) {
        const others = [...parties.values()].filter((x) => x.id !== p.id && (x.state === 'waiting' || x.state === 'notified')).sort((a, b) => a.rank - b.rank);
        const i = Math.min(input.position - 1, others.length);
        const before = others[i - 1]?.rank;
        const after = others[i]?.rank;
        p.rank = before === undefined ? (after ?? 0) - 1 : after === undefined ? before + 1 : (before + after) / 2;
      }
      return partyView(partyId);
    },
    notifyParty: async (partyId) => {
      const p = parties.get(partyId) ?? h.refuse('No such party', 404, 'not_found');
      if (!p.phone || !p.textConsent) h.refuse('They didn’t leave a number to text', 422, 'invalid');
      if (p.state === 'waiting') Object.assign(p, { state: 'notified', notifiedAt: h.now() });
      return partyView(partyId);
    },
    noShowParty: async (partyId) => {
      const p = parties.get(partyId) ?? h.refuse('No such party', 404, 'not_found');
      if (p.state === 'seated') h.refuse('They’re seated', 409, 'conflict');
      p.state = 'no_show';
      return partyView(partyId);
    },
    seatParty: async (partyId, input) => {
      const r = SeatParty.parse(input);
      const p = parties.get(partyId) ?? h.refuse('No such party', 404, 'not_found');
      const t = table(r.tableId);
      if (p.state === 'seated') {
        if (p.tableId !== t.id) h.refuse('They’re already seated at another table', 409, 'conflict');
        return { party: partyView(partyId), table: tableView(t) };
      }
      if (t.tabOrderId || t.seatedAt || (t.hold && Date.parse(t.hold.expiresAt) > Date.parse(h.now()))) h.refuse(`Table ${t.number} isn’t free`, 409, 'conflict');
      if (r.text && !p.phone) h.refuse('They didn’t leave a number', 422, 'invalid');
      const at = h.now();
      Object.assign(p, { state: 'seated', seatedAt: at, tableId: t.id });
      t.hold = {
        partyId,
        showName: r.showName,
        seatedAt: at,
        expiresAt: plus(at, HOLD_SECONDS),
      };
      for (const pt of points.values()) if (pt.settings.tableId === t.id) pt.base = { kind: 'idle', mode: pt.settings.idleMode };
      const door = [...points.values()].find((x) => x.settings.placement === 'door');
      const alertId = h.id('alr');
      alerts.set(alertId, {
        id: alertId,
        kind: 'table_ready',
        pointId: door?.id ?? null,
        partyId,
        orderId: null,
        label: r.showName ? firstName(p.name) : `Table ${t.number}`,
        textedTo: r.text && p.phone ? `··${p.phone.replace(/\D/g, '').slice(-4)}` : null,
        createdAt: at,
        expiresAt: plus(at, TABLE_READY_SECONDS),
        clearedAt: null,
      });
      return { party: partyView(partyId), table: tableView(t) };
    },
    tableRequests: async () => [...requests.values()].sort((a, b) => b.at.localeCompare(a.at)).map(strip),
    answerTableRequest: async (requestId) => {
      const r = requests.get(requestId) ?? h.refuse('No such request', 404, 'not_found');
      if (r.state === 'open')
        Object.assign(r, {
          state: 'answered',
          answeredBy: h.viewer(),
          answeredAt: h.now(),
        });
      return strip(r);
    },
    createAlert: async (input) => {
      const at = h.now();
      const id = h.id('alr');
      if (input.kind === 'table_ready') {
        const p = parties.get(input.partyId) ?? h.refuse('No such party', 404, 'not_found');
        const door = input.pointId ?? [...points.values()].find((x) => x.settings.placement === 'door')?.id ?? null;
        if (p.state === 'waiting') Object.assign(p, { state: 'notified', readyAt: at });
        alerts.set(id, {
          id,
          kind: 'table_ready',
          pointId: door,
          partyId: p.id,
          orderId: null,
          label: firstName(p.name),
          textedTo: p.phone && p.textConsent ? `··${p.phone.replace(/\D/g, '').slice(-4)}` : null,
          createdAt: at,
          expiresAt: plus(at, TABLE_READY_SECONDS),
          clearedAt: null,
        });
      } else {
        const o = h.order(input.orderId);
        if (!PAID.includes(o.status)) h.refuse('Call it once it’s paid', 409, 'conflict');
        const counter = input.pointId ?? [...points.values()].find((x) => x.settings.placement === 'counter')?.id ?? null;
        setMeta(o.id, { calledAt: at });
        alerts.set(id, {
          id,
          kind: 'order_ready',
          pointId: counter,
          partyId: null,
          orderId: o.id,
          label: o.number !== null ? String(o.number) : (o.name ?? 'Your order'),
          textedTo: null,
          createdAt: at,
          expiresAt: plus(at, ORDER_READY_SECONDS),
          clearedAt: null,
        });
      }
      return alerts.get(id)!;
    },
    clearAlert: async (alertId) => {
      const a = alerts.get(alertId) ?? h.refuse('No such alert', 404, 'not_found');
      a.clearedAt = a.clearedAt ?? h.now();
      return a;
    },
    pickups: async () => pickupList(),
    markPickedUp: async (orderId) => {
      setMeta(orderId, { pickedUpAt: metaOf(orderId).pickedUpAt ?? h.now() });
      for (const a of alerts.values()) if (a.orderId === orderId && !a.clearedAt) a.clearedAt = h.now();
      return pickupList().find((p) => p.orderId === orderId) ?? h.refuse('That order isn’t one to pick up', 404, 'not_found');
    },
  };

  function pickupList(): PickupOrder[] {
    return [...meta.entries()]
      .filter(([id, m]) => !m.tableId && m.serviceType === 'to_go' && pickupNames.has(id))
      .map(([id, m]) => {
        const o = h.order(id);
        return {
          orderId: id,
          number: o.number,
          name: pickupNames.get(id) ?? null,
          paidAt: lastPaid(id),
          itemCount: o.lines.reduce((s, l) => s + l.quantity, 0) || 1,
          serviceType: m.serviceType,
          calledAt: m.calledAt,
          pickedUpAt: m.pickedUpAt,
        };
      })
      .sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  }

  return {
    api,
    metaOf,
    /** A new order for a table becomes its tab (the mock's createOrder calls this). */
    attachTab: (tableId: string, orderId: string) => attachTab(tableId, orderId, h.now()),
    setMeta,
    /** Orders paid now, for "Paid since". */
    markPaid: (orderId: string) => paidTimes.set(orderId, h.now()),
    menu: () => MENU,
    PAID_SECONDS: POINT_PAID_SECONDS,
  };
}

export type TerminalMock = ReturnType<typeof createTerminalMock>;
