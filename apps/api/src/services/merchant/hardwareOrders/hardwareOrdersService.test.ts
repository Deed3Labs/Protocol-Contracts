import { describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import { cancelHardwareLine, HardwareOrderError, hardwareOrders, lineOf, nameOf, type ShopStripe } from './hardwareOrdersService.js';

const SHOP = '0x00000000000000000000000000000000000000aa';
const OTHER = '0x00000000000000000000000000000000000000bb';
const TODAY = '2026-10-20';

/** The site's Stripe, as the reservations sit in it: metadata per line, and what this does to them. */
function fakeStripe(intents: Array<Partial<Stripe.PaymentIntent> & { id: string; metadata: Record<string, string> }>) {
  const pis = intents.map((p) => ({ status: 'succeeded', created: 1_790_000_000, ...p }) as Stripe.PaymentIntent);
  const refunds: Array<{ payment_intent: string; amount: number; key?: string }> = [];
  const queries: string[] = [];
  const stripe: ShopStripe = {
    paymentIntents: {
      search: async ({ query }) => {
        queries.push(query);
        const shop = /shop_id'\]:'([^']+)'/.exec(query)?.[1];
        return { data: pis.filter((p) => p.metadata.shop_id === shop), has_more: false };
      },
      retrieve: async (id) => pis.find((p) => p.id === id) ?? Promise.reject(new Error('No such payment_intent')),
      update: async (id, { metadata }) => {
        const p = pis.find((x) => x.id === id)!;
        Object.assign(p.metadata, metadata);
        return p;
      },
    },
    refunds: {
      create: async (params, opts) => {
        refunds.push({ payment_intent: params.payment_intent, amount: params.amount, key: opts?.idempotencyKey });
        return { id: `re_${refunds.length}` };
      },
    },
  };
  return { stripe, pis, refunds, queries };
}

const reservation = (id: string, shop: string, extra: Record<string, string> = {}) => ({
  id,
  metadata: {
    kind: 'reservation',
    shop_id: shop,
    reserved_at: '2026-10-16T00:00:00Z',
    r1: 'clear-point/table/4/8900/5500/Feb 2027',
    s1: 'reserved',
    r2: 'clear-tap/m2/1/8900/8000/Mar 2027',
    s2: 'building:2026-10-23',
    ...extra,
  },
});

describe('reading a reservation', () => {
  test('names, money, status and whether Cancel is open, per line', () => {
    const m = reservation('pi_1', SHOP, { r3: 'clear-drawer/one/1/19900/15000/Apr 2027', s3: 'building:2026-10-19', r4: 'full-counter/one/1/114900/91000/Apr 2027', s4: 'shipped:2026-12-01:pi_bal' }).metadata;
    expect(lineOf(m, 1, TODAY)).toEqual({ n: 1, slug: 'clear-point', variant: 'table', name: 'Clear Point, Table', qty: 4, depositCents: 22000, balanceCents: 13600, ships: 'Feb 2027', status: 'reserved', startsOn: null, cancellable: true });
    expect(lineOf(m, 2, TODAY)).toMatchObject({ name: 'Clear Tap, With an M2', depositCents: 8000, balanceCents: 900, status: 'building', startsOn: '2026-10-23', cancellable: true });
    expect(lineOf(m, 3, TODAY)).toMatchObject({ status: 'building', startsOn: '2026-10-19', cancellable: false });
    expect(lineOf(m, 4, TODAY)).toMatchObject({ status: 'shipped', cancellable: false });
    expect(lineOf(m, 9, TODAY)).toBeNull();
    expect(lineOf({ r1: 'clear-point/table/x/8900/5500/Feb 2027' }, 1, TODAY)).toBeNull();
    expect(nameOf('mystery', 'one')).toBe('mystery (one)');
  });
  test('lists only this shop’s paid reservations, newest first', async () => {
    const { stripe, queries } = fakeStripe([
      { ...reservation('pi_old', SHOP), created: 1 },
      { ...reservation('pi_new', SHOP), created: 2 },
      reservation('pi_theirs', OTHER),
      { id: 'pi_unstamped', metadata: { ...reservation('x', SHOP).metadata, reserved_at: '' } },
    ]);
    const r = await hardwareOrders(stripe, SHOP.toUpperCase().replace('0X', '0x'), TODAY);
    expect(r.configured).toBe(true);
    expect(r.orders.map((o) => o.id)).toEqual(['pi_new', 'pi_old']);
    expect(queries[0]).toContain(`metadata['shop_id']:'${SHOP}'`);
  });
  test('says it isn’t configured without the site’s Stripe key', async () => {
    expect(await hardwareOrders(null, SHOP)).toEqual({ configured: false, orders: [] });
  });
});

describe('Cancel', () => {
  test('refunds a reserved line’s deposit in full, once, and marks it refunded', async () => {
    const { stripe, pis, refunds } = fakeStripe([reservation('pi_1', SHOP)]);
    await cancelHardwareLine(stripe, SHOP, 'pi_1', 1, TODAY);
    expect(refunds).toEqual([{ payment_intent: 'pi_1', amount: 22000, key: 'refund-pi_1-1' }]);
    expect(pis[0].metadata.s1).toBe(`refunded:${TODAY}:re_1`);
    await expect(cancelHardwareLine(stripe, SHOP, 'pi_1', 1, TODAY)).rejects.toMatchObject({ status: 409 });
  });
  test('a line building before its start date is refunded; from the start date it is not', async () => {
    const { stripe, refunds } = fakeStripe([reservation('pi_1', SHOP)]);
    await expect(cancelHardwareLine(stripe, SHOP, 'pi_1', 2, '2026-10-23')).rejects.toBeInstanceOf(HardwareOrderError);
    expect(refunds).toHaveLength(0);
    await cancelHardwareLine(stripe, SHOP, 'pi_1', 2, '2026-10-22');
    expect(refunds[0]).toMatchObject({ amount: 8000, key: 'refund-pi_1-2' });
  });
  test('another shop’s order, an unknown id, or a missing line is not found', async () => {
    const { stripe, refunds } = fakeStripe([reservation('pi_1', OTHER), { id: 'pi_goods', metadata: { items: 'member-tee/mx1' } }]);
    await expect(cancelHardwareLine(stripe, SHOP, 'pi_1', 1, TODAY)).rejects.toMatchObject({ status: 404 });
    await expect(cancelHardwareLine(stripe, SHOP, 'pi_goods', 1, TODAY)).rejects.toMatchObject({ status: 404 });
    await expect(cancelHardwareLine(stripe, SHOP, 'pi_nope', 1, TODAY)).rejects.toMatchObject({ status: 404 });
    await expect(cancelHardwareLine(stripe, SHOP, 'not-an-id', 1, TODAY)).rejects.toMatchObject({ status: 404 });
    expect(refunds).toHaveLength(0);
  });
});
