/**
 * The member's signature on a pledge (Phase 4b, decision L-I).
 *
 * `CollateralRegistry.pledge` and `pledgeItem` take the member's EIP-712 signature (EIP-1271 for a
 * smart account); the operator submits it. A pledge encumbers what is pledged, so an operator key
 * alone must not be able to put a member's assets behind their credit.
 *
 *   domain  { name: "Clear CollateralRegistry", version: "1", chainId, verifyingContract: registry }
 *   Pledge(address member,bytes32 kind,uint256 amount,uint256 nonce,uint256 deadline)
 *   PledgeItem(address member,bytes32 kind,uint256 itemId,uint256 nonce,uint256 deadline)
 *
 * at `pledgeNonces(member)`, used up by each pledge. Checked against `CollateralRegistry.sol` by the
 * tests.
 *
 * The registry's signed structs are one table (`COLLATERAL_SIGNED_TYPES`), and the typed data,
 * the message for a local hasher and the phone's checks are built from it for any entry. A further
 * signed struct in this domain -- the Earn pledge's Maturity Instruction for bonds (Phase 2e) -- is a
 * new entry there and its own few fields in `CollateralShown`, not a second signing path.
 *
 * No dependencies, like the rest of this package.
 */

export const COLLATERAL_REGISTRY_DOMAIN_NAME = 'Clear CollateralRegistry';
export const COLLATERAL_REGISTRY_DOMAIN_VERSION = '1';

/** Every struct a member signs in the registry's domain, by primary type. */
export const COLLATERAL_SIGNED_TYPES = {
  Pledge: [
    { name: 'member', type: 'address' },
    { name: 'kind', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  PledgeItem: [
    { name: 'member', type: 'address' },
    { name: 'kind', type: 'bytes32' },
    { name: 'itemId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export type CollateralPrimaryType = keyof typeof COLLATERAL_SIGNED_TYPES;

/** The EIP-712 type string, as the contract's typehash spells it. */
export function collateralTypeString(primaryType: CollateralPrimaryType): string {
  const fields = COLLATERAL_SIGNED_TYPES[primaryType];
  return `${primaryType}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`;
}

/** How long a pledge signature stays good for. */
export const PLEDGE_SIGNATURE_TTL_SECONDS = 15 * 60;

export interface CollateralDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export function collateralRegistryDomain(chainId: number, registry: string): CollateralDomain {
  return {
    name: COLLATERAL_REGISTRY_DOMAIN_NAME,
    version: COLLATERAL_REGISTRY_DOMAIN_VERSION,
    chainId,
    verifyingContract: registry,
  };
}

/** A signed struct's typed data. Integers travel as decimal strings; addresses and bytes32 as hex. */
export interface CollateralTypedData<P extends CollateralPrimaryType = CollateralPrimaryType> {
  domain: CollateralDomain;
  types: { [K in P]: (typeof COLLATERAL_SIGNED_TYPES)[K] };
  primaryType: P;
  message: Record<string, string>;
}

/** Typed data for any of the registry's signed structs. Every field of the struct must be given. */
export function collateralTypedData<P extends CollateralPrimaryType>(input: {
  primaryType: P;
  chainId: number;
  registry: string;
  message: Record<(typeof COLLATERAL_SIGNED_TYPES)[P][number]['name'], string | number | bigint>;
}): CollateralTypedData<P> {
  const fields = COLLATERAL_SIGNED_TYPES[input.primaryType];
  const message: Record<string, string> = {};
  for (const f of fields) {
    const value = (input.message as Record<string, string | number | bigint | undefined>)[f.name];
    if (value === undefined) throw new Error(`${input.primaryType}.${f.name} is missing`);
    message[f.name] = String(value);
  }
  return {
    domain: collateralRegistryDomain(input.chainId, input.registry),
    types: { [input.primaryType]: fields } as CollateralTypedData<P>['types'],
    primaryType: input.primaryType,
    message,
  };
}

/** A pledge of an amount (`pledge`) or of one item (`pledgeItem`). */
export function pledgeTypedData(input: {
  chainId: number;
  registry: string;
  member: string;
  kind: string;
  nonce: bigint | string;
  deadline: number;
} & ({ amount: bigint | string } | { itemId: bigint | string })): CollateralTypedData<'Pledge'> | CollateralTypedData<'PledgeItem'> {
  const common = { member: input.member, kind: input.kind, nonce: String(input.nonce), deadline: String(Math.floor(input.deadline)) };
  if ('itemId' in input) {
    return collateralTypedData({
      primaryType: 'PledgeItem',
      chainId: input.chainId,
      registry: input.registry,
      message: { ...common, itemId: String(input.itemId) },
    });
  }
  return collateralTypedData({
    primaryType: 'Pledge',
    chainId: input.chainId,
    registry: input.registry,
    message: { ...common, amount: String(input.amount) },
  });
}

/** The message with uint fields as bigints, for a signer that hashes locally (viem). */
export function collateralMessage(typedData: CollateralTypedData): Record<string, string | bigint> {
  const out: Record<string, string | bigint> = {};
  for (const f of COLLATERAL_SIGNED_TYPES[typedData.primaryType]) {
    const value = typedData.message[f.name];
    out[f.name] = f.type.startsWith('uint') ? BigInt(value) : value;
  }
  return out;
}

/** What the phone showed, to check a pledge against before signing it. */
export interface CollateralShown {
  member: string;
  kind: string;
  /** For `Pledge`: the amount, in the asset's units. */
  amount?: bigint | string;
  /** For `PledgeItem`: the item. */
  itemId?: bigint | string;
}

/** What the phone checks before signing. The reason to refuse, or null. */
export function collateralMismatch(input: {
  typedData: CollateralTypedData;
  shown: CollateralShown;
  expected: { chainId: number; registry: string };
  nowSeconds: number;
}): string | null {
  const { typedData: td, shown, expected } = input;
  if (!(td.primaryType in COLLATERAL_SIGNED_TYPES)) return 'not a pledge';
  if (td.domain.name !== COLLATERAL_REGISTRY_DOMAIN_NAME || td.domain.version !== COLLATERAL_REGISTRY_DOMAIN_VERSION) return 'not the collateral registry';
  if (Number(td.domain.chainId) !== expected.chainId) return 'wrong network';
  if (td.domain.verifyingContract.toLowerCase() !== expected.registry.toLowerCase()) return 'not the collateral registry';
  const m = td.message;
  if (String(m.member).toLowerCase() !== shown.member.toLowerCase()) return 'somebody else';
  if (String(m.kind).toLowerCase() !== shown.kind.toLowerCase()) return 'a different kind of collateral';
  if (td.primaryType === 'Pledge' && (shown.amount === undefined || BigInt(m.amount) !== BigInt(shown.amount))) return 'a different amount';
  if (td.primaryType === 'PledgeItem' && (shown.itemId === undefined || BigInt(m.itemId) !== BigInt(shown.itemId))) return 'a different item';
  if (BigInt(m.deadline) <= BigInt(Math.floor(input.nowSeconds))) return 'a pledge that has expired';
  return null;
}
