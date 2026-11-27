import type { LineInput, Order, TaxKind, TaxStatus, Tender } from '@clear/merchant-contracts';
import { price } from '@/data/merchantApi/pricing';
import { indexedDbStore, type QueueStore } from '@/hardware/queue';

/**
 * A cash sale with the connection down (terminal prompt: "A cash sale must open the drawer and print
 * with no internet"). The tablet prices the cart itself, from the catalogue it has and the shop's tax
 * rates as it last read them, and queues the order and its cash together; the server keeps those
 * figures when the queue syncs (CreateOrder.offline). Card and Clear wait for the connection.
 */

const RATES_KEY = 'clear.merchant.taxRates';

/** Keep the shop's rates from Settings › Tax, for a sale made offline. */
export function rememberRates(status: TaxStatus | null | undefined): void {
  if (!status) return;
  const ppm = (pct: string | null) => (pct === null ? 0 : Math.round(parseFloat(pct) * 10_000));
  const rates: Record<TaxKind, number> = {
    goods: ppm(status.rates.goods),
    food: ppm(status.rates.food),
    labour: ppm(status.rates.labour),
    exempt: 0,
  };
  try {
    localStorage.setItem(RATES_KEY, JSON.stringify({ rates, inclusive: status.pricesIncludeTax }));
  } catch {
    // Private windows: an offline sale then can't be priced, and says so.
  }
}

export function rememberedRates(): {
  rates: Record<TaxKind, number>;
  inclusive: boolean;
} | null {
  try {
    const raw = localStorage.getItem(RATES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export class OfflineUnpriced extends Error {}

/** A line as the tablet prices it: the cart already knows each line's price and tax kind. */
export interface OfflineLine {
  input: LineInput;
  name: string;
  quantity: number;
  unitCents: number;
  taxKind: TaxKind;
}

/** The order as the counter's screens need it, priced here. Its id says it isn't on the server yet. */
export function offlineOrder(lines: OfflineLine[], opts: { shop: string; raisedBy: string; now?: Date }): Order {
  const known = rememberedRates();
  if (!known) throw new OfflineUnpriced('A cash sale offline needs the shop’s tax rates, which this tablet hasn’t read yet. Reconnect once, then it can.');
  const p = price(
    lines.map((l) => ({
      lineCents: l.unitCents * l.quantity,
      taxKind: l.taxKind,
      category: null,
    })),
    null,
    { inclusive: known.inclusive, rates: known.rates },
  );
  const key = `offline_${crypto.randomUUID()}`;
  const now = (opts.now ?? new Date()).toISOString();
  return {
    id: key,
    shop: opts.shop,
    number: null,
    name: null,
    raisedBy: opts.raisedBy,
    customer: null,
    status: 'open',
    lines: lines.map((l, i) => ({
      id: `${key}_${i}`,
      itemId: l.input.itemId,
      name: l.name,
      note: null,
      quantity: l.quantity,
      unitCents: l.unitCents,
      options: [],
      lineCents: l.unitCents * l.quantity,
      discountCents: 0,
      taxKind: l.taxKind,
      taxCents: p.taxes[i]!,
    })),
    discount: null,
    subtotalCents: p.subtotal,
    discountCents: 0,
    taxCents: p.tax,
    totalCents: p.total,
    taxIncluded: known.inclusive,
    taxSource: 'none',
    tipCents: 0,
    remainingCents: p.total,
    businessDate: now.slice(0, 10),
    createdAt: now,
    offline: true,
  };
}

export const isOffline = (o: Pick<Order, 'id'> | null | undefined) => !!o && o.id.startsWith('offline_');

let store: QueueStore | null = null;

/** Queue the order and its cash, and answer with the tender the screen shows. */
export async function queueCashSale(
  order: Order,
  lines: LineInput[],
  cash: { amountCents: number; tipCents: number; handedOverCents: number },
  queue: QueueStore = (store ??= indexedDbStore()),
): Promise<Tender> {
  const at = new Date().toISOString();
  await queue.add({
    kind: 'cashSale',
    orderKey: order.id,
    order: {
      lines,
      customer: null,
      idempotencyKey: order.id,
      offline: {
        createdAt: order.createdAt,
        subtotalCents: order.subtotalCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
      },
    },
    cash: { ...cash, idempotencyKey: `${order.id}_cash`, clientCreatedAt: at },
  });
  return {
    id: `${order.id}_cash`,
    orderId: order.id,
    method: 'cash',
    amountCents: cash.amountCents,
    tipCents: cash.tipCents,
    status: 'approved',
    refundedCents: 0,
    cardBrand: null,
    cardLast4: null,
    readerId: null,
    clearChargeCode: null,
    handedOverCents: cash.handedOverCents,
    changeCents: cash.handedOverCents - cash.amountCents - cash.tipCents,
    createdAt: at,
  };
}
