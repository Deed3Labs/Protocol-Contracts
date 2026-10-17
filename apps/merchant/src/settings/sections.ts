/**
 * Settings' sections, in the rail's order (panes.tsx draws them). Kept apart from the panes so the
 * rail's rules can be tested without the app's aliases.
 */

export type Section =
  | 'shop'
  | 'payouts'
  | 'partnership'
  | 'counter'
  | 'payments'
  | 'tax'
  | 'tips'
  | 'discounts'
  | 'shop-app'
  | 'developers'
  | 'devices'
  | 'closing'
  | 'security'
  | 'notifications'
  | 'advanced'
  | 'help'
  | 'you';

export const SECTIONS: { key: Section; label: string; det: string; desc: string; live?: boolean }[] = [
  { key: 'shop', label: 'Shop', det: 'What members see in Clear Partners, and when you are open.', desc: 'Listing, hours, contact', live: true },
  { key: 'payouts', label: 'Payouts', det: 'Where your money goes, when, and the record of it.', desc: 'Bank, schedule, statements', live: true },
  { key: 'partnership', label: 'Partnership', det: 'Your terms, your agreement, and your record in the co-op.', desc: 'Terms, agreement, co-op record', live: true },
  { key: 'counter', label: 'Counter', det: 'The printed cards, and how a shift runs on the tablet.', desc: 'Counter cards, breaks, idle lock', live: true },
  { key: 'payments', label: 'Payments', det: 'How customers can pay you, and what happens when the connection drops.', desc: 'Ways to pay, cards, offline', live: true },
  { key: 'tax', label: 'Tax', det: 'Sales tax, worked out from where the shop is.', desc: 'Where you collect, how prices show', live: true },
  { key: 'tips', label: 'Tips', det: 'Whether Checkout asks, what it offers, and who gets it.', desc: 'Asking, amounts, who gets them', live: true },
  { key: 'discounts', label: 'Discounts', det: 'Codes you create, and how much each role can give without asking.', desc: 'Codes, limits by role', live: true },
  { key: 'shop-app', label: 'Shop app', det: 'Your own app for your customers: rewards, offers and Scan to pay.', desc: 'Rewards, look, offers', live: true },
  { key: 'developers', label: 'Developers', det: 'Keys, webhooks and testing for Pay with Clear on your website.', desc: 'Keys, websites, webhooks', live: true },
  { key: 'devices', label: 'Devices', det: 'What is paired with this tablet.', desc: 'Reader, printer, this tablet', live: true },
  { key: 'closing', label: 'Closing', det: 'How the drawer is opened, counted and signed off.', desc: 'The drawer, and who closes', live: true },
  { key: 'security', label: 'Security', det: 'How you sign in, and what is signed in as the shop.', desc: 'Sign-in, owner PIN, devices', live: true },
  { key: 'notifications', label: 'Notifications', det: 'What reaches you, and where.', desc: 'What reaches you and how', live: true },
  { key: 'advanced', label: 'Advanced', det: 'Business details, your data, and leaving.', desc: 'Business details, your data, leaving', live: true },
  { key: 'help', label: 'Help', det: 'A person first, then the guides.', desc: 'A person, then the guides', live: true },
];

export const YOU = { key: 'you' as const, label: 'You', det: 'Your own PIN, and how this tablet is set.', desc: 'Your PIN and this tablet' };

/**
 * What each role's rail lists. An owner sees every section (the preview's too); a manager sees Shop
 * app, Developers and You; a counter shift, Shop app and You. Developers is the one owners-only
 * exception besides Shop app (pay DECISIONS, Phase 1): the counter never sees it.
 */
export function sectionsFor(role: string, preview: boolean): { key: Section; label: string; det: string; desc: string; live?: boolean }[] {
  if (role === 'owner') return SECTIONS.filter((s) => preview || s.live);
  const pick = (k: Section) => SECTIONS.find((s) => s.key === k)!;
  return role === 'manager' ? [pick('shop-app'), pick('developers'), YOU] : [pick('shop-app'), YOU];
}
