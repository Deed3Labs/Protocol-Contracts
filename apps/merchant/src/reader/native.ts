import type { PluginListenerHandle } from '@capacitor/core';
import { thisDevice } from './platform';
import { cardLabel, serverSmartReaders } from './server';
import type { CollectEvent, CollectResult, Platform, ReaderInfo, ReaderKind, ReaderService, TerminalBackend, TenderOrder } from './types';
import { ReaderUnavailable } from './types';

/**
 * The installed app's readers.
 *
 *   M2, Tap to Pay   through the community Capacitor Stripe Terminal plugin
 *                    (@capacitor-community/stripe-terminal, native Terminal SDK 5.7). The server
 *                    starts the card tender; the plugin collects and confirms it on the device; the
 *                    server learns the outcome (sync, or the webhook) and captures at Close the day.
 *   smart readers    driven from the server, exactly as in the browser (./server.ts).
 *
 * Loaded only in the installed app, so the web bundle never carries the plugin. What the plugin
 * doesn't do: store-and-forward. See `OFFLINE_BUILT` in ./platform.
 */
export async function nativeReader(platform: Platform, backend: TerminalBackend): Promise<ReaderService> {
  const { StripeTerminal, TerminalConnectTypes, TerminalEventsEnum, ReaderEvent, PaymentStatus } = await import(
    '@capacitor-community/stripe-terminal'
  );

  // The SDK asks for a connection token whenever it needs one; the server makes it, on the shop's
  // account and scoped to its reader location, which the SDK then needs to connect an M2.
  let locationId: string | null = null;
  const token = async () => {
    const t = await backend.connectionToken();
    locationId = t.locationId;
    return t.secret;
  };
  await StripeTerminal.addListener(TerminalEventsEnum.RequestedConnectionToken, async () => {
    await StripeTerminal.setConnectionToken({ token: await token() });
  });
  await StripeTerminal.initialize({ isTest: !import.meta.env.PROD });

  const smart = serverSmartReaders(backend);
  const TYPE = { bluetooth: TerminalConnectTypes.Bluetooth, tapToPay: TerminalConnectTypes.TapToPay };
  let current: ReaderInfo | null = null;
  /** The server's id for the connected M2 or Tap to Pay reader: tenders name the reader by it. */
  let serverReaderId: string | null = null;
  let tenderId: string | null = null;

  const toInfo = (kind: Exclude<ReaderKind, 'smart'>, r: { serialNumber: string; label?: string }): ReaderInfo => ({
    id: r.serialNumber,
    kind,
    label: kind === 'tapToPay' ? `Tap to Pay on ${thisDevice(platform)}` : 'Stripe Reader M2',
    detail: kind === 'tapToPay' ? 'Tap only · online only' : 'Chip, tap and swipe · Bluetooth to this tablet',
    handle: r,
  });

  async function collectHere(amountCents: number, onEvent: (e: CollectEvent) => void, order?: TenderOrder): Promise<CollectResult> {
    if (!order || !serverReaderId) throw new ReaderUnavailable('Card payments aren’t switched on for this shop yet.');
    const start = await backend.startCardTender(order.orderId, {
      amountCents,
      tipCents: order.tipCents,
      readerId: serverReaderId,
      idempotencyKey: crypto.randomUUID(),
    });
    tenderId = start.tenderId;
    const handles: PluginListenerHandle[] = [];
    const reading = () => onEvent({ state: 'reading' });
    handles.push(await StripeTerminal.addListener(TerminalEventsEnum.ReaderEvent, ({ event }) => event === ReaderEvent.CardInserted && reading()));
    handles.push(await StripeTerminal.addListener(TerminalEventsEnum.PaymentStatusChange, ({ status }) => status === PaymentStatus.Processing && reading()));
    try {
      onEvent({ state: 'ready' });
      try {
        await StripeTerminal.collectPaymentMethod({ paymentIntent: start.clientSecret });
      } catch {
        // Cancelled at the counter, or the reader gave up waiting for a card.
        return { outcome: 'cancelled' };
      }
      reading();
      await StripeTerminal.confirmPaymentIntent().catch(() => undefined);
      // The device's word is not the record: the server asks the processor. A decline is voided
      // there, and its reason stays with Stripe and the customer.
      const t = await backend.sync(start.tenderId);
      tenderId = null;
      const card = cardLabel(t.cardBrand, t.cardLast4);
      if (t.status === 'authorised' || t.status === 'captured') {
        onEvent({ state: 'approved', card });
        return { outcome: 'approved', card };
      }
      onEvent({ state: 'declined', message: 'Declined' });
      return { outcome: 'declined', card };
    } finally {
      await Promise.all(handles.map((h) => h.remove()));
    }
  }

  return {
    platform,
    kinds: ['smart', 'bluetooth', 'tapToPay'],
    async discover(kind) {
      if (kind === 'smart') return smart.discover();
      if (!locationId) await token();
      const { readers } = await StripeTerminal.discoverReaders({ type: TYPE[kind], locationId: locationId ?? undefined });
      return readers.map((r) => toInfo(kind, r));
    },
    async connect(reader) {
      if (reader.kind === 'smart') {
        current = reader;
        serverReaderId = reader.id;
        return;
      }
      await StripeTerminal.connectReader({
        reader: reader.handle as never,
        autoReconnectOnUnexpectedDisconnect: reader.kind === 'bluetooth',
      });
      const recorded = await backend.recordReader({ type: reader.kind === 'bluetooth' ? 'm2' : 'tap_to_pay', externalReaderId: reader.id, label: reader.label });
      current = reader;
      serverReaderId = recorded.id;
    },
    connected: () => current,
    async collect(amountCents, onEvent, order) {
      if (!current) throw new Error('Choose a reader first');
      return current.kind === 'smart' ? smart.collect(current, amountCents, onEvent, order) : collectHere(amountCents, onEvent, order);
    },
    async cancel() {
      if (current?.kind === 'smart') return smart.cancel();
      await StripeTerminal.cancelCollectPaymentMethod().catch(() => undefined);
      const id = tenderId;
      tenderId = null;
      if (id) await backend.cancelTender(id).catch(() => undefined);
    },
    async disconnect() {
      if (current && current.kind !== 'smart') await StripeTerminal.disconnectReader().catch(() => undefined);
      current = null;
      serverReaderId = null;
    },
  };
}
