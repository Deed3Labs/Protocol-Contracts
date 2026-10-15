import { sendNotificationService } from '../../sendNotificationService.js';

/**
 * Table ready and Order ready by text, through the Twilio path receipts already use. A text that
 * can't go is reported, never thrown: the Point still shows it.
 */
export interface Texter {
  send(input: { to: string; message: string }): Promise<boolean>;
}

export const defaultTexter = (): Texter => ({
  send: async ({ to, message }) => (await sendNotificationService.sendShopText({ to, message })) !== null,
});

/** "Your table is ready: 6, by the window" (section 8b). */
export const tableReadyText = (table: { number: number; area: string | null }) => `Your table is ready: ${table.number}${table.area ? `, ${table.area}` : ''}`;

/** The Point's own words for Order ready (section 9): "Order 27 · Ready. Pick up at the counter." */
export const orderReadyText = (shop: string, label: string) => `${shop}: order ${label} is ready. Pick up at the counter.`;

/** The last four, as an alert keeps it: "··0142". */
export const lastFour = (phone: string) => `··${phone.replace(/\D/g, '').slice(-4)}`;
