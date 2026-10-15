/**
 * What the phone pages read, as `@clear/merchant-contracts` defines it (public.ts, orders.ts). Only
 * the fields these pages draw: the API sends more, and the contracts are the source.
 */

export interface PublicBill {
  orderNumber: number | null;
  lines: { name: string; quantity: number; lineCents: number }[];
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  remainingCents: number;
  sentAt: string;
}

export interface Receipt {
  shop: { name: string; address: string | null };
  orderNumber: number | null;
  issuedAt: string;
  lines: { name: string; quantity: number; lineCents: number }[];
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  tenders: { method: 'clear' | 'card' | 'cash' | string; amountCents: number; tipCents: number; card: string | null; changeCents: number | null; status: string }[];
  table?: string | null;
  code?: string | null;
}

export type PointView = 'menu' | 'pay_here' | 'bill' | 'paid' | 'waitlist';

export interface PublicPoint {
  code: string;
  shop: { name: string };
  table: string | null;
  placement: 'counter' | 'table' | 'door';
  view: PointView;
  bill: PublicBill | null;
  paid: { paidAt: string; receipt: Receipt } | null;
  waitlist: { quotedMinutes: number } | null;
  pay: { clear: boolean; card: boolean };
}

export interface PublicMenu {
  categories: { name: string; items: { id: string; name: string; detail: string | null; priceCents: number }[] }[];
}

export type PublicPayStarted = { method: 'clear'; chargeCode: string; url: string } | { method: 'card'; checkoutUrl: string };

export interface WaitlistJoined {
  position: number;
  quotedMinutes: number;
}
