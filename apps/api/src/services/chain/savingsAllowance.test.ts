import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { CHAIN_ERRORS } from './chainErrors';
import { savingsAllowanceShort } from './cardSettlementService';

/*
 * Phase 2b (12.7): a card approval refused for "no room" says when the room it lacked was Savings
 * the member has not allowed card spending to draw on.
 */
const MEMBER = '0x00000000000000000000000000000000000000a1';
const USD = 1_000_000n;
const headroomError = { data: CHAIN_ERRORS.encodeErrorResult('RevolvingIssuerCardHeadroom', [MEMBER, 50n * USD, 0n]) };

function issuer(room: bigint, allowance: bigint) {
  const kinds = ['SAVINGS', 'INCOME'].map((k) => ethers.encodeBytes32String(k));
  return {
    tierCount: async () => 2n,
    tierAt: async (i: number) => [kinds[i], 0n, true],
    headroomOf: async () => room,
    savingsDrawAllowance: async () => allowance,
  } as unknown as ethers.Contract;
}

describe('a card refused for room it would have had from Savings says so', () => {
  test('no allowance at all', async () => {
    const reason = await savingsAllowanceShort(issuer(300n * USD, 0n), MEMBER, headroomError);
    expect(reason).toContain('only once the member allows it');
    expect(reason).toContain('$300.00');
  });

  test('an allowance smaller than the savings room', async () => {
    expect(await savingsAllowanceShort(issuer(300n * USD, 20n * USD), MEMBER, headroomError)).toContain('only $20.00 more');
  });

  test('not the reason: allowance covers the room, or another error', async () => {
    expect(await savingsAllowanceShort(issuer(300n * USD, 300n * USD), MEMBER, headroomError)).toBeNull();
    const other = { data: CHAIN_ERRORS.encodeErrorResult('RevolvingIssuerCardTxCap', [1n, 1n]) };
    expect(await savingsAllowanceShort(issuer(300n * USD, 0n), MEMBER, other)).toBeNull();
  });
});
