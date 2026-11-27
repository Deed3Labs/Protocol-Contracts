import type { PaySession, PublicLink } from '@clear/merchant-contracts';

/**
 * Which of the link page's states to draw (pay spec §5: the modal's steps as a full page). Phase 3 has
 * five: paying it, waiting on Clear or a card, paid, expired, and turned off.
 */
export type LinkStep = 'start' | 'waiting' | 'paid' | 'expired' | 'inactive';

export function linkStep(link: Pick<PublicLink, 'state'>, session: Pick<PaySession, 'state'> | null, waiting: boolean): LinkStep {
  // Paid stands even if the link has since expired or been turned off.
  if (session?.state === 'paid') return 'paid';
  if (link.state === 'inactive') return 'inactive';
  if (link.state === 'expired' || session?.state === 'expired') return 'expired';
  return waiting && session?.state === 'open' ? 'waiting' : 'start';
}

/** "Taco tray for 12 · Saturday pickup, 11:30am" */
export const linkDetail = (link: Pick<PublicLink, 'order' | 'note'>) => [link.order.summary, link.note].filter(Boolean).join(' · ');

/** A session the page started is kept for the tab's life, so a second tap pays the same order. */
const sessionKey = (slug: string) => `clear.pay.session.${slug}`;

export function rememberedSession(slug: string): string | null {
  try {
    return window.sessionStorage.getItem(sessionKey(slug));
  } catch {
    return null;
  }
}

export function rememberSession(slug: string, id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(sessionKey(slug), id);
    else window.sessionStorage.removeItem(sessionKey(slug));
  } catch {
    // Private windows can refuse storage; the page still works, it just starts again on reload.
  }
}
