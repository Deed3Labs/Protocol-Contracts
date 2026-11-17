import { describe, expect, mock, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { claimKeySeed, PAYOUT_CLAIM_TYPE_STRING, PAYOUT_CLAIM_TYPES, payoutClaimTypedData, payoutRefSeed } from '@clear/domain';

/*
 * Card and bank payouts of a claim are signed (Phase 2d, decision L-D, PR #893).
 *
 * `ClaimEscrow.claimToPayoutTreasury` now reverts; the settler submits
 * `claimToPayoutTreasuryWithSignature(transferId, payoutRefHash, signature)`, with the claim key's
 * (or the sender's) EIP-712 signature over PayoutClaim(transferId, payoutTreasury, payoutRefHash).
 * Checked against ClaimEscrow.sol as it stands on audit/phase-2d-dfal-vault; once #893 merges the
 * source in this tree is checked too.
 */

const ESCROW = '0x00000000000000000000000000000000000000E5';
const TREASURY = '0x00000000000000000000000000000000000000F7';
const TOKEN = 'k1aV0VnG2v8m4J6tq0yX5Lr3cZb9Hs7w';
const escrowSol = new URL('../../../../contracts/peripherals/ClaimEscrow.sol', import.meta.url);

const relayerCalls: unknown[][] = [];
mock.module('./disputes/disputeStore.js', () => ({ disputeStore: { openFor: async () => null } }));

const { CLAIM_ESCROW_ABI } = await import('./sendRelayerService');
const { sendRelayerService } = await import('./sendRelayerService');
const { payoutRefHash, sendPayoutService } = await import('./sendPayoutService');

describe('the escrow’s new payout entry point', () => {
  test('the fragment is the 2d contract’s: claimToPayoutTreasuryWithSignature(bytes32,bytes32,bytes)', () => {
    const iface = new ethers.Interface(CLAIM_ESCROW_ABI as unknown as string[]);
    expect(iface.getFunction('claimToPayoutTreasuryWithSignature')?.format()).toBe('claimToPayoutTreasuryWithSignature(bytes32,bytes32,bytes)');
    expect(iface.getFunction('PAYOUT_TREASURY')?.format()).toBe('PAYOUT_TREASURY()');
    // The retired one is not called any more: it only reverts.
    expect(iface.getFunction('claimToPayoutTreasury')).toBeNull();
    expect(PAYOUT_CLAIM_TYPE_STRING).toBe('PayoutClaim(bytes32 transferId,address payoutTreasury,bytes32 payoutRefHash)');
  });

  test('and still match ClaimEscrow.sol once #893 is in this tree', () => {
    if (!existsSync(escrowSol)) return;
    const source = readFileSync(escrowSol, 'utf8');
    if (!source.includes('claimToPayoutTreasuryWithSignature')) return; // #893 not merged here yet
    expect(source).toContain('function claimToPayoutTreasuryWithSignature(bytes32 transferId, bytes32 payoutRefHash, bytes calldata signature)');
    expect(source).toContain(`keccak256("${PAYOUT_CLAIM_TYPE_STRING}")`);
  });
});

describe('the claim key signs the payout, and the escrow’s digest is what it signed', () => {
  test('PayoutClaim, written out the way payoutClaimDigest builds it', async () => {
    const key = new ethers.Wallet(ethers.id(claimKeySeed(TOKEN)));
    const transferId = ethers.id('transfer');
    const refHash = payoutRefHash(transferId, 'DEBIT');
    expect(refHash).toBe(ethers.keccak256(ethers.toUtf8Bytes(payoutRefSeed(transferId, 'DEBIT'))));
    const td = payoutClaimTypedData({ chainId: 8453, escrow: ESCROW, transferId, payoutTreasury: TREASURY, payoutRefHash: refHash });
    const signature = await key.signTypedData(td.domain, { PayoutClaim: [...PAYOUT_CLAIM_TYPES.PayoutClaim] }, td.message);

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const structHash = ethers.keccak256(
      coder.encode(['bytes32', 'bytes32', 'address', 'bytes32'], [ethers.id(PAYOUT_CLAIM_TYPE_STRING), transferId, TREASURY, refHash]),
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

  test('a card and a bank payout commit to different references, so one signature cannot be used for the other', () => {
    const transferId = ethers.id('transfer');
    expect(payoutRefHash(transferId, 'DEBIT')).not.toBe(payoutRefHash(transferId, 'BANK'));
    expect(payoutRefHash(transferId, 'DEBIT')).not.toBe(payoutRefHash(ethers.id('other'), 'DEBIT'));
  });
});

describe('the payout service', () => {
  const transfer = {
    transferId: ethers.id('transfer'),
    chainId: 84532,
    region: 'US',
  } as never;

  test('without the link’s signature, a bank payout stops before anything is sent', async () => {
    const original = sendRelayerService.claimToPayoutTreasury.bind(sendRelayerService);
    (sendRelayerService as unknown as { claimToPayoutTreasury: (...a: unknown[]) => unknown }).claimToPayoutTreasury = async (...a: unknown[]) => {
      relayerCalls.push(a);
      throw new Error('should not be called');
    };
    const service = sendPayoutService as unknown as { isStripeBridgeJitMode(): boolean; isBridgeOnlyMode(): boolean };
    const jit = service.isStripeBridgeJitMode;
    const bridge = service.isBridgeOnlyMode;
    service.isStripeBridgeJitMode = () => false;
    service.isBridgeOnlyMode = () => false;
    try {
      const result = await sendPayoutService.executeBankPayout(transfer, {} as never);
      expect(result.status).toBe('FAILED');
      expect(result.failureCode).toBe('PAYOUT_SIGNATURE_REQUIRED');
      expect(relayerCalls).toEqual([]);
    } finally {
      (sendRelayerService as unknown as { claimToPayoutTreasury: typeof original }).claimToPayoutTreasury = original;
      service.isStripeBridgeJitMode = jit;
      service.isBridgeOnlyMode = bridge;
    }
  });

  test('with it, the relayer is handed the signature and this method’s reference', () => {
    const source = readFileSync(new URL('./sendPayoutService.ts', import.meta.url), 'utf8');
    expect(source).toContain("const debitAuth = payoutAuth(transfer.transferId, 'DEBIT', recipientContext);");
    expect(source).toContain('sendRelayerService.claimToPayoutTreasury(transfer.transferId, transfer.chainId, debitAuth)');
    expect(source).toContain("const bankAuth = payoutAuth(transfer.transferId, 'BANK', recipientContext);");
    expect(source).toContain('sendRelayerService.claimToPayoutTreasury(transfer.transferId, transfer.chainId, bankAuth)');
    const relayer = readFileSync(new URL('./sendRelayerService.ts', import.meta.url), 'utf8');
    expect(relayer.match(/claimToPayoutTreasuryWithSignature', \[transferId, auth\.payoutRefHash, auth\.signature\]/g)).toHaveLength(2);
    expect(relayer).toContain('contract.claimToPayoutTreasuryWithSignature(transferId, auth.payoutRefHash, auth.signature)');
  });

  test('the routes pass the browser’s signature through, and prepare reads the treasury from the escrow', () => {
    const routes = readFileSync(new URL('../routes/send.ts', import.meta.url), 'utf8');
    expect(routes.match(/payoutSignature: typeof body\.payoutSignature === 'string' \? body\.payoutSignature\.trim\(\) : undefined,/g)).toHaveLength(2);
    expect(routes).toContain("sendRouter.post('/claim/payout/prepare'");
    expect(routes).toContain('await sendRelayerService.payoutTreasury(transfer.chainId)');
  });
});
