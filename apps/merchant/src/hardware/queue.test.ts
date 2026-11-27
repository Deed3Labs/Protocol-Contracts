import { describe, expect, test } from 'bun:test';
import type { MerchantApi } from '@clear/merchant-contracts';
import { memoryStore, syncQueue, type QueueItem } from './queue';

const at = '2026-10-15T12:41:00-07:00';
const sale = (n: number): QueueItem => ({
  kind: 'cashSale',
  orderKey: `ord-${n}-offline`,
  order: {
    lines: [
      {
        itemId: null,
        name: 'Burritos',
        note: null,
        amountCents: 4225,
        taxKind: 'food',
      },
    ],
    customer: null,
    idempotencyKey: `ord-${n}-offline`,
    offline: {
      createdAt: at,
      subtotalCents: 4225,
      taxCents: 351,
      totalCents: 4576,
    },
  },
  cash: {
    amountCents: 4576,
    tipCents: 0,
    handedOverCents: 5000,
    idempotencyKey: `cash-${n}-offline`,
    clientCreatedAt: at,
  },
});
const open = (n: number): QueueItem => ({
  kind: 'drawerEvent',
  orderKey: `ord-${n}-offline`,
  event: {
    kind: 'opened',
    clientId: `evt-${n}-offline`,
    drawerId: 'hw_drawer',
    at,
    staffId: 'stf_jen',
    reason: 'sale',
    orderId: null,
    noSale: null,
    approvalId: null,
  },
});

/** A server that keeps what it's sent once, by its keys, as the real one does. */
function server(opts: { downAfter?: number } = {}) {
  const orders = new Map<string, string>();
  const cash = new Set<string>();
  const events = new Map<string, unknown>();
  let calls = 0;
  const reach = () => {
    calls += 1;
    if (opts.downAfter !== undefined && calls > opts.downAfter) throw new TypeError('Failed to fetch');
  };
  const api = {
    createOrder: async (input: { idempotencyKey?: string }) => {
      reach();
      const id = orders.get(input.idempotencyKey!) ?? `ord_${orders.size + 1}`;
      orders.set(input.idempotencyKey!, id);
      return { id } as never;
    },
    createCashTender: async (_orderId: string, input: { idempotencyKey: string }) => {
      reach();
      cash.add(input.idempotencyKey);
      return {} as never;
    },
    saveDrawerEvents: async (input: { events: Array<{ clientId: string }> }) => {
      reach();
      for (const e of input.events) events.set(e.clientId, e);
      return { saved: 1, duplicates: 0 };
    },
  } as unknown as Pick<MerchantApi, 'createOrder' | 'createCashTender' | 'saveDrawerEvents'>;
  return { api, orders, cash, events };
}

describe('the offline queue', () => {
  test('sends a sale and its drawer open, in order, with the order’s id filled in', async () => {
    const store = memoryStore();
    await store.add(sale(1));
    await store.add(open(1));
    const s = server();
    expect(await syncQueue(store, s.api)).toEqual({
      synced: 2,
      refused: [],
      stopped: false,
    });
    expect(s.events.get('evt-1-offline')).toMatchObject({ orderId: 'ord_1' });
    expect(await store.all()).toHaveLength(0);
  });

  test('cut off part-way, it stops, keeps the rest, and sending again counts each sale once', async () => {
    const store = memoryStore();
    for (const n of [1, 2]) await store.add(sale(n));
    const flaky = server({ downAfter: 3 });
    expect((await syncQueue(store, flaky.api)).stopped).toBe(true);
    expect(await store.all()).toHaveLength(1);
    const back = server();
    back.orders.set('ord-1-offline', 'ord_1');
    await syncQueue(store, back.api);
    expect(await store.all()).toHaveLength(0);
    expect([...flaky.cash, ...back.cash].filter((k) => k === 'cash-1-offline')).toHaveLength(1);
  });

  test('a refusal is set aside rather than holding up the rest', async () => {
    const store = memoryStore();
    await store.add(open(3));
    await store.add(sale(4));
    const s = server();
    s.api.saveDrawerEvents = async () => {
      throw Object.assign(new Error('That drawer isn’t one of the shop’s'), {
        status: 422,
      });
    };
    const r = await syncQueue(store, s.api);
    expect(r.refused.map((x) => x.message)).toEqual(['That drawer isn’t one of the shop’s']);
    expect(r.synced).toBe(1);
  });
});
