import type { BillButton, PointIdleMode, PointPlacement } from '@clear/merchant-contracts';

/**
 * The Clear Terminal reference's shop: Mi Casa Tacos on Thu, Oct 15, at dinner (terminal
 * reference, every section). Tables, menus and order numbers don't happen at a tire shop, so the
 * terminal file draws a restaurant, and the preview shows it with `&shop=micasa`. Mike's Tire stays
 * the preview's shop everywhere else.
 *
 * The figures are the reference's own. The mock API seeds its terminal state from here, so the
 * preview and `&live=1` show the same dinner.
 */

/** `&shop=micasa` in the dev preview. */
export function miCasa(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('shop') === 'micasa';
}

export const MI_CASA = {
  shop: 'Mi Casa Tacos',
  owner: 'Ana R.',
  since: { long: 'October 2026', short: 'Oct 2026' },
  /** The people on the preview's shifts: the owner, the counter and a manager. */
  people: {
    owner: { id: 'stf_mike', name: 'Ana R.' },
    counter: { id: 'stf_jen', name: 'Jen R.' },
    manager: { id: 'stf_luis', name: 'Luis M.' },
  },
  wifi: [
    { ssid: 'MiCasa-Staff', det: 'This tablet’s network · strong', ok: true },
    {
      ssid: 'MiCasa-Guest',
      det: 'Has a sign-in page, so a Point can’t use it',
      ok: false,
    },
  ],
} as const;

export interface RefPoint {
  id: string;
  code: string;
  name: string;
  model: 'point' | 'point_large';
  placement: PointPlacement;
  table: number | null;
  idleMode: PointIdleMode;
  battery: number;
  pluggedIn: boolean;
  /** What the row says it shows. */
  showing: 'pay' | 'bill' | 'waitlist' | 'idle';
  readerId: string | null;
  buttons: { call: boolean; bill: BillButton };
  case: boolean;
}

/** Section 1: four Points, three at tables and one at the counter (the door's counts as a table Point's model). */
export const POINTS: RefPoint[] = [
  {
    id: 'hw_counter',
    code: 'C0N7',
    name: 'Counter',
    model: 'point_large',
    placement: 'counter',
    table: null,
    idleMode: 'pay',
    battery: 100,
    pluggedIn: true,
    showing: 'pay',
    readerId: null,
    buttons: { call: false, bill: 'notify' },
    case: false,
  },
  {
    id: 'hw_t12',
    code: 'A7K2',
    name: 'Table 12',
    model: 'point',
    placement: 'table',
    table: 12,
    idleMode: 'showcase',
    battery: 82,
    pluggedIn: false,
    showing: 'bill',
    readerId: 'rdr_1a3f',
    buttons: { call: true, bill: 'send_bill' },
    case: true,
  },
  {
    id: 'hw_t14',
    code: 'T14P',
    name: 'Table 14',
    model: 'point',
    placement: 'table',
    table: 14,
    idleMode: 'number',
    battery: 18,
    pluggedIn: false,
    showing: 'idle',
    readerId: null,
    buttons: { call: true, bill: 'send_bill' },
    case: false,
  },
  {
    id: 'hw_door',
    code: 'D00R',
    name: 'Door',
    model: 'point',
    placement: 'door',
    table: null,
    idleMode: 'waitlist',
    battery: 64,
    pluggedIn: false,
    showing: 'waitlist',
    readerId: null,
    buttons: { call: false, bill: 'notify' },
    case: false,
  },
];

/** Section 8: eight tables (seats from the seating addendum: 1 and 6 seat two, 14 seats four). */
export const TABLES: { number: number; seats: number; area: string | null }[] = [
  { number: 1, seats: 2, area: null },
  { number: 2, seats: 4, area: null },
  { number: 4, seats: 4, area: null },
  { number: 6, seats: 2, area: 'by the window' },
  { number: 7, seats: 2, area: null },
  { number: 9, seats: 4, area: null },
  { number: 12, seats: 4, area: 'back patio' },
  { number: 14, seats: 4, area: null },
];

/** Section 10 and the bills: the menu, by Inventory's categories. */
export const MENU: {
  ref: string;
  name: string;
  category: string;
  cents: number;
  detail: string | null;
  onMenu: boolean;
  soldThisWeek?: number;
  note?: string;
}[] = [
  {
    ref: 'pastor',
    name: 'Al pastor',
    category: 'Tacos',
    cents: 450,
    detail: 'Pork, pineapple, cilantro',
    onMenu: true,
    soldThisWeek: 140,
  },
  {
    ref: 'asada',
    name: 'Carne asada',
    category: 'Tacos',
    cents: 500,
    detail: 'Grilled steak, salsa verde',
    onMenu: true,
  },
  {
    ref: 'pescado',
    name: 'Pescado',
    category: 'Tacos',
    cents: 550,
    detail: 'Battered fish, cabbage, crema',
    onMenu: true,
  },
  {
    ref: 'hongos',
    name: 'Hongos',
    category: 'Tacos',
    cents: 450,
    detail: 'Mushroom, poblano, queso',
    onMenu: true,
  },
  {
    ref: 'birria',
    name: 'Birria, 3',
    category: 'Tacos',
    cents: 1300,
    detail: null,
    onMenu: false,
    note: 'weekends only',
  },
  {
    ref: 'burrito',
    name: 'Carne asada burrito',
    category: 'Burritos',
    cents: 1250,
    detail: null,
    onMenu: true,
  },
  {
    ref: 'horchata',
    name: 'Horchata',
    category: 'Drinks',
    cents: 350,
    detail: null,
    onMenu: true,
  },
  {
    ref: 'jamaica',
    name: 'Jamaica',
    category: 'Drinks',
    cents: 350,
    detail: null,
    onMenu: true,
  },
  {
    ref: 'coke',
    name: 'Mexican Coke',
    category: 'Drinks',
    cents: 350,
    detail: null,
    onMenu: true,
  },
  {
    ref: 'churros',
    name: 'Churros',
    category: 'Dessert',
    cents: 575,
    detail: null,
    onMenu: true,
  },
  {
    ref: 'nachos',
    name: 'Nachos grande',
    category: 'Sides',
    cents: 1950,
    detail: null,
    onMenu: true,
  },
  {
    ref: 'chips',
    name: 'Chips and salsa',
    category: 'Sides',
    cents: 450,
    detail: null,
    onMenu: true,
  },
];

/** The order categories show in (section 10). */
export const CATEGORY_ORDER = ['Tacos', 'Drinks', 'Dessert', 'Sides', 'Specials'];

/** Table 12's tab (sections 8, 11, 13): 4 Al pastor, 2 Horchata, 1 Nachos grande, tax $3.70, $48.20. */
export const TAB_12 = {
  lines: [
    ['pastor', 4],
    ['horchata', 2],
    ['nachos', 1],
  ] as [string, number][],
  taxCents: 370,
  totalCents: 4820,
  sentAt: '7:42 PM',
};

/**
 * Order 0142 at the counter (sections 5, 7, 12). The reference draws $3.45 of tax and $45.70; at the
 * one rate Table 12's bill sets (8.32%), it's $3.51 and $45.76, $4.24 change from $50.00 (DECISIONS ›
 * Terminal Phase 4).
 */
export const ORDER_0142 = {
  number: 142,
  lines: [
    ['burrito', 2],
    ['chips', 1],
    ['coke', 2],
    ['churros', 1],
  ] as [string, number][],
  taxCents: 351,
  totalCents: 4576,
  handedOverCents: 5000,
  at: '12:41pm',
};

/** The wait list after Ana is seated at 6 (seating addendum). */
export const WAITLIST: {
  name: string;
  size: number;
  phone: string | null;
  quoted: number;
  state: 'waiting' | 'seated';
  table?: number;
}[] = [
  {
    name: 'Ana',
    size: 2,
    phone: '(909) 555-0142',
    quoted: 0,
    state: 'seated',
    table: 6,
  },
  {
    name: 'Lee',
    size: 4,
    phone: '(909) 555-0177',
    quoted: 5,
    state: 'waiting',
  },
  { name: 'Marco', size: 3, phone: null, quoted: 10, state: 'waiting' },
  {
    name: 'Priya',
    size: 2,
    phone: '(909) 555-0190',
    quoted: 15,
    state: 'waiting',
  },
];

/** Section 9: counter orders waiting, called, picked up. */
export const PICKUPS = [
  {
    number: 27,
    name: 'Ana',
    paid: '12:41pm',
    items: 4,
    service: 'to_go' as const,
    called: null,
    picked: null,
  },
  {
    number: 26,
    name: null,
    paid: '12:38pm',
    items: 2,
    service: 'to_go' as const,
    called: '12:39pm',
    picked: null,
  },
  {
    number: 25,
    name: 'Lee',
    paid: '12:30pm',
    items: 3,
    service: 'to_go' as const,
    called: '12:33pm',
    picked: '12:35pm',
  },
];

/** Section 6: the drawer today. */
export const DRAWER_DAY = {
  opens: 23,
  withSale: 21,
  noSales: [
    { at: '11:04am', who: 'Jen', why: 'change for a $50', approvedBy: 'Ana' },
    { at: '2:15pm', who: 'Luis', why: 'counting', approvedBy: null },
  ],
  withKey: [{ order: '0142' }],
};
