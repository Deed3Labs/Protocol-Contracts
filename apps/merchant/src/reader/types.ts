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

import type { CardTenderStart, ConnectionToken, Reader, Tender } from '@clear/merchant-contracts';

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

/** Which order a card payment is for, and the tip on it. */
export interface TenderOrder {
  orderId: string;
  tipCents: number;
}

/**
 * The server's side of a card payment: the merchant API's card endpoints (backend prompt, Phases
 * 4 and 5; typed in `packages/merchant-contracts`). The server creates, sends to smart readers,
 * voids and captures (at Close the day); the app only collects the card on the M2 and Tap to Pay.
 * `merchantTerminalBackend` (./backend.ts) is it, over the data layer's MerchantApi.
 */
export interface TerminalBackend {
  /** For the native SDK: a token on the shop's account, and the shop's reader location. */
  connectionToken(): Promise<ConnectionToken>;
  /** The shop's readers as the server knows them. */
  readers(): Promise<Reader[]>;
  /** Records an M2 or Tap to Pay reader once the app connects it. */
  recordReader(input: { type: 'm2' | 'tap_to_pay'; externalReaderId: string; label: string }): Promise<Reader>;
  startCardTender(orderId: string, input: { amountCents: number; tipCents: number; readerId: string; idempotencyKey: string }): Promise<CardTenderStart>;
  /** Sends a smart reader's payment to it. */
  present(tenderId: string): Promise<void>;
  /** Where the payment stands, from the processor. */
  sync(tenderId: string): Promise<Tender>;
  /** Void before capture; clears a smart reader first. */
  cancelTender(tenderId: string): Promise<void>;
}

export interface ReaderService {
  platform: Platform;
  /** What this device can drive at all. */
  kinds: ReaderKind[];
  discover(kind: ReaderKind): Promise<ReaderInfo[]>;
  connect(reader: ReaderInfo): Promise<void>;
  connected(): ReaderInfo | null;
  /**
   * Collect `amountCents` for an order on the connected reader. The server starts the payment; a
   * smart reader is sent it by the server, an M2 or Tap to Pay collects it here; the server learns
   * the outcome and captures at Close the day. Events drive the card screen.
   */
  collect(amountCents: number, onEvent: (e: CollectEvent) => void, order?: TenderOrder): Promise<CollectResult>;
  /** Stop collecting, and void the payment on the server. */
  cancel(): Promise<void>;
  disconnect(): Promise<void>;
}

export class ReaderUnavailable extends Error {}
