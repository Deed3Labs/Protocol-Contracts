import crypto from 'crypto';
import { ethers } from 'ethers';

export interface VerifyEscrowLockParams {
  txHash: string;
  expectedSenderWallet: string;
  chainId: number;
  expectedTransferId: string;
  expectedPrincipalUsdcMicros: string;
  expectedSponsorFeeUsdcMicros: string;
  expectedTotalLockedUsdcMicros: string;
  expectedExpiry: Date | string;
  expectedRecipientHintHash: string;
}

export interface EscrowVerificationResult {
  valid: boolean;
  reason?: string;
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function getRpcUrl(chainId: number): string | null {
  const chainSpecific = process.env[`SEND_RPC_URL_${chainId}` as keyof NodeJS.ProcessEnv];
  if (chainSpecific) {
    return chainSpecific;
  }

  if (chainId === 8453) {
    return process.env.SEND_BASE_MAINNET_RPC_URL || process.env.BASE_MAINNET_RPC_URL || null;
  }

  if (chainId === 84532) {
    return process.env.SEND_BASE_SEPOLIA_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || null;
  }

  return null;
}

function getEscrowAddress(chainId: number): string | null {
  const chainSpecific = process.env[`SEND_CLAIM_ESCROW_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv];
  if (typeof chainSpecific === 'string' && chainSpecific.trim().length > 0) {
    return chainSpecific.trim().toLowerCase();
  }

  const globalValue = (process.env.SEND_CLAIM_ESCROW_ADDRESS || '').trim();
  if (globalValue) {
    return globalValue.toLowerCase();
  }

  return null;
}

const CREATE_TRANSFER_SELECTOR = ethers.id('createTransfer(bytes32,uint256,uint256,uint64,bytes32)').slice(0, 10);
const CLAIM_ESCROW_INTERFACE = new ethers.Interface([
  'function createTransfer(bytes32 transferId, uint256 principalUsdc, uint256 sponsorFeeUsdc, uint64 expiry, bytes32 recipientHintHash)',
]);

function shouldSkipEscrowTxVerification(): boolean {
  const requestedSkip = (process.env.SEND_SKIP_ESCROW_TX_VERIFICATION || 'false').trim().toLowerCase() === 'true';
  if (!requestedSkip) {
    return false;
  }

  const isProduction = (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (isProduction) {
    console.warn(
      '[SendFunds] SEND_SKIP_ESCROW_TX_VERIFICATION=true ignored in production.'
    );
    return false;
  }

  return true;
}

class SendCryptoService {
  generateTransferId(input: {
    senderWallet: string;
    recipientContactHash: string;
    principalUsdc: string;
  }): string {
    const seed = [
      normalizeAddress(input.senderWallet),
      input.recipientContactHash,
      input.principalUsdc,
      Date.now().toString(),
      crypto.randomBytes(16).toString('hex'),
    ].join(':');

    return `0x${crypto.createHash('sha256').update(seed).digest('hex')}`;
  }

  computeRecipientHintHash(recipientContactHash: string): string {
    return `0x${crypto.createHash('sha256').update(recipientContactHash).digest('hex')}`;
  }

  isValidBytes32(value: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(value);
  }

  isValidTxHash(txHash: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(txHash.trim());
  }

  async verifyEscrowLockTransaction(params: VerifyEscrowLockParams): Promise<EscrowVerificationResult> {
    if (!this.isValidTxHash(params.txHash)) {
      return { valid: false, reason: 'Invalid transaction hash format' };
    }

    if (!this.isValidBytes32(params.expectedTransferId)) {
      return { valid: false, reason: 'Expected transfer id is invalid' };
    }

    if (!this.isValidBytes32(params.expectedRecipientHintHash)) {
      return { valid: false, reason: 'Expected recipient hint hash is invalid' };
    }

    let expectedPrincipal: bigint;
    let expectedSponsorFee: bigint;
    let expectedTotalLocked: bigint;
    try {
      expectedPrincipal = BigInt(params.expectedPrincipalUsdcMicros);
      expectedSponsorFee = BigInt(params.expectedSponsorFeeUsdcMicros);
      expectedTotalLocked = BigInt(params.expectedTotalLockedUsdcMicros);
    } catch {
      return { valid: false, reason: 'Expected USDC amounts are invalid' };
    }

    if (expectedPrincipal <= 0n) {
      return { valid: false, reason: 'Expected principal must be positive' };
    }

    if (expectedPrincipal + expectedSponsorFee !== expectedTotalLocked) {
      return { valid: false, reason: 'Expected total lock does not match principal + sponsor fee' };
    }

    const expiryDate = params.expectedExpiry instanceof Date ? params.expectedExpiry : new Date(params.expectedExpiry);
    if (Number.isNaN(expiryDate.getTime())) {
      return { valid: false, reason: 'Expected expiry is invalid' };
    }
    const expectedExpirySeconds = BigInt(Math.floor(expiryDate.getTime() / 1000));

    const skipVerification = shouldSkipEscrowTxVerification();
    if (skipVerification) {
      return { valid: true };
    }

    const rpcUrl = getRpcUrl(params.chainId);
    if (!rpcUrl) {
      return { valid: false, reason: 'No RPC URL configured for chain' };
    }

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const tx = await provider.getTransaction(params.txHash);
      if (!tx) {
        return { valid: false, reason: 'Transaction not found' };
      }

      if (!tx.from || normalizeAddress(tx.from) !== normalizeAddress(params.expectedSenderWallet)) {
        return { valid: false, reason: 'Transaction sender mismatch' };
      }

      const expectedEscrow = getEscrowAddress(params.chainId);
      if (!expectedEscrow) {
        return { valid: false, reason: 'Escrow address is not configured for chain' };
      }
      if (!tx.to || normalizeAddress(tx.to) !== expectedEscrow) {
        return { valid: false, reason: 'Transaction target does not match escrow contract' };
      }

      if (!tx.data || !tx.data.startsWith(CREATE_TRANSFER_SELECTOR)) {
        return { valid: false, reason: 'Transaction is not createTransfer call data' };
      }

      let decoded:
        | {
            transferId: string;
            principalUsdc: bigint;
            sponsorFeeUsdc: bigint;
            expiry: bigint;
            recipientHintHash: string;
          }
        | null = null;
      try {
        const parsed = CLAIM_ESCROW_INTERFACE.parseTransaction({ data: tx.data, value: tx.value });
        if (!parsed || parsed.name !== 'createTransfer') {
          return { valid: false, reason: 'Transaction did not decode as createTransfer' };
        }

        decoded = {
          transferId: String(parsed.args[0]),
          principalUsdc: parsed.args[1] as bigint,
          sponsorFeeUsdc: parsed.args[2] as bigint,
          expiry: parsed.args[3] as bigint,
          recipientHintHash: String(parsed.args[4]),
        };
      } catch {
        return { valid: false, reason: 'Failed to decode createTransfer call data' };
      }

      if (normalizeAddress(decoded.transferId) !== normalizeAddress(params.expectedTransferId)) {
        return { valid: false, reason: 'Transfer id in transaction does not match expected transfer id' };
      }

      if (normalizeAddress(decoded.recipientHintHash) !== normalizeAddress(params.expectedRecipientHintHash)) {
        return { valid: false, reason: 'Recipient hint hash in transaction does not match expected value' };
      }

      if (decoded.principalUsdc !== expectedPrincipal) {
        return { valid: false, reason: 'Principal amount in transaction does not match expected value' };
      }

      if (decoded.sponsorFeeUsdc !== expectedSponsorFee) {
        return { valid: false, reason: 'Sponsor fee in transaction does not match expected value' };
      }

      if (decoded.principalUsdc + decoded.sponsorFeeUsdc !== expectedTotalLocked) {
        return { valid: false, reason: 'Total lock amount in transaction does not match expected value' };
      }

      if (decoded.expiry !== expectedExpirySeconds) {
        return { valid: false, reason: 'Expiry in transaction does not match expected value' };
      }

      const receipt = await provider.getTransactionReceipt(params.txHash);
      if (!receipt || receipt.status !== 1) {
        return { valid: false, reason: 'Transaction failed or not mined' };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: error instanceof Error ? error.message : 'Escrow transaction verification failed',
      };
    }
  }
}

export const sendCryptoService = new SendCryptoService();
