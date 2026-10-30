import type { Queryable } from '../../db/db.js';

/*
 * Where the shops are, for the Merchants map: each shop's street address turned into a point by the US Census
 * geocoder (free, no key, US addresses), looked up once and kept in command.geocodes. Kai's choice (2026-10-30)
 * over Nominatim and over pins placed near a city's middle: a pin is at the shop's door or there is no pin.
 *
 * A partner's address is the merchant app's (merchant.profiles); a pipeline card's is the one typed on it, with
 * its city. An online shop has no door, so no pin. What's asked is the one-line address, and that's the key.
 */

const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
/** An address with no match is asked again after this long: the Census's data catches up with new addresses. */
const RETRY_MS = 30 * 24 * 60 * 60 * 1000;

/** The parts of an address as one line: "300 E State St, Redlands, CA, 92373", empty parts left out. */
export const oneLine = (...parts: Array<string | null | undefined>) =>
  parts
    .map((p) => String(p ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ');
/** How an address is kept: its one line, lower case. */
export const geoKey = (line: string) => line.toLowerCase();

export interface Point {
  lat: number;
  lng: number;
  matched: string;
}

/** The Census's first match for a one-line address, or null for none. Throws when it can't be asked. */
export async function censusGeocode(line: string, f: typeof fetch = fetch): Promise<Point | null> {
  const url = new URL(CENSUS);
  url.search = new URLSearchParams({ address: line, benchmark: 'Public_AR_Current', format: 'json' }).toString();
  const r = await f(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Census geocoder: HTTP ${r.status}`);
  const m = ((await r.json()) as { result?: { addressMatches?: Array<{ matchedAddress: string; coordinates: { x: number; y: number } }> } }).result?.addressMatches?.[0];
  return m ? { lat: m.coordinates.y, lng: m.coordinates.x, matched: m.matchedAddress } : null;
}

/** Every shop the map could pin, by the id the page knows it by: a partner's merchant id, a card's own id. */
export async function shopAddresses(db: Queryable): Promise<Array<{ id: string; line: string }>> {
  const out: Array<{ id: string; line: string }> = [];
  try {
    const { rows } = await db.query<{ id: string; a1: string; city: string | null; region: string | null; zip: string | null }>(
      `SELECT lower(merchant) AS id, address_line1 AS a1, address_city AS city, address_region AS region, address_postal_code AS zip
         FROM merchant.profiles WHERE coalesce(trim(address_line1), '') <> ''`,
    );
    for (const r of rows) out.push({ id: r.id, line: oneLine(r.a1, r.city, r.region, r.zip) });
  } catch {
    // no merchant app here (the seed's own database): only the pipeline's cards
  }
  const { rows: cards } = await db.query<{ id: string; address: string; city: string }>(
    `SELECT id, address, city FROM command.merchant_stage WHERE removed_at IS NULL AND sells <> 'online' AND trim(address) <> ''`,
  );
  for (const c of cards) out.push({ id: c.id, line: oneLine(c.address, c.city) });
  return out;
}

/**
 * Looks up the shops' addresses that haven't been yet (or found nothing a while ago), a few at a time, and keeps
 * what comes back. A lookup that fails to reach the Census is left for the next pass.
 */
export async function geocodeShops(db: Queryable, opts: { limit?: number; fetch?: typeof fetch; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const lines = [...new Set((await shopAddresses(db)).map((s) => s.line))];
  if (!lines.length) return { looked: 0, found: 0 };
  const { rows: known } = await db.query<{ address: string; lat: number | null; looked_at: Date }>('SELECT address, lat, looked_at FROM command.geocodes WHERE address = ANY($1)', [
    lines.map(geoKey),
  ]);
  const have = new Map(known.map((k) => [k.address, k]));
  const todo = lines.filter((l) => {
    const k = have.get(geoKey(l));
    return !k || (k.lat == null && now - new Date(k.looked_at).getTime() > RETRY_MS);
  });
  let looked = 0,
    found = 0;
  for (const line of todo.slice(0, opts.limit ?? 20)) {
    let p: Point | null;
    try {
      p = await censusGeocode(line, opts.fetch);
    } catch {
      continue;
    }
    looked++;
    if (p) found++;
    await db.query(
      `INSERT INTO command.geocodes (address, lat, lng, matched, looked_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address) DO UPDATE SET lat = $2, lng = $3, matched = $4, looked_at = $5`,
      [geoKey(line), p?.lat ?? null, p?.lng ?? null, p?.matched ?? null, new Date(now)],
    );
  }
  return { looked, found };
}

/** Each pinned shop's point, by its id, from what's been looked up: [lat, lng]. */
export async function shopPins(db: Queryable): Promise<Record<string, [number, number]>> {
  const shops = await shopAddresses(db);
  if (!shops.length) return {};
  const { rows } = await db.query<{ address: string; lat: number; lng: number }>('SELECT address, lat, lng FROM command.geocodes WHERE lat IS NOT NULL AND address = ANY($1)', [
    shops.map((s) => geoKey(s.line)),
  ]);
  const at = new Map(rows.map((r) => [r.address, [Number(r.lat), Number(r.lng)] as [number, number]]));
  const out: Record<string, [number, number]> = {};
  for (const s of shops) {
    const p = at.get(geoKey(s.line));
    if (p) out[s.id] = p;
  }
  return out;
}
