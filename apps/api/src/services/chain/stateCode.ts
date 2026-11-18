import { ethers } from 'ethers';

/*
 * A member's state of residence, as the chain holds it. One place, so the attestation the API writes
 * is byte for byte what the contracts compare it with.
 *
 * The encoding is the deploy's: `deploy/25_wire_Compliance.ts` (`loadRateTable`) writes every
 * RateSchedule product under `ethers.encodeBytes32String(state)` for the two-letter codes in
 * `deploy/config/rate-schedule.json` ("CA" is 0x4341 then 30 zero bytes). RevolvingIssuer's state
 * gate reads `NetworkRegistry.stateCodeOf(member)` and asks `RateSchedule.isEnabled(state,
 * ceilingProduct)` with that same bytes32, and TermIssuer does the same, so an attestation in any
 * other form (lower case, a full name, right-aligned) would be a state no product is enabled in.
 * Zero is "not attested" (NetworkRegistry refuses to write it).
 */

/** USPS codes: the 50 states, DC and the inhabited territories. Nothing else is a state here. */
export const US_STATE_NAMES: Readonly<Record<string, string>> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
};

const squash = (s: string) => s.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();

/** Full names (and the few common spellings that are not guesses) to codes. */
const BY_NAME: ReadonlyMap<string, string> = new Map([
  ...Object.entries(US_STATE_NAMES).map(([code, name]) => [squash(name), code] as [string, string]),
  ['washington dc', 'DC'],
  ['washington d c', 'DC'],
  ['dc', 'DC'],
  ['virgin islands', 'VI'],
  ['us virgin islands', 'VI'],
]);

export type StateCodeParse = { ok: true; code: string } | { ok: false; reason: 'missing' | 'unrecognized' };

/**
 * The member's two-letter code from what they typed (a profile field is free text, up to 60
 * characters): a code in any case, or a full name. Anything else is unrecognized and never guessed.
 */
export function normalizeStateCode(raw: string | null | undefined): StateCodeParse {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: false, reason: 'missing' };
  const upper = text.replace(/\./g, '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && US_STATE_NAMES[upper]) return { ok: true, code: upper };
  const byName = BY_NAME.get(squash(text));
  return byName ? { ok: true, code: byName } : { ok: false, reason: 'unrecognized' };
}

/** The bytes32 the contracts hold for a two-letter code. Throws on anything that is not one. */
export function encodeStateCode(code: string): string {
  if (!/^[A-Z]{2}$/.test(code) || !US_STATE_NAMES[code]) throw new Error('not a two-letter US state code');
  return ethers.encodeBytes32String(code);
}

/** The two-letter code in a bytes32 state code, or null for none (zero) or anything unreadable. */
export function decodeStateCode(value: unknown): string | null {
  if (typeof value !== 'string' || /^0x0*$/.test(value)) return null;
  try {
    return ethers.decodeBytes32String(value) || null;
  } catch {
    return null;
  }
}
