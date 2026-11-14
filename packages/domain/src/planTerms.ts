/**
 * The terms a member signs to open a term plan (audit H-4), and the disclosure they are shown.
 *
 * `TermIssuer.openPlan(PlanTerms terms, bytes signature)` opens a plan only on terms the member
 * signed: an EIP-712 signature over `PlanTerms`, at the member's current `planNonces(member)`, in
 * the domain { name "Clear TermIssuer", version "1", chainId, verifyingContract: the TermIssuer }.
 * EIP-1271 smart accounts are accepted on chain. The operator key only submits.
 *
 * This is the one definition of those terms. The API builds the typed data and submits the
 * signature; the member app checks it and signs it. Neither copies the field list. It is checked
 * against the contract's `PLAN_TERMS_TYPEHASH` (TermIssuerBase.sol) by `planTerms.test.ts`.
 *
 * ## Phase 2 (compliance)
 *
 * - `productId` (after `merchant`) names the RateSchedule product: `PARTNER` for partner credit,
 *   `CASH` for Clear Cash. It is `encodeBytes32String`, as in `deploy/config/rate-schedule.json`.
 * - The chain prices the plan. `openPlan` reverts with `TermIssuerTermsMismatch` unless the signed
 *   `ratePerCycle` and `payout` are exactly what `TermIssuerBase._quote` computes, so the server
 *   reads them from chain (`planQuote.ts` holds the arithmetic) and never from a table of its own.
 * - Phase 2b (section 12.9): the schedule is LEVELLED, an equal payment every installment, with the
 *   plan charged its monthly rate per 30-day cycle (not x 12 / 365, which stays for revolving).
 *   `planSchedule` reproduces `_fixSchedule` and `_dueAt` in integers, so the disclosure shows the
 *   figures the chain will measure against: $940 in 4 at 2% is $246.87 x 4, $47.47 of carry.
 * - A re-split that costs more needs the member's signature over `Resplit` (below), in the same
 *   domain and at the same nonce counter.
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

/** EIP-712 domain name and version, as `TermIssuer.domainSeparator()` hashes them. */
export const PLAN_TERMS_DOMAIN_NAME = 'Clear TermIssuer';
export const PLAN_TERMS_DOMAIN_VERSION = '1';

/** The struct, field for field in the contract's order. The order is the hash. */
export const PLAN_TERMS_TYPES = {
  PlanTerms: [
    { name: 'member', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'productId', type: 'bytes32' },
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

// ---- Products --------------------------------------------------------------------------------------

/** `ethers.encodeBytes32String` for the short ASCII names RateSchedule uses. */
export function bytes32String(text: string): string {
  if (!/^[\x20-\x7e]{1,31}$/.test(text)) throw new Error('product names are short ASCII');
  const hex = Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `0x${hex.padEnd(64, '0')}`;
}

/** The RateSchedule term products (`deploy/config/rate-schedule.json`). */
export const PLAN_PRODUCTS = {
  /** A purchase at a partner shop, split over time. */
  PARTNER: bytes32String('PARTNER'),
  /** Clear Cash: money to the member, over time. */
  CASH: bytes32String('CASH'),
} as const;

export type PlanProduct = keyof typeof PLAN_PRODUCTS;

/** The product a bytes32 id names, or null when it is not one this app offers. */
export function planProductOf(productId: string): PlanProduct | null {
  const id = String(productId).toLowerCase();
  for (const [name, value] of Object.entries(PLAN_PRODUCTS)) if (value === id) return name as PlanProduct;
  return null;
}

const PRODUCT_LABEL: Record<PlanProduct, string> = { PARTNER: 'Partner credit', CASH: 'Clear Cash' };

// ---- The terms -------------------------------------------------------------------------------------

/**
 * The `PlanTerms` struct as `openPlan` takes it. Integers travel as decimal strings so the whole
 * thing survives JSON between the server and the phone; `planTermsMessage` turns them back.
 */
export interface PlanTerms {
  member: string;
  merchant: string;
  /** bytes32 RateSchedule product id (`PLAN_PRODUCTS`). */
  productId: string;
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
    productId: message.productId,
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
    productId: terms.productId,
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

/** True when two sets of terms are the same plan, field for field (addresses and hex compared without case). */
export function samePlanTerms(a: PlanTerms, b: PlanTerms): boolean {
  return (
    a.member.toLowerCase() === b.member.toLowerCase() &&
    a.merchant.toLowerCase() === b.merchant.toLowerCase() &&
    String(a.productId ?? '').toLowerCase() === String(b.productId ?? '').toLowerCase() &&
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

// ---- The schedule, as the chain computes it --------------------------------------------------------

const RAY = 10n ** 27n;
const BPS = 10_000n;
/** `TermIssuerBase.TERM_CYCLE`: a term plan's rate is per 30-day cycle (section 12.9). */
export const TERM_CYCLE_SECONDS = 30n * 86_400n;

/** One installment of a plan's schedule, in ledger units. */
export interface ScheduledInstallment {
  /** 1-based. */
  index: number;
  /** What the installment pays down of the principal. */
  principal: bigint;
  /** What it pays in carry: the period's rate on the principal still unpaid. */
  carry: bigint;
  /** The whole payment: the level payment, or for a free plan its share of the principal. */
  amount: bigint;
}

export interface PlanSchedule {
  installments: ScheduledInstallment[];
  /** `TermIssuer.scheduleOf(planId).installmentAmount`: the level payment. */
  payment: bigint;
  /** Carry over the whole schedule if it is paid on time. */
  totalCarry: bigint;
  /** `principal + totalCarry`: `TermIssuer.scheduleOf(planId).scheduleTotal`. */
  total: bigint;
}

/** `TermIssuerBase._periodRate`: the monthly rate per 30-day cycle over one installment, RAY-scaled. */
export function termPeriodRate(ratePerCycleBps: bigint | number, installmentLengthSeconds: bigint | number): bigint {
  return (BigInt(ratePerCycleBps) * RAY * BigInt(installmentLengthSeconds)) / (BPS * TERM_CYCLE_SECONDS);
}

/**
 * The schedule `TermIssuerBase._fixSchedule` fixes for a plan, installment by installment.
 *
 * Levelled (section 12.9): the payment is B·r / (1 − (1 + r)^−n), rounded up to the unit, with r
 * the plan's rate over one installment (`_periodRate`). (1 + r)^n is compounded in RAY the way the
 * contract compounds it, rounding down at each step, so the payment is the contract's to the unit.
 * `scheduleTotal` is payment × n. Each installment's carry is r on the principal still unpaid and
 * the rest pays principal down; the last installment pays off what is left, so the carry adds up to
 * `scheduleTotal − principal` exactly. A free plan (r = 0) splits the principal exactly: the payment
 * is rounded up and the last installment takes the remainder. `PlanOpened.totalCarry` is
 * `total − principal`.
 */
export function planSchedule(input: {
  principal: bigint;
  ratePerCycleBps: bigint | number;
  installments: number;
  installmentLengthSeconds: bigint | number;
}): PlanSchedule {
  const n = BigInt(Math.max(1, Math.floor(input.installments)));
  const base = input.principal;
  const r = termPeriodRate(input.ratePerCycleBps, input.installmentLengthSeconds);
  let payment: bigint;
  if (base === 0n) payment = 0n;
  else if (r === 0n) payment = (base - 1n) / n + 1n;
  else {
    let grown = RAY;
    for (let i = 0n; i < n; i++) grown = (grown * (RAY + r)) / RAY;
    payment = (base * r * grown - 1n) / (RAY * (grown - RAY)) + 1n;
  }
  const total = r === 0n ? base : payment * n;
  const rows: ScheduledInstallment[] = [];
  let unpaid = base;
  for (let k = 1n; k <= n; k++) {
    const last = k === n;
    if (r === 0n) {
      const principal = last ? unpaid : payment < unpaid ? payment : unpaid;
      unpaid -= principal;
      rows.push({ index: Number(k), principal, carry: 0n, amount: principal });
      continue;
    }
    let carry = (unpaid * r) / RAY;
    let principal = payment - carry;
    if (last || principal > unpaid) {
      principal = unpaid;
      carry = payment - principal;
    }
    unpaid -= principal;
    rows.push({ index: Number(k), principal, carry, amount: payment });
  }
  return { installments: rows, payment, totalCarry: total - base, total };
}

// ---- The disclosure ------------------------------------------------------------------------------

export const PLAN_DISCLOSURE_VERSION = 'Clear plan terms, v3';

/** What the disclosure says, all of it from the terms being signed. */
export interface PlanDisclosureInput {
  merchantName: string;
  /** bytes32 RateSchedule product id. */
  productId: string;
  /** Ledger units (six decimals). */
  purchase: bigint;
  /** Monthly basis points: 200 is 2% a month. Zero for a free plan. */
  ratePerCycleBps: number;
  installments: number;
  installmentLengthSeconds: number;
}

/** "$1,234.50": fixed formatting, never the locale, so two machines write the same bytes. */
export function disclosureMoney(cents: number): string {
  const whole = Math.round(Math.abs(cents));
  const dollars = Math.floor(whole / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${dollars}.${String(whole % 100).padStart(2, '0')}`;
}

/** Ledger units to cents, half up, in integers. */
export function unitsToCents(units: bigint): number {
  return Number((units + UNITS_PER_CENT / 2n) / UNITS_PER_CENT);
}

const unitsMoney = (units: bigint) => disclosureMoney(unitsToCents(units));

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
 * The figures are the chain's own: the schedule is `planSchedule`, the one `_fixSchedule` fixes,
 * so the disclosure shows the level payment, the carry in each installment, and the total the plan
 * will collect if paid on time.
 */
export function planDisclosure(input: PlanDisclosureInput): string[] {
  const n = Math.max(1, Math.floor(input.installments));
  const product = planProductOf(input.productId);
  const schedule = planSchedule({
    principal: input.purchase,
    ratePerCycleBps: input.ratePerCycleBps,
    installments: n,
    installmentLengthSeconds: input.installmentLengthSeconds,
  });
  const lines = [
    PLAN_DISCLOSURE_VERSION,
    `Shop: ${input.merchantName.trim()}`,
    `Credit: ${product ? PRODUCT_LABEL[product] : `product ${input.productId}`}`,
    `Purchase: ${unitsMoney(input.purchase)}`,
    `Repaid in ${n} installment${n === 1 ? '' : 's'}, one every ${days(input.installmentLengthSeconds)}`,
    input.ratePerCycleBps > 0
      ? `Carry: ${percent(input.ratePerCycleBps)} per 30-day cycle on principal still owed, never on carry. Equal payments of ${unitsMoney(schedule.payment)}`
      : 'Carry: none. This plan is free, even if a payment is late',
  ];
  for (const row of schedule.installments) {
    lines.push(
      input.ratePerCycleBps > 0
        ? `Installment ${row.index}: ${unitsMoney(row.amount)} (${unitsMoney(row.principal)} principal + ${unitsMoney(row.carry)} carry)`
        : `Installment ${row.index}: ${unitsMoney(row.amount)}`,
    );
  }
  lines.push(`Total carry ${unitsMoney(schedule.totalCarry)}, ${unitsMoney(schedule.total)} in all, if paid on schedule`);
  return lines;
}

/**
 * The disclosure for terms already built, from the signed fields themselves. The member app renders
 * this rather than any text the server sends, so what is on the screen is what the terms say.
 */
export function planDisclosureForTerms(
  terms: Pick<PlanTerms, 'productId' | 'purchase' | 'ratePerCycle' | 'installments' | 'installmentLength'>,
  merchantName: string,
): string[] {
  return planDisclosure({
    merchantName,
    productId: terms.productId,
    purchase: BigInt(terms.purchase),
    ratePerCycleBps: Number(terms.ratePerCycle),
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
 *
 * `ratePerCycleBps` and `payout` must be the chain's quote (`quotePlan`), or `openPlan` reverts with
 * `TermIssuerTermsMismatch`. `payout` is in ledger units because the chain computes it in units:
 * `purchase - purchase * discountBps / 10000`, which is not always a whole number of cents.
 */
export function buildPlanTerms(input: {
  member: string;
  merchant: string;
  merchantName: string;
  productId: string;
  purchaseCents: number;
  payout: bigint | string;
  ratePerCycleBps: number | bigint;
  cycleLengthSeconds: number;
  installments: number;
  installmentLengthSeconds: number;
  deadline: number;
  keccakUtf8: (text: string) => string;
}): { terms: PlanTerms; disclosure: string[] } {
  const purchase = BigInt(Math.round(input.purchaseCents)) * UNITS_PER_CENT;
  const disclosure = planDisclosure({
    merchantName: input.merchantName,
    productId: input.productId,
    purchase,
    ratePerCycleBps: Number(input.ratePerCycleBps),
    installments: input.installments,
    installmentLengthSeconds: input.installmentLengthSeconds,
  });
  return {
    disclosure,
    terms: {
      member: input.member,
      merchant: input.merchant,
      productId: input.productId.toLowerCase(),
      purchase: purchase.toString(),
      payout: BigInt(input.payout).toString(),
      ratePerCycle: BigInt(input.ratePerCycleBps).toString(),
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
 * what product, how it is split, and that the disclosure hash is the hash of the lines on the
 * screen. A server that sent different terms from the ones it displayed is refused here, before a
 * signature exists. The rate is not compared with any figure of the phone's own: the chain sets it,
 * and the disclosure (which states it, and the schedule it makes) is rebuilt from the signed field.
 */
export function planTermsMismatch(input: {
  typedData: PlanTermsTypedData;
  shown: { member: string; purchaseCents: number; installments: number; disclosure: string[] };
  expected: { chainId: number; termIssuer: string; productIds?: string[] };
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
  const products = (expected.productIds ?? Object.values(PLAN_PRODUCTS)).map((p) => p.toLowerCase());
  if (!products.includes(String(m.productId ?? '').toLowerCase())) return 'a different kind of credit';
  if (BigInt(m.purchase) !== BigInt(Math.round(shown.purchaseCents)) * UNITS_PER_CENT) return 'a different amount';
  if (BigInt(m.payout) > BigInt(m.purchase)) return 'the shop is paid more than the purchase';
  if (Number(m.installments) !== shown.installments) return 'a different split';
  if (m.disclosureHash.toLowerCase() !== input.keccakUtf8(planDisclosureText(shown.disclosure)).toLowerCase()) {
    return 'terms that differ from the ones shown';
  }
  if (BigInt(m.deadline) <= BigInt(Math.floor(input.nowSeconds))) return 'terms that have expired';
  return null;
}

// ---- Re-split (compliance spec item 6) -----------------------------------------------------------

/**
 * `TermIssuerExtension.RESPLIT_TYPEHASH`. A re-split that makes a plan cost more (a higher rate, or
 * a charged plan spread over more installments than it has left) reverts from `setSplit` with
 * `TermIssuerResplitNeedsSignature`; the member signs this instead, at `planNonces(member)`, in the
 * plan domain above, and the operator submits `resplitWithSignature`.
 */
export const RESPLIT_TYPES = {
  Resplit: [
    { name: 'planId', type: 'uint256' },
    { name: 'installments', type: 'uint32' },
    { name: 'rateBps', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const RESPLIT_TYPE_STRING = `Resplit(${RESPLIT_TYPES.Resplit.map((f) => `${f.type} ${f.name}`).join(',')})`;

export interface ResplitTypedData {
  domain: PlanTermsTypedData['domain'];
  types: typeof RESPLIT_TYPES;
  primaryType: 'Resplit';
  message: { planId: string; installments: number; rateBps: string; nonce: string; deadline: string };
}

export function resplitTypedData(input: {
  chainId: number;
  termIssuer: string;
  planId: number | bigint | string;
  installments: number;
  rateBps: number | bigint | string;
  nonce: bigint | string;
  deadline: number;
}): ResplitTypedData {
  return {
    domain: planTermsDomain(input.chainId, input.termIssuer),
    types: RESPLIT_TYPES,
    primaryType: 'Resplit',
    message: {
      planId: String(input.planId),
      installments: Math.floor(input.installments),
      rateBps: String(input.rateBps),
      nonce: String(input.nonce),
      deadline: String(Math.floor(input.deadline)),
    },
  };
}

/** The message with its integers as bigints, for a signer that hashes locally (viem). */
export function resplitMessage(message: ResplitTypedData['message']) {
  return {
    planId: BigInt(message.planId),
    installments: Number(message.installments),
    rateBps: BigInt(message.rateBps),
    nonce: BigInt(message.nonce),
    deadline: BigInt(message.deadline),
  };
}

/**
 * The lines shown before a member signs a re-split. Built from the signed fields and the remainder
 * the server read from chain, so the phone shows the new rate and the schedule it makes.
 */
export function resplitDisclosure(input: {
  remaining: bigint;
  rateBps: number;
  installments: number;
  installmentLengthSeconds: number;
}): string[] {
  const n = Math.max(1, Math.floor(input.installments));
  const schedule = planSchedule({
    principal: input.remaining,
    ratePerCycleBps: input.rateBps,
    installments: n,
    installmentLengthSeconds: input.installmentLengthSeconds,
  });
  return [
    `What is left: ${unitsMoney(input.remaining)}, spread over ${n} installment${n === 1 ? '' : 's'}, one every ${days(input.installmentLengthSeconds)}`,
    input.rateBps > 0
      ? `Carry from now on: ${percent(input.rateBps)} per 30-day cycle on principal still owed`
      : 'Carry from now on: none',
    `${unitsMoney(schedule.installments[0]?.amount ?? 0n)} an installment, ${unitsMoney(schedule.totalCarry)} in carry, ${unitsMoney(schedule.total)} in all`,
    'Carry already owed stays owed. Anything behind is due now.',
  ];
}

/** What the phone checks before signing a re-split. The reason to refuse, or null. */
export function resplitMismatch(input: {
  typedData: ResplitTypedData;
  shown: { planId: number; installments: number; rateBps: number };
  expected: { chainId: number; termIssuer: string };
  nowSeconds: number;
}): string | null {
  const { typedData: td, shown, expected } = input;
  if (td.primaryType !== 'Resplit') return 'not a re-split';
  if (td.domain.name !== PLAN_TERMS_DOMAIN_NAME || td.domain.version !== PLAN_TERMS_DOMAIN_VERSION) return 'not the plan issuer';
  if (Number(td.domain.chainId) !== expected.chainId) return 'wrong network';
  if (td.domain.verifyingContract.toLowerCase() !== expected.termIssuer.toLowerCase()) return 'not the plan issuer';
  if (String(td.message.planId) !== String(shown.planId)) return 'a different plan';
  if (Number(td.message.installments) !== shown.installments) return 'a different split';
  if (String(td.message.rateBps) !== String(shown.rateBps)) return 'a different rate';
  if (BigInt(td.message.deadline) <= BigInt(Math.floor(input.nowSeconds))) return 'terms that have expired';
  return null;
}
