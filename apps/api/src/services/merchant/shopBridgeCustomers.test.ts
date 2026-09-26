import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { seedShop, testDb } from '../../db/testDb.js';
import { resolveCustomerForEmails } from '../bridgeCustomerService.js';
import { shopBridgeCustomers } from './shopBridgeCustomers.js';

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

describe('a shop’s Bridge customer is never a member’s', () => {
  test('picks out the shops’ customers from a list', async () => {
    const s = await seedShop(db);
    await db.query(`UPDATE merchant.profiles SET bridge_customer_id = 'cus_shop' WHERE merchant = $1`, [s.merchant]);
    expect([...(await shopBridgeCustomers(['cus_shop', 'cus_member', ''], db))]).toEqual(['cus_shop']);
    expect((await shopBridgeCustomers([], db)).size).toBe(0);
    expect((await shopBridgeCustomers(['cus_shop'], null)).size).toBe(0);
  });

  describe('the member app’s lookup by email', () => {
    const realFetch = globalThis.fetch;
    const saved = { key: process.env.BRIDGE_API_KEY, url: process.env.BRIDGE_API_BASE_URL };
    afterEach(() => {
      globalThis.fetch = realFetch;
      process.env.BRIDGE_API_KEY = saved.key;
      process.env.BRIDGE_API_BASE_URL = saved.url;
    });
    const bridgeWith = (customers: string[], links: string[] = []) => {
      process.env.BRIDGE_API_KEY = 'sk-test-fake';
      process.env.BRIDGE_API_BASE_URL = 'https://bridge.test/v0';
      globalThis.fetch = (async (url: string | URL) => {
        const u = String(url);
        const body = u.includes('/customers?') ? { data: customers.map((id) => ({ id })) } : { data: links.map((customer_id) => ({ customer_id })) };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;
    };
    const shops = async (ids: string[]) => new Set(ids.filter((id) => id === 'cus_shop'));

    test('skips the shop’s business for the owner’s own customer under the same email', async () => {
      bridgeWith(['cus_shop', 'cus_member']);
      expect(await resolveCustomerForEmails(['mike@gmail.com'], shops)).toEqual({ customerId: 'cus_member', email: 'mike@gmail.com' });
    });

    test('only the shop’s: no member customer, not the shop’s', async () => {
      bridgeWith(['cus_shop'], ['cus_shop']);
      expect(await resolveCustomerForEmails(['mike@gmail.com'], shops)).toBeNull();
    });

    test('found through a verification link, the same rule', async () => {
      bridgeWith([], ['cus_shop', 'cus_member']);
      expect(await resolveCustomerForEmails(['mike@gmail.com'], shops)).toEqual({ customerId: 'cus_member', email: 'mike@gmail.com' });
    });
  });
});
