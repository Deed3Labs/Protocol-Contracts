import type { CollectEvent, CollectResult, ReaderInfo, ReaderService, TerminalBackend } from './types';
import { ReaderUnavailable } from './types';

/**
 * The browser's readers: Stripe smart readers on the shop's network, through Stripe's web SDK.
 * The M2 and Tap to Pay need the installed app, so a browser never lists them.
 */
export async function webReader(backend: TerminalBackend): Promise<ReaderService> {
  const { loadStripeTerminal } = await import('@stripe/terminal-js');
  const StripeTerminal = await loadStripeTerminal();
  if (!StripeTerminal) throw new ReaderUnavailable('Stripe’s reader software could not be loaded. Check the connection and try again.');

  let onPayment: ((status: string) => void) | null = null;
  const terminal = StripeTerminal.create({
    onFetchConnectionToken: () => backend.connectionToken(),
    onPaymentStatusChange: ({ status }) => onPayment?.(status),
  });

  let current: ReaderInfo | null = null;
  let paymentId: string | null = null;
  const failed = (r: unknown): r is { error: { message: string } } => !!r && typeof r === 'object' && 'error' in r;

  return {
    platform: 'web',
    kinds: ['smart'],
    async discover(kind) {
      if (kind !== 'smart') return [];
      const location = (await backend.locationId()) ?? undefined;
      const res = await terminal.discoverReaders({ location } as never);
      if (failed(res)) throw new ReaderUnavailable(res.error.message);
      return res.discoveredReaders.map((r) => ({
        id: r.id,
        kind: 'smart' as const,
        label: r.label ?? r.serial_number,
        detail: 'Smart reader · on your network',
        handle: r,
      }));
    },
    async connect(reader) {
      const res = await terminal.connectReader(reader.handle as never);
      if (failed(res)) throw new ReaderUnavailable(res.error.message);
      current = reader;
    },
    connected: () => current,
    async collect(amountCents: number, onEvent: (e: CollectEvent) => void, orderId?: string): Promise<CollectResult> {
      const pay = await backend.createPayment({ amountCents, orderId });
      paymentId = pay.id;
      onPayment = (status) => status === 'processing' && onEvent({ state: 'reading' });
      try {
        onEvent({ state: 'ready' });
        const collected = await terminal.collectPaymentMethod(pay.clientSecret);
        if (failed(collected)) return { outcome: 'cancelled', message: collected.error.message };
        onEvent({ state: 'reading' });
        const processed = await terminal.processPayment(collected.paymentIntent);
        if (failed(processed)) {
          onEvent({ state: 'declined', message: processed.error.message });
          return { outcome: 'declined', message: processed.error.message };
        }
        const pm = processed.paymentIntent.payment_method;
        // The SDK's type omits them, but Stripe returns the card's brand and last four here.
        const card = (pm && typeof pm === 'object' ? pm.card_present : null) as { brand?: string; last4?: string } | null;
        const label = card?.last4 ? `${card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : 'Card'} ending ${card.last4}` : 'Card';
        await backend.capture(pay.id);
        paymentId = null;
        onEvent({ state: 'approved', card: label });
        return { outcome: 'approved', card: label };
      } finally {
        onPayment = null;
      }
    },
    async cancel() {
      await terminal.cancelCollectPaymentMethod().catch(() => undefined);
      if (paymentId) await backend.cancel(paymentId).catch(() => undefined);
      paymentId = null;
    },
    async disconnect() {
      await terminal.disconnectReader().catch(() => undefined);
      current = null;
    },
  };
}
