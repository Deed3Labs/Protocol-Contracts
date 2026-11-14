import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  COLLATERAL_SIGNED_TYPES,
  collateralMessage,
  collateralMismatch,
  collateralTypedData,
  collateralTypeString,
  pledgeTypedData,
} from './pledge';
import { PAYOUT_CLAIM_TYPE_STRING, payoutClaimTypedData, payoutRefSeed } from './claimKey';

const MEMBER = '0x00000000000000000000000000000000000000a1';
const REGISTRY = '0x00000000000000000000000000000000000000c5';
const SAVINGS = '0x534156494e475300000000000000000000000000000000000000000000000000';
const registrySol = new URL('../../../contracts/peripherals/CollateralRegistry.sol', import.meta.url);

describe('a pledge is the contract’s typed data (Phase 4b, L-I)', () => {
  test('Pledge and PledgeItem, field for field', () => {
    expect(collateralTypeString('Pledge')).toBe('Pledge(address member,bytes32 kind,uint256 amount,uint256 nonce,uint256 deadline)');
    expect(collateralTypeString('PledgeItem')).toBe('PledgeItem(address member,bytes32 kind,uint256 itemId,uint256 nonce,uint256 deadline)');
  });

  test('and still match CollateralRegistry.sol, domain included', () => {
    if (!existsSync(registrySol)) return;
    const source = readFileSync(registrySol, 'utf8');
    for (const primary of Object.keys(COLLATERAL_SIGNED_TYPES) as (keyof typeof COLLATERAL_SIGNED_TYPES)[]) {
      expect(source).toContain(`"${collateralTypeString(primary)}"`);
    }
    expect(source).toContain('keccak256(bytes("Clear CollateralRegistry"))');
    expect(source).toContain('keccak256(bytes("1"))');
  });

  test('an amount makes a Pledge, an item a PledgeItem', () => {
    const amount = pledgeTypedData({ chainId: 84532, registry: REGISTRY, member: MEMBER, kind: SAVINGS, amount: 5_000_000n, nonce: 3n, deadline: 2_000_000_000 });
    expect(amount.primaryType).toBe('Pledge');
    expect(amount.message).toEqual({ member: MEMBER, kind: SAVINGS, amount: '5000000', nonce: '3', deadline: '2000000000' });
    expect(amount.domain).toEqual({ name: 'Clear CollateralRegistry', version: '1', chainId: 84532, verifyingContract: REGISTRY });
    const item = pledgeTypedData({ chainId: 84532, registry: REGISTRY, member: MEMBER, kind: SAVINGS, itemId: 7n, nonce: 3n, deadline: 2_000_000_000 });
    expect(item.primaryType).toBe('PledgeItem');
    expect(item.message.itemId).toBe('7');
    expect(collateralMessage(item)).toEqual({ member: MEMBER, kind: SAVINGS, itemId: 7n, nonce: 3n, deadline: 2_000_000_000n });
  });

  test('a struct with a field missing is refused before anything is signed', () => {
    expect(() =>
      collateralTypedData({
        primaryType: 'Pledge',
        chainId: 84532,
        registry: REGISTRY,
        message: { member: MEMBER, kind: SAVINGS, nonce: 1, deadline: 2 } as never,
      }),
    ).toThrow('Pledge.amount is missing');
  });
});

describe('what the phone checks before it signs a pledge', () => {
  const expected = { chainId: 84532, registry: REGISTRY };
  const td = pledgeTypedData({ chainId: 84532, registry: REGISTRY, member: MEMBER, kind: SAVINGS, amount: 5_000_000n, nonce: 3n, deadline: 2_000_000_000 });
  const shown = { member: MEMBER, kind: SAVINGS, amount: 5_000_000n };
  const check = (over: Partial<Parameters<typeof collateralMismatch>[0]>) =>
    collateralMismatch({ typedData: td, shown, expected, nowSeconds: 1_900_000_000, ...over });

  test('the pledge on the screen passes', () => {
    expect(check({})).toBeNull();
  });

  test('anything else is refused, with the reason', () => {
    expect(check({ shown: { ...shown, amount: 6_000_000n } })).toBe('a different amount');
    expect(check({ shown: { ...shown, member: REGISTRY } })).toBe('somebody else');
    expect(check({ expected: { ...expected, chainId: 1 } })).toBe('wrong network');
    expect(check({ expected: { ...expected, registry: MEMBER } })).toBe('not the collateral registry');
    expect(check({ nowSeconds: 2_100_000_000 })).toBe('a pledge that has expired');
    const item = pledgeTypedData({ chainId: 84532, registry: REGISTRY, member: MEMBER, kind: SAVINGS, itemId: 7n, nonce: 3n, deadline: 2_000_000_000 });
    expect(check({ typedData: item, shown: { member: MEMBER, kind: SAVINGS, itemId: 8n } })).toBe('a different item');
  });
});

describe('a card or bank payout of a claim is signed (Phase 2d, L-D)', () => {
  test('PayoutClaim, field for field, as ClaimEscrow.sol on audit/phase-2d-dfal-vault spells it', () => {
    expect(PAYOUT_CLAIM_TYPE_STRING).toBe('PayoutClaim(bytes32 transferId,address payoutTreasury,bytes32 payoutRefHash)');
  });

  test('the payout reference names the transfer and the method, nothing else', () => {
    expect(payoutRefSeed('0xABC', 'DEBIT')).toBe('clear-payout/v1:0xabc:DEBIT');
    expect(payoutRefSeed('0xabc', 'BANK')).not.toBe(payoutRefSeed('0xabc', 'DEBIT'));
    const td = payoutClaimTypedData({ chainId: 8453, escrow: REGISTRY, transferId: '0x01', payoutTreasury: MEMBER, payoutRefHash: '0x02' });
    expect(td.domain).toEqual({ name: 'ClaimEscrow', version: '1', chainId: 8453, verifyingContract: REGISTRY });
    expect(td.primaryType).toBe('PayoutClaim');
  });
});
