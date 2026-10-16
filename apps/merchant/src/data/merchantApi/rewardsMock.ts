import {
  AddCustomer,
  BRAND_PRESETS,
  Brand,
  brandContrast,
  CounterCustomer,
  earnPoints,
  EarnRulesInput,
  giveBack,
  MAX_FONT_BYTES,
  OfferPatch,
  RewardInput,
  SetShopDomain,
  ShopAppPatch,
  UploadFontFields,
  type CatalogItem,
  type DiscountCode,
  type EarnRules,
  type MerchantRewardsApi,
  type OrderCustomer,
  type OrderCustomerState,
  type ReadyReward,
  type Reward,
  type ShopApp,
  type ShopAppSettings,
  type ShopDomain,
  type UploadedFont,
} from '@clear/merchant-contracts';

/**
 * Rewards in the mock (rewards spec, sections 8 and 9): the shop's app, its earning rules and
 * rewards, and the customer added at the cart. Matching a reward to the cart and what an order earns
 * follow the server's rules (apps/api services/merchant/rewards/counter.ts and ledger.ts), so the
 * cart reads what the real one will.
 *
 * For `&shop=micasa` it's Mi Casa as Settings › Shop app draws it, with Sofia M. (a Clear member, 128
 * points), Dev L. (a Clear member who hasn't joined) and Marco A. (rewards only, 42 points) to add.
 * Any other shop starts with its app off and nobody to add.
 */

export interface RewardsHost {
  micasa: boolean;
  shopName: string;
  shopId: string;
  now: () => string;
  id: (prefix: string) => string;
  viewer: () => string;
  roleOf: (staffId: string) => 'counter' | 'manager' | 'owner' | undefined;
  refuse: (message: string, status?: number, code?: string) => never;
  items: () => CatalogItem[];
  codes: Map<string, DiscountCode>;
  /** The order's lines as matching sees them, before any discount. */
  cart: (orderId: string) => CartLine[];
  /** The order's lines after their share of the discount, and its total: what earning counts. */
  paid: (orderId: string) => { lines: Array<{ netCents: number; category: string | null }>; totalCents: number };
  /** Refuses unless the order can still change. */
  editable: (orderId: string) => void;
  /** Whether a reward is the order's discount now. */
  hasReward: (orderId: string) => boolean;
  /** The shop's own time for a timestamp: weekday (Monday 0) and "HH:MM". */
  clock: (iso: string) => { weekday: number; time: string };
}

export interface CartLine {
  id: string;
  itemId: string | null;
  name: string;
  quantity: number;
  unitCents: number;
  lineCents: number;
  category: string | null;
}

interface PersonRec {
  id: string;
  firstName: string;
  lastInitial: string | null;
  phone: string;
  wallet: string | null;
  clearMember: boolean;
  canPayWithClear: boolean;
  /** At this shop: null when they haven't joined. */
  joinedAt: string | null;
  points: number;
  lastVisit: { at: string; table: string | null } | null;
}

type CustomerRec =
  | { status: 'pending'; phone: string; since: string; expiresAt: string; staffId: string }
  | { status: 'added'; personId: string; addedBy: string | null; via: OrderCustomer['addedVia']; at: string };

/** A typed-in number is confirmed on their phone this long after the text, in the mock. */
export const CONFIRM_AFTER_MS = 4000;
const CONFIRM_MINUTES = 10;

const digits = (p: string) => p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/**
 * What a reward takes off these lines (counter.ts `matchReward`): an item reward is the dearest of
 * its items on the order, up to its cap; an amount or a percent comes off the lines it covers.
 */
export function matchReward(reward: Pick<Reward, 'gives'>, lines: CartLine[]): { amountCents: number; lineId: string | null; label: string } | null {
  const g = reward.gives;
  if (g.kind === 'item') {
    const rank = (itemId: string | null) => (itemId ? g.itemIds.indexOf(itemId) : -1);
    const fits = lines.filter((l) => rank(l.itemId) >= 0).sort((a, b) => b.unitCents - a.unitCents || rank(a.itemId) - rank(b.itemId));
    const line = fits[0];
    if (!line) return null;
    const amount = g.maxCents === null ? line.unitCents : Math.min(line.unitCents, g.maxCents);
    return amount > 0 ? { amountCents: amount, lineId: line.id, label: `1 × ${line.name}` } : null;
  }
  const covered = lines.filter((l) => g.categories === null || (l.category !== null && g.categories.includes(l.category)));
  const base = covered.reduce((s, l) => s + l.lineCents, 0);
  if (base <= 0) return null;
  const amount = g.kind === 'amount' ? Math.min(base, g.amountCents) : Math.floor((base * g.percent) / 100);
  if (amount <= 0) return null;
  const label = g.categories === null ? 'this order' : covered.length === 1 ? `1 × ${covered[0]!.name}` : `${g.categories.join(', ')} on this order`;
  return { amountCents: amount, lineId: covered.length === 1 ? covered[0]!.id : null, label };
}

export function createRewardsMock(h: RewardsHost) {
  const item = (ref: string) => `itm_${ref}`;
  const TACOS = ['pastor', 'asada', 'pescado', 'hongos', 'birria'].map(item);

  // ---- The shop's app ------------------------------------------------------------------------
  const fonts = new Map<string, UploadedFont>();
  if (h.micasa) {
    fonts.set('fnt_casa', {
      id: 'fnt_casa',
      name: 'Casa Display',
      fileName: 'Casa-Display-Bold.woff2',
      sizeBytes: 190_464,
      uploadedAs: 'woff2',
      // No file stands behind it in the mock; the preview falls back to the serif, as the spec draws it.
      url: 'https://useclear.org/s/micasa/fonts/fnt_casa.woff2',
      checks: { glyphs: 'passed', missing: [], legibility: 'passed' },
      usedFor: 'headings',
      licence: { declaredAt: '2026-10-09T17:20:00.000Z', declaredBy: 'stf_mike' },
      uploadedAt: '2026-10-09T17:20:00.000Z',
    });
  }
  const terracotta = BRAND_PRESETS.terracotta;
  let app: ShopApp = {
    slug: h.micasa ? 'micasa' : 'mikes-tire',
    enabled: h.micasa,
    brand: {
      logoUrl: null,
      monogram: h.micasa ? 'MC' : 'MT',
      colour: terracotta.colour,
      onColour: terracotta.onColour,
      paper: terracotta.paper,
      paper2: terracotta.paper2,
      headingFont: h.micasa ? { kind: 'uploaded', fontId: 'fnt_casa' } : { kind: 'preset', preset: 'serif' },
      textFont: { kind: 'preset', preset: 'instrument_sans' },
    },
    pointsName: { kind: 'points' },
    offerCodeIds: [...h.codes.values()].filter((c) => c.showInApp).map((c) => c.id),
    configVersion: 7,
    updatedAt: '2026-10-09T17:22:00.000Z',
  };

  const rewards = new Map<string, Reward>(
    (h.micasa
      ? ([
          { id: 'rwd_agua', name: 'Free agua fresca', gives: { kind: 'item', itemIds: [item('jamaica'), item('horchata')], maxCents: null }, cost: 75, limit: 'daily', clearMembersOnly: false, note: 'any size' },
          { id: 'rwd_churros', name: 'Free churros', gives: { kind: 'item', itemIds: [item('churros')], maxCents: null }, cost: 150, limit: 'daily', clearMembersOnly: false, note: null },
          { id: 'rwd_plate', name: 'Free taco plate', gives: { kind: 'item', itemIds: TACOS, maxCents: 1400 }, cost: 300, limit: 'none', clearMembersOnly: false, note: 'any plate up to $14' },
          { id: 'rwd_tray', name: 'Family tray, $20 off', gives: { kind: 'amount', amountCents: 2000, categories: ['Catering'] }, cost: 600, limit: 'none', clearMembersOnly: true, note: null },
        ] satisfies Reward[])
      : []
    ).map((r) => [r.id, r]),
  );

  let rulesVersion = 3;
  let rules: EarnRules = {
    version: rulesVersion,
    effectiveAt: '2026-10-09T17:22:00.000Z',
    unit: 'dollars',
    pointsPer: 1,
    perAmountCents: 100,
    visitMinCents: 500,
    cardSize: 10,
    keepTheChange: true,
    // Off at Mi Casa (rewards DECISIONS, Hard Stop 2): the spec's 1.5× isn't the shop's choice.
    clearMultiplier: 1,
    boosts: [
      { id: 'bst_tue', name: 'Double points · Tuesdays', multiplier: 2, scope: { kind: 'days', days: [1] }, on: true },
      { id: 'bst_happy', name: 'Happy hour · 2×', multiplier: 2, scope: { kind: 'hours', days: [0, 1, 2, 3, 4], span: { from: '14:00', to: '17:00' } }, on: false },
      { id: 'bst_catering', name: 'Catering · 3×', multiplier: 3, scope: { kind: 'categories', categories: ['Catering'] }, on: false },
    ],
    joinBonus: 25,
    birthdayRewardId: h.micasa ? 'rwd_agua' : null,
    referralBonus: null,
    expiry: 'never',
  };

  let domain: ShopDomain | null = null;

  // ---- People and the counter ----------------------------------------------------------------
  const people = new Map<string, PersonRec>(
    (h.micasa
      ? [
          { id: 'rwp_sofia', firstName: 'Sofia', lastInitial: 'M', phone: '9095550142', wallet: '0x50f1a00000000000000000000000000000000142', clearMember: true, canPayWithClear: true, joinedAt: '2026-03-07T02:10:00.000Z', points: 128, lastVisit: { at: '2026-10-13T02:30:00.000Z', table: 'Table 6' } },
          { id: 'rwp_dev', firstName: 'Dev', lastInitial: 'L', phone: '9095550163', wallet: '0xde70000000000000000000000000000000000163', clearMember: true, canPayWithClear: true, joinedAt: null, points: 0, lastVisit: null },
          { id: 'rwp_marco', firstName: 'Marco', lastInitial: 'A', phone: '9095550188', wallet: null, clearMember: false, canPayWithClear: false, joinedAt: '2026-08-21T19:00:00.000Z', points: 42, lastVisit: { at: '2026-10-03T19:40:00.000Z', table: null } },
        ]
      : []
    ).map((p) => [p.id, p]),
  );
  const customers = new Map<string, CustomerRec>();
  /** The reward that's each order's discount, and the points it will take. */
  const rewardOnOrder = new Map<string, { rewardId: string; points: number }>();

  const canEdit = () => {
    const r = h.roleOf(h.viewer());
    return r === 'owner' || r === 'manager';
  };
  const editor = () => {
    if (!canEdit()) h.refuse('Only owners and managers change the shop’s app', 403, 'forbidden');
  };
  const priceOf = (itemId: string) => h.items().find((i) => i.id === itemId)?.priceCents ?? null;

  function settings(): ShopAppSettings {
    const joined = [...people.values()].filter((p) => p.joinedAt);
    return {
      app: { ...app, offerCodeIds: [...app.offerCodeIds] },
      rules,
      rewards: [...rewards.values()],
      fonts: [...fonts.values()],
      domain,
      storeBuilds: [],
      // Mi Casa's members, as Settings draws them; the mock's three people stand for them at the counter.
      members: h.micasa ? { joined: 214, thisWeek: 38, withClear: 61 } : { joined: joined.length, thisWeek: 0, withClear: 0 },
      link: `useclear.org/s/${app.slug}`,
      giveBack: giveBack(rules, [...rewards.values()], priceOf),
      canEdit: canEdit(),
    };
  }

  // ---- The counter's view of someone ---------------------------------------------------------
  /** What other open orders have promised of their points (counter.ts `spendable`). */
  const held = (personId: string, exceptOrderId: string | null) =>
    [...rewardOnOrder.entries()].reduce((sum, [orderId, r]) => {
      const c = customers.get(orderId);
      return orderId !== exceptOrderId && c?.status === 'added' && c.personId === personId ? sum + r.points : sum;
    }, 0);
  const spendable = (p: PersonRec, orderId: string | null) => p.points - held(p.id, orderId);

  function counterView(p: PersonRec, orderId: string | null): CounterCustomer {
    let membership: CounterCustomer['membership'] = null;
    if (p.joinedAt) {
      const points = spendable(p, orderId);
      const lines = orderId ? h.cart(orderId) : [];
      const ready: ReadyReward[] = [...rewards.values()]
        .filter((r) => r.cost <= points)
        .map((r) => {
          const m = orderId ? matchReward(r, lines) : null;
          return { rewardId: r.id, name: r.name, cost: r.cost, amountCents: m?.amountCents ?? null, matches: m && m.lineId ? { lineId: m.lineId, label: m.label } : null, locked: r.clearMembersOnly && !p.clearMember };
        })
        .sort((a, b) => Number(Boolean(b.matches)) - Number(Boolean(a.matches)) || b.cost - a.cost);
      const next = [...rewards.values()].filter((r) => r.cost > points).sort((a, b) => a.cost - b.cost)[0];
      membership = { points, joinedAt: p.joinedAt, readyRewards: ready, nextReward: next ? { rewardId: next.id, name: next.name, toGo: next.cost - points } : null };
    }
    return CounterCustomer.parse({
      firstName: p.firstName,
      lastInitial: p.lastInitial,
      isClearMember: p.clearMember,
      canPayWithClear: p.canPayWithClear && Boolean(p.wallet),
      membership,
      lastVisit: p.lastVisit,
    });
  }

  /** What this order earns its customer if it's paid now (ledger.ts `previewEarn`). */
  function earns(orderId: string, opts: { clear?: boolean } = {}): number {
    const o = h.paid(orderId);
    return earnPoints({ rules, lines: o.lines, at: h.clock(h.now()), clearCents: opts.clear ? o.totalCents : 0, paidCents: o.totalCents, carryCents: 0, stampedToday: false }).points;
  }

  /** A typed-in number they've confirmed on their phone: known numbers confirm a few seconds on. */
  function settle(orderId: string): CustomerRec | undefined {
    const c = customers.get(orderId);
    if (c?.status !== 'pending') return c;
    if (Date.parse(h.now()) > Date.parse(c.expiresAt)) {
      customers.delete(orderId);
      return undefined;
    }
    const p = [...people.values()].find((x) => x.phone === digits(c.phone));
    if (!p || Date.now() - Date.parse(c.since) < CONFIRM_AFTER_MS) return c;
    const added: CustomerRec = { status: 'added', personId: p.id, addedBy: c.staffId, via: 'phone', at: h.now() };
    customers.set(orderId, added);
    return added;
  }

  function stateOf(orderId: string): OrderCustomerState {
    const c = settle(orderId);
    if (!c) return { status: 'none' };
    if (c.status === 'pending') return { status: 'pending', expiresAt: c.expiresAt };
    const p = people.get(c.personId)!;
    const customer = counterView(p, orderId);
    return { status: 'added', customer, earnsPoints: customer.membership ? earns(orderId) : null };
  }

  // ---- What the order mock asks of rewards ---------------------------------------------------
  const hooks = {
    /** Who the order is for, as `Order.member` carries it. */
    member(orderId: string): OrderCustomer | null {
      const c = settle(orderId);
      return c?.status === 'added' ? { memberId: c.personId, addedBy: c.addedBy, addedVia: c.via, at: c.at } : null;
    },
    /** A reward as the order's discount: checked for the person on it, and how it comes off. */
    rewardSpec(orderId: string, request: { kind: 'reward'; rewardId: string } | { kind: 'claim'; code: string }) {
      if (request.kind === 'claim') h.refuse('That code isn’t one this shop has given out', 422, 'invalid');
      const c = settle(orderId);
      if (c?.status !== 'added') h.refuse('Add the customer first', 409, 'conflict');
      const p = people.get((c as Extract<CustomerRec, { status: 'added' }>).personId)!;
      const r = rewards.get(request.rewardId) ?? h.refuse('That reward isn’t on offer here', 404, 'not_found');
      if (!p.joinedAt) h.refuse(`They haven’t joined ${h.shopName} Rewards`, 409, 'not_joined');
      if (r.clearMembersOnly && !p.clearMember) h.refuse(`${r.name} is for Clear members`, 403, 'forbidden');
      if (spendable(p, orderId) < r.cost) h.refuse(`Not enough points for ${r.name}`, 409, 'not_enough');
      const m = matchReward(r, h.cart(orderId)) ?? h.refuse(`${r.name} doesn’t fit anything on this order`, 422, 'invalid');
      rewardOnOrder.set(orderId, { rewardId: r.id, points: r.cost });
      return { rewardId: r.id, points: r.cost, label: r.name, percent: r.gives.kind === 'percent' ? r.gives.percent : null, amountCents: r.gives.kind === 'percent' ? null : m.amountCents };
    },
    /** An item reward follows the cart: a free drink is still the drink's price after a change. */
    amountNow(orderId: string, rewardId: string): { percent: number | null; amountCents: number | null } {
      const r = rewards.get(rewardId);
      if (!r) return { percent: null, amountCents: 0 };
      if (r.gives.kind === 'percent') return { percent: r.gives.percent, amountCents: null };
      return { percent: null, amountCents: matchReward(r, h.cart(orderId))?.amountCents ?? 0 };
    },
    rewardRemoved(orderId: string) {
      rewardOnOrder.delete(orderId);
    },
    /** Paid: the reward's points come off and what it earned goes on (ledger.ts `onOrderPaid`). */
    paid(orderId: string, opts: { clear: boolean }) {
      const c = settle(orderId);
      if (c?.status !== 'added') return;
      const p = people.get(c.personId)!;
      if (!p.joinedAt) return;
      const used = rewardOnOrder.get(orderId)?.points ?? 0;
      p.points += earns(orderId, opts) - used;
      p.lastVisit = { at: h.now(), table: null };
      rewardOnOrder.delete(orderId);
    },
    /** Who to send a Clear charge to with `{ to: 'customer' }`. */
    customerWallet(orderId: string): string | null {
      const c = settle(orderId);
      return c?.status === 'added' ? (people.get(c.personId)?.wallet ?? null) : null;
    },
    earns,
  };

  // ---- The API -------------------------------------------------------------------------------
  const api: MerchantRewardsApi = {
    shopApp: async () => settings(),
    updateShopApp: async (input) => {
      editor();
      const p = ShopAppPatch.safeParse(input);
      if (!p.success) return h.refuse(p.error.issues[0]?.message ?? 'Those settings aren’t valid', 422, 'invalid');
      const brand = p.data.brand ? Brand.parse({ ...app.brand, ...p.data.brand }) : app.brand;
      const problems = brandContrast(brand);
      if (problems.length) return h.refuse(problems[0]!, 422, 'invalid');
      for (const f of [brand.headingFont, brand.textFont]) {
        if (f.kind === 'uploaded' && fonts.get(f.fontId)?.checks.glyphs !== 'passed') return h.refuse('That font isn’t one you uploaded, or it didn’t pass its checks', 422, 'invalid');
      }
      if (p.data.offerCodeIds) {
        if (p.data.offerCodeIds.some((id) => !h.codes.has(id))) return h.refuse('One of those offers isn’t one of your codes', 422, 'invalid');
        for (const c of h.codes.values()) h.codes.set(c.id, { ...c, showInApp: p.data.offerCodeIds.includes(c.id) });
      }
      if (p.data.rules) {
        const next = p.data.rules;
        rules = { ...next, boosts: next.boosts.map((b) => ({ ...b, id: b.id ?? h.id('bst') })), version: ++rulesVersion, effectiveAt: h.now() };
      }
      app = { ...app, ...(p.data.slug ? { slug: p.data.slug } : {}), ...(p.data.enabled !== undefined ? { enabled: p.data.enabled } : {}), ...(p.data.pointsName ? { pointsName: p.data.pointsName } : {}), ...(p.data.offerCodeIds ? { offerCodeIds: p.data.offerCodeIds } : {}), brand, configVersion: app.configVersion + 1, updatedAt: h.now() };
      return settings();
    },
    createReward: async (input) => {
      editor();
      const p = RewardInput.safeParse(input);
      if (!p.success) return h.refuse(p.error.issues[0]?.message ?? 'That reward isn’t valid', 422, 'invalid');
      const r: Reward = { ...p.data, id: h.id('rwd') };
      rewards.set(r.id, r);
      return r;
    },
    updateReward: async (rewardId, input) => {
      editor();
      if (!rewards.has(rewardId)) return h.refuse('No such reward', 404, 'not_found');
      const p = RewardInput.safeParse(input);
      if (!p.success) return h.refuse(p.error.issues[0]?.message ?? 'That reward isn’t valid', 422, 'invalid');
      const r: Reward = { ...p.data, id: rewardId };
      rewards.set(rewardId, r);
      return r;
    },
    removeReward: async (rewardId) => {
      editor();
      if (!rewards.delete(rewardId)) h.refuse('No such reward', 404, 'not_found');
      if (rules.birthdayRewardId === rewardId) rules = { ...rules, birthdayRewardId: null };
    },
    updateOffer: async (codeId, input) => {
      editor();
      const p = OfferPatch.safeParse(input);
      if (!p.success) return h.refuse(p.error.issues[0]?.message ?? 'That isn’t valid', 422, 'invalid');
      const code = h.codes.get(codeId) ?? h.refuse('No such code', 404, 'not_found');
      const next: DiscountCode = { ...code, ...(p.data.audience ? { audience: p.data.audience } : {}), ...(p.data.showInApp !== undefined ? { showInApp: p.data.showInApp } : {}) };
      h.codes.set(codeId, next);
      if (p.data.showInApp !== undefined) {
        const ids = app.offerCodeIds.filter((id) => id !== codeId);
        app = { ...app, offerCodeIds: p.data.showInApp ? [...ids, codeId] : ids, configVersion: app.configVersion + 1 };
      }
      return next;
    },
    uploadFont: async (file, fields) => {
      editor();
      const f = UploadFontFields.safeParse(fields);
      if (!f.success) return h.refuse(f.error.issues[0]?.message ?? 'That isn’t valid', 422, 'invalid');
      if (file.size > MAX_FONT_BYTES) return h.refuse('Fonts can be 1 MB at most', 413, 'invalid');
      const fileName = file instanceof File ? file.name : 'font';
      const ext = fileName.toLowerCase().split('.').pop();
      if (ext !== 'woff2' && ext !== 'otf' && ext !== 'ttf') return h.refuse('A WOFF2, OTF or TTF file', 422, 'invalid');
      // In the browser the preview can use the file itself; the checks pass, as the spec draws them.
      const url = typeof URL.createObjectURL === 'function' && typeof window !== 'undefined' ? URL.createObjectURL(file) : `https://useclear.org/s/${app.slug}/fonts/upload.woff2`;
      const font: UploadedFont = {
        id: h.id('fnt'),
        name: f.data.name,
        fileName,
        sizeBytes: Math.max(1, file.size),
        uploadedAs: ext,
        url,
        checks: { glyphs: 'passed', missing: [], legibility: 'passed' },
        usedFor: f.data.usedFor,
        licence: { declaredAt: h.now(), declaredBy: h.viewer() },
        uploadedAt: h.now(),
      };
      fonts.set(font.id, font);
      return font;
    },
    giveBack: async (input) => {
      if (!input) return giveBack(rules, [...rewards.values()], priceOf);
      const p = EarnRulesInput.safeParse(input);
      if (!p.success) return h.refuse(p.error.issues[0]?.message ?? 'Those rules aren’t valid', 422, 'invalid');
      return giveBack({ ...p.data, boosts: p.data.boosts.map((b) => ({ ...b, id: b.id ?? 'new' })), version: rules.version, effectiveAt: h.now() }, [...rewards.values()], priceOf);
    },
    setDomain: async (input) => {
      editor();
      const p = SetShopDomain.safeParse({ domain: String(input?.domain ?? '').trim().toLowerCase() });
      if (!p.success) return h.refuse(p.error.issues[0]?.message ?? 'That isn’t a domain', 422, 'invalid');
      const labels = p.data.domain.split('.');
      const record = labels.length > 2 ? { type: 'CNAME' as const, name: labels[0]!, value: 'cname.vercel-dns.com' } : { type: 'A' as const, name: '@', value: '76.76.21.21' };
      domain = { domain: p.data.domain, shopSlug: app.slug, status: 'pending', record, checkedAt: null, verifiedAt: null };
      return domain;
    },
    checkDomain: async () => {
      editor();
      if (!domain) return h.refuse('Add a domain first', 404, 'not_found');
      domain = { ...domain, checkedAt: h.now() };
      return domain;
    },
    addCustomer: async (orderId, input) => {
      h.editable(orderId);
      const b = AddCustomer.safeParse(input);
      if (!b.success) return h.refuse(b.error.issues[0]?.message ?? 'A code or a phone number', 422, 'invalid');
      const current = settle(orderId);
      if (b.data.via === 'code') {
        // `<origin>/send?to=<wallet>&id=<signed>`: the wallet alone is public, so it adds nobody.
        const code = b.data.code;
        const wallet = /[?&]to=(0x[0-9a-fA-F]{40})/.exec(code)?.[1]?.toLowerCase() ?? (/^0x[0-9a-fA-F]{40}$/.test(code) ? code.toLowerCase() : null);
        if (!wallet) return h.refuse('That isn’t a member’s code', 422, 'invalid');
        if (!/[?&]id=[^&]+/.test(code)) return h.refuse('Ask them to open the code again: that one can’t add them', 422, 'invalid');
        const p = [...people.values()].find((x) => x.wallet === wallet) ?? h.refuse('That code isn’t a member’s', 404, 'not_found');
        if (current?.status === 'added' && current.personId !== p.id) return h.refuse('Someone else is on this order. Remove them first', 409, 'conflict');
        customers.set(orderId, { status: 'added', personId: p.id, addedBy: h.viewer(), via: 'code', at: h.now() });
        return stateOf(orderId);
      }
      if (digits(b.data.phone).length !== 10) return h.refuse('That isn’t a phone number we can text', 422, 'invalid');
      if (current?.status === 'added') return h.refuse('Someone else is on this order. Remove them first', 409, 'conflict');
      const expiresAt = plus(h.now(), CONFIRM_MINUTES * 60_000);
      customers.set(orderId, { status: 'pending', phone: b.data.phone, since: new Date().toISOString(), expiresAt, staffId: h.viewer() });
      return { status: 'pending', expiresAt };
    },
    orderCustomer: async (orderId) => stateOf(orderId),
    removeCustomer: async (orderId) => {
      h.editable(orderId);
      if (h.hasReward(orderId)) h.refuse('Undo their reward first', 409, 'conflict');
      customers.delete(orderId);
    },
    inviteCustomer: async (orderId) => {
      const c = settle(orderId);
      if (c?.status !== 'added') return h.refuse('Add them to the charge first', 409, 'conflict');
      const p = people.get(c.personId)!;
      if (p.joinedAt) return h.refuse('They’ve joined already', 409, 'conflict');
      if (!p.wallet) return h.refuse('They can’t be asked from here', 409, 'conflict');
      return { sentAt: h.now() };
    },
  };

  /** The preview's people, by name, for `&customer=` (preview only). */
  const preview = {
    add(orderId: string, who: 'sofia' | 'dev' | 'marco') {
      customers.set(orderId, { status: 'added', personId: `rwp_${who}`, addedBy: h.viewer(), via: 'code', at: h.now() });
    },
    pending(orderId: string, phone: string) {
      customers.set(orderId, { status: 'pending', phone, since: new Date(8.64e15).toISOString(), expiresAt: plus(h.now(), CONFIRM_MINUTES * 60_000), staffId: h.viewer() });
    },
    /** A code for a seeded person, as their phone would show it. */
    codeFor(who: 'sofia' | 'dev' | 'marco') {
      const w = people.get(`rwp_${who}`)?.wallet;
      return w ? `https://useclear.org/send?to=${w}&id=mock-${who}` : null;
    },
  };

  return { api, hooks, preview };
}
