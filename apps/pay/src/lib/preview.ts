import type { PaySession, PublicLink } from '@clear/merchant-contracts';
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
  };
}
