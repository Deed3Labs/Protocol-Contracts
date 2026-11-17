/**
 * The member's own switches on the revolving line (Phase 2b, section 12.2 and 12.7).
 *
 * - **Auto-clear** (12.2, replaced): when a deposit lands, what the member owes is cleared from it
 *   first, dearest tier first, within a scope they choose: UNSECURED_ONLY (income-backed and Boost,
 *   the default) or ALL. Set by the member's wallet (`setAutoClear(on, scope)`) or by their EIP-712
 *   `AutoClear` signature (`setAutoClearWithSignature`), which is how onboarding turns it on.
 * - **Savings draw allowance** (12.7): card spending may draw against Savings only up to what the
 *   member authorized (`setSavingsDrawAllowance(amount)` or the `SavingsDrawAllowance` signature),
 *   revocable to 0. No admin path raises it.
 *
 * Both signatures are in RevolvingIssuer's domain { "Clear RevolvingIssuer", "1", chainId, issuer }
 * at `memberNonces(member)`. Checked against `RevolvingIssuerCycles.sol` by the tests.
 *
 * No dependencies, like the rest of this package.
 */

export const REVOLVING_DOMAIN_NAME = 'Clear RevolvingIssuer';
export const REVOLVING_DOMAIN_VERSION = '1';

/** `RevolvingIssuerBase.SCOPE_*`. */
export const AUTO_CLEAR_SCOPE = { UNSECURED_ONLY: 0, ALL: 1 } as const;
export type AutoClearScope = (typeof AUTO_CLEAR_SCOPE)[keyof typeof AUTO_CLEAR_SCOPE];

export const AUTO_CLEAR_TYPES = {
  AutoClear: [
    { name: 'member', type: 'address' },
    { name: 'on', type: 'bool' },
    { name: 'scope', type: 'uint8' },
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
  message: { member: string; on: boolean; scope: number; nonce: string; deadline: string };
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
  scope: number;
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
      scope: input.scope,
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
  return { member: m.member, on: Boolean(m.on), scope: Number(m.scope), nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) };
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
  shown: { member: string } & ({ on: boolean; scope: number } | { amount: bigint });
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
    if (Boolean(td.message.on) !== shown.on || Number(td.message.scope) !== shown.scope) return 'a different setting';
  } else {
    if (!('amount' in shown)) return 'a different setting';
    if (BigInt(td.message.amount) !== shown.amount) return 'a different amount';
  }
  if (BigInt(td.message.deadline) <= BigInt(Math.floor(input.nowSeconds))) return 'a request that has expired';
  return null;
}
