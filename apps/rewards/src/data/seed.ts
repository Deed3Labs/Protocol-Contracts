import type { Brand, EarnSummary, OfferView, PointsName, RewardView } from '@clear/merchant-contracts';

/**
 * The preview's shops and people, as the spec draws them (rewards prompt, Phase 4 › Mock seed).
 * The mock's day is Thursday, October 15, 2026, 7:46pm in Redlands.
 */

export const NOW = '2026-10-16T02:46:00.000Z';

export interface SeedShop {
  slug: string;
  name: string;
  brand: Brand;
  pointsName: PointsName;
  earn: EarnSummary;
  pitch: string;
  rewards: Array<RewardView & { gives?: { itemNames: string[]; amountCents: number } }>;
  offers: OfferView[];
  joinBonus: number;
  distanceMeters: number;
  /** Whether it shows in the directory as joinable by Sofia. */
  directoryOnly?: boolean;
}

const preset = (preset: 'serif' | 'grotesque' | 'rounded') => ({ kind: 'preset' as const, preset });
const sans = { kind: 'preset' as const, preset: 'instrument_sans' as const };
const points = (rate: string, sentence: string, joinBonus = 0): EarnSummary => ({ unit: 'dollars', rate, sentence, expiry: 'Points never expire', cardSize: null, joinBonus });
const view = (id: string, name: string, cost: number, word: string, note?: string, clearMembersOnly = false): RewardView => ({ id, name, cost, detail: note ? `${cost} ${word} · ${note}` : `${cost} ${word}`, clearMembersOnly });

export const SHOPS: Record<string, SeedShop> = {
  micasa: {
    slug: 'micasa',
    name: 'Mi Casa Tacos',
    brand: { logoUrl: null, monogram: 'MC', colour: '#B4532A', onColour: '#FBF3EA', paper: '#F1EADF', paper2: '#E8DCCB', headingFont: preset('serif'), textFont: sans },
    pointsName: { kind: 'points' },
    earn: points('1 point per $1', 'Earn 1 point for every $1. Double on Tuesdays.', 25),
    pitch: 'A point for every dollar, and a free agua fresca at 75.',
    rewards: [
      { ...view('rwd_agua', 'Free agua fresca', 75, 'points', 'any size'), gives: { itemNames: ['Jamaica', 'Horchata'], amountCents: 350 } },
      view('rwd_churros', 'Free churros', 150, 'points'),
      view('rwd_plate', 'Free taco plate', 300, 'points'),
      view('rwd_tray', 'Family tray, $20 off', 600, 'points', undefined, true),
    ],
    offers: [
      { codeId: 'dsc_tacotue', code: 'TACOTUE', title: 'Taco Tuesday', detail: 'Two tacos for $7, in the shop or to go', when: 'Tue', audience: 'everyone' },
      { codeId: 'dsc_tray10', code: 'TRAY10', title: '10% off a tray', detail: 'Catering orders over $60', when: 'Ends Oct 31', audience: 'everyone' },
    ],
    joinBonus: 25,
    distanceMeters: 1100,
  },
  'mikes-tire': {
    slug: 'mikes-tire',
    name: 'Mike’s Tire',
    brand: { logoUrl: null, monogram: 'MT', colour: '#1F4E8C', onColour: '#F2F5F9', paper: '#E7EBEF', paper2: '#D6DDE5', headingFont: preset('grotesque'), textFont: sans },
    pointsName: { kind: 'points' },
    earn: points('1 point per $1', 'Earn 1 point for every $1.'),
    pitch: 'A point for every dollar, and a free tire rotation at 500.',
    rewards: [view('rwd_rotation', 'Free tire rotation', 500, 'points'), view('rwd_alignment', '$25 off an alignment', 750, 'points')],
    offers: [{ codeId: 'dsc_winter', code: 'WINTER', title: 'Winter check', detail: 'Free battery and tread check with any service', when: 'Nov', audience: 'everyone' }],
    joinBonus: 0,
    distanceMeters: 2400,
  },
  'la-bonita': {
    slug: 'la-bonita',
    name: 'La Bonita Bakery',
    brand: { logoUrl: null, monogram: 'LB', colour: '#8C3B5E', onColour: '#FBEFF4', paper: '#F2E9EC', paper2: '#E6D3DA', headingFont: preset('rounded'), textFont: sans },
    pointsName: { kind: 'custom', one: 'stamp', many: 'stamps' },
    earn: { unit: 'visits', rate: '$5 or more, once a day', sentence: 'One stamp a visit, 10 to a card.', expiry: 'Stamps never expire', cardSize: 10, joinBonus: 0 },
    pitch: 'A stamp every visit, and a free coffee at 5.',
    rewards: [view('rwd_coffee', 'Free coffee', 5, 'stamps'), view('rwd_pandulce', 'Box of pan dulce', 10, 'stamps')],
    offers: [],
    joinBonus: 0,
    distanceMeters: 1900,
  },
  'pena-coffee': {
    slug: 'pena-coffee',
    name: 'Peña Coffee',
    brand: { logoUrl: null, monogram: 'PE', colour: '#3E5C3A', onColour: '#EEF2EC', paper: '#ECEEE6', paper2: '#DCE0D4', headingFont: preset('grotesque'), textFont: sans },
    pointsName: { kind: 'points' },
    earn: points('1 point per $1', 'Earn 1 point for every $1.', 25),
    pitch: 'A point for every $1, a free drink at 60.',
    rewards: [view('rwd_drink', 'Free drink', 60, 'points')],
    offers: [],
    joinBonus: 25,
    distanceMeters: 483,
    directoryOnly: true,
  },
  'tia-beas': {
    slug: 'tia-beas',
    name: 'Tia Bea’s Tamales',
    brand: { logoUrl: null, monogram: 'TB', colour: '#6B4A1F', onColour: '#F6EFE4', paper: '#F3ECE1', paper2: '#E6DAC8', headingFont: preset('serif'), textFont: sans },
    pointsName: { kind: 'custom', one: 'stamp', many: 'stamps' },
    earn: { unit: 'visits', rate: '$5 or more, once a day', sentence: 'One stamp a visit, 8 to a card.', expiry: 'Stamps never expire', cardSize: 8, joinBonus: 0 },
    pitch: 'A stamp every visit, and a dozen tamales at 8.',
    rewards: [view('rwd_dozen', 'A dozen tamales', 8, 'stamps')],
    offers: [],
    joinBonus: 0,
    distanceMeters: 1287,
    directoryOnly: true,
  },
};

export interface SeedPerson {
  id: string;
  firstName: string;
  lastInitial: string | null;
  phone: string;
  /** Clear member, with this balance; null is rewards only. */
  balanceCents: number | null;
  points: Record<string, number>;
  texts: Record<string, 'codes' | 'codes_and_offers'>;
}

export const PEOPLE: Record<'sofia' | 'marco', SeedPerson> = {
  sofia: {
    id: 'rwp_sofia',
    firstName: 'Sofia',
    lastInitial: 'M',
    phone: '(909) 555-0142',
    balanceCents: 21240,
    points: { micasa: 128, 'mikes-tire': 340, 'la-bonita': 6 },
    texts: { micasa: 'codes_and_offers', 'mikes-tire': 'codes', 'la-bonita': 'codes_and_offers' },
  },
  marco: {
    id: 'rwp_marco',
    firstName: 'Marco',
    lastInitial: 'A',
    phone: '(909) 555-0188',
    balanceCents: null,
    points: { micasa: 42 },
    texts: { micasa: 'codes' },
  },
};

/** Table 6 at Mi Casa, on its Point (section 3), and the Clear charge Jen sends Sofia (section 9). */
export const TABLE_6 = {
  pointCode: 'A7K2',
  orderId: 'ord_table6',
  table: 'Table 6',
  lines: [
    { id: 'l1', name: 'Al pastor', quantity: 2, lineCents: 900 },
    { id: 'l2', name: 'Horchata', quantity: 1, lineCents: 350 },
    { id: 'l3', name: 'Jamaica', quantity: 1, lineCents: 350 },
  ],
  // Tax per line at 8.375% (DECISIONS, Figures): $17.33 without the reward, $13.55 with it.
  withReward: { discountCents: 350, taxCents: 105, totalCents: 1355, earnsPoints: 12 },
  withoutReward: { discountCents: 0, taxCents: 133, totalCents: 1733, earnsPoints: 16 },
  paidAt: NOW,
  counterCharge: 'CLRTBL6X',
};

/** Peña Coffee, paid before joining (section 7). */
export const PENA_VISIT = { orderId: 'ord_pena', amountCents: 840, paidAt: '2026-10-15T15:12:00.000Z', earns: 8 };
