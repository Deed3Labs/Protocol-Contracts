import type { MemberQuote, PaidView, PaySession, PublicLink } from '@clear/merchant-contracts';
import type { Step } from '../clear/Steps';
import type { PayApi } from './api';

/**
 * The spec's Mi Casa Tacos (§5): the taco tray for 12 at $149.00, $12.48 tax, $161.48, with its note
 * and seven days to pay. `?state=open|waiting|card|paid|expired|inactive` shows each state.
 */
export const MI_CASA_LINK: PublicLink = {
  slug: 'micasa-tray12',
  shop: { name: 'Mi Casa Tacos', initials: 'MC', logoUrl: null, accent: '#B4532A' },
  order: {
    lines: [{ name: 'Taco tray for 12', quantity: 1, lineCents: 14900 }],
    subtotalCents: 14900,
    taxCents: 1248,
    totalCents: 16148,
    summary: 'Taco tray for 12',
  },
  note: 'Saturday pickup, 11:30am',
  expiresAt: '2026-10-23T17:40:00.000Z',
  state: 'open',
  methods: { clear: true, card: true },
};

export type PreviewState = 'open' | 'waiting' | 'card' | 'paid' | 'expired' | 'inactive';

export function previewApi(state: PreviewState): PayApi {
  const link: PublicLink = { ...MI_CASA_LINK, state: state === 'expired' ? 'expired' : state === 'inactive' ? 'inactive' : 'open' };
  const session = (): PaySession => ({
    id: 'ps_preview',
    livemode: false,
    shop: link.shop,
    order: link.order,
    methods: link.methods,
    overTime: true,
    shopHost: null,
    link: { note: link.note, expiresAt: link.expiresAt },
    state: state === 'paid' ? 'paid' : 'open',
    expiresAt: '2026-10-17T17:40:00.000Z',
  });
  return {
    link: async () => link,
    startSession: async () => ({ session: 'ps_preview' }),
    session: async () => session(),
    pay: async (_id, method) => (method === 'clear' ? { method: 'clear', chargeCode: 'K7Q2M9XH', url: 'https://app.useclear.org/c/K7Q2M9XH' } : { method: 'card', checkoutUrl: '/l/micasa-tray12?preview=1&state=card&s=ps_preview&paid=1' }),
    ...previewSignIn(),
  };
}

/** Signing in, in the preview: a code of 000000 is Sofia; anything else is someone new, Marco. */
function previewSignIn(): Pick<PayApi, 'frameOrigin' | 'contact' | 'code' | 'status' | 'member' | 'approve' | 'approval'> {
  return {
    frameOrigin: async () => ({ origin: null }),
    contact: async (_id, contact) => (contact.includes('@') ? { channel: 'email', to: 's•••@gmail.com', resendInSeconds: 60 } : { channel: 'phone', to: '(909) •••-0142', resendInSeconds: 60 }),
    code: async (_id, code) => (code === '000000' ? { token: 'pt.preview.x', person: { kind: 'member', firstName: 'Sofia' } } : { token: 'pt.preview.y', person: { kind: 'new', contact: '(909) 555-0188' } }),
    status: async () => ({ state: 'waiting', paid: null }),
    member: async () => SOFIA_QUOTE,
    approve: async () => SOFIA_PAID,
    approval: async () => ({ url: 'https://app.useclear.org/approve/preview' }),
  };
}

// ---- The modal (§2–§4): Sofia at micasatacos.com, the spec's catering order -------------------------


export const MI_CASA_ORDER: PaySession['order'] = {
  lines: [
    { name: 'Taco tray for 12', quantity: 1, lineCents: 14900 },
    { name: 'Agua fresca, gallon', quantity: 2, lineCents: 2200 },
  ],
  subtotalCents: 17100,
  taxCents: 1432,
  totalCents: 18532,
  summary: 'Taco tray for 12, 2 × Agua fresca',
};

export const MI_CASA_SESSION: PaySession = {
  id: 'ms_preview',
  livemode: true,
  shop: { name: 'Mi Casa Tacos', initials: 'MC', logoUrl: null, accent: '#B4532A' },
  order: MI_CASA_ORDER,
  methods: { clear: true, card: true },
  overTime: true,
  shopHost: 'micasatacos.com',
  link: null,
  state: 'open',
  expiresAt: '2026-10-16T18:10:00.000Z',
  payment: { id: 'pay_preview', reference: 'catering-1042' },
  prefillEmail: 'sofia.m@gmail.com',
};

/** Sofia's screen as drawn: her terms at 2%, Chase, and 256 points at 1.5×. */
export const SOFIA_QUOTE: MemberQuote = {
  firstName: 'Sofia',
  totalCents: 18532,
  canPayNow: true,
  splits: [
    { installments: 1, perCycleCents: 18903, carryCents: 371, totalCents: 18903, ratePerCycleBps: 200 },
    { installments: 2, perCycleCents: 9544, carryCents: 556, totalCents: 19088, ratePerCycleBps: 200 },
    { installments: 4, perCycleCents: 4865, carryCents: 927, totalCents: 19459, ratePerCycleBps: 200 },
    { installments: 12, perCycleCents: 1745, carryCents: 2409, totalCents: 20941, ratePerCycleBps: 200 },
  ],
  clearsFrom: 'Chase •••• 4471',
  points: { earns: 256, shopName: 'Mi Casa', multiplierLabel: '1.5× for paying with Clear', before: 128, after: 384 },
  approveIn: 'frame',
};

export const SOFIA_PAID: PaidView = { method: 'clear', installments: 4, firstCycle: { amountCents: 4865, on: '2026-11-01' }, points: { earned: 256, now: 384 }, receipt: 'In Clear and by email' };

/** The modal's preview: Sofia at micasatacos.com. */
export function previewModalApi(): PayApi {
  return { ...previewApi('open'), session: async () => MI_CASA_SESSION };
}

/** The modal's steps with the spec's figures, for the preview and `/_frames`. */
export function previewStep(name: string): Step | undefined {
  switch (name) {
    case 'start':
      return { k: 'start' };
    case 'enter':
      return { k: 'enter' };
    case 'check':
      return { k: 'check', sent: { channel: 'phone', to: '(909) •••-0142', resendInSeconds: 0 }, contact: '(909) 555-0142' };
    case 'check-email':
      return { k: 'check', sent: { channel: 'email', to: 's•••@gmail.com', resendInSeconds: 0 }, contact: 'sofia.m@gmail.com' };
    case 'member':
      return { k: 'member', token: 'pt.preview.x', quote: SOFIA_QUOTE };
    case 'new':
      return { k: 'new', contact: '(909) 555-0188' };
    case 'window':
      return { k: 'window', via: 'clear', url: 'https://app.useclear.org/approve/preview' };
    case 'done':
      return { k: 'done', paid: SOFIA_PAID, pointsShop: 'Mi Casa' };
    default:
      return undefined;
  }
}
