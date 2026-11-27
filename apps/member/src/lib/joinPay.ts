/**
 * The join window (`app.useclear.org/join/pay?h=<handoff>`): Pay with Clear's step 2, in Clear's own
 * window (pay DECISIONS, "Joining").
 *
 * A new customer confirmed their phone or email in the shop's modal and typed step 1 there: legal
 * name, date of birth, ZIP and street. The SSN, a photo of their ID and their bank's sign-in need a
 * window whose address bar says Clear, so the modal opens this one. It signs up with Privy, runs the
 * onboarding submit chain, Lithic's identity check and Plaid, then tells the API it's done; the
 * modal, polling, moves on to step 3.
 *
 * Everything here is pure, so the rules the window lives by can be tested without a browser.
 */
import { toIdentityStatus, type IdentityState } from './identityStatus';
import { toFormattedSsn, toIsoDob } from './identityFields';

/**
 * `GET /api/checkout/join/:handoff`, as `@clear/merchant-contracts` (payPages.ts, `JoinWindow`)
 * defines it. Only the fields this window reads; the contracts are the source.
 */
export interface JoinWindowView {
  shop: { name: string; initials: string };
  order: { totalCents: number; summary: string };
  /** "micasatacos.com": where they go back to. Null for a payment link. */
  shopHost: string | null;
  /** Step 1. Null signed out: the API gives it only to the person signed in with the confirmed contact. */
  basics: { legalName: string; dateOfBirth: string; zip: string; street: string } | null;
  /** The phone or email the modal's code confirmed. */
  contact: { channel: 'phone' | 'email'; value: string };
  expiresAt: string;
}

/** `POST /api/checkout/join/:handoff/done` (`JoinFinished`). */
export interface JoinFinished {
  state: 'done';
  /** The term limit now on the member's line; null when the checks haven't passed yet. */
  termLimitCents: number | null;
}

export type JoinRead<T> =
  | { kind: 'ok'; data: T }
  /** 404 or 410 (or 409, used): the hand-off has ended or was already used. */
  | { kind: 'ended' }
  /** 401: nobody signed in, or the session lapsed. */
  | { kind: 'signin' }
  /** Anything else: the network, or the API having a bad moment. */
  | { kind: 'error' };

/** The hand-off from `?h=`. Null when it's missing or isn't the shape of one. */
export function handoffFrom(search: string): string | null {
  const h = new URLSearchParams(search).get('h')?.trim() ?? '';
  return /^[A-Za-z0-9_-]{8,200}$/.test(h) ? h : null;
}

/** How each answer reads, the same for the GET and the POST. */
async function readAs<T>(r: Response, valid: (body: unknown) => body is T): Promise<JoinRead<T>> {
  if (r.status === 404 || r.status === 410 || r.status === 409) return { kind: 'ended' };
  if (r.status === 401) return { kind: 'signin' };
  if (!r.ok) return { kind: 'error' };
  const body = (await r.json().catch(() => null)) as unknown;
  return valid(body) ? { kind: 'ok', data: body } : { kind: 'error' };
}

function isJoinWindow(body: unknown): body is JoinWindowView {
  const v = body as JoinWindowView | null;
  return Boolean(v && typeof v.shop?.name === 'string' && typeof v.order?.totalCents === 'number' && v.basics !== undefined && v.contact);
}

function isJoinFinished(body: unknown): body is JoinFinished {
  return (body as JoinFinished | null)?.state === 'done';
}

/**
 * Reads the hand-off. `headers` is the member's session (the Privy token and the wallet), the same
 * pair the member routes take; an empty object asks without one. Nothing cached: the hand-off
 * changes under the page.
 */
export async function readJoinWindow(
  handoff: string,
  apiBase: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<JoinRead<JoinWindowView>> {
  try {
    const r = await fetchImpl(`${apiBase}/api/checkout/join/${encodeURIComponent(handoff)}`, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', ...headers },
    });
    return await readAs(r, isJoinWindow);
  } catch {
    return { kind: 'error' };
  }
}

/** Tells the API the window is finished. The session's wallet becomes the payment's payer. */
export async function postJoinDone(
  handoff: string,
  apiBase: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<JoinRead<JoinFinished>> {
  try {
    const r = await fetchImpl(`${apiBase}/api/checkout/join/${encodeURIComponent(handoff)}/done`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    });
    return await readAs(r, isJoinFinished);
  } catch {
    return { kind: 'error' };
  }
}

// ---- What the window shows ------------------------------------------------------------------------

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Mi Casa Tacos · $185.32 · Taco tray for 12, 2 × Agua fresca". */
export function askingFor(view: Pick<JoinWindowView, 'shop' | 'order'>): string {
  return [view.shop.name, usd(view.order.totalCents), view.order.summary].filter(Boolean).join(' · ');
}

/** "+19095550188" → "(909) 555-0188"; an email, or any other number, as it came. */
export function contactLabel(contact: { channel: 'phone' | 'email'; value: string }): string {
  if (contact.channel !== 'phone') return contact.value;
  const d = contact.value.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : contact.value;
}

/** The shop's own page, by its site when there is one. */
function shopPage(host: string | null, shopName: string): string {
  return host ?? `${shopName}’s page`;
}

/** Where to start again: the shop's own page. */
export function startAgainLine(shopName: string | null): string {
  return `Start again on ${shopName ? `${shopName}’s` : 'the shop’s'} page.`;
}

/** The hand-off has ended or was used (404/410). */
export function endedLine(shopName: string | null): string {
  return `This link has ended. ${startAgainLine(shopName)}`;
}

/** Identity couldn't be confirmed: they're still a member, and the shop takes a card. */
export function cardStillLine(host: string | null, shopName: string): string {
  return `${shopPage(host, shopName)} still has Pay by card.`;
}

/**
 * "You're in", and what's next. A term limit means the split can be approved back on the shop's page;
 * none yet (checks pending, rejected or put off) means the shop's card is how this order is paid.
 */
export function doneLede(finished: JoinFinished | null, host: string | null, shopName: string, identity: IdentityState, identityLater = false): string {
  if (identity === 'rejected') return `We couldn’t confirm it’s you, so credit isn’t open yet. ${cardStillLine(host, shopName)}`;
  if (finished?.termLimitCents) return `You can split up to ${usd(finished.termLimitCents)}. Finish on ${shopPage(host, shopName)}.`;
  if (identityLater) return `Confirm it’s you any time in Clear. ${cardStillLine(host, shopName)}`;
  return `Finish on ${shopPage(host, shopName)}. It still has Pay by card.`;
}

// ---- The basics, ready for the identity check ------------------------------------------------------

/**
 * "Marco Alvarez" → Marco / Alvarez. The first word is the first name and the rest is the last name,
 * as the Verify identity form splits it ("Maria de la Cruz" → Maria / de la Cruz). Null without both.
 */
export function splitLegalName(name: string): { firstName: string; lastName: string } | null {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  if (!firstName || rest.length === 0) return null;
  return { firstName, lastName: rest.join(' ') };
}

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE',
  nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const CODES = new Set(Object.values(STATES));

/** "CA", "ca", "California" → "CA". Null for anything that isn't a US state. */
export function stateCode(text: string): string | null {
  const t = text.trim().replace(/\.$/, '');
  if (CODES.has(t.toUpperCase()) && t.length === 2) return t.toUpperCase();
  return STATES[t.toLowerCase()] ?? null;
}

export interface StreetParts {
  address1: string;
  /** Empty when the street didn't say; the window asks. */
  city: string;
  state: string;
}

/**
 * Step 1 asks for a street address in one field, and Lithic wants the street, city and state apart.
 * "418 W 6th St, Ontario, CA" (with or without the ZIP after the state, or the state spelled out)
 * splits into all three. Without a state at the end, the whole string is the street and the city and
 * state are left empty for the window to ask, rather than guessed.
 */
export function parseStreet(street: string): StreetParts {
  const parts = street.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    // The last part is the state, maybe with the ZIP after it: "CA 91762".
    const last = parts[parts.length - 1]!.replace(/\s+\d{5}(?:-\d{4})?$/, '');
    const state = stateCode(last);
    const city = parts[parts.length - 2]!;
    if (state && city && !/\d/.test(city)) {
      return { address1: parts.slice(0, -2).join(', '), city, state };
    }
  }
  if (parts.length >= 2) {
    // "418 W 6th St, Ontario CA 91762": the city and state share the last part.
    const m = parts[parts.length - 1]!.match(/^([A-Za-z .'-]+?)\s+([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
    const state = m ? stateCode(m[2]!) : null;
    if (m && state) return { address1: parts.slice(0, -1).join(', '), city: m[1]!.trim(), state };
  }
  return { address1: street.trim(), city: '', state: '' };
}

/** `1991-04-12` → `04/12/1991`, the way the identity form's date field is typed (and `toIsoDob` reads). */
export function typedDob(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

/** A phone as Lithic wants it (E.164), from however it was written. */
export function toE164(phone: string): string {
  const t = phone.trim();
  return t.startsWith('+') ? `+${t.replace(/\D/g, '')}` : `+1${t.replace(/\D/g, '')}`;
}

/** The identity form: the basics from step 1, made editable, plus what only this window asks. */
export interface IdentityValues {
  name: string;
  /** As typed: MM/DD/YYYY. */
  dob: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  /** Asked only here, kept in memory only while the form is open. */
  ssn: string;
}

/** The form, filled from step 1 and the confirmed contact. The other contact comes from sign-in, if it has one. */
export function identityValuesFrom(view: JoinWindowView, signedInEmail?: string | null): IdentityValues {
  const basics = view.basics ?? { legalName: '', dateOfBirth: '', zip: '', street: '' };
  const street = parseStreet(basics.street);
  return {
    name: basics.legalName.trim(),
    dob: basics.dateOfBirth ? typedDob(basics.dateOfBirth) : '',
    address1: street.address1,
    city: street.city,
    state: street.state,
    zip: basics.zip,
    phone: view.contact.channel === 'phone' ? view.contact.value : '',
    email: view.contact.channel === 'email' ? view.contact.value : (signedInEmail ?? ''),
    ssn: '',
  };
}

/** What `POST /api/lithic/account` takes (`submitIdentity`). */
export interface IdentityInput {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dob: string;
  governmentId: string;
  address: { address1: string; city: string; state: string; postal_code: string };
}

/**
 * Checks the form the way the Verify identity modal does, before anything is sent: a validation
 * miss found after an SSN has gone is the worst time to find one.
 */
export function identityInput(v: IdentityValues): { input: IdentityInput } | { error: string } {
  const name = splitLegalName(v.name);
  if (!name) return { error: 'Enter your first and last name.' };
  const dob = toIsoDob(v.dob);
  if (!dob) return { error: 'Enter your date of birth as MM/DD/YYYY. You must be 18 or over.' };
  const ssn = toFormattedSsn(v.ssn);
  if (!ssn) return { error: 'A social security number is nine digits.' };
  if (!v.address1.trim() || !v.city.trim() || !v.zip.trim()) return { error: 'We need your full home address.' };
  const state = stateCode(v.state);
  if (!state) return { error: 'Enter your state, like CA.' };
  if (v.phone.replace(/\D/g, '').length < 10) return { error: 'We need a phone number for our card issuer.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) return { error: 'We need an email address for our card issuer.' };
  return {
    input: {
      ...name,
      email: v.email.trim(),
      phoneNumber: toE164(v.phone),
      dob,
      governmentId: ssn,
      address: { address1: v.address1.trim(), city: v.city.trim(), state, postal_code: v.zip.trim() },
    },
  };
}

// ---- The steps, in order ----------------------------------------------------------------------------

export type JoinStep = 'onboard' | 'identity' | 'document' | 'bank' | 'finish';

export interface JoinProgress {
  /** The member record exists and onboarding was submitted (now or before). */
  onboarded: boolean;
  /** Lithic's answer, as the app names it. */
  identity: IdentityState;
  /** The identity form was sent from this window (so a "didn't match" isn't asked again in a loop). */
  identityTried: boolean;
  /** "Do this later" on identity, or on the photo. */
  identityLater: boolean;
  /** Anything needed doing when the window opened: a fully set-up member skips straight to finishing. */
  joining: boolean;
  bankLinked: boolean;
  bankSkipped: boolean;
}

/**
 * The next thing the window does. In order: the submit chain, the identity check (the SSN, asked only
 * here), a photo when Lithic wants one, the bank (skippable: it isn't needed to join), then finishing.
 *
 * Rejected skips the bank: credit can't open, so linking one would buy nothing today.
 */
export function nextStep(p: JoinProgress): JoinStep {
  if (!p.onboarded) return 'onboard';
  if (!p.identityLater) {
    if (p.identity === 'unverified') return 'identity';
    if (p.identity === 'needs_resubmit' && !p.identityTried) return 'identity';
    if (p.identity === 'needs_document') return 'document';
  }
  if (p.joining && p.identity !== 'rejected' && !p.bankLinked && !p.bankSkipped) return 'bank';
  return 'finish';
}

/**
 * Whether anything needs doing for this member. A member who's onboarded and verified (or whose
 * check is with Lithic already) has nothing to do here but finish.
 */
export function needsJoining(onboarded: boolean, identity: IdentityState): boolean {
  return !onboarded || identity === 'unverified' || identity === 'needs_resubmit' || identity === 'needs_document';
}

/** Onboarded means past `ONBOARDING`; a status that didn't load is treated as not yet. */
export function isOnboarded(memberStatus: string | null): boolean {
  return memberStatus != null && memberStatus !== 'ONBOARDING';
}

/**
 * Lithic's state after `POST /api/lithic/account`: its KYC status (`ACCEPTED`, `PENDING_DOCUMENT`, …)
 * read the way Settings reads it.
 */
export function identityAfterSubmit(kycStatus: string | undefined): IdentityState {
  return toIdentityStatus({ configured: true, provisioned: true, status: kycStatus }).state;
}

/** The panel's label for each step. The window is the modal's step 2 of 3. */
export const STEP_LABEL: Record<JoinStep | 'signin' | 'done', string> = {
  signin: 'Sign in',
  onboard: 'Joining',
  identity: 'Confirm it’s you',
  document: 'Photo of your ID',
  bank: 'Link your bank',
  finish: 'Finishing',
  done: 'Done',
};
