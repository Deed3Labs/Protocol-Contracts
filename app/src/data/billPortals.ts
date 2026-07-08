/*
 * Bill-portal directory for Clear Pay. Users can't be given most billers' ACH details (utilities/rent
 * pull from you), so instead we send them to the biller's own portal to pay with their Clear card
 * (Bridge / Stripe Issuing, funded just-in-time from their Base USDC). This is the verified list of
 * provider login/pay URLs, grouped by category and tagged by the US states they serve so we can bubble
 * the likely ones to the top. National providers (telecom, rent platforms) carry no `states`.
 */
export type PortalCategory = 'electric' | 'utilities' | 'rent' | 'telecom';

export interface BillPortal {
  id: string;
  name: string;
  category: PortalCategory;
  /** Deep link to the provider's login / pay-bill page (not the marketing home). */
  url: string;
  hint?: string;
  /** US state codes served; omit for national providers. */
  states?: string[];
  /** Rare: the site permits iframing, so we can embed it in-app. Default (undefined) → opens in a new tab. */
  frameable?: boolean;
}

export const PORTAL_CATEGORIES: { id: PortalCategory; label: string; emoji: string }[] = [
  { id: 'electric', label: 'Electric', emoji: '⚡️' },
  { id: 'utilities', label: 'Utilities', emoji: '💧' },
  { id: 'rent', label: 'Rent', emoji: '🏠' },
  { id: 'telecom', label: 'Telecom', emoji: '📱' },
];

export const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington, D.C.' },
];

export const BILL_PORTALS: BillPortal[] = [
  // ── Electric (investor-owned utilities) ─────────────────────────────────────
  { id: 'pge', name: 'PG&E', category: 'electric', hint: 'Gas & electric', url: 'https://m.pge.com/', states: ['CA'] },
  { id: 'sce', name: 'Southern California Edison', category: 'electric', hint: 'Electric', url: 'https://www.sce.com/mysce/login', states: ['CA'] },
  { id: 'sdge', name: 'San Diego Gas & Electric', category: 'electric', hint: 'Gas & electric', url: 'https://myaccount.sdge.com/', states: ['CA'] },
  { id: 'coned', name: 'Con Edison', category: 'electric', hint: 'Gas & electric', url: 'https://www.coned.com/en/login', states: ['NY'] },
  { id: 'comed', name: 'ComEd', category: 'electric', hint: 'Electric', url: 'https://secure.comed.com/MyAccount/Pages/Login.aspx', states: ['IL'] },
  { id: 'duke', name: 'Duke Energy', category: 'electric', hint: 'Electric', url: 'https://www.duke-energy.com/my-account/sign-in', states: ['NC', 'SC', 'FL', 'OH', 'IN', 'KY'] },
  { id: 'fpl', name: 'Florida Power & Light', category: 'electric', hint: 'Electric', url: 'https://www.fpl.com/my-account/login.html', states: ['FL'] },
  { id: 'georgiapower', name: 'Georgia Power', category: 'electric', hint: 'Electric', url: 'https://www.georgiapower.com/sign-in.html', states: ['GA'] },
  { id: 'oncor', name: 'Oncor / TXU Energy', category: 'electric', hint: 'Electric', url: 'https://www.txu.com/en/residential/login', states: ['TX'] },
  { id: 'dominion', name: 'Dominion Energy', category: 'electric', hint: 'Electric', url: 'https://www.dominionenergy.com/sign-in', states: ['VA', 'NC', 'SC', 'OH'] },
  { id: 'xcel', name: 'Xcel Energy', category: 'electric', hint: 'Gas & electric', url: 'https://my.xcelenergy.com/MyAccount/s/login/', states: ['CO', 'MN', 'TX', 'NM', 'WI', 'MI', 'ND', 'SD'] },
  { id: 'aps', name: 'Arizona Public Service', category: 'electric', hint: 'Electric', url: 'https://www.aps.com/en/Account-Login', states: ['AZ'] },
  { id: 'nvenergy', name: 'NV Energy', category: 'electric', hint: 'Electric', url: 'https://www.nvenergy.com/account/login', states: ['NV'] },
  { id: 'pse', name: 'Puget Sound Energy', category: 'electric', hint: 'Gas & electric', url: 'https://myaccount.pse.com/', states: ['WA'] },

  // ── Utilities (gas / water) ────────────────────────────────────────────────
  { id: 'socalgas', name: 'SoCalGas', category: 'utilities', hint: 'Natural gas', url: 'https://myaccount.socalgas.com/', states: ['CA'] },
  { id: 'nationalgrid', name: 'National Grid', category: 'utilities', hint: 'Gas & electric', url: 'https://www.nationalgridus.com/login', states: ['NY', 'MA', 'RI'] },
  { id: 'atmos', name: 'Atmos Energy', category: 'utilities', hint: 'Natural gas', url: 'https://www.atmosenergy.com/accountcenter/logon/login.html', states: ['TX', 'LA', 'MS', 'CO', 'KS', 'KY', 'TN'] },
  { id: 'amwater', name: 'American Water', category: 'utilities', hint: 'Water', url: 'https://www.amwater.com/mywater/login', states: ['NJ', 'PA', 'IL', 'MO', 'CA', 'IN', 'WV'] },
  { id: 'nicor', name: 'Nicor Gas', category: 'utilities', hint: 'Natural gas', url: 'https://www.nicorgas.com/sign-in', states: ['IL'] },

  // ── Rent (landlord payment platforms — national) ───────────────────────────
  { id: 'rentcafe', name: 'RentCafe', category: 'rent', hint: 'Resident portal', url: 'https://www.rentcafe.com/residentservices/apartmentsforrent/userlogin.aspx' },
  { id: 'appfolio', name: 'AppFolio', category: 'rent', hint: 'Online portal', url: 'https://www.appfolio.com/online-portal-login' },
  { id: 'buildium', name: 'Buildium', category: 'rent', hint: 'Resident portal', url: 'https://signin.managebuilding.com/manager/public/authentication/login' },
  { id: 'zillow', name: 'Zillow Rental Manager', category: 'rent', hint: 'Pay rent online', url: 'https://www.zillow.com/user/acct/login/' },
  { id: 'payyourrent', name: 'PayYourRent', category: 'rent', hint: 'Pay rent online', url: 'https://online.payyourrent.com/' },
  { id: 'entrata', name: 'Entrata / ResidentPortal', category: 'rent', hint: 'Resident portal', url: 'https://www.residentportal.com/' },

  // ── Telecom (national) ─────────────────────────────────────────────────────
  { id: 'att', name: 'AT&T', category: 'telecom', hint: 'Wireless & internet', url: 'https://signin.att.com/' },
  { id: 'verizon', name: 'Verizon', category: 'telecom', hint: 'Wireless & Fios', url: 'https://www.verizon.com/signin' },
  { id: 'tmobile', name: 'T-Mobile', category: 'telecom', hint: 'Wireless', url: 'https://account.t-mobile.com/' },
  { id: 'xfinity', name: 'Xfinity / Comcast', category: 'telecom', hint: 'Internet & TV', url: 'https://login.xfinity.com/login' },
  { id: 'spectrum', name: 'Spectrum', category: 'telecom', hint: 'Internet & TV', url: 'https://www.spectrum.net/login' },
  { id: 'cox', name: 'Cox Communications', category: 'telecom', hint: 'Internet & TV', url: 'https://www.cox.com/residential/pay-bill.html' },
];

/** Rank portals for a state: in-state regional providers first, then national, then the rest. */
export function rankPortals(portals: BillPortal[], state?: string): BillPortal[] {
  if (!state) return portals;
  const score = (p: BillPortal) => (p.states?.includes(state) ? 0 : !p.states ? 1 : 2);
  return [...portals].sort((a, b) => score(a) - score(b));
}

/** Best-effort match a detected/manual biller name to a directory portal (folds in the user's bills). */
export function matchPortal(billerName: string): BillPortal | undefined {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9&]+/g, '');
  const s = norm(billerName);
  if (s.length < 3) return undefined;
  return BILL_PORTALS.find((p) => {
    const pn = norm(p.name);
    if (pn.length < 3) return false;
    if (s.includes(pn) || pn.includes(s)) return true;
    // shared distinctive token (e.g. "verizon", "xfinity")
    return p.name.toLowerCase().split(/[^a-z0-9&]+/).some((t) => t.length > 3 && s.includes(t));
  });
}
