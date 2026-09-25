import type { MerchantApi, Staff } from '@clear/merchant-contracts';

/**
 * The merchant API over HTTP (UI prompt, Phase 3): one method per endpoint under /api/merchant, on
 * the app's one transport (`request`: the shift's session token, the tablet's device token, no
 * cookies, a sentence for every failure). Screens reach it through `api()` (./index.ts), never
 * directly, so the mock can stand in for it.
 *
 * Nothing here decides anything: fees, tax and totals come back from the server.
 *
 * The transport is passed in: the app's own (`request` in ../apiClient.ts), or in the contract
 * conformance run, one carrying a test session (apps/api/e2e/contract.ts).
 */

export type Transport = <T>(path: string, init?: RequestInit) => Promise<T>;

const range = (r: { from: string; to: string }) => `from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
const id = encodeURIComponent;

export function realMerchantApi(request: Transport): MerchantApi {
  const M = '/api/merchant';
  const get = <T>(path: string) => request<T>(`${M}${path}`);
  const send = <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
    request<T>(`${M}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const post = <T>(path: string, body?: unknown) => send<T>('POST', path, body ?? {});

  return {
    // ---- The shop
    shop: () => get('/shop'),
    updateShop: (patch) => send('PATCH', '/shop', patch),
    hours: () => get('/shop/hours'),
    saveHours: (h) => send('PUT', '/shop/hours', h),
    settings: () => get('/settings'),
    updateSettings: (patch) => send('PATCH', '/settings', patch),
    // The roster endpoint predates the contracts and says more than Staff does; only Staff is kept.
    staff: async () =>
      (await get<{ staff: Array<Staff & Record<string, unknown>> }>('/staff')).staff.map(({ id: staffId, name, role, active }) => ({ id: staffId, name, role, active })),
    taxStatus: () => get('/tax'),
    setup: () => get('/setup'),

    // ---- Shifts and hours
    shifts: () => get('/shifts'),
    startBreak: () => post('/shifts/me/break'),
    endBreak: () => send('DELETE', '/shifts/me/break'),
    endShift: async (staffId) => {
      await post(`/shifts/${id(staffId)}/end`);
    },
    staffWeek: (date) => get(`/staff/week${date ? `?date=${encodeURIComponent(date)}` : ''}`),
    staffHours: (staffId) => get(`/staff/${id(staffId)}/hours`),
    saveStaffHours: (staffId, input) => send('PUT', `/staff/${id(staffId)}/hours`, input),

    // ---- Cards
    cardAvailability: () => get('/cards/availability'),
    connectCards: () => post('/cards/connect'),
    connectionToken: () => post('/cards/connection-token'),
    readers: () => get('/cards/readers'),
    registerSmartReader: (input) => post('/cards/readers/smart', input),
    recordReader: (input) => post('/cards/readers', input),

    // ---- The catalogue and stock
    catalog: () => get('/catalog'),
    createItem: (input) => post('/catalog/items', input),
    importCatalog: (input) => post('/catalog/import', input),
    updateItem: (itemId, input) => send('PATCH', `/catalog/items/${id(itemId)}`, input),
    archiveItem: (itemId) => post(`/catalog/items/${id(itemId)}/archive`),
    saveOptionGroups: (itemId, groups) => send('PUT', `/catalog/items/${id(itemId)}/options`, { groups }),
    adjustStock: (input) => post('/catalog/stock', input),
    stockHistory: (itemId) => get(`/catalog/items/${id(itemId)}/stock`),
    reorders: () => get('/reorders'),
    markReordered: (input) => post('/reorders', input),
    receiveReorder: (reorderId, input) => post(`/reorders/${id(reorderId)}/receive`, input),
    discountCodes: () => get('/discount-codes'),
    createDiscountCode: (input) => post('/discount-codes', input),

    // ---- Orders
    createOrder: (input) => post('/orders', input),
    updateOrder: (orderId, input) => send('PUT', `/orders/${id(orderId)}/lines`, input),
    order: (orderId) => get(`/orders/${id(orderId)}`),
    orders: ({ date }) => get(`/orders?date=${encodeURIComponent(date)}`),
    orderHistory: (r) => get(`/orders/history?${range(r)}`),
    applyDiscount: (orderId, input) => post(`/orders/${id(orderId)}/discount`, input),
    removeDiscount: (orderId) => send('DELETE', `/orders/${id(orderId)}/discount`),
    voidOrder: (orderId, input) => post(`/orders/${id(orderId)}/void`, input),
    discardOrder: (orderId) => post(`/orders/${id(orderId)}/discard`),

    // ---- Tenders
    tenders: (orderId) => get(`/orders/${id(orderId)}/tenders`),
    createCardTender: (orderId, input) => post(`/orders/${id(orderId)}/tenders/card`, input),
    presentTender: (tenderId) => post(`/tenders/${id(tenderId)}/present`),
    syncTender: (tenderId) => post(`/tenders/${id(tenderId)}/sync`),
    cancelTender: (tenderId) => post(`/tenders/${id(tenderId)}/cancel`),
    adjustTip: (tenderId, input) => post(`/tenders/${id(tenderId)}/tip`, input),
    createCashTender: (orderId, input) => post(`/orders/${id(orderId)}/tenders/cash`, input),
    createClearTender: (orderId, input) => post(`/orders/${id(orderId)}/tenders/clear`, input),
    sendClearCharge: (tenderId, input) => post(`/tenders/${id(tenderId)}/send`, input),
    sendReceipt: async (orderId, input) => {
      await post(`/orders/${id(orderId)}/receipt`, input);
    },
    receipt: (orderId) => get(`/orders/${id(orderId)}/receipt`),

    // ---- Refunds
    requestRefund: (input) => post('/tender-refunds', input),
    decideRefund: (refundId, input) => post(`/tender-refunds/${id(refundId)}/decide`, input),

    // ---- The drawer and Close the day
    drawer: () => get('/drawer'),
    openDrawer: (input) => post('/drawer', input),
    saveCount: (sessionId, input) => post(`/drawer/${id(sessionId)}/counts`, input),
    counts: (sessionId) => get(`/drawer/${id(sessionId)}/counts`),
    recount: (sessionId, input) => post(`/drawer/${id(sessionId)}/recount`, input),
    signOff: (sessionId, input) => post(`/drawer/${id(sessionId)}/signoff`, input),
    closeDay: (sessionId) => post(`/drawer/${id(sessionId)}/close`),
    bankDeposits: () => get('/bank-deposits'),
    markDeposited: (depositId) => post(`/bank-deposits/${id(depositId)}/deposited`),

    // ---- Reports
    dayReports: (r) => get(`/day-reports?${range(r)}`),
    cardDeposits: (r) => get(`/card-deposits?${range(r)}`),
    overview: (r) => get(`/overview?${range(r)}`),
    clearFeeBills: () => get('/clear-fee-bills'),
    audit: (r) => get(`/audit?${range(r)}`),
  };
}
