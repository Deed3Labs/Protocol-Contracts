import type { Queryable } from '../../db/db.js';
import { feedRows } from './feeds.js';

/*
 * The shop's catalog (docs/command-center-plan.md, Phase 7a and Phase 11): what the store sells.
 *
 * Until Phase 11 the catalog was the website's content file, read through its /api/shop/catalog, and
 * Command kept its own record of a product only for what the site doesn't have (costs, stock, the
 * shelf). Phase 11 moves the catalog here: a product the site sells is imported once (in_catalog), and
 * from then on Command's record is the catalog, served at /api/command/catalog. The site keeps how a
 * product is drawn (its plate, renders and CAD sheets), matched by slug.
 */

const SIZES = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl']);
const title = (s: string) => s.replace(/(^|-)([a-z])/g, (_m, sep, c) => (sep ? ' ' : '') + c.toUpperCase());
/** A variant id as the page shows it: "black-m" is Black, M; "circle" is Circle, no size. */
export function variantParts(variant: string): [string, string] {
  const parts = variant.split('-');
  const size = SIZES.has(parts.at(-1)!) ? parts.pop()!.toUpperCase() : '';
  return [title(parts.join('-')) || 'One size', size];
}

/** A product in the page's shape (the prototype's PR rows). */
export type ShopProduct = { id: string; n: string; v: string; line: string; g: string; price: number; c?: number[]; st: string; cols: string[]; wk: number[]; lead?: number; slug: string; why?: string; dep?: number };

/** A product as the site's catalog serves it (clearpath-website /api/shop/catalog). */
export interface SiteProduct {
  slug: string;
  section: 'goods' | 'for-shops';
  name: string;
  kind: string;
  category: string;
  alsoIn: string[];
  priceCents: number;
  status: 'live' | 'draft';
  colours: Array<{ id: string; label: string }>;
  variants: Array<{ id: string; label: string; depositCents?: number }>;
}
export const SITE_GLYPH: Record<string, string> = { tee: 'tee', 'tee-ls': 'ls', turtleneck: 'turtle', hoodie: 'hood', patch: 'psq', point: 'point', counter: 'tab', kit: 'tab' };

/** The site's product in the page's shape, with Command's own record of it (costs, glyph, lead time) where it has one. */
export function siteProduct(p: SiteProduct, own: ShopProduct | undefined, wk: number[]): ShopProduct & { full?: number; nc?: number } {
  const hw = p.section === 'for-shops';
  const graphic = p.category === 'Graphic Tees' || p.alsoIn.includes('Graphic Tees');
  const line = hw ? 'hw' : graphic ? 'graphic' : p.kind === 'patch' ? 'patch' : p.kind === 'tee' || p.kind === 'tee-ls' ? 'logo' : 'layers';
  const v = graphic ? p.name.replace(/^Graphic Tee\s*[·:–—-]?\s*/i, '') : line === 'logo' ? (p.kind === 'tee' ? 'Short sleeve' : 'Long sleeve') : line === 'patch' ? 'Logo' : '';
  const deposits = p.variants.map((x) => x.depositCents).filter((d): d is number => d != null);
  return {
    id: own?.id ?? p.slug.replace(/[^a-z0-9]/g, ''),
    n: line === 'logo' ? 'Logo Tee' : p.name,
    v,
    line,
    g: own?.g ?? (graphic ? 'gtee' : (SITE_GLYPH[p.kind] ?? (hw ? 'tab' : 'tee'))),
    // a deposit product's price is what it reserves now, as the prototype's is; its full price rides along
    price: hw && deposits.length ? Math.min(...deposits) / 100 : p.priceCents / 100,
    ...(hw ? { dep: 1, full: p.priceCents / 100 } : own?.c ? { c: own.c } : { c: [0, 0, 0, 0], nc: 1 }),
    st: p.status === 'live' ? 'on' : 'draft',
    cols: p.colours.length ? p.colours.map((c) => c.label) : p.variants.map((x) => x.label),
    wk,
    ...(own?.lead != null ? { lead: own.lead } : {}),
    slug: p.slug,
    ...(own?.why ? { why: own.why } : {}),
  };
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
/** The site's product that the page shows as `pid` (or whose slug is `pid`, as a live order's items carry), or null. */
async function siteProductFor(db: Queryable, pid: string): Promise<{ site: SiteProduct; page: ReturnType<typeof siteProduct> } | null> {
  const cat = (await feedRows(db)).get('catalog')?.figures as { products?: SiteProduct[] } | undefined;
  for (const site of cat?.products ?? []) {
    const page = siteProduct(site, undefined, []);
    if (page.id === pid || site.slug === pid) return { site, page };
  }
  return null;
}

/** A product the site sells as the shop's actions read one: its name and state, from the catalog. Null when it sells none by that id. */
export async function siteProductRow(db: Queryable, pid: string) {
  const s = await siteProductFor(db, pid);
  return s ? { id: s.page.id, name: s.page.n, variant: s.page.v, status: s.page.st, price_cents: Math.round((s.page.full ?? s.page.price) * 100) } : null;
}

/**
 * Makes Command's record of a product the site sells but Command has none for, from the catalog: live,
 * with no seed, every product starts this way, and its record is made the first time someone acts on
 * it (a recipe, a run, the shelf, its details). Its costs aren't entered yet (null boxes); its stock is
 * 0 for each colour and, for a sized product, each of the six sizes, so a run has somewhere to land.
 * Returns whether the site sells it (it may already have been made).
 */
export async function adoptSiteProduct(db: Queryable, pid: string, at: Date, who: string): Promise<boolean> {
  const s = await siteProductFor(db, pid);
  if (!s || s.page.id !== pid) return false;
  await recordFromSite(db, s.site, at, who, 'Command’s record started from the site’s catalog');
  return true;
}

/** Makes Command's record of a site product (see adoptSiteProduct), if it has none yet. Returns whether it made one. */
async function recordFromSite(db: Queryable, site: SiteProduct, at: Date, who: string, what: string): Promise<boolean> {
  const page = siteProduct(site, undefined, []);
  const priceCents = Math.round((page.full ?? page.price) * 100);
  if (priceCents <= 0) return false;
  const r = await db.query(
    `INSERT INTO command.shop_products (id, position, name, variant, line, glyph, price_cents, cost_cents, status, options, lead_weeks, slug, why, deposit)
     VALUES ($1, (SELECT coalesce(max(position), -1) + 1 FROM command.shop_products), $2, $3, $4, $5, $6, NULL, $7, $8, NULL, $9, NULL, $10)
     ON CONFLICT DO NOTHING RETURNING 1`,
    [page.id, page.n, page.v, page.line, page.g, priceCents, page.st, page.cols, site.slug, !!page.dep],
  );
  if (!r.rows.length) return false;
  // each colour (or option), and for a sized product all six sizes, so the page's grid lines up
  const sized = site.variants.some((x) => variantParts(x.id)[1]);
  const sizes = sized ? SIZE_ORDER : [''];
  for (const [oi, opt] of page.cols.entries())
    for (const [si, size] of sizes.entries()) await db.query('INSERT INTO command.shop_stock (product_id, option, option_pos, size, size_pos, on_hand) VALUES ($1, $2, $3, $4, $5, 0) ON CONFLICT DO NOTHING', [page.id, opt, oi, size, si]);
  await db.query('INSERT INTO command.shop_history (product_id, at, what, who) VALUES ($1, $2, $3, $4)', [page.id, at, what, who]);
  return true;
}

// ── Phase 11a: the catalog in Command ───────────────────────────────────────

export type Tone = 'ink' | 'land' | 'paper';
export interface CatalogColour {
  id: string;
  label: string;
  swatch: string;
  tone: Tone;
  fill?: boolean;
}
export interface CatalogVariant {
  id: string;
  label: string;
  priceCents?: number;
  depositCents?: number;
  per?: string;
  colour?: string;
  size?: string;
  soldOut?: boolean;
}
/**
 * A product as the store reads it: the site's `Product` (clearpath-website content/shop.ts) without
 * how it's drawn (tone, plate, media). The site's full catalog sends this shape (?full=1, with the
 * token) for the import, and Command's own catalog serves it.
 */
export interface CatalogProduct {
  slug: string;
  section: 'goods' | 'for-shops';
  name: string;
  /** the line under the name */
  line: string;
  description: string;
  priceCents: number;
  kind: string;
  category: string;
  alsoIn: string[];
  featured?: boolean;
  variantLabel?: string;
  variants: CatalogVariant[];
  colours: CatalogColour[];
  details: string[];
  weightOz: number;
  images?: Array<{ src: string; alt: string }>;
  /** goods: the month they ship */
  ships?: string;
  /** hardware: reserved now, shipped then, and whether it awaits FCC authorization */
  preorder?: { ships: string; fcc: boolean };
  fcc?: string;
  founding?: string;
  status: 'draft' | 'live';
}

/** Whether the site sent its full records (?full=1), which the import needs, or only the summary Command reads. */
export const isFull = (products: unknown[]): products is CatalogProduct[] =>
  products.length > 0 && products.every((p: any) => typeof p?.description === 'string' && Array.isArray(p?.details) && Array.isArray(p?.colours));

/** The site's status for Command's: on the shelf is live; off, a draft and archived aren't. */
const siteStatus = (st: string): 'live' | 'draft' => (st === 'on' ? 'live' : 'draft');

/**
 * Imports the site's catalog into Command, once a product: each product Command doesn't own yet
 * (not in_catalog) gets its record (made like adoptSiteProduct's, or the existing one found by slug or
 * an old slug), filled with the site's fields, colours and variants. A product already in Command's
 * catalog is left alone: from then on Command's record is the catalog, and the site's copy can't
 * overwrite an edit. An existing record keeps its shelf status. Returns the ids imported.
 */
export async function importCatalog(db: Queryable, products: CatalogProduct[], moved: Record<string, string>, at: Date, who = 'The site’s catalog'): Promise<string[]> {
  for (const [from, to] of Object.entries(moved)) await db.query('INSERT INTO command.shop_moved (old_slug, new_slug) VALUES ($1, $2) ON CONFLICT (old_slug) DO NOTHING', [from, to]);
  const { rows: own } = await db.query<{ id: string; slug: string; in_catalog: boolean }>('SELECT id, slug, in_catalog FROM command.shop_products');
  const bySlug = new Map(own.map((r) => [moved[r.slug] ?? r.slug, r]));
  const imported: string[] = [];
  for (const p of products) {
    const had = bySlug.get(p.slug);
    if (had?.in_catalog) continue;
    if (!had && !(await recordFromSite(db, p, at, who, 'Imported into Command’s catalog from the site'))) continue;
    const id = had?.id ?? siteProduct(p, undefined, []).id;
    await fillRecord(db, id, p, !!had);
    if (had) await db.query('INSERT INTO command.shop_history (product_id, at, what, who) VALUES ($1, $2, $3, $4)', [id, at, 'Imported into Command’s catalog from the site', who]);
    imported.push(id);
  }
  return imported;
}

/** Fills a record with the store's fields, colours and variants. `keepStatus`: an existing record keeps its shelf status. */
async function fillRecord(db: Queryable, id: string, p: CatalogProduct, keepStatus: boolean) {
  await db.query(
    `UPDATE command.shop_products SET in_catalog = true, slug = $2, section = $3, kind = $4, title = $5, tagline = $6, description = $7, details = $8,
       category = $9, also_in = $10, featured = $11, variant_label = $12, weight_oz = $13, ships = $14, fcc = $15, fcc_notice = $16, founding = $17,
       images = $18, price_cents = $19, status = CASE WHEN $20 THEN status ELSE $21 END
     WHERE id = $1`,
    [
      id, p.slug, p.section, p.kind, p.name, p.line ?? '', p.description, p.details, p.category, p.alsoIn ?? [], !!p.featured, p.variantLabel ?? null,
      p.weightOz > 0 ? p.weightOz : null, p.preorder?.ships ?? p.ships ?? null, !!p.preorder?.fcc, p.fcc ?? null, p.founding ?? null,
      JSON.stringify(p.images ?? []), p.priceCents, keepStatus, p.status === 'live' ? 'on' : 'draft',
    ],
  );
  await setColours(db, id, p.colours ?? []);
  await setVariants(db, id, p.variants);
}

/**
 * A product added in Command (Phase 11b), straight into its catalog as a draft: its record made the way
 * an imported one's is (shelf labels, line and glyph from its kind, stock at 0 for each colour and
 * size). Returns its id, or null when one already has its slug or id.
 */
export async function addToCatalog(db: Queryable, p: CatalogProduct, at: Date, who: string): Promise<string | null> {
  const draft = { ...p, status: 'draft' as const };
  if (await db.query('SELECT 1 FROM command.shop_products WHERE slug = $1', [p.slug]).then((r) => r.rows.length)) return null;
  if (!(await recordFromSite(db, draft, at, who, 'Added to the catalog as a draft'))) return null;
  const id = siteProduct(draft, undefined, []).id;
  await fillRecord(db, id, draft, false);
  return id;
}

/** Replaces a product's colours, in order. */
export async function setColours(db: Queryable, pid: string, colours: CatalogColour[]) {
  await db.query('DELETE FROM command.shop_colours WHERE product_id = $1', [pid]);
  for (const [i, c] of colours.entries())
    await db.query('INSERT INTO command.shop_colours (product_id, id, position, label, swatch, tone, fill) VALUES ($1, $2, $3, $4, $5, $6, $7)', [pid, c.id, i, c.label, c.swatch, c.tone, !!c.fill]);
}
/** Replaces a product's variants, in order. */
export async function setVariants(db: Queryable, pid: string, variants: CatalogVariant[]) {
  await db.query('DELETE FROM command.shop_variants WHERE product_id = $1', [pid]);
  for (const [i, v] of variants.entries())
    await db.query(
      'INSERT INTO command.shop_variants (product_id, id, position, label, colour, size, price_cents, deposit_cents, per, sold_out) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [pid, v.id, i, v.label, v.colour ?? null, v.size ?? null, v.priceCents ?? null, v.depositCents ?? null, v.per ?? null, !!v.soldOut],
    );
}

type ProductRecord = {
  id: string;
  slug: string;
  status: string;
  section: 'goods' | 'for-shops';
  kind: string | null;
  title: string | null;
  name: string;
  tagline: string;
  description: string;
  details: string[];
  category: string;
  also_in: string[];
  featured: boolean;
  variant_label: string | null;
  weight_oz: string | null;
  ships: string | null;
  fcc: boolean;
  fcc_notice: string | null;
  founding: string | null;
  images: Array<{ src: string; alt: string }>;
  price_cents: number;
  sell_past_stock: boolean;
};

/** Command's catalog: every product in it, in the shelf's order, with Command's id and shelf status alongside the store's shape. */
export async function catalogProducts(db: Queryable): Promise<Array<CatalogProduct & { id: string; shelf: string; sellPastStock: boolean }>> {
  const { rows } = await db.query<ProductRecord>('SELECT * FROM command.shop_products WHERE in_catalog ORDER BY position');
  if (!rows.length) return [];
  const { rows: cs } = await db.query<{ product_id: string; id: string; label: string; swatch: string; tone: Tone; fill: boolean }>('SELECT * FROM command.shop_colours ORDER BY product_id, position');
  const { rows: vs } = await db.query<{ product_id: string; id: string; label: string; colour: string | null; size: string | null; price_cents: number | null; deposit_cents: number | null; per: string | null; sold_out: boolean }>(
    'SELECT * FROM command.shop_variants ORDER BY product_id, position',
  );
  const colours = new Map<string, CatalogColour[]>();
  for (const c of cs) (colours.get(c.product_id) ?? colours.set(c.product_id, []).get(c.product_id)!).push({ id: c.id, label: c.label, swatch: c.swatch, tone: c.tone, ...(c.fill ? { fill: true } : {}) });
  const variants = new Map<string, CatalogVariant[]>();
  for (const v of vs)
    (variants.get(v.product_id) ?? variants.set(v.product_id, []).get(v.product_id)!).push({
      id: v.id,
      label: v.label,
      ...(v.price_cents != null ? { priceCents: v.price_cents } : {}),
      ...(v.deposit_cents != null ? { depositCents: v.deposit_cents } : {}),
      ...(v.per ? { per: v.per } : {}),
      ...(v.colour ? { colour: v.colour } : {}),
      ...(v.size ? { size: v.size } : {}),
      ...(v.sold_out ? { soldOut: true } : {}),
    });
  // a product that stops at what's on hand: a colour and size with nothing left shows sold out
  const stops = rows.filter((r) => !r.sell_past_stock).map((r) => r.id);
  const stock = new Map<string, number>();
  if (stops.length) {
    const { rows: st } = await db.query<{ product_id: string; option: string; size: string; on_hand: number }>('SELECT product_id, option, size, on_hand FROM command.shop_stock WHERE product_id = ANY($1)', [stops]);
    for (const x of st) stock.set(`${x.product_id}|${x.option}|${x.size}`, x.on_hand);
  }
  const onHandOf = (pid: string, v: CatalogVariant) => {
    const option = v.colour ? (colours.get(pid)?.find((c) => c.id === v.colour)?.label ?? v.colour) : v.label;
    return stock.get(`${pid}|${option}|${(v.size ?? '').toUpperCase()}`);
  };
  return rows.map((r) => {
    const hw = r.section === 'for-shops';
    return {
      id: r.id,
      shelf: r.status,
      sellPastStock: r.sell_past_stock,
      slug: r.slug,
      section: r.section,
      name: r.title ?? r.name,
      line: r.tagline,
      description: r.description,
      priceCents: r.price_cents,
      kind: r.kind ?? '',
      category: r.category,
      alsoIn: r.also_in,
      ...(r.featured ? { featured: true } : {}),
      ...(r.variant_label ? { variantLabel: r.variant_label } : {}),
      variants: (variants.get(r.id) ?? []).map((v) => (!r.sell_past_stock && !v.soldOut && onHandOf(r.id, v) === 0 ? { ...v, soldOut: true } : v)),
      colours: colours.get(r.id) ?? [],
      details: r.details,
      weightOz: r.weight_oz == null ? 0 : Number(r.weight_oz),
      ...(r.images.length ? { images: r.images } : {}),
      ...(hw ? (r.ships ? { preorder: { ships: r.ships, fcc: r.fcc } } : {}) : r.ships ? { ships: r.ships } : {}),
      ...(r.fcc_notice ? { fcc: r.fcc_notice } : {}),
      ...(r.founding ? { founding: r.founding } : {}),
      status: siteStatus(r.status),
    };
  });
}

/**
 * What /api/command/catalog serves the store: the products on the shelf, and with the token the drafts
 * and those taken off it too (as drafts, which the site shows only where drafts show). Archived ones
 * aren't sent. Plus the moved slugs, old → new.
 */
export async function publicCatalog(db: Queryable, drafts: boolean) {
  const all = await catalogProducts(db);
  const products = all.filter((p) => p.shelf !== 'arch' && (drafts || p.status === 'live')).map(({ id: _id, shelf: _shelf, sellPastStock: _sell, ...p }) => p);
  const { rows } = await db.query<{ old_slug: string; new_slug: string }>('SELECT old_slug, new_slug FROM command.shop_moved ORDER BY old_slug');
  return { products, moved: Object.fromEntries(rows.map((r) => [r.old_slug, r.new_slug])) };
}

/**
 * Command's catalog for the Shop page (Phase 11b), by product id: the store's fields as the store shows
 * them, money in dollars, each variant with what's on hand behind it, and whether it sells past stock.
 */
export async function catalogPayload(db: Queryable): Promise<Record<string, unknown>> {
  const all = await catalogProducts(db);
  if (!all.length) return {};
  const { rows: st } = await db.query<{ product_id: string; option: string; size: string; on_hand: number }>('SELECT product_id, option, size, on_hand FROM command.shop_stock WHERE product_id = ANY($1)', [all.map((p) => p.id)]);
  const stock = new Map(st.map((x) => [`${x.product_id}|${x.option}|${x.size}`, x.on_hand]));
  const d = (c: number | undefined) => (c == null ? null : c / 100);
  return Object.fromEntries(
    all.map((p) => [
      p.id,
      {
        slug: p.slug,
        status: p.status,
        section: p.section,
        kind: p.kind,
        title: p.name,
        tagline: p.line,
        description: p.description,
        details: p.details,
        category: p.category,
        alsoIn: p.alsoIn,
        featured: !!p.featured,
        variantLabel: p.variantLabel ?? null,
        price: p.priceCents / 100,
        weightOz: p.weightOz || null,
        ships: p.preorder?.ships ?? p.ships ?? null,
        fcc: !!p.preorder?.fcc,
        fccNotice: p.fcc ?? null,
        founding: p.founding ?? null,
        images: p.images ?? [],
        sellPastStock: p.sellPastStock,
        colours: p.colours,
        variants: p.variants.map((v) => {
          const option = v.colour ? (p.colours.find((c) => c.id === v.colour)?.label ?? v.colour) : v.label;
          return { id: v.id, label: v.label, colour: v.colour ?? null, size: v.size ?? null, price: d(v.priceCents), deposit: d(v.depositCents), per: v.per ?? null, soldOut: !!v.soldOut, onHand: stock.get(`${p.id}|${option}|${(v.size ?? '').toUpperCase()}`) ?? null };
        }),
      },
    ]),
  );
}

/**
 * Tells the site its catalog changed (Phase 11b), so an edit shows within seconds rather than at its
 * cache's next minute: a POST to COMMAND_SITE_REVALIDATE_URL with the shared token. Off until that's
 * set (the site's route comes in 11c); a failure is logged, never thrown: the change is made either way.
 */
export async function revalidateSite(env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Promise<boolean> {
  const url = env.COMMAND_SITE_REVALIDATE_URL?.trim();
  const token = env.COMMAND_CATALOG_TOKEN?.trim();
  if (!url || !token) return false;
  try {
    const r = await f(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) console.warn(`[catalog] the site's revalidate answered ${r.status}`);
    return r.ok;
  } catch (e) {
    console.warn(`[catalog] couldn't reach the site's revalidate: ${(e as Error).message}`);
    return false;
  }
}

// ── Phase 11d: product photos ───────────────────────────────────────────────

/** A photo the catalog can hold: the site's Blob store, under its product's folder (shop/<id>/). */
export const isProductPhoto = (url: string, pid: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(u.hostname) && u.pathname.startsWith(`/shop/${pid}/`);
  } catch {
    return false;
  }
};
export const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** What the site's route takes in one request (a Vercel function's body tops out at 4.5 MB). */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const photosUrl = (env: Record<string, string | undefined>) => env.COMMAND_SITE_PHOTOS_URL?.trim() || 'https://www.useclear.org/api/shop/photos';

/**
 * Stores a product photo through the site (its /api/shop/photos, with the shared token), which puts it
 * in Vercel Blob and answers with its address. Throws with the site's reason when it refuses.
 */
export async function uploadPhoto(pid: string, name: string, type: string, bytes: Buffer, env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Promise<string> {
  const token = env.COMMAND_CATALOG_TOKEN?.trim();
  if (!token) throw new Error('COMMAND_CATALOG_TOKEN isn’t set, so the site won’t take photos');
  const r = await f(`${photosUrl(env)}?product=${encodeURIComponent(pid)}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!r.ok || !j.url) throw new Error(j.error ?? `The site answered ${r.status}`);
  if (!isProductPhoto(j.url, pid)) throw new Error('The site answered with an address that isn’t one of its photos');
  return j.url;
}

/** Deletes a photo the catalog no longer holds, through the site. A failure is logged, not thrown: the catalog has already let it go. */
export async function deletePhoto(url: string, env: Record<string, string | undefined> = process.env, f: typeof fetch = fetch): Promise<boolean> {
  const token = env.COMMAND_CATALOG_TOKEN?.trim();
  if (!token) return false;
  try {
    const r = await f(photosUrl(env), { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) console.warn(`[catalog] the site didn't delete a photo: ${r.status}`);
    return r.ok;
  } catch (e) {
    console.warn(`[catalog] couldn't reach the site to delete a photo: ${(e as Error).message}`);
    return false;
  }
}
