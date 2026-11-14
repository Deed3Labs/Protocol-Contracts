import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashTypedData } from 'viem';
import { ethers } from 'ethers';
import {
  COLLATERAL_SIGNED_TYPES,
  collateralMessage,
  PAYOUT_CLAIM_TYPES,
  payoutClaimTypedData,
  pledgeTypedData,
} from '@clear/domain';
import { claimSignerOf, signPayoutClaim } from './claimKey';

/*
 * The two signatures the API now needs from the app:
 *   - a card or bank payout of a claim, signed by the claim link (Phase 2d, L-D);
 *   - every pledge, signed by the member (Phase 4b, L-I).
 */

const CLAIM_PAGE = readFileSync(join(import.meta.dir, '../pages/auth/ClaimFunds.tsx'), 'utf8');
const SEND_CALLS = readFileSync(join(import.meta.dir, 'sendCalls.ts'), 'utf8');
const PLEDGE = readFileSync(join(import.meta.dir, 'pledgeSigning.ts'), 'utf8');

const TOKEN = 'k1aV0VnG2v8m4J6tq0yX5Lr3cZb9Hs7w';
const ESCROW = '0x00000000000000000000000000000000000000E5';
const TREASURY = '0x00000000000000000000000000000000000000f7';

describe('a card or bank payout is signed by the claim link (L-D)', () => {
  const transferId = ethers.id('transfer');
  const td = payoutClaimTypedData({ chainId: 8453, escrow: ESCROW, transferId, payoutTreasury: TREASURY, payoutRefHash: ethers.id('ref') });

  test('the signature recovers to the claim key, over PayoutClaim', async () => {
    const signature = await signPayoutClaim({ claimToken: TOKEN, typedData: td, expected: { chainId: 8453, escrow: ESCROW, transferId } });
    expect(ethers.verifyTypedData(td.domain, { PayoutClaim: [...PAYOUT_CLAIM_TYPES.PayoutClaim] }, td.message, signature)).toBe(claimSignerOf(TOKEN));
  });

  test('a payout for another transfer, escrow or network is refused before anything is signed', async () => {
    const expected = { chainId: 8453, escrow: ESCROW, transferId };
    await expect(signPayoutClaim({ claimToken: TOKEN, typedData: td, expected: { ...expected, transferId: ethers.id('other') } })).rejects.toThrow('not for this transfer');
    await expect(signPayoutClaim({ claimToken: TOKEN, typedData: td, expected: { ...expected, escrow: TREASURY } })).rejects.toThrow('not for this transfer');
    await expect(signPayoutClaim({ claimToken: TOKEN, typedData: td, expected: { ...expected, chainId: 1 } })).rejects.toThrow('not for this transfer');
  });

  test('the claim page signs before it asks for a card or bank payout, and sends only the signature', () => {
    const flow = CLAIM_PAGE.slice(CLAIM_PAGE.indexOf("if (method === 'DEBIT' || method === 'BANK')"));
    expect(flow.indexOf('await prepareClaimPayout(')).toBeLessThan(flow.indexOf('await signPayoutClaim('));
    expect(flow.indexOf('await signPayoutClaim(')).toBeLessThan(flow.indexOf('await claimPayoutDebit('));
    expect(CLAIM_PAGE.match(/payoutSignature,\n/g)).toHaveLength(2);
  });
});

describe('the member signs every pledge (L-I)', () => {
  test('the message viem hashes is the typed data ethers verifies', async () => {
    const member = ethers.Wallet.createRandom();
    const td = pledgeTypedData({ chainId: 84532, registry: ESCROW, member: member.address, kind: ethers.encodeBytes32String('SAVINGS'), amount: 5_000_000n, nonce: 2n, deadline: 2_000_000_000 });
    const signature = await member.signTypedData(td.domain, { Pledge: [...COLLATERAL_SIGNED_TYPES.Pledge] }, td.message);
    const digest = hashTypedData({
      domain: { ...td.domain, verifyingContract: td.domain.verifyingContract as `0x${string}` },
      types: { Pledge: COLLATERAL_SIGNED_TYPES.Pledge },
      primaryType: 'Pledge',
      message: collateralMessage(td) as never,
    });
    expect(ethers.recoverAddress(digest, signature)).toBe(member.address);
  });

  test('after savings, the pool or a bond lands, the app asks for the pledge', () => {
    expect(SEND_CALLS).toContain("askToPledge('SAVINGS', args.ownerWallet, args.chainId);");
    expect(SEND_CALLS).toContain("askToPledge('POOL_SHARE', args.ownerWallet, args.chainId);");
    expect(SEND_CALLS).toContain("askToPledge('BOND', args.ownerWallet, args.chainId);");
  });

  test('it checks what it signs, and signs any of the registry’s structs the same way', () => {
    expect(PLEDGE.indexOf('collateralMismatch(')).toBeLessThan(PLEDGE.indexOf('signTypedData(config'));
    expect(PLEDGE).toContain('types: { [primaryType]: COLLATERAL_SIGNED_TYPES[primaryType] },');
  });
});
