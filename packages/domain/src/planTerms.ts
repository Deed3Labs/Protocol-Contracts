/**
 * The terms a member signs to open a term plan (audit H-4), and the disclosure they are shown.
 *
 * `TermIssuer.openPlan(PlanTerms terms, bytes signature)` opens a plan only on terms the member
 * signed: an EIP-712 signature over `PlanTerms`, at the member's current `planNonces(member)`, in
 * the domain { name "Clear TermIssuer", version "1", chainId, verifyingContract: the TermIssuer }.
 * EIP-1271 smart accounts are accepted on chain. The operator key only submits.
 *
 * This is the one definition of those terms. The API builds the typed data and submits the
 * signature; the member app checks it and signs it. Neither copies the field list. Phase 2 changes
 * the plan terms again (rate, product and split rules, and a re-split that needs the member's
 * signature too), and that change is made here, once, and checked against the contract's
 * `PLAN_TERMS_TYPEHASH` by `planTerms.test.ts`.
 *
 * No dependencies, like the rest of this package: hashing is the caller's (ethers on the server,
 * viem in the app), passed in where it is needed. Both are keccak-256 over the same bytes.
 *
 * ## The disclosure hash
 *
 * `disclosureHash` is `keccak256(utf8(planDisclosure(...).join('\n')))`: the hash of the exact
 * lines the approval screen shows above "Sign and approve". The lines are built here from the same
 * terms the member signs, with fixed formatting (no locale), so the server and the phone produce the
 * same bytes. The member app recomputes the hash from the lines it rendered and refuses to sign if
 * it differs from the one in the typed data, which is what makes it the hash of the disclosure
 * actually shown rather than of whatever the server said it showed. `PLAN_DISCLOSURE_VERSION` is the
 * first line, so a change of wording is a change of hash.
 */

import { splitQuote } from './split';

/** EIP-712 domain name and version, as `TermIssuer.domainSeparator()` hashes them. */
export const PLAN_TERMS_DOMAIN_NAME = 'Clear TermIssuer';
export const PLAN_TERMS_DOMAIN_VERSION = '1';

/** The struct, field for field in the contract's order. The order is the hash. */
export const PLAN_TERMS_TYPES = {
  PlanTerms: [
    { name: 'member', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'purchase', type: 'uint256' },
    { name: 'payout', type: 'uint256' },
    { name: 'ratePerCycle', type: 'uint256' },
    { name: 'cycleLength', type: 'uint64' },
    { name: 'installments', type: 'uint32' },
    { name: 'installmentLength', type: 'uint64' },
    { name: 'disclosureHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** The type string the contract hashes into `PLAN_TERMS_TYPEHASH`, derived from the list above. */
export const PLAN_TERMS_TYPE_STRING = `PlanTerms(${PLAN_TERMS_TYPES.PlanTerms.map((f) => `${f.type} ${f.name}`).join(',')})`;

/** How long a member's signature stays good for. The API submits as soon as it has one. */
export const PLAN_SIGNATURE_TTL_SECONDS = 10 * 60;

/** Ledger units are the reserve token's six decimals; the charge table is in cents. */
const UNITS_PER_CENT = 10_000n;

/**
 * The `PlanTerms` struct as `openPlan` takes it. Integers travel as decimal strings so the whole
 * thing survives JSON between the server and the phone; `planTermsMessage` turns them back.
 */
export interface PlanTerms {
  member: string;
  merchant: string;
  purchase: string;
  payout: string;
  ratePerCycle: string;
  cycleLength: string;
  installments: number;
  installmentLength: string;
  disclosureHash: string;
  deadline: string;
}

/** What is signed: the struct plus the member's current nonce, which the contract reads itself. */
export interface PlanTermsTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: typeof PLAN_TERMS_TYPES;
  primaryType: 'PlanTerms';
  message: PlanTerms & { nonce: string };
}

export function planTermsDomain(chainId: number, termIssuer: string): PlanTermsTypedData['domain'] {
  return {
    name: PLAN_TERMS_DOMAIN_NAME,
    version: PLAN_TERMS_DOMAIN_VERSION,
    chainId,
    verifyingContract: termIssuer,
  };
}

export function planTermsTypedData(input: {
  chainId: number;
  termIssuer: string;
  terms: PlanTerms;
  nonce: bigint | string;
}): PlanTermsTypedData {
  return {
    domain: planTermsDomain(input.chainId, input.termIssuer),
    types: PLAN_TERMS_TYPES,
    primaryType: 'PlanTerms',
    message: { ...input.terms, nonce: String(input.nonce) },
  };
}

/**
 * The message with its integers as bigints, the shape a signer that hashes locally (viem) wants.
 * A JSON-RPC wallet takes either.
 */
export function planTermsMessage(message: PlanTermsTypedData['message']) {
  return {
    member: message.member,
    merchant: message.merchant,
    purchase: BigInt(message.purchase),
    payout: BigInt(message.payout),
    ratePerCycle: BigInt(message.ratePerCycle),
    cycleLength: BigInt(message.cycleLength),
    installments: Number(message.installments),
    installmentLength: BigInt(message.installmentLength),
    disclosureHash: message.disclosureHash,
    nonce: BigInt(message.nonce),
    deadline: BigInt(message.deadline),
  };
}

/** The struct as an `openPlan` call takes it (a tuple of named fields; ethers and viem both accept it). */
export function planTermsArg(terms: PlanTerms) {
  return {
    member: terms.member,
    merchant: terms.merchant,
    purchase: BigInt(terms.purchase),
    payout: BigInt(terms.payout),
    ratePerCycle: BigInt(terms.ratePerCycle),
    cycleLength: BigInt(terms.cycleLength),
    installments: Number(terms.installments),
    installmentLength: BigInt(terms.installmentLength),
    disclosureHash: terms.disclosureHash,
    deadline: BigInt(terms.deadline),
  };
}

/** True when two sets of terms are the same plan, field for field (addresses compared without case). */
export function samePlanTerms(a: PlanTerms, b: PlanTerms): boolean {
  return (
    a.member.toLowerCase() === b.member.toLowerCase() &&
    a.merchant.toLowerCase() === b.merchant.toLowerCase() &&
    String(a.purchase) === String(b.purchase) &&
    String(a.payout) === String(b.payout) &&
    String(a.ratePerCycle) === String(b.ratePerCycle) &&
    String(a.cycleLength) === String(b.cycleLength) &&
    Number(a.installments) === Number(b.installments) &&
    String(a.installmentLength) === String(b.installmentLength) &&
    a.disclosureHash.toLowerCase() === b.disclosureHash.toLowerCase() &&
    String(a.deadline) === String(b.deadline)
  );
}

// ---- The disclosure ------------------------------------------------------------------------------

export const PLAN_DISCLOSURE_VERSION = 'Clear plan terms, v1';

/** What the disclosure says, all of it from the terms being signed. */
export interface PlanDisclosureInput {
  merchantName: string;
  purchaseCents: number;
  /** Basis points a cycle: 200 is 2%. */
  ratePerCycleBps: number;
  cycleLengthSeconds: number;
  installments: number;
  installmentLengthSeconds: number;
}

/** "$1,234.50": fixed formatting, never the locale, so two machines write the same bytes. */
export function disclosureMoney(cents: number): string {
  const whole = Math.round(Math.abs(cents));
  const dollars = Math.floor(whole / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${dollars}.${String(whole % 100).padStart(2, '0')}`;
}

function days(seconds: number): string {
  const d = Math.round((seconds / 86_400) * 100) / 100;
  return `${d} day${d === 1 ? '' : 's'}`;
}

function percent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/**
 * The lines the approval screen shows and the member's signature covers, by hash.
 *
 * The figures are the plan's own: carry is quoted the way `splitQuote` quotes it on the split
 * chooser, so the disclosure and the screen above it cannot disagree.
 */
export function planDisclosure(input: PlanDisclosureInput): string[] {
  const n = Math.max(1, Math.floor(input.installments));
  const quote = splitQuote(input.purchaseCents, n, input.ratePerCycleBps / 10_000);
  return [
    PLAN_DISCLOSURE_VERSION,
    `Shop: ${input.merchantName.trim()}`,
    `Purchase: ${disclosureMoney(input.purchaseCents)}`,
    `Repaid in ${n} installment${n === 1 ? '' : 's'}, one every ${days(input.installmentLengthSeconds)}`,
    `Carry: ${percent(input.ratePerCycleBps)} a cycle on what is still owed; a cycle is ${days(input.cycleLengthSeconds)}`,
    `About ${disclosureMoney(quote.perCycle)} an installment, ${disclosureMoney(quote.carry)} in carry, ${disclosureMoney(quote.total)} in all`,
  ];
}

/**
 * The disclosure for terms already built, from the signed fields themselves. The member app renders
 * this rather than any text the server sends, so what is on the screen is what the terms say.
 */
export function planDisclosureForTerms(terms: Pick<PlanTerms, 'purchase' | 'ratePerCycle' | 'cycleLength' | 'installments' | 'installmentLength'>, merchantName: string): string[] {
  return planDisclosure({
    merchantName,
    purchaseCents: Number(BigInt(terms.purchase) / UNITS_PER_CENT),
    ratePerCycleBps: Number(terms.ratePerCycle),
    cycleLengthSeconds: Number(terms.cycleLength),
    installments: Number(terms.installments),
    installmentLengthSeconds: Number(terms.installmentLength),
  });
}

/** The bytes that are hashed: the lines, joined by a newline. */
export function planDisclosureText(lines: string[]): string {
  return lines.join('\n');
}

/**
 * Builds the terms for a charge, with the disclosure they carry. `keccakUtf8` is the caller's
 * keccak-256 of a UTF-8 string (`ethers.id`, or viem's `keccak256(toBytes(s))`).
 */
export function buildPlanTerms(input: {
  member: string;
  merchant: string;
  merchantName: string;
  purchaseCents: number;
  payoutCents: number;
  ratePerCycleBps: number;
  cycleLengthSeconds: number;
  installments: number;
  installmentLengthSeconds: number;
  deadline: number;
  keccakUtf8: (text: string) => string;
}): { terms: PlanTerms; disclosure: string[] } {
  const disclosure = planDisclosure(input);
  return {
    disclosure,
    terms: {
      member: input.member,
      merchant: input.merchant,
      purchase: (BigInt(Math.round(input.purchaseCents)) * UNITS_PER_CENT).toString(),
      payout: (BigInt(Math.round(input.payoutCents)) * UNITS_PER_CENT).toString(),
      ratePerCycle: String(Math.round(input.ratePerCycleBps)),
      cycleLength: String(Math.round(input.cycleLengthSeconds)),
      installments: Math.floor(input.installments),
      installmentLength: String(Math.round(input.installmentLengthSeconds)),
      disclosureHash: input.keccakUtf8(planDisclosureText(disclosure)),
      deadline: String(Math.floor(input.deadline)),
    },
  };
}

/**
 * What the member's phone checks before it signs. Returns the reason to refuse, or null.
 *
 * Everything the screen showed is compared with what is about to be signed: whose plan, how much,
 * how it is split, and that the disclosure hash is the hash of the lines on the screen. A server
 * that sent different terms from the ones it displayed is refused here, before a signature exists.
 */
export function planTermsMismatch(input: {
  typedData: PlanTermsTypedData;
  shown: { member: string; purchaseCents: number; installments: number; disclosure: string[] };
  expected: { chainId: number; termIssuer: string };
  keccakUtf8: (text: string) => string;
  nowSeconds: number;
}): string | null {
  const { typedData, shown, expected } = input;
  const m = typedData.message;
  if (typedData.primaryType !== 'PlanTerms') return 'not a plan';
  if (typedData.domain.name !== PLAN_TERMS_DOMAIN_NAME || typedData.domain.version !== PLAN_TERMS_DOMAIN_VERSION) {
    return 'not the plan issuer';
  }
  if (Number(typedData.domain.chainId) !== expected.chainId) return 'wrong network';
  if (typedData.domain.verifyingContract.toLowerCase() !== expected.termIssuer.toLowerCase()) return 'not the plan issuer';
  if (m.member.toLowerCase() !== shown.member.toLowerCase()) return 'not your plan';
  if (BigInt(m.purchase) !== BigInt(Math.round(shown.purchaseCents)) * UNITS_PER_CENT) return 'a different amount';
  if (BigInt(m.payout) > BigInt(m.purchase)) return 'the shop is paid more than the purchase';
  if (Number(m.installments) !== shown.installments) return 'a different split';
  if (m.disclosureHash.toLowerCase() !== input.keccakUtf8(planDisclosureText(shown.disclosure)).toLowerCase()) {
    return 'terms that differ from the ones shown';
  }
  if (BigInt(m.deadline) <= BigInt(Math.floor(input.nowSeconds))) return 'terms that have expired';
  return null;
}
