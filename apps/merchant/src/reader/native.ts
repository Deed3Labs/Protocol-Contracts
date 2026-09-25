import type { PluginListenerHandle } from '@capacitor/core';
import { thisDevice } from './platform';
import type { CollectEvent, CollectResult, Platform, ReaderInfo, ReaderKind, ReaderService, TerminalBackend } from './types';

/**
 * The installed app's readers, through the community Capacitor Stripe Terminal plugin
 * (@capacitor-community/stripe-terminal, native Terminal SDK 5.7). M2 over Bluetooth, Tap to Pay,
 * and smart readers. Loaded only in the installed app, so the web bundle never carries it.
 *
 * What the plugin doesn't do: store-and-forward. See `OFFLINE_BUILT` in ./platform.
 */
export async function nativeReader(platform: Platform, backend: TerminalBackend): Promise<ReaderService> {
  const { StripeTerminal, TerminalConnectTypes, TerminalEventsEnum, ReaderEvent, PaymentStatus } = await import(
    '@capacitor-community/stripe-terminal'
  );

  // The SDK asks for a connection token whenever it needs one; the server makes it.
  await StripeTerminal.addListener(TerminalEventsEnum.RequestedConnectionToken, async () => {
    await StripeTerminal.setConnectionToken({ token: await backend.connectionToken() });
  });
  await StripeTerminal.initialize({ isTest: !import.meta.env.PROD });

  const TYPE = { smart: TerminalConnectTypes.Internet, bluetooth: TerminalConnectTypes.Bluetooth, tapToPay: TerminalConnectTypes.TapToPay };
  let current: ReaderInfo | null = null;
  let paymentId: string | null = null;

  const toInfo = (kind: ReaderKind, r: { serialNumber: string; label?: string; deviceType?: string }): ReaderInfo => ({
    id: r.serialNumber,
    kind,
    label: kind === 'tapToPay' ? `Tap to Pay on ${thisDevice(platform)}` : kind === 'bluetooth' ? 'Stripe Reader M2' : r.label || r.serialNumber,
    detail:
      kind === 'tapToPay' ? 'Tap only · online only' : kind === 'bluetooth' ? 'Chip, tap and swipe · Bluetooth to this tablet' : 'Smart reader · on your network',
    handle: r,
  });

  return {
    platform,
    kinds: ['smart', 'bluetooth', 'tapToPay'],
    async discover(kind) {
      const { readers } = await StripeTerminal.discoverReaders({ type: TYPE[kind], locationId: (await backend.locationId()) ?? undefined });
      return readers.map((r) => toInfo(kind, r));
    },
    async connect(reader) {
      await StripeTerminal.connectReader({
        reader: reader.handle as never,
        autoReconnectOnUnexpectedDisconnect: reader.kind === 'bluetooth',
      });
      current = reader;
      if (reader.kind !== 'smart') await backend.registerReader(reader);
    },
    connected: () => current,
    async collect(amountCents: number, onEvent: (e: CollectEvent) => void, orderId?: string): Promise<CollectResult> {
      const pay = await backend.createPayment({ amountCents, orderId });
      paymentId = pay.id;
      const handles: PluginListenerHandle[] = [];
      const reading = () => onEvent({ state: 'reading' });
      handles.push(await StripeTerminal.addListener(TerminalEventsEnum.ReaderEvent, ({ event }) => event === ReaderEvent.CardInserted && reading()));
      handles.push(await StripeTerminal.addListener(TerminalEventsEnum.PaymentStatusChange, ({ status }) => status === PaymentStatus.Processing && reading()));
      try {
        onEvent({ state: 'ready' });
        try {
          await StripeTerminal.collectPaymentMethod({ paymentIntent: pay.clientSecret });
        } catch {
          // Cancelled at the counter, or the reader gave up waiting for a card.
          return { outcome: 'cancelled' };
        }
        reading();
        try {
          await StripeTerminal.confirmPaymentIntent();
        } catch (e) {
          // Declined: the bank's reason stays with Stripe; the screen says only that it was declined.
          const message = e instanceof Error ? e.message : 'Declined';
          onEvent({ state: 'declined', message });
          return { outcome: 'declined', message };
        }
        await backend.capture(pay.id);
        paymentId = null;
        onEvent({ state: 'approved', card: 'Card' });
        return { outcome: 'approved', card: 'Card' };
      } finally {
        await Promise.all(handles.map((h) => h.remove()));
      }
    },
    async cancel() {
      await StripeTerminal.cancelCollectPaymentMethod().catch(() => undefined);
      if (paymentId) await backend.cancel(paymentId).catch(() => undefined);
      paymentId = null;
    },
    async disconnect() {
      await StripeTerminal.disconnectReader().catch(() => undefined);
      current = null;
    },
  };
}
