import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { seedShop, testDb } from '../../db/testDb.js';
import { censusGeocode, geocodeShops, oneLine, shopPins } from './geocode.js';

/*
 * The Merchants map's pins: shops' street addresses through a stand-in for the US Census geocoder. Looked up once,
 * kept, an address with no match left alone until it's due again, and online shops never asked about.
 */

/** A stand-in Census: answers the addresses it knows, and remembers what it was asked. */
function census(known: Record<string, [number, number]>) {
  const asked: string[] = [];
  const f = (async (u: string | URL) => {
    const line = new URL(String(u)).searchParams.get('address') ?? '';
    asked.push(line);
    const p = known[line];
    const addressMatches = p ? [{ matchedAddress: line.toUpperCase(), coordinates: { x: p[1], y: p[0] } }] : [];
    return new Response(JSON.stringify({ result: { addressMatches } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, asked };
}

let db: Db;
let shop: string;
beforeAll(async () => {
  ({ db } = await testDb());
  shop = (await seedShop(db)).merchant;
  await db.query(`UPDATE merchant.profiles SET address_line1 = '300 E State St', address_city = 'Redlands', address_region = 'CA', address_postal_code = '92373' WHERE merchant = $1`, [shop]);
  const card = (id: string, address: string, sells: string) =>
    db.query(`INSERT INTO command.merchant_stage (id, position, name, kind, city, stage, source, address, sells) VALUES ($1, 0, $1, 'Shop', 'Redlands', 'prospect', 'Walk-in', $2, $3)`, [id, address, sells]);
  await card('walkin', '12 Orange St', 'in_person');
  await card('nowhere', '1 Nowhere Ln', 'in_person');
  await card('web', '', 'online');
  await card('webaddr', '9 Web Way', 'online');
});

describe('the Census geocoder', () => {
  test('a match is its first one, as [lat, lng]; none is null', async () => {
    const c = census({ '300 E State St, Redlands': [34.0564, -117.1792] });
    expect(await censusGeocode('300 E State St, Redlands', c.f)).toEqual({ lat: 34.0564, lng: -117.1792, matched: '300 E STATE ST, REDLANDS' });
    expect(await censusGeocode('1 Nowhere Ln, Redlands', c.f)).toBeNull();
  });

  test('an address is its parts on one line, the empty ones left out', () => {
    expect(oneLine(' 300 E  State St ', 'Redlands', '', null, '92373')).toBe('300 E State St, Redlands, 92373');
  });
});

describe('the shops’ pins', () => {
  test('a partner’s address and an in-person card’s are looked up once; an online shop never is', async () => {
    const c = census({ '300 E State St, Redlands, CA, 92373': [34.0564, -117.1792], '12 Orange St, Redlands': [34.0551, -117.1825] });
    expect(await geocodeShops(db, { fetch: c.f })).toEqual({ looked: 3, found: 2 });
    expect(c.asked.sort()).toEqual(['1 Nowhere Ln, Redlands', '12 Orange St, Redlands', '300 E State St, Redlands, CA, 92373']);
    expect(await shopPins(db)).toEqual({ [shop.toLowerCase()]: [34.0564, -117.1792], walkin: [34.0551, -117.1825] });
    // kept: a second pass asks nothing, the miss included, until it's due again
    const again = census({});
    expect(await geocodeShops(db, { fetch: again.f })).toEqual({ looked: 0, found: 0 });
    expect(await geocodeShops(db, { fetch: again.f, now: Date.now() + 31 * 24 * 60 * 60 * 1000 })).toEqual({ looked: 1, found: 0 });
    expect(again.asked).toEqual(['1 Nowhere Ln, Redlands']);
  });

  test('a card whose address changes is looked up at its new one', async () => {
    await db.query(`UPDATE command.merchant_stage SET address = '5 State St' WHERE id = 'walkin'`);
    expect(await shopPins(db)).not.toHaveProperty('walkin');
    const c = census({ '5 State St, Redlands': [34.06, -117.18] });
    expect((await geocodeShops(db, { fetch: c.f })).found).toBe(1);
    expect((await shopPins(db)).walkin).toEqual([34.06, -117.18]);
  });

  test('the Census out of reach is no answer: nothing is kept, and it’s asked next pass', async () => {
    await db.query(`UPDATE command.merchant_stage SET address = '7 Down St' WHERE id = 'walkin'`);
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await geocodeShops(db, { fetch: down })).toEqual({ looked: 0, found: 0 });
    const c = census({ '7 Down St, Redlands': [34.07, -117.19] });
    expect((await geocodeShops(db, { fetch: c.f })).found).toBe(1);
  });
});
