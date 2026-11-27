import type { CollectEvent, CollectResult, ReaderInfo, TerminalBackend, TenderOrder } from './types';
import { ReaderUnavailable } from './types';

/**
 * Smart readers (S700/S710, WisePOS E), driven from the server. Stripe recommends this over its
 * browser SDK, which needs the counter device and the reader on the same local network: here the
 * app asks the API to send the payment to the reader, and the reader talks to Stripe itself.
 *
 * Collecting: start the card tender, send it to the reader, then follow the tender until the
 * processor says approved or declined. The server captures at Close the day, never the app.
 */

const POLL_MS = 1000;
/** The reader gives up on its own well before this; it's a backstop against a reader gone silent. */
const GIVE_UP_MS = 4 * 60 * 1000;

export const cardLabel = (brand: string | null, last4: string | null) =>
  last4 ? `${brand ? brand[0]!.toUpperCase() + brand.slice(1) : 'Card'} ending ${last4}` : 'Card';

export function serverSmartReaders(backend: TerminalBackend, opts: { pollMs?: number; giveUpMs?: number; key?: () => string } = {}) {
  const pollMs = opts.pollMs ?? POLL_MS;
  const giveUpMs = opts.giveUpMs ?? GIVE_UP_MS;
  const key = opts.key ?? (() => crypto.randomUUID());
  let tenderId: string | null = null;
  let stopped = false;

  return {
    async discover(): Promise<ReaderInfo[]> {
      const readers = await backend.readers();
      return readers
        .filter((r) => r.type === 'smart')
        .map((r) => ({ id: r.id, kind: 'smart' as const, label: r.label, detail: 'Smart reader · takes the card itself' }));
    },

    async collect(reader: ReaderInfo, amountCents: number, onEvent: (e: CollectEvent) => void, order?: TenderOrder): Promise<CollectResult> {
      if (!order) throw new ReaderUnavailable('Card payments aren’t switched on for this shop yet.');
      stopped = false;
      const start = await backend.startCardTender(order.orderId, { amountCents, tipCents: order.tipCents, readerId: reader.id, idempotencyKey: key() });
      tenderId = start.tenderId;
      await backend.present(start.tenderId);
      onEvent({ state: 'ready' });

      const until = Date.now() + giveUpMs;
      while (!stopped && Date.now() < until) {
        await new Promise((r) => setTimeout(r, pollMs));
        if (stopped) break;
        const t = await backend.sync(start.tenderId);
        if (t.status === 'authorised' || t.status === 'captured') {
          const card = cardLabel(t.cardBrand, t.cardLast4);
          tenderId = null;
          onEvent({ state: 'approved', card });
          return { outcome: 'approved', card };
        }
        if (t.status === 'declined') {
          tenderId = null;
          // Why the bank declined stays with Stripe and the customer.
          onEvent({ state: 'declined', message: 'Declined' });
          return { outcome: 'declined', card: cardLabel(t.cardBrand, t.cardLast4) };
        }
        if (t.status === 'cancelled') {
          tenderId = null;
          return { outcome: 'cancelled' };
        }
      }
      if (!stopped && tenderId) await backend.cancelTender(tenderId).catch(() => undefined);
      tenderId = null;
      return { outcome: 'cancelled', message: stopped ? undefined : 'The reader stopped waiting for the card.' };
    },

    /** Stop following, and void the payment: the server clears the reader too. */
    async cancel(): Promise<void> {
      const id = tenderId;
      if (!id) return;
      // If the server refuses (a card is mid-authorisation on the reader), keep following: the
      // payment may yet be approved, and the screen must say so rather than "cancelled".
      await backend.cancelTender(id);
      stopped = true;
      tenderId = null;
    },
  };
}
