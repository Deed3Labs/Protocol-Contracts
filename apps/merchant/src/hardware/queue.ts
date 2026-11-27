import type { CreateOrder, DrawerEvent, MerchantApi } from '@clear/merchant-contracts';
import { z } from 'zod';

/**
 * What the counter did while the connection was down, kept on the tablet and sent when it's back
 * (terminal prompt: "Drawer events and cash sales made offline are queued on the tablet and synced
 * later, exactly once"). One queue, in the order things happened: a cash sale (its order and its
 * cash, by the tablet's own figures and time) and the drawer's log.
 *
 * Exactly once comes from the server, not from here: an order carries its idempotency key, a cash
 * tender its own, and a drawer event its client id, so a sync that's cut off and sent again is the
 * same sale and the same open. Card and Clear never queue: they need the connection.
 */

export type QueuedCashSale = {
  kind: 'cashSale';
  /** The order's retry key; drawer events made for this sale point at it until it has an id. */
  orderKey: string;
  order: z.input<typeof CreateOrder> & {
    idempotencyKey: string;
    offline: NonNullable<z.input<typeof CreateOrder>['offline']>;
  };
  cash: {
    amountCents: number;
    tipCents: number;
    handedOverCents: number;
    idempotencyKey: string;
    clientCreatedAt: string;
  };
};

/** A drawer event made offline; `orderKey` names an offline sale's order until it's synced. */
export type QueuedDrawerEvent = {
  kind: 'drawerEvent';
  event: DrawerEvent;
  orderKey: string | null;
};

export type QueueItem = QueuedCashSale | QueuedDrawerEvent;

/** Where the queue lives: IndexedDB on a device, memory in tests. */
export interface QueueStore {
  add(item: QueueItem): Promise<void>;
  /** Everything, oldest first, with each item's own key. */
  all(): Promise<{ key: number; item: QueueItem }[]>;
  remove(key: number): Promise<void>;
}

export function memoryStore(): QueueStore {
  let next = 1;
  const items = new Map<number, QueueItem>();
  return {
    add: async (item) => void items.set(next++, structuredClone(item)),
    all: async () => [...items.entries()].sort((a, b) => a[0] - b[0]).map(([key, item]) => ({ key, item: structuredClone(item) })),
    remove: async (key) => void items.delete(key),
  };
}

const DB = 'clear-merchant';
const STORE = 'offline-queue';

/** The tablet's own, surviving a reload or a dead battery. */
export function indexedDbStore(): QueueStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void) =>
    open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const r = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve((r as IDBRequest<T> | undefined)?.result as T);
          tx.onerror = () => reject(tx.error);
        }),
    );
  return {
    add: (item) => run('readwrite', (s) => s.add(item)).then(() => undefined),
    all: () =>
      run<{ key: number; item: QueueItem }[]>('readonly', () => undefined).then(
        () =>
          new Promise((resolve, reject) =>
            open().then((db) => {
              const out: { key: number; item: QueueItem }[] = [];
              const req = db.transaction(STORE).objectStore(STORE).openCursor();
              req.onsuccess = () => {
                const c = req.result;
                if (!c) return resolve(out);
                out.push({ key: c.key as number, item: c.value as QueueItem });
                c.continue();
              };
              req.onerror = () => reject(req.error);
            }),
          ),
      ),
    remove: (key) => run('readwrite', (s) => s.delete(key)).then(() => undefined),
  };
}

/** A refusal from the server (a 4xx), as opposed to not reaching it. */
const refused = (e: unknown) => {
  const status = (e as { status?: number })?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
};

export interface SyncResult {
  synced: number;
  /** Items the server refused; set aside so they don't block the rest, and shown to the owner. */
  refused: { item: QueueItem; message: string }[];
  /** True when the connection dropped again part-way; the rest wait for next time. */
  stopped: boolean;
}

/**
 * Send everything, in order. A cash sale's order first, then its cash; a drawer event made for an
 * offline sale gets the order's id once the sale is in. Stops at the first item that can't reach the
 * server, so nothing is sent out of order.
 */
export async function syncQueue(store: QueueStore, api: Pick<MerchantApi, 'createOrder' | 'createCashTender' | 'saveDrawerEvents'>): Promise<SyncResult> {
  const out: SyncResult = { synced: 0, refused: [], stopped: false };
  const orderIds = new Map<string, string>();
  for (const { key, item } of await store.all()) {
    try {
      if (item.kind === 'cashSale') {
        const order = await api.createOrder(item.order);
        orderIds.set(item.orderKey, order.id);
        await api.createCashTender(order.id, item.cash);
      } else {
        const event =
          item.orderKey && item.event.kind === 'opened'
            ? {
                ...item.event,
                orderId: orderIds.get(item.orderKey) ?? item.event.orderId,
              }
            : item.event;
        await api.saveDrawerEvents({ events: [event] });
      }
      await store.remove(key);
      out.synced += 1;
    } catch (e) {
      if (!refused(e)) {
        out.stopped = true;
        break;
      }
      out.refused.push({
        item,
        message: e instanceof Error ? e.message : 'Refused',
      });
      await store.remove(key);
    }
  }
  return out;
}
