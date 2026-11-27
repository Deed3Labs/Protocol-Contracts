import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { claimKeySeed, claimTypedData, claimWindowOpen, CLAIM_TYPES } from '@clear/domain';
import { sendCryptoService } from './sendCryptoService';

const routes = readFileSync(new URL('../routes/send.ts', import.meta.url), 'utf8');
const relayer = readFileSync(new URL('./sendRelayerService.ts', import.meta.url), 'utf8');
const crypto = readFileSync(new URL('./sendCryptoService.ts', import.meta.url), 'utf8');

const ESCROW = '0x00000000000000000000000000000000000000E5';
const TOKEN = 'k1aV0VnG2v8m4J6tq0yX5Lr3cZb9Hs7w';

describe('the claim link carries the claim key (audit H-4)', () => {
  test('the key is keccak-256 of the versioned token, and the same token always gives the same key', () => {
    const wallet = new ethers.Wallet(ethers.id(claimKeySeed(TOKEN)));
    expect(sendCryptoService.claimSignerFor(TOKEN)).toBe(wallet.address);
    expect(sendCryptoService.claimSignerFor(` ${TOKEN} `)).toBe(wallet.address);
    expect(sendCryptoService.claimSignerFor(`${TOKEN}x`)).not.toBe(wallet.address);
  });

  test('a claim signed with it is the one ClaimEscrow checks: Claim(transferId, recipientWallet)', async () => {
    const key = new ethers.Wallet(ethers.id(claimKeySeed(TOKEN)));
    const transferId = ethers.id('transfer');
    const recipient = ethers.Wallet.createRandom().address;
    const td = claimTypedData({ chainId: 8453, escrow: ESCROW, transferId, recipientWallet: recipient });
    const signature = await key.signTypedData(td.domain, { Claim: [...CLAIM_TYPES.Claim] }, td.message);

    // claimDigest(transferId, recipientWallet), written out the way the contract builds it.
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const structHash = ethers.keccak256(
      coder.encode(['bytes32', 'bytes32', 'address'], [ethers.id('Claim(bytes32 transferId,address recipientWallet)'), transferId, recipient]),
    );
    const domainSeparator = ethers.keccak256(
      coder.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [ethers.id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), ethers.id('ClaimEscrow'), ethers.id('1'), 8453, ESCROW],
      ),
    );
    const digest = ethers.keccak256(ethers.concat(['0x1901', domainSeparator, structHash]));
    expect(ethers.recoverAddress(digest, signature)).toBe(key.address);
  });

  test('a gasless lock’s nonce is transferTermsHash(terms), so the sender’s signature commits to the key', () => {
    const terms = {
      transferId: ethers.id('transfer'),
      principalUsdc: '25000000',
      sponsorFeeUsdc: '500000',
      expiry: '2000000000',
      recipientHintHash: ethers.id('hint'),
      claimSigner: sendCryptoService.claimSignerFor(TOKEN),
    };
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const structHash = ethers.keccak256(
      coder.encode(
        ['bytes32', 'bytes32', 'uint256', 'uint256', 'uint64', 'bytes32', 'address'],
        [
          ethers.id('TransferTerms(bytes32 transferId,uint256 principalUsdc,uint256 sponsorFeeUsdc,uint64 expiry,bytes32 recipientHintHash,address claimSigner)'),
          terms.transferId, terms.principalUsdc, terms.sponsorFeeUsdc, terms.expiry, terms.recipientHintHash, terms.claimSigner,
        ],
      ),
    );
    const domainSeparator = ethers.keccak256(
      coder.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [ethers.id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'), ethers.id('ClaimEscrow'), ethers.id('1'), 84532, ESCROW],
      ),
    );
    expect(sendCryptoService.transferTermsHash(84532, ESCROW, terms)).toBe(
      ethers.keccak256(ethers.concat(['0x1901', domainSeparator, structHash])),
    );
  });

  test('claims stop at expiry, inclusive', () => {
    const expiry = new Date('2030-01-01T00:00:00Z');
    expect(claimWindowOpen(expiry, new Date('2030-01-01T00:00:00Z'))).toBe(true);
    expect(claimWindowOpen(expiry, new Date('2030-01-01T00:00:01Z'))).toBe(false);
  });
});

describe('the routes and the relayer use it', () => {
  test('prepare hands out the token and the key’s address; only a hash is ever stored', () => {
    expect(routes).toContain('claim: { token: claimToken, signer: sendCryptoService.claimSignerFor(claimToken) }');
    // Confirm and submit hash the token they were sent back; neither makes a new one.
    expect(routes.split('sendClaimService.generateClaimToken()').length - 1).toBe(1);
  });

  test('a lock is accepted only if it committed this transfer’s claim key', () => {
    expect(routes).toContain('expectedClaimSigner: sendCryptoService.claimSignerFor(claimToken)');
    expect(crypto).toContain("'function createTransferWithClaimKey(");
    expect(crypto).toContain('The lock did not commit this transfer’s claim key');
  });

  test('a wallet claim relays the claim key’s signature, inside the window; the settler no longer chooses', () => {
    const wallet = routes.slice(routes.indexOf("sendRouter.post('/claim/payout/wallet'"));
    expect(wallet.indexOf('body.claimSignature')).toBeLessThan(wallet.indexOf('executeWalletPayout('));
    expect(wallet.indexOf('if (!claimWindowOpen(transfer.expiresAt))')).toBeLessThan(wallet.indexOf('createPayoutAttempt('));
    expect(relayer).toContain("encodeFunctionData('claimToWalletWithSignature'");
    expect(relayer).not.toContain("'function claimToWallet(");
    expect(relayer).toContain("'function createTransferWithAuthorizationAndClaimKey(");
  });
});
