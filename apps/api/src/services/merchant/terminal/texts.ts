import { contactsStore } from '../../contactsStore.js';
import { notificationStore } from '../../notificationStore.js';
import { sendNotificationService } from '../../sendNotificationService.js';

/**
 * Table ready and Order ready by text, through the Twilio path receipts already use. A text that
 * can't go is reported, never thrown: the Point still shows it.
 */
export interface Texter {
  send(input: { to: string; message: string }): Promise<boolean>;
  /**
   * The same news in the Clear app, when the number is a member's (terminal reference, section 13:
   * "a wait-list text is also a notification for members"). Only where a text goes, so only with the
   * party's consent; the party's own wallet when they joined from the app, else the member the
   * number finds, unless they opted out of being found.
   */
  notifyMember?(input: { phone: string; wallet: string | null; title: string; body: string; dedupeKey: string }): Promise<boolean>;
}

export const defaultTexter = (): Texter => ({
  send: async ({ to, message }) => (await sendNotificationService.sendShopText({ to, message })) !== null,
  notifyMember: async ({ phone, wallet, title, body, dedupeKey }) => {
    const to = wallet ?? (await contactsStore.lookupWallet(undefined, phone))?.wallet ?? null;
    if (!to) return false;
    return (await notificationStore.emit({ wallet: to, kind: 'system', title, body, dedupeKey, push: true })) !== null;
  },
});

/** The lock screen's notice (section 13): "Your table is ready" · "Mi Casa Tacos · Table 12, back patio". */
export const tableReadyNotice = (shop: string, table: { number: number; label?: string | null; area: string | null } | null) => ({
  title: 'Your table is ready',
  body: table ? `${shop} · ${table.label ?? `Table ${table.number}`}${table.area ? `, ${table.area}` : ''}` : shop,
});

/** "Your table is ready: 6, by the window" (section 8b). */
export const tableReadyText = (table: { number: number; area: string | null }) => `Your table is ready: ${table.number}${table.area ? `, ${table.area}` : ''}`;

/** The Point's own words for Order ready (section 9): "Order 27 · Ready. Pick up at the counter." */
export const orderReadyText = (shop: string, label: string) => `${shop}: order ${label} is ready. Pick up at the counter.`;

/** The last four, as an alert keeps it: "··0142". */
export const lastFour = (phone: string) => `··${phone.replace(/\D/g, '').slice(-4)}`;
