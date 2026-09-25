/**
 * Every state the app can be put in without a backend, and the reference frame each one is drawn
 * from (docs/merchant-reference/clear-merchant-<file>.html: the frame is the `i`th `.mc-tablet` or
 * `.phone` under the h2 `h2`).
 *
 * A state is captured at all three sizes. A reference frame is drawn at one size — a landscape
 * tablet, a portrait one, or a phone — so it pairs with that size's capture. `note` is the reason
 * a pair differs, where it does; the report shows it beside the pair.
 *
 * `url` is an app route with `?preview=1`, which stands in a session and a device and shows the
 * reference scenario (Mike's Tire, Tue Sep 22). `gallery` is a labelled frame on /_gallery, for
 * the screens that only show without a session (signing in). `as` puts the counter writer (jen)
 * or the manager (luis) on shift instead of the owner.
 */

export type File = 'home' | 'charges' | 'inventory' | 'new-charge' | 'onboarding' | 'overview' | 'payouts' | 'settings' | 'sign-in' | 'staff';

export interface Ref {
  file: File;
  h2: string;
  i: number;
  /** Why the app differs from this frame. */
  note?: string;
  /** For a detail (a crop the reference draws small): the size it is a detail of. Landscape by default. */
  at?: SizeName;
}

export interface State {
  id: string;
  /** The screen this belongs to, for grouping in the report and the role checks. */
  page: string;
  url?: string;
  gallery?: string;
  /** Clicks to make after it loads, by accessible name. */
  click?: string[];
  refs: Ref[];
  /** A reference-only frame with no app state of its own yet. */
  pending?: string;
  /** Only at these sizes: a gallery frame drawn for one layout. */
  sizes?: SizeName[];
}

const P = '?preview=1';
const r = (file: File, h2: string, i = 0, note?: string, at?: SizeName): Ref => ({ file, h2, i, note, at });

export const STATES: State[] = [
  // ---- Home ------------------------------------------------------------------------------------
  {
    id: 'home-running',
    page: 'home',
    url: `/${P}&home=running`,
    refs: [r('home', 'Running · owner · tablet', 0, 'Dana\'s line is neutral: “has seen it”, not “hers” (DECISIONS › Home).'), r('home', 'One column · 520 to 900', 0, 'Build cart and New charge take their own row under the figure (DECISIONS › Adaptations). Dana\'s line is neutral: “has seen it”, not “hers” (DECISIONS › Home).'), r('home', 'Phone · the fallback', 0, 'Dana\'s line is neutral: “has seen it”, not “hers” (DECISIONS › Home).')],
  },
  { id: 'home-counter', page: 'home', url: `/${P}&home=counter&as=jen`, refs: [r('home', 'Running · counter shift · tablet', 0, 'The drawer expects $211.79, not $212.00, from the valve-stem sale\'s tax (DECISIONS › Figures). Dana\'s line is neutral: “has seen it”, not “hers” (DECISIONS › Home).'), r('home', 'Phone · the fallback', 1, 'Dana\'s line is neutral: “has seen it”, not “hers” (DECISIONS › Home).')] },
  { id: 'home-early', page: 'home', url: `/${P}&home=early`, refs: [r('home', 'Early · owner · tablet')] },
  {
    id: 'home-day-one',
    page: 'home',
    url: `/${P}&home=dayOne`,
    refs: [r('home', 'Day one · owner · tablet', 0, 'Set up the till replaces Home\'s day-one list: signup covers staff, counter cards and the test charge (DECISIONS › Onboarding).'), r('home', 'Phone · the fallback', 2, 'Set up the till replaces Home\'s day-one list (DECISIONS › Onboarding).'), r('onboarding', 'After onboarding: set up the till', 0, 'Home keeps its own hero (with Build cart) and its Waiting cell above the till, rather than the Onboarding file\'s hero (DECISIONS › Onboarding).')],
  },
  { id: 'home-till-later', page: 'home', url: `/${P}&home=tillLater`, refs: [r('onboarding', 'After onboarding: set up the till', 1, 'Home\'s own hero and Waiting cell sit above the till, and the figure line is Home\'s wording (DECISIONS › Onboarding).')] },
  { id: 'home-on-break', page: 'home', url: `/${P}&home=onBreak`, refs: [] },
  { id: 'home-closing', page: 'home', url: `/${P}&home=closing`, refs: [r('home', 'Closing the day', 3, 'A detail: the reference draws this part alone; the app draws the whole screen around it. Closing up sits under Waiting, full width.')] },
  { id: 'home-low-stock', page: 'home', url: `/${P}&home=lowStock`, refs: [r('inventory', 'Reordering', 0, 'Running low, drawn alone in Inventory\'s reference, sits on Home for owners and managers (DECISIONS › Inventory).')] },
  { id: 'home-plus-sheet', page: 'home', url: `/${P}&home=running`, click: ['New charge'], refs: [r('home', 'Phone · the fallback', 3, 'Square corners on the sheet (DECISIONS › The prompt\'s rules). The scrim covers Home behind it; the reference draws the sheet alone.', 'phone')] },

  // ---- Close the day ---------------------------------------------------------------------------
  { id: 'close-signed', page: 'close', url: `/close${P}&drawer=signed`, refs: [r('home', 'Closing the day', 0, 'Figures follow the valve-stem correction: expected $211.79, short $3.79, taken $1,899.31, tax $62.31 (DECISIONS › Figures). The slab fills the screen (DECISIONS › Adaptations).')] },
  { id: 'close-balanced', page: 'close', url: `/close${P}&drawer=balanced`, refs: [r('home', 'Closing the day', 1, 'Figures follow the valve-stem correction: expected $211.79, short $3.79, taken $1,899.31, tax $62.31 (DECISIONS › Figures). The slab fills the screen (DECISIONS › Adaptations).')] },
  { id: 'close-short', page: 'close', url: `/close${P}&drawer=short`, refs: [r('home', 'Closing the day', 2, 'Figures follow the valve-stem correction: expected $211.79, short $3.79, taken $1,899.31, tax $62.31 (DECISIONS › Figures). The slab fills the screen (DECISIONS › Adaptations).')] },

  // ---- Charges ---------------------------------------------------------------------------------
  {
    id: 'charges-owner',
    page: 'charges',
    url: `/charges${P}&screen=owner`,
    refs: [r('charges', 'Charges · owner · tablet', 0), r('charges', 'One column, and the phone', 0), r('charges', 'One column, and the phone', 1)],
  },
  { id: 'charges-late', page: 'charges', url: `/charges${P}&screen=late`, refs: [r('charges', 'Charges · owner · tablet', 1, 'The cash sale is $38.79 and paid today $1,899.31 (DECISIONS › Figures). The app keeps the tools and the pager, so the eighth row is on page two (DECISIONS › Charges).')] },
  {
    id: 'charges-counter',
    page: 'charges',
    url: `/charges${P}&screen=counter&as=jen`,
    refs: [r('charges', 'Charges · counter shift · tablet'), r('charges', 'One column, and the phone', 2)],
  },
  { id: 'charges-filter', page: 'charges', url: `/charges${P}&screen=menu-filter`, refs: [] },
  { id: 'charges-sort', page: 'charges', url: `/charges${P}&screen=menu-sort`, refs: [] },
  { id: 'charge-owner', page: 'charges', url: `/charges/marcus${P}`, refs: [r('charges', 'A charge, opened', 0), r('charges', 'A charge, opened', 2)] },
  { id: 'charge-counter', page: 'charges', url: `/charges/marcus${P}&screen=counter&as=jen`, refs: [r('charges', 'A charge, opened', 1)] },
  { id: 'charge-sale', page: 'charges', url: `/charges/split${P}`, refs: [r('charges', 'A charge, opened', 3, 'Sun, Sep 20, settled Sunday night (DECISIONS › Figures). The slab fills the screen, so the totals sit at the foot of the cell.')] },
  { id: 'charge-refund', page: 'charges', url: `/charges/marcus${P}&screen=refund`, refs: [] },
  { id: 'charge-refund-waiting', page: 'charges', url: `/charges/marcus${P}&screen=waiting`, refs: [] },
  { id: 'charge-refund-approve', page: 'charges', url: `/charges/marcus${P}&screen=approve`, refs: [] },
  { id: 'charge-refunded', page: 'charges', url: `/charges/marcus${P}&screen=refunded`, refs: [] },
  { id: 'charge-refund-declined', page: 'charges', url: `/charges/marcus${P}&screen=declined`, refs: [] },
  { id: 'charge-refund-goods', page: 'charges', url: `/charges/split${P}&screen=refund-goods`, refs: [] },
  { id: 'charge-void', page: 'charges', url: `/charges/card${P}&screen=void`, refs: [] },
  { id: 'charge-tip', page: 'charges', url: `/charges/card${P}&screen=tip`, refs: [] },

  // ---- Inventory -------------------------------------------------------------------------------
  {
    id: 'inventory-owner',
    page: 'inventory',
    url: `/inventory${P}`,
    refs: [r('inventory', 'Inventory · owner · tablet', 0, 'The page scrolls; the reference draws the whole list in one tall frame.'), r('inventory', 'One column, and the phone', 0, 'The page scrolls; the reference draws the whole list in one tall frame.'), r('inventory', 'One column, and the phone', 1)],
  },
  { id: 'inventory-counter', page: 'inventory', url: `/inventory${P}&as=jen`, refs: [r('inventory', 'Inventory · counter shift · tablet', 0, 'The page scrolls; the reference draws the whole list in one tall frame.')] },
  { id: 'inventory-empty', page: 'inventory', url: `/inventory${P}&screen=empty`, refs: [r('inventory', 'Before the first item', 0, '“Items None yet” is “—”, by the em-dash rule (DECISIONS › Inventory).')] },
  { id: 'inventory-filter', page: 'inventory', url: `/inventory${P}&screen=menu-filter`, refs: [] },
  { id: 'inventory-sort', page: 'inventory', url: `/inventory${P}&screen=menu-sort`, refs: [] },
  { id: 'inventory-add', page: 'inventory', url: `/inventory${P}&screen=add`, refs: [] },
  { id: 'inventory-add-service', page: 'inventory', url: `/inventory${P}&screen=add-service`, refs: [] },
  { id: 'inventory-import', page: 'inventory', url: `/inventory${P}&screen=import`, refs: [] },
  { id: 'item-owner', page: 'inventory', url: `/inventory/goodyear${P}&screen=item`, refs: [r('inventory', 'An item, opened', 0), r('inventory', 'One column, and the phone', 2)] },
  { id: 'item-counter', page: 'inventory', url: `/inventory/goodyear${P}&screen=item&as=jen`, refs: [r('inventory', 'An item, opened', 1)] },
  { id: 'item-adjust', page: 'inventory', url: `/inventory/goodyear${P}&screen=adjust`, refs: [r('inventory', 'Changing stock', 0, 'Square corners on the sheet (DECISIONS › The prompt\'s rules).')] },
  { id: 'item-on-order', page: 'inventory', url: `/inventory/goodyear${P}&screen=on-order`, refs: [r('inventory', 'Reordering', 2, 'Due Sat, Sep 26, not Fri (DECISIONS › Figures).'), r('inventory', 'Reordering', 1, 'A detail of the list row while a reorder is open; the item\'s page carries the same “8 on order”.')] },
  { id: 'item-reorder', page: 'inventory', url: `/inventory/goodyear${P}&screen=reorder`, refs: [] },
  { id: 'item-receive', page: 'inventory', url: `/inventory/goodyear${P}&screen=receive`, refs: [] },
  { id: 'item-receive-short', page: 'inventory', url: `/inventory/goodyear${P}&screen=receive-short`, refs: [] },
  { id: 'item-edit', page: 'inventory', url: `/inventory/goodyear${P}&screen=edit`, refs: [] },
  { id: 'item-archive', page: 'inventory', url: `/inventory/goodyear${P}&screen=archive`, refs: [] },
  { id: 'item-options', page: 'inventory', url: `/inventory/michelin/options${P}`, refs: [r('inventory', 'Options on an item', 0, 'The customer\'s preview sheet has square corners (DECISIONS › The prompt\'s rules).')] },
  { id: 'item-add-group', page: 'inventory', url: `/inventory/michelin/options${P}&screen=add-group`, refs: [] },

  // ---- New charge ------------------------------------------------------------------------------
  {
    id: 'new-amount',
    page: 'new',
    url: `/new${P}&screen=amount`,
    refs: [r('new-charge', '1 · Start with an amount', 0), r('new-charge', 'One column · 520 to 900', 0), r('new-charge', 'Phone · the fallback', 0, 'The phone\'s header carries the Amount / Items switch, so a phone can start from items; the reference\'s phone draws Amount only.')],
  },
  { id: 'new-amount-counter', page: 'new', url: `/new${P}&screen=amount&as=jen`, refs: [r('new-charge', '1 · Start with an amount', 1)] },
  { id: 'new-items', page: 'new', url: `/new${P}&screen=items&as=jen`, refs: [r('new-charge', '1 · Or start from items', 0), r('new-charge', '1 · Or start from items', 5)] },
  { id: 'new-items-suggest', page: 'new', url: `/new${P}&screen=items-suggest&as=jen`, refs: [r('new-charge', '1 · Or start from items', 1)] },
  { id: 'new-items-empty', page: 'new', url: `/new${P}&screen=items-empty&as=jen`, refs: [r('new-charge', '1 · Or start from items', 2)] },
  { id: 'new-options', page: 'new', url: `/new${P}&screen=options&as=jen`, refs: [r('new-charge', '1 · Or start from items', 3, 'Square corners on the sheet (DECISIONS › The prompt\'s rules).')] },
  { id: 'new-notenough', page: 'new', url: `/new${P}&screen=notenough&as=jen`, refs: [r('new-charge', '1 · Or start from items', 4, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'new-quicksale', page: 'new', url: `/new${P}&screen=quicksale&as=jen`, refs: [] },
  { id: 'new-phone-cart', page: 'new', url: `/new${P}&screen=phone-cart&as=jen`, refs: [r('new-charge', '1 · Or start from items', 6)] },
  { id: 'new-tiles', page: 'new', url: `/new${P}&screen=tiles&as=jen`, refs: [r('new-charge', '1 · From items, as tiles', 0)] },
  { id: 'new-food', page: 'new', url: `/new${P}&screen=food`, refs: [r('new-charge', '1 · From items, as tiles', 1, 'The food-truck example runs on the preview\'s session, so Mike is on shift rather than the reference\'s Linda.')] },
  { id: 'new-food-options', page: 'new', url: `/new${P}&screen=food-options`, refs: [] },
  { id: 'new-checkout', page: 'new', url: `/new${P}&screen=checkout&as=jen`, refs: [r('new-charge', '2 · Checkout', 0)] },
  { id: 'new-checkout-no-stripe', page: 'new', url: `/new${P}&screen=checkout-nostripe&as=jen`, refs: [r('new-charge', '2 · Checkout', 1, 'A detail: the reference draws this part alone; the app draws the whole screen around it. The locked Card tile is Checkout\'s own.')] },
  { id: 'new-checkout-amount', page: 'new', url: `/new${P}&screen=checkout-amount&as=jen`, refs: [] },
  { id: 'new-checkout-discount', page: 'new', url: `/new${P}&screen=checkout-discount&as=jen`, refs: [r('new-charge', '2 · Checkout', 2)] },
  { id: 'new-discount-code', page: 'new', url: `/new${P}&screen=discount-code&as=jen`, refs: [] },
  { id: 'new-discount-expired', page: 'new', url: `/new${P}&screen=discount-expired&as=jen`, refs: [] },
  { id: 'new-discount-amount', page: 'new', url: `/new${P}&screen=discount-amount&as=jen`, refs: [] },
  { id: 'new-tip', page: 'new', url: `/new${P}&screen=tip&as=jen`, refs: [r('new-charge', '3 · Tip')] },
  {
    id: 'new-code',
    page: 'new',
    url: `/new${P}&screen=code&as=jen`,
    refs: [r('new-charge', '4 · Paying with Clear', 0, 'Once the code shows, the charge is raised, so the header closes it (×, which cancels it) rather than stepping back (←).'), r('new-charge', 'One column · 520 to 900', 1, 'Once the code shows, the charge is raised, so the header closes it (×, which cancels it) rather than stepping back (←).'), r('new-charge', 'Phone · the fallback', 1)],
  },
  { id: 'new-code-cart', page: 'new', url: `/new${P}&screen=code-cart&as=jen`, refs: [r('new-charge', '4 · Paying with Clear', 1, 'Once the code shows, the charge is raised, so the header closes it (×, which cancels it) rather than stepping back (←).')] },
  { id: 'new-theirs', page: 'new', url: `/new${P}&screen=theirs&as=jen`, refs: [r('new-charge', '4 · Paying with Clear', 2, 'Once the code shows, the charge is raised, so the header closes it (×, which cancels it) rather than stepping back (←).')] },
  { id: 'new-phone', page: 'new', url: `/new${P}&screen=phone&as=jen`, refs: [r('new-charge', '4 · Paying with Clear', 3, 'Once the code shows, the charge is raised, so the header closes it (×, which cancels it) rather than stepping back (←).')] },
  { id: 'new-theirs-cart', page: 'new', url: `/new${P}&screen=theirs-cart&as=jen`, refs: [r('new-charge', '4 · Paying with Clear', 4, 'Once the code shows, the charge is raised, so the header closes it (×, which cancels it) rather than stepping back (←).')] },
  { id: 'new-under-min', page: 'new', url: `/new${P}&screen=under-min&as=jen`, refs: [r('new-charge', '4 · Paying with Clear', 5, 'A detail: the reference draws this part alone; the app draws the whole screen around it. The preview draws the customer\'s side alone, across the screen.')] },
  { id: 'new-waiting', page: 'new', url: `/new${P}&screen=waiting&as=jen`, refs: [r('new-charge', '4 · Paying with Clear', 6, 'Once the code shows, the charge is raised, so the header closes it (×, which cancels it) rather than stepping back (←). Neutral pronouns: “Reached them”, “on their phone” (DECISIONS › New Charge).'), r('new-charge', 'Phone · the fallback', 2, 'Neutral pronouns (DECISIONS › New Charge).')] },
  { id: 'new-approved', page: 'new', url: `/new${P}&screen=approved`, refs: [r('new-charge', '4 · Paying with Clear', 7, 'Neutral pronouns: “went to their phone”, “If they miss a payment” (DECISIONS › New Charge).'), r('new-charge', 'Phone · the fallback', 3)] },
  { id: 'new-approved-counter', page: 'new', url: `/new${P}&screen=approved&as=jen`, refs: [r('new-charge', '4 · Paying with Clear', 8, 'Neutral pronouns (DECISIONS › New Charge).')] },
  { id: 'new-card', page: 'new', url: `/new${P}&screen=card&as=jen`, refs: [r('new-charge', '5 · Paying by card', 0, '× in place of ←: the reader already has the amount, so leaving cancels it there (DECISIONS › Phase 5).')] },
  { id: 'new-card-reading', page: 'new', url: `/new${P}&screen=card-reading&as=jen`, refs: [r('new-charge', '5 · Paying by card', 1, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'new-card-declined', page: 'new', url: `/new${P}&screen=card-declined&as=jen`, refs: [r('new-charge', '5 · Paying by card', 2, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'new-card-approved', page: 'new', url: `/new${P}&screen=card-approved&as=jen`, refs: [r('new-charge', '5 · Paying by card', 3, 'The header carries what the card paid, tip included ($937.52, the walk-in on Charges); the reference keeps the $927.52 before the tip. × in place of ←, as on the card screen.')] },
  { id: 'new-receipt-text', page: 'new', url: `/new${P}&screen=receipt-text&as=jen`, refs: [] },
  { id: 'new-receipt-email', page: 'new', url: `/new${P}&screen=receipt-email&as=jen`, refs: [] },
  { id: 'new-print', page: 'new', url: `/new${P}&screen=print&as=jen`, refs: [] },
  { id: 'new-print-offline', page: 'new', url: `/new${P}&screen=print-offline&as=jen`, refs: [] },
  { id: 'new-cash', page: 'new', url: `/new${P}&screen=cash&as=jen`, refs: [r('new-charge', '6 · Paying in cash', 0)] },
  { id: 'new-cash-paid', page: 'new', url: `/new${P}&screen=cash-paid&as=jen`, refs: [r('new-charge', '6 · Paying in cash', 1)] },
  { id: 'new-split', page: 'new', url: `/new${P}&screen=split&as=jen`, refs: [r('new-charge', '7 · Split between methods', 0)] },
  { id: 'new-split-declined', page: 'new', url: `/new${P}&screen=split-declined&as=jen`, refs: [r('new-charge', '7 · Split between methods', 1, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'new-declined', page: 'new', url: `/new${P}&screen=declined&as=jen`, refs: [] },
  { id: 'new-expired', page: 'new', url: `/new${P}&screen=expired&as=jen`, refs: [] },
  { id: 'new-offline', page: 'new', url: `/new${P}&screen=offline&as=jen`, refs: [] },

  // ---- Payouts ---------------------------------------------------------------------------------
  {
    id: 'payouts-owner',
    page: 'payouts',
    url: `/payouts${P}`,
    refs: [r('payouts', 'Payouts · owner · tablet', 0), r('payouts', 'One column, and the phone', 0), r('payouts', 'One column, and the phone', 1)],
  },
  { id: 'payouts-none', page: 'payouts', url: `/payouts${P}&screen=none`, refs: [r('payouts', 'Payouts · owner · tablet', 1)] },
  { id: 'payouts-paying', page: 'payouts', url: `/payouts${P}&screen=paying`, refs: [r('payouts', 'Payouts · owner · tablet', 2)] },
  { id: 'payouts-year', page: 'payouts', url: `/payouts${P}&screen=year`, refs: [r('payouts', 'Payouts · owner · tablet', 3, 'A detail: the reference draws this part alone; the app draws the whole screen around it. The history is the Payouts cell\'s, under the cycle card.')] },
  { id: 'payouts-counter', page: 'payouts', url: `/payouts${P}&screen=counter`, refs: [r('payouts', 'Payouts · counter shift', 0, 'The route sends a real counter shift Home (DECISIONS › Payouts, Overview, Staff); its drawn page is reached under the owner\'s session, so the header is Mike\'s, unlocked.')] },
  { id: 'payouts-withdraw', page: 'payouts', url: `/payouts${P}&screen=withdraw`, refs: [] },
  { id: 'payouts-from', page: 'payouts', url: `/payouts${P}&screen=from`, refs: [] },
  { id: 'payouts-to', page: 'payouts', url: `/payouts${P}&screen=to`, refs: [] },
  { id: 'payouts-sending', page: 'payouts', url: `/payouts${P}&screen=sending`, refs: [] },
  { id: 'payouts-done', page: 'payouts', url: `/payouts${P}&screen=done`, refs: [] },
  { id: 'payouts-breakdown', page: 'payouts', url: `/payouts${P}&screen=breakdown`, refs: [] },
  { id: 'payouts-receive', page: 'payouts', url: `/payouts${P}&screen=receive`, refs: [] },
  { id: 'payouts-destinations', page: 'payouts', url: `/payouts${P}&screen=destinations`, refs: [] },
  { id: 'payouts-add-bank', page: 'payouts', url: `/payouts${P}&screen=add-bank`, refs: [] },

  // ---- Staff -----------------------------------------------------------------------------------
  {
    id: 'staff-owner',
    page: 'staff',
    url: `/staff${P}`,
    refs: [r('staff', 'Staff · owner · tablet', 0, 'Neutral pronouns: “Remind them”, “they set their PIN” (DECISIONS › Staff).'), r('staff', 'One column, and the phone', 0, 'Neutral pronouns: “Remind them”, “they set their PIN” (DECISIONS › Staff).'), r('staff', 'One column, and the phone', 1, 'Neutral pronouns: “Remind them”, “they set their PIN” (DECISIONS › Staff).')],
  },
  { id: 'staff-first', page: 'staff', url: `/staff${P}&screen=first`, refs: [r('staff', 'Staff · owner · tablet', 1, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'staff-busy', page: 'staff', url: `/staff${P}&screen=busy`, refs: [r('staff', 'Staff · owner · tablet', 2, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  {
    id: 'staff-counter',
    page: 'staff',
    url: `/staff${P}&screen=counter`,
    refs: [r('staff', 'Staff · counter shift · tablet', 0, 'The route sends a real counter shift Home (DECISIONS › Payouts, Overview, Staff); its drawn page is reached under the owner\'s session, so the header is Mike\'s, unlocked.'), r('staff', 'One column, and the phone', 2, 'The route sends a real counter shift Home; its drawn page is reached under the owner\'s session, so the header is Mike\'s.')],
  },
  { id: 'staff-person', page: 'staff', url: `/staff${P}&screen=person`, refs: [r('staff', 'Hours · owner · tablet', 0, 'Neutral pronouns: “Reset their PIN” (DECISIONS › Staff). Square corners on the sheet (DECISIONS › The prompt\'s rules).')] },
  { id: 'staff-hours', page: 'staff', url: `/staff${P}&screen=hours`, refs: [r('staff', 'Hours · owner · tablet', 1, 'Neutral pronouns (DECISIONS › Staff). Square corners on the sheet (DECISIONS › The prompt\'s rules).')] },
  { id: 'staff-day-hours', page: 'staff', url: `/staff${P}&screen=day-hours`, refs: [r('staff', 'Hours · owner · tablet', 2, 'Neutral pronouns: “a day they do not work”, “Their other days stay” (DECISIONS › Staff). Square corners on the sheet (DECISIONS › The prompt\'s rules).')] },
  { id: 'staff-hours-friday', page: 'staff', url: `/staff${P}&screen=hours-friday`, refs: [r('staff', 'Hours · owner · tablet', 3, 'Neutral pronouns (DECISIONS › Staff). Square corners on the sheet (DECISIONS › The prompt\'s rules).')] },
  { id: 'staff-hours-week', page: 'staff', url: `/staff${P}&screen=hours-week`, refs: [] },
  { id: 'staff-add', page: 'staff', url: `/staff${P}&screen=add`, refs: [] },
  { id: 'staff-remove', page: 'staff', url: `/staff${P}&screen=remove`, refs: [] },
  { id: 'staff-limit', page: 'staff', url: `/staff${P}&screen=limit`, refs: [] },

  // ---- Overview --------------------------------------------------------------------------------
  {
    id: 'overview-owner',
    page: 'overview',
    url: `/overview${P}`,
    refs: [r('overview', 'Overview · owner · tablet', 0, 'The month and the average follow the valve-stem correction: $5,295.23, $155.74, up $2,113.19 (DECISIONS › Figures).'), r('overview', 'One column, and the phone', 0, 'The month and the average follow the valve-stem correction: $5,295.23, $155.74, up $2,113.19 (DECISIONS › Figures). Narrower frames keep the second slab (DECISIONS › Overview).'), r('overview', 'One column, and the phone', 1, 'The month and the average follow the valve-stem correction: $5,295.23, $155.74, up $2,113.19 (DECISIONS › Figures). Narrower frames keep the second slab (DECISIONS › Overview).')],
  },
  { id: 'overview-counter', page: 'overview', url: `/overview${P}&screen=counter`, refs: [r('overview', 'Overview · counter shift', 0, 'The route sends a real counter shift Home (DECISIONS › Payouts, Overview, Staff); its drawn page is reached under the owner\'s session, so the header is Mike\'s, unlocked.')] },
  { id: 'overview-statements', page: 'overview', url: `/overview${P}&screen=statements`, refs: [] },
  { id: 'overview-terms', page: 'overview', url: `/overview${P}&screen=terms`, refs: [] },

  // ---- Settings --------------------------------------------------------------------------------
  { id: 'settings-index', page: 'settings', url: `/settings${P}`, refs: [r('settings', 'Settings · index', 0, 'The index lists all fourteen sections, not the first eight (DECISIONS › Settings).'), r('settings', 'Settings · index', 1, 'The index lists all fourteen sections, not the first eight (DECISIONS › Settings).')] },
  { id: 'settings-shop', page: 'settings', url: `/settings/shop${P}`, refs: [r('settings', 'Settings · owner · tablet')] },
  {
    id: 'settings-shop-hours',
    page: 'settings',
    url: `/settings/shop/hours${P}`,
    refs: [r('settings', 'Shop › Shop hours · pane and drill-in', 0), r('settings', 'Shop › Shop hours · pane and drill-in', 1)],
  },
  { id: 'settings-payouts', page: 'settings', url: `/settings/payouts${P}`, refs: [r('settings', 'Payouts · pane and drill-in', 0), r('settings', 'Payouts · pane and drill-in', 1)] },
  { id: 'settings-partnership', page: 'settings', url: `/settings/partnership${P}`, refs: [r('settings', 'Partnership')] },
  { id: 'settings-counter-pane', page: 'settings', url: `/settings/counter${P}`, refs: [r('settings', 'Counter')] },
  { id: 'settings-payments', page: 'settings', url: `/settings/payments${P}`, refs: [r('settings', 'Selling', 0)] },
  { id: 'settings-payments-connected', page: 'settings', url: `/settings/payments${P}&screen=payments-connected`, refs: [r('settings', 'Selling', 1)] },
  { id: 'settings-tax', page: 'settings', url: `/settings/tax${P}`, refs: [r('settings', 'Selling', 2)] },
  { id: 'settings-tips', page: 'settings', url: `/settings/tips${P}`, refs: [r('settings', 'Selling', 3)] },
  { id: 'settings-discounts', page: 'settings', url: `/settings/discounts${P}`, refs: [r('settings', 'Selling', 4)] },
  { id: 'settings-devices', page: 'settings', url: `/settings/devices${P}`, refs: [r('settings', 'Selling', 5)] },
  { id: 'settings-closing', page: 'settings', url: `/settings/closing${P}`, refs: [r('settings', 'Selling', 6)] },
  { id: 'settings-security', page: 'settings', url: `/settings/security${P}`, refs: [r('settings', 'Security')] },
  { id: 'settings-notifications', page: 'settings', url: `/settings/notifications${P}`, refs: [r('settings', 'Notifications')] },
  { id: 'settings-advanced', page: 'settings', url: `/settings/advanced${P}`, refs: [r('settings', 'Advanced', 0, 'Tax ID is ••-•••4829 (DECISIONS › Figures).')] },
  { id: 'settings-help', page: 'settings', url: `/settings/help${P}`, refs: [r('settings', 'Help')] },
  { id: 'settings-counter', page: 'settings', url: `/settings${P}&screen=counter&as=jen`, refs: [r('settings', 'Settings · counter shift · tablet', 0, 'A counter shift\'s rail is You alone: absent, not locked (DECISIONS › Settings).')] },
  { id: 'settings-leave', page: 'settings', url: `/settings/advanced${P}&screen=leave`, refs: [r('settings', 'Settings modals', 0, 'Tax ID is ••-•••4829 (DECISIONS › Figures). Square corners on the sheet (DECISIONS › The prompt\'s rules).')] },
  { id: 'settings-account', page: 'settings', url: `/settings${P}&screen=account`, refs: [] },
  { id: 'settings-device', page: 'settings', url: `/settings/devices${P}&screen=device`, refs: [] },
  { id: 'settings-confirm', page: 'settings', url: `/settings/advanced${P}&screen=confirm`, refs: [] },
  { id: 'settings-code', page: 'settings', url: `/settings/partnership${P}&screen=code`, refs: [] },

  // ---- Onboarding ------------------------------------------------------------------------------
  { id: 'onboarding-1', page: 'onboarding', url: `/onboarding${P}&step=1`, refs: [r('onboarding', '1 · Start')] },
  { id: 'onboarding-2', page: 'onboarding', url: `/onboarding${P}&step=2`, refs: [r('onboarding', '2 · Your shop')] },
  { id: 'onboarding-3', page: 'onboarding', url: `/onboarding${P}&step=3`, refs: [r('onboarding', '3 · Your team', 0)] },
  { id: 'onboarding-3-solo', page: 'onboarding', url: `/onboarding${P}&step=3&team=solo`, refs: [r('onboarding', '3 · Your team', 1, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'onboarding-4', page: 'onboarding', url: `/onboarding${P}&step=4`, refs: [r('onboarding', '4 · Your terms', 0), r('onboarding', 'On the phone', 0)] },
  { id: 'onboarding-4-warn', page: 'onboarding', url: `/onboarding${P}&step=4&code=warn`, refs: [r('onboarding', '4 · Your terms', 1, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'onboarding-4-bad', page: 'onboarding', url: `/onboarding${P}&step=4&code=bad`, refs: [r('onboarding', '4 · Your terms', 2, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'onboarding-5', page: 'onboarding', url: `/onboarding${P}&step=5`, refs: [r('onboarding', '5 · Verify', 0)] },
  { id: 'onboarding-5-needs', page: 'onboarding', url: `/onboarding${P}&step=5&verify=needs`, refs: [r('onboarding', '5 · Verify', 1, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'onboarding-5-verified', page: 'onboarding', url: `/onboarding${P}&step=5&verify=verified`, refs: [r('onboarding', '5 · Verify', 2, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'onboarding-6', page: 'onboarding', url: `/onboarding${P}&step=6`, refs: [r('onboarding', '6 · Where payouts go', 0)] },
  { id: 'onboarding-6-waiting', page: 'onboarding', url: `/onboarding${P}&step=6&bank=waiting`, refs: [r('onboarding', '6 · Where payouts go', 1, 'A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'onboarding-7', page: 'onboarding', url: `/onboarding${P}&step=7`, refs: [r('onboarding', '7 · The counter'), r('onboarding', 'On the phone', 1)] },
  { id: 'onboarding-done', page: 'onboarding', url: `/onboarding${P}&done=1`, refs: [r('onboarding', 'Done')] },

  // ---- Signing in (no session, so from the gallery's frames) -----------------------------------
  { id: 'enroll-code', page: 'sign-in', gallery: 'Set up this tablet, by code', refs: [r('sign-in', '1 · Enrolling a device', 0, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')] },
  { id: 'enroll-expired', page: 'sign-in', gallery: 'A code that has expired', refs: [r('sign-in', '1 · Enrolling a device', 2, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation. A detail: the reference draws this part alone; the app draws the whole screen around it.')] },
  { id: 'enroll-confirm', page: 'sign-in', gallery: 'Enrolling, after the owner signed in here', refs: [r('sign-in', '1 · Enrolling a device', 1, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')] },
  { id: 'shift-who', page: 'sign-in', gallery: "Who's on the counter?", refs: [r('sign-in', '2 · Starting a shift', 0, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')] },
  { id: 'shift-pin', page: 'sign-in', gallery: 'PIN', refs: [r('sign-in', '2 · Starting a shift', 1, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')] },
  { id: 'shift-pin-wrong', page: 'sign-in', gallery: 'Wrong PIN', refs: [] },
  { id: 'shift-idle-lock', page: 'sign-in', gallery: 'Locked after five idle minutes', refs: [r('sign-in', '2 · Starting a shift', 2, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation. Neutral pronouns: “Their shift keeps running” (DECISIONS › Copy).')] },
  {
    id: 'owner-sign-in',
    page: 'sign-in',
    gallery: 'Full screen, on another device',
    refs: [r('sign-in', '3 · The owner, for anything that moves money', 0, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.'), r('sign-in', '3 · The owner, for anything that moves money', 2, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')],
  },
  { id: 'owner-check-email', page: 'sign-in', gallery: 'Check your email, full screen', refs: [r('sign-in', '3 · The owner, for anything that moves money', 1, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')] },
  { id: 'owner-passkey', page: 'sign-in', gallery: 'Waiting for a passkey', refs: [r('sign-in', '3 · The owner, for anything that moves money', 3, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')] },
  { id: 'owner-signed-in', page: 'sign-in', gallery: 'Signed in', refs: [r('sign-in', '3 · The owner, for anything that moves money', 4, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')] },
  { id: 'owner-beside-shift', page: 'sign-in', gallery: "Owner signed in beside Jen's shift", sizes: ['landscape', 'portrait'], refs: [r('sign-in', '3 · The owner, for anything that moves money', 5, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation. A detail: the header alone.')] },
  { id: 'tablet-removed', page: 'sign-in', gallery: 'The removed tablet', refs: [r('sign-in', '4 · A forgotten PIN, and a lost tablet', 0, 'From the gallery, which frames the same screen component the app shows; it only appears signed out, so this is how it is reached in isolation.')] },
];

/** A frame's size, from its classes: which of the three captures it pairs with. */
export type SizeName = 'landscape' | 'portrait' | 'phone';
