import type { MyShops, Partners, Person, PublicShopApp, RewardClaim, RewardsMe, ShopBill, ShopPaid } from '@clear/merchant-contracts';
import type { ChargeView, RewardsData } from './types';
import { NOW, PENA_VISIT, PEOPLE, SHOPS, TABLE_6, type SeedPerson, type SeedShop } from './seed';

/**
 * The preview's data: the spec's shops and people, in memory, behaving as the API does (rewards
 * prompt, Phase 4 › Mock seed). `who` is `sofia` (a Clear member at three shops), `marco` (rewards
 * only, at Mi Casa) or `new` (signed in, nobody yet).
 */
export type Who = 'sofia' | 'marco' | 'new';

const later = <T,>(v: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));
const refuse = (message: string): never => {
  throw Object.assign(new Error(message), { code: 'refused' });
};

export function mockData(who: Who, opts: { after?: 'table6' } = {}): RewardsData {
  const person: SeedPerson | null = who === 'new' ? null : structuredClone(PEOPLE[who]);
  let created: Person | null = null;
  let balance = person?.balanceCents ?? null;
  // The preview can start just after Sofia paid for Table 6 (section 3's Paid frame).
  const startPaid = opts.after === 'table6' && who === 'sofia';
  if (startPaid && person && balance !== null) {
    balance -= TABLE_6.withReward.totalCents;
    person.points.micasa = (person.points.micasa ?? 0) - 75 + TABLE_6.withReward.earnsPoints;
  }
  const joined = new Set(person ? Object.keys(person.points) : []);
  const claims = new Map<string, RewardClaim>();
  let paidTable6 = startPaid;

  const shop = (slug: string): SeedShop => SHOPS[slug] ?? refuse('No shop has that address');
  const pts = (slug: string) => person?.points[slug] ?? 0;
  const isClear = () => balance !== null;
  const me: Person | null = person ? { id: person.id, firstName: person.firstName, lastInitial: person.lastInitial, phone: person.phone, isClearMember: isClear() } : null;

  const publicApp = (s: SeedShop): PublicShopApp => ({
    slug: s.slug,
    name: s.name,
    brand: s.brand,
    fonts: {},
    pointsName: s.pointsName,
    earn: s.earn,
    pitch: s.pitch,
    rewards: s.rewards.map(({ gives: _g, ...r }) => r),
    offers: s.offers,
    configVersion: 1,
  });

  async function chargeOf(code: string): Promise<ChargeView> {
    const agua = code === TABLE_6.counterCharge || sessionStorage.getItem('rewards:preview:reward') !== '0';
    const t = agua ? TABLE_6.withReward : TABLE_6.withoutReward;
    return later({
      code,
      shopName: 'Mi Casa Tacos',
      table: TABLE_6.table,
      amountCents: t.totalCents,
      lines: TABLE_6.lines,
      taxCents: t.taxCents,
      reward: agua ? { name: 'Free agua fresca', points: 75, appliedBy: code === TABLE_6.counterCharge ? 'counter' : 'customer', amountCents: 350 } : null,
      earnsPoints: t.earnsPoints,
      status: 'pending',
    });
  }

  const data: RewardsData = {
    shop: (slug) => later(publicApp(shop(slug))),
    async me(slug): Promise<RewardsMe> {
      const s = shop(slug);
      const p = me ?? created ?? refuse('Tell us your first name first');
      const has = pts(slug);
      const isMember = joined.has(slug);
      const rewards = s.rewards.map(({ gives: _g, ...r }) => r);
      return later({
        person: { ...p, isClearMember: isClear() },
        membership: isMember
          ? { shopSlug: slug, memberId: p.id, joinedAt: '2026-03-04T20:00:00.000Z', consentAt: '2026-03-04T20:00:00.000Z', consentVersion: 'join-2026-03', texts: person?.texts[slug] ?? 'codes', birthMonth: null, referredBy: null }
          : null,
        points: isMember ? has : 0,
        ready: isMember ? rewards.filter((r) => r.cost <= has).sort((a, b) => b.cost - a.cost) : [],
        next: rewards.filter((r) => !isMember || r.cost > has).map((r) => ({ ...r, toGo: Math.max(1, r.cost - (isMember ? has : 0)) })).sort((a, b) => a.toGo - b.toGo),
        offers: s.offers,
        earn: s.earn,
        clear: { status: isClear() ? 'active' : 'not_set_up', canPayWithClear: isClear(), canPayOverTime: isClear() },
      });
    },
    balanceCents: () => later(balance),
    person: () => later(me ?? created),
    createPerson: async (firstName) => (created = { id: 'rwp_new', firstName, lastInitial: null, phone: '(909) 555-0142', isClearMember: false }),
    deletePerson: async () => {
      joined.clear();
    },
    identityCode: () => later({ payload: `https://rewards.useclear.org/send?to=0x5a1f00000000000000000000000000000000c0de&id=1792130000.preview`, expiresAt: '2026-10-16T02:48:00.000Z' }),
    async myShops(): Promise<MyShops> {
      return later({
        shops: [...joined].map((slug) => {
          const s = shop(slug);
          const has = pts(slug);
          const next = s.rewards.filter((r) => r.cost > has).sort((a, b) => a.cost - b.cost)[0];
          return {
            slug,
            name: s.name,
            brand: { logoUrl: s.brand.logoUrl, monogram: s.brand.monogram, colour: s.brand.colour, onColour: s.brand.onColour, headingFont: s.brand.headingFont },
            pointsName: s.pointsName,
            unit: s.earn.unit,
            points: has,
            cardSize: s.earn.cardSize,
            readyCount: s.rewards.filter((r) => r.cost <= has).length,
            next: next ? { name: next.name.replace(/^Free /, 'free '), toGo: next.cost - has } : null,
            texts: person?.texts[slug] ?? 'codes',
          };
        }),
      });
    },
    async partners(): Promise<Partners> {
      return later({
        partners: Object.values(SHOPS)
          .filter((s) => s.directoryOnly && !joined.has(s.slug))
          .sort((a, b) => a.distanceMeters - b.distanceMeters)
          .map((s) => ({
            slug: s.slug,
            name: s.name,
            brand: { logoUrl: null, monogram: s.brand.monogram, colour: s.brand.colour, onColour: s.brand.onColour, headingFont: s.brand.headingFont },
            distanceMeters: s.distanceMeters,
            earns: s.earn.unit === 'visits' ? 'stamps' : s.earn.rate,
            joined: false,
          })),
      });
    },
    async join(slug, input) {
      const s = shop(slug);
      const p = me ?? created ?? refuse('Tell us your first name first');
      const fresh = !joined.has(slug);
      joined.add(slug);
      const join = fresh ? s.joinBonus : 0;
      const payment = input.orderId === PENA_VISIT.orderId ? PENA_VISIT.earns : 0;
      if (person) person.points[slug] = pts(slug) + join + payment;
      if (person) person.texts[slug] = input.texts;
      return later({
        membership: { shopSlug: slug, memberId: p.id, joinedAt: NOW, consentAt: NOW, consentVersion: 'join-2026-10', texts: input.texts, birthMonth: null, referredBy: null },
        points: pts(slug),
        credited: { join, payment },
      });
    },
    async updateMembership(slug, input) {
      if (person && input.texts) person.texts[slug] = input.texts;
      return later({ shopSlug: slug, memberId: person?.id ?? 'rwp_new', joinedAt: NOW, consentAt: NOW, consentVersion: 'join-2026-10', texts: person?.texts[slug] ?? 'codes', birthMonth: null, referredBy: null });
    },
    async leave(slug) {
      joined.delete(slug);
      if (person) delete person.points[slug];
    },
    async claim(slug, rewardId) {
      const r = shop(slug).rewards.find((x) => x.id === rewardId) ?? refuse('That reward isn’t on offer here');
      if (pts(slug) < r.cost) refuse(`Not enough points for ${r.name}`);
      const c: RewardClaim = { id: `rcl_${rewardId}`, code: 'K7P4QM', qr: 'https://rewards.useclear.org/k/K7P4QM', rewardId, rewardName: r.name, cost: r.cost, expiresAt: '2026-10-16T03:01:00.000Z', status: 'open', orderId: null };
      claims.set(c.id, c);
      return later(c);
    },
    activity: (slug) =>
      later({
        items: slug === 'micasa' && paidTable6 ? [{ orderId: TABLE_6.orderId, at: NOW, table: TABLE_6.table, totalCents: TABLE_6.withReward.totalCents, paidWith: 'clear' as const, points: { earned: 12, used: 75 } }] : [],
      }),
    pointShop: async (pointCode) => (pointCode.toUpperCase() === TABLE_6.pointCode ? 'micasa' : null),
    async bill(slug, pointCode): Promise<ShopBill> {
      if (slug !== 'micasa' || pointCode.toUpperCase() !== TABLE_6.pointCode) refuse('There’s no bill here right now');
      const has = pts(slug);
      const agua = SHOPS.micasa!.rewards[0]!;
      const canUse = joined.has(slug) && has >= agua.cost;
      return later({
        pointCode: TABLE_6.pointCode,
        orderId: TABLE_6.orderId,
        table: TABLE_6.table,
        lines: TABLE_6.lines,
        withReward: canUse ? TABLE_6.withReward : null,
        withoutReward: TABLE_6.withoutReward,
        reward: canUse ? { rewardId: agua.id, name: agua.name, cost: agua.cost, amountCents: 350, pointsBefore: has } : null,
        hasDiscount: false,
        earnsWithClear: canUse ? TABLE_6.withReward.earnsPoints : TABLE_6.withoutReward.earnsPoints,
      });
    },
    async pay(_slug, pointCode, input) {
      if (pointCode.toUpperCase() !== TABLE_6.pointCode) refuse('There’s no bill here right now');
      if (input.method === 'card') return later({ method: 'card', checkoutUrl: 'https://checkout.stripe.com/preview' });
      sessionStorage.setItem('rewards:preview:reward', input.rewardId ? '1' : '0');
      return later({ method: 'clear', chargeCode: 'CLRTBL6P', url: 'https://app.useclear.org/c/CLRTBL6P' });
    },
    async paid(slug, orderId): Promise<ShopPaid> {
      if (orderId === PENA_VISIT.orderId) {
        const s = shop(slug);
        return later({
          orderId,
          amountCents: PENA_VISIT.amountCents,
          paidAt: PENA_VISIT.paidAt,
          table: null,
          paidWith: 'clear_balance',
          points: joined.has(slug) ? { used: null, earned: PENA_VISIT.earns, have: pts(slug) } : null,
          joinOffer: joined.has(slug) ? null : { joinBonus: s.joinBonus, fromThis: PENA_VISIT.earns, total: s.joinBonus + PENA_VISIT.earns },
        });
      }
      const withReward = sessionStorage.getItem('rewards:preview:reward') !== '0';
      const t = withReward ? TABLE_6.withReward : TABLE_6.withoutReward;
      return later({
        orderId: TABLE_6.orderId,
        amountCents: t.totalCents,
        paidAt: TABLE_6.paidAt,
        table: TABLE_6.table,
        paidWith: 'clear_balance',
        points: { used: withReward ? { reward: 'Free agua fresca', points: 75 } : null, earned: t.earnsPoints, have: paidTable6 ? pts(slug) : pts(slug) - (withReward ? 75 : 0) + t.earnsPoints },
        joinOffer: null,
      });
    },
    charge: chargeOf,
    onboarding: {
      bootstrapMemberAccount: async () => ({}),
      updateMemberOnboarding: async () => ({}),
      updateMemberProfile: async () => ({}),
      acceptMemberTerms: async () => ({}),
      submitMemberOnboarding: async () => {
        balance = 0;
        return {};
      },
    },
    async approve(code, mode) {
      if (!isClear()) refuse('Complete account onboarding before using this feature');
      const c = await chargeOf(code);
      if (mode === 'now') {
        if ((balance ?? 0) < c.amountCents) refuse('Not enough in your Clear balance');
        balance = (balance ?? 0) - c.amountCents;
      }
      if (person && !paidTable6) person.points.micasa = pts('micasa') - (c.reward ? 75 : 0) + (c.earnsPoints ?? 0);
      paidTable6 = true;
      return later({ orderId: TABLE_6.orderId }, 400);
    },
  };
  return data;
}

/** Peña Coffee's visit is "paid" in the preview without a join, so the paid screen offers one. */
export const PREVIEW_PENA = PENA_VISIT;
