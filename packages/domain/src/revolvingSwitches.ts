/**
 * The member's own switches on the revolving line (Phase 2b, section 12.2 and 12.7).
 *
 * - **Auto-clear** (12.2, replaced): when a deposit lands, what the member owes is cleared from it
 *   first, dearest tier first, within a level they choose: UNSECURED_ONLY (income-backed and Boost,
 *   the default), ALL, or DUE_ONLY (Phase 2e). Set by the member's wallet
 *   (`setAutoClear(on, level, authHash)`) or by their EIP-712 `AutoClear` signature
 *   (`setAutoClearWithSignature`), which is how onboarding turns it on. Since Phase 2e turning it on
 *   records `authHash`, the hash of the authorization the member approved
 *   (`autoClearAuthorizationLines`): keccak256(utf8(lines.join('\n'))), built here so the server and
 *   the phone hash the same bytes. Turning it off signs a zero hash.
 * - **Savings draw allowance** (12.7): card spending may draw against Savings only up to what the
 *   member authorized (`setSavingsDrawAllowance(amount)` or the `SavingsDrawAllowance` signature),
 *   revocable to 0. No admin path raises it.
 *
 * Both signatures are in RevolvingIssuer's domain { "Clear RevolvingIssuer", "1", chainId, issuer }
 * at `memberNonces(member)`. Checked against `RevolvingIssuerWorkouts.sol` by the tests.
 *
 * No dependencies, like the rest of this package.
 */

export const REVOLVING_DOMAIN_NAME = 'Clear RevolvingIssuer';
export const REVOLVING_DOMAIN_VERSION = '1';

/** `RevolvingIssuerBase` levels: 0 UNSECURED (the default), 1 EVERYTHING, 2 DUE_ONLY (Phase 2e). */
export const AUTO_CLEAR_SCOPE = { UNSECURED_ONLY: 0, ALL: 1, DUE_ONLY: 2 } as const;
export type AutoClearScope = (typeof AUTO_CLEAR_SCOPE)[keyof typeof AUTO_CLEAR_SCOPE];

export const AUTO_CLEAR_TYPES = {
  AutoClear: [
    { name: 'member', type: 'address' },
    { name: 'on', type: 'bool' },
    { name: 'level', type: 'uint8' },
    { name: 'authHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const SAVINGS_DRAW_TYPES = {
  SavingsDrawAllowance: [
    { name: 'member', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

const typeString = (name: string, fields: ReadonlyArray<{ name: string; type: string }>) =>
  `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`;

export const AUTO_CLEAR_TYPE_STRING = typeString('AutoClear', AUTO_CLEAR_TYPES.AutoClear);
export const SAVINGS_DRAW_TYPE_STRING = typeString('SavingsDrawAllowance', SAVINGS_DRAW_TYPES.SavingsDrawAllowance);

/** The first line of the auto-clear authorization: a change of wording is a change of hash. */
export const AUTO_CLEAR_AUTHORIZATION_VERSION = 'Clear Automatic Clearing authorization, v1';

const LEVEL_WORDS: Record<number, string> = {
  0: 'what I owe on income-backed credit and Boost (and any unpaid Secured Minimum)',
  1: 'everything I owe on my line',
  2: 'only what is due (the Rebalance Amount and any unpaid Secured Minimum)',
};

/**
 * The authorization a member approves to turn automatic clearing on (12.2), line by line, for a
 * level. Its hash is `authHash`. Plain text with fixed wording, so it can be shown, kept in
 * Documents and hashed the same way on the server and the phone.
 */
export function autoClearAuthorizationLines(level: number): string[] {
  return [
    AUTO_CLEAR_AUTHORIZATION_VERSION,
    `When a deposit reaches my Spendable account, Clear may first clear ${LEVEL_WORDS[level] ?? `level ${level}`}, dearest first, from that deposit.`,
    'Clear pays the clearing with its own funds and then moves the same amount out of that deposit. My Ready to allocate and my Savings are never swept.',
    'Deposits from a federal benefit payer are never cleared unless I allow that payer myself.',
    'I can turn this off, or change what it covers, at any time in Settings.',
  ];
}

/** The exact bytes hashed into `authHash`: the lines, joined by newlines. */
export function autoClearAuthorizationText(lines: string[]): string {
  return lines.join('\n');
}

export const ZERO_AUTH_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** How long a member's switch signature stays good for. */
export const SWITCH_SIGNATURE_TTL_SECONDS = 10 * 60;

export interface RevolvingDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export function revolvingDomain(chainId: number, revolvingIssuer: string): RevolvingDomain {
  return { name: REVOLVING_DOMAIN_NAME, version: REVOLVING_DOMAIN_VERSION, chainId, verifyingContract: revolvingIssuer };
}

export interface AutoClearTypedData {
  domain: RevolvingDomain;
  types: typeof AUTO_CLEAR_TYPES;
  primaryType: 'AutoClear';
  message: { member: string; on: boolean; level: number; authHash: string; nonce: string; deadline: string };
}

export interface SavingsDrawTypedData {
  domain: RevolvingDomain;
  types: typeof SAVINGS_DRAW_TYPES;
  primaryType: 'SavingsDrawAllowance';
  message: { member: string; amount: string; nonce: string; deadline: string };
}

export function autoClearTypedData(input: {
  chainId: number;
  revolvingIssuer: string;
  member: string;
  on: boolean;
  /** The level (`scope` in the app's words). */
  scope: number;
  /** The authorization's hash when turning on; zero when turning off. */
  authHash: string;
  nonce: bigint | string;
  deadline: number;
}): AutoClearTypedData {
  return {
    domain: revolvingDomain(input.chainId, input.revolvingIssuer),
    types: AUTO_CLEAR_TYPES,
    primaryType: 'AutoClear',
    message: {
      member: input.member,
      on: input.on,
      level: input.scope,
      authHash: input.authHash,
      nonce: String(input.nonce),
      deadline: String(Math.floor(input.deadline)),
    },
  };
}

export function savingsDrawTypedData(input: {
  chainId: number;
  revolvingIssuer: string;
  member: string;
  amount: bigint | string;
  nonce: bigint | string;
  deadline: number;
}): SavingsDrawTypedData {
  return {
    domain: revolvingDomain(input.chainId, input.revolvingIssuer),
    types: SAVINGS_DRAW_TYPES,
    primaryType: 'SavingsDrawAllowance',
    message: {
      member: input.member,
      amount: String(input.amount),
      nonce: String(input.nonce),
      deadline: String(Math.floor(input.deadline)),
    },
  };
}

/** The messages with integers as bigints, for a signer that hashes locally (viem). */
export function autoClearMessage(m: AutoClearTypedData['message']) {
  return {
    member: m.member,
    on: Boolean(m.on),
    level: Number(m.level),
    authHash: m.authHash as `0x${string}`,
    nonce: BigInt(m.nonce),
    deadline: BigInt(m.deadline),
  };
}

export function savingsDrawMessage(m: SavingsDrawTypedData['message']) {
  return { member: m.member, amount: BigInt(m.amount), nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) };
}

/**
 * What the phone checks before signing a switch: the right contract and chain, the member's own
 * address, and exactly the choice on the screen. The reason to refuse, or null.
 */
export function switchMismatch(input: {
  typedData: AutoClearTypedData | SavingsDrawTypedData;
  /** For `AutoClear`, `authHash` is the hash the phone computed of the authorization it showed. */
  shown: { member: string } & ({ on: boolean; scope: number; authHash?: string } | { amount: bigint });
  expected: { chainId: number; revolvingIssuer: string };
  nowSeconds: number;
}): string | null {
  const { typedData: td, shown, expected } = input;
  if (td.domain.name !== REVOLVING_DOMAIN_NAME || td.domain.version !== REVOLVING_DOMAIN_VERSION) return 'not the credit line';
  if (Number(td.domain.chainId) !== expected.chainId) return 'wrong network';
  if (td.domain.verifyingContract.toLowerCase() !== expected.revolvingIssuer.toLowerCase()) return 'not the credit line';
  if (td.message.member.toLowerCase() !== shown.member.toLowerCase()) return 'not your line';
  if (td.primaryType === 'AutoClear') {
    if (!('on' in shown)) return 'a different setting';
    if (Boolean(td.message.on) !== shown.on || Number(td.message.level) !== shown.scope) return 'a different setting';
    const expectedHash = shown.on ? shown.authHash : ZERO_AUTH_HASH;
    if (!expectedHash || String(td.message.authHash).toLowerCase() !== expectedHash.toLowerCase()) return 'a different authorization';
  } else {
    if (!('amount' in shown)) return 'a different setting';
    if (BigInt(td.message.amount) !== shown.amount) return 'a different amount';
  }
  if (BigInt(td.message.deadline) <= BigInt(Math.floor(input.nowSeconds))) return 'a request that has expired';
  return null;
}
