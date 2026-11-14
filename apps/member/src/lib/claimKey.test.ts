import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ethers } from 'ethers';
import { CLAIM_TYPES, claimKeySeed, claimTypedData } from '@clear/domain';
import { claimSignerOf, signClaimToWallet } from './claimKey';

const CLAIM_PAGE = readFileSync(join(import.meta.dir, '../pages/auth/ClaimFunds.tsx'), 'utf8');
const SEND_CALLS = readFileSync(join(import.meta.dir, 'sendCalls.ts'), 'utf8');
const SEND_MODAL = readFileSync(join(import.meta.dir, '../components/app-ui/SendModal.tsx'), 'utf8');

const TOKEN = 'k1aV0VnG2v8m4J6tq0yX5Lr3cZb9Hs7w';
const ESCROW = '0x00000000000000000000000000000000000000E5';

describe('the claim link is the claim key (audit H-4)', () => {
  test('this browser derives the same key the server committed', () => {
    // The server derives it with ethers (sendCryptoService.claimSignerFor); both are keccak of the seed.
    expect(claimSignerOf(TOKEN)).toBe(new ethers.Wallet(ethers.id(claimKeySeed(TOKEN))).address);
  });

  test('its claim signature recovers to that key, for that wallet only', async () => {
    const transferId = ethers.id('transfer');
    const wallet = '0x00000000000000000000000000000000000000A1';
    const signature = await signClaimToWallet({ claimToken: TOKEN, chainId: 8453, escrow: ESCROW, transferId, recipientWallet: wallet });
    const td = claimTypedData({ chainId: 8453, escrow: ESCROW, transferId, recipientWallet: wallet });
    const types = { Claim: [...CLAIM_TYPES.Claim] };
    expect(ethers.verifyTypedData(td.domain, types, td.message, signature)).toBe(claimSignerOf(TOKEN));
    const other = claimTypedData({ chainId: 8453, escrow: ESCROW, transferId, recipientWallet: ESCROW });
    expect(ethers.verifyTypedData(other.domain, types, other.message, signature)).not.toBe(claimSignerOf(TOKEN));
  });

  test('the claim page signs before it asks for the payout, and sends only the signature', () => {
    const wallet = CLAIM_PAGE.slice(CLAIM_PAGE.indexOf("if (method === 'WALLET')"));
    expect(wallet.indexOf('await signClaimToWallet(')).toBeLessThan(wallet.indexOf('await claimPayoutWallet('));
    expect(wallet).toContain('claimPayoutWallet(verifiedClaim.claimSessionToken, walletAddress, claimSignature)');
  });

  test('a sender’s lock commits the key from prepare', () => {
    expect(SEND_CALLS).toContain("functionName: 'createTransferWithClaimKey'");
    expect(SEND_CALLS).not.toContain("functionName: 'createTransfer',");
    expect(SEND_MODAL).toContain('claimSigner: claimKey.signer');
    expect(SEND_MODAL).toContain('claimToken: claimKey.token');
  });
});
