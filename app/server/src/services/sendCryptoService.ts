import crypto from 'crypto';
import { ethers } from 'ethers';

export interface VerifyEscrowLockParams {
  txHash: string;
  expectedSenderWallet: string;
  chainId: number;
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

    const skipVerification = (process.env.SEND_SKIP_ESCROW_TX_VERIFICATION || 'true') === 'true';
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
