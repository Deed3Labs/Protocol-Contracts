/**
 * Card readers, as the app sees them.
 *
 * Three kinds, and where each works (merchant UI prompt, Phase 5):
 *   smart      a Stripe smart reader on the shop's network. Browser and installed app.
 *   bluetooth  the Stripe Reader M2 over Bluetooth. Installed app only.
 *   tapToPay   Tap to Pay on the phone or tablet itself. Installed app only, online only.
 *
 * The screens never talk to a Terminal SDK. They use a `ReaderService`, which the installed app
 * backs with the native plugin, the browser with Stripe's web SDK, and the preview with a
 * simulation. The server creates, captures and cancels each payment (`TerminalBackend`); the
 * app only collects it on the reader.
 */

export type ReaderKind = 'smart' | 'bluetooth' | 'tapToPay';

export type Platform = 'web' | 'ios' | 'android';

export interface ReaderInfo {
  id: string;
  kind: ReaderKind;
  /** "Stripe Reader M2", "Tap to Pay on this iPhone", "WisePOS E" */
  label: string;
  /** "Chip, tap and swipe · Bluetooth to this tablet" */
  detail: string;
  /** Only the SDK's own object, handed back when connecting. */
  handle?: unknown;
}

/**
 * What the card screen shows while a payment is collected. The screen's four states:
 * ready (waiting for the card), reading, declined, approved.
 */
export type CollectEvent =
  | { state: 'ready' }
  | { state: 'reading' }
  | { state: 'declined'; message: string }
  | { state: 'approved'; card: string };

export interface CollectResult {
  outcome: 'approved' | 'declined' | 'cancelled';
  /** "Visa ending 4242", when approved or declined and the SDK says. */
  card?: string;
  message?: string;
}

/**
 * The server's side of a card payment: the backend prompt's Phase 5, typed in
 * `packages/merchant-contracts` once that exists. Until then `unavailableBackend` stands in.
 */
export interface TerminalBackend {
  /** A connection token on the shop's connected account, for any SDK. */
  connectionToken(): Promise<string>;
  /** Creates the payment for a card tender; the app collects it on the reader. */
  createPayment(input: { amountCents: number; orderId?: string }): Promise<{ id: string; clientSecret: string }>;
  capture(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  /** Records an M2 or Tap to Pay reader once the app connects it. */
  registerReader(reader: Pick<ReaderInfo, 'id' | 'kind' | 'label'>): Promise<void>;
  /** The Stripe Terminal location this shop's readers belong to. */
  locationId(): Promise<string | null>;
}

export interface ReaderService {
  platform: Platform;
  /** What this device can drive at all. */
  kinds: ReaderKind[];
  discover(kind: ReaderKind): Promise<ReaderInfo[]>;
  connect(reader: ReaderInfo): Promise<void>;
  connected(): ReaderInfo | null;
  /**
   * Collect `amountCents` on the connected reader: the server creates the payment, the reader
   * collects it, the server captures it. Events drive the card screen.
   */
  collect(amountCents: number, onEvent: (e: CollectEvent) => void, orderId?: string): Promise<CollectResult>;
  /** Stop collecting, and cancel the payment on the server. */
  cancel(): Promise<void>;
  disconnect(): Promise<void>;
}

export class ReaderUnavailable extends Error {}
