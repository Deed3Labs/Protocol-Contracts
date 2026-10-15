import type { DrawerOpenReason } from '@clear/merchant-contracts';

/**
 * The cash drawer, as a screen sees it (terminal reference, sections 4–6). The tablet opens it
 * itself, over Bluetooth or through the printer's drawer pulse, with or without a connection; the
 * server only hears about it afterwards (the drawer's log). Screens never touch Bluetooth.
 */

/** What the drawer said, or didn't. */
export type DrawerSignal = { kind: 'opened'; at: string } | { kind: 'shut'; at: string } | { kind: 'unreachable'; at: string; why: string };

export interface PairedDrawer {
  /** The drawer's own id: `C1:EA:4F:2A`. "4F2A" is its last four. */
  bluetoothId: string;
  name: string;
}

export interface DrawerService {
  /** Find a drawer nearby and pair it (Add a device › Cash drawer). */
  pair(): Promise<PairedDrawer>;
  /**
   * Open it. Resolves once the command is sent; whether it opened comes on `events` (an `opened`
   * within two seconds, or an `unreachable`). A sale never waits on this.
   */
  open(reason: DrawerOpenReason): Promise<void>;
  /** Every signal from the drawer, until the returned function is called. */
  events(on: (s: DrawerSignal) => void): () => void;
}

/** How long a sale's change screen waits for the drawer to say it opened. */
export const DRAWER_ANSWER_MS = 2000;

export class DrawerUnavailable extends Error {}
