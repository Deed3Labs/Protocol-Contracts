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

const DEFAULT_USDC_BY_CHAIN: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
};

function getUsdcAddress(chainId: number): string | null {
  const override = (process.env[`SEND_USDC_${chainId}` as keyof NodeJS.ProcessEnv] || '').trim();
  if (override && ethers.isAddress(override)) return ethers.getAddress(override);
  const fallback = DEFAULT_USDC_BY_CHAIN[chainId];
  return fallback ? ethers.getAddress(fallback) : null;
}

function getRpcUrlOrDefault(chainId: number): string {
  const configured = getRpcUrl(chainId);
  if (configured) return configured;
  if (chainId === 8453) return 'https://mainnet.base.org';
  if (chainId === 84532) return 'https://sepolia.base.org';
  throw new Error(`No RPC URL configured for send chain ${chainId}.`);
}

const ERC20_DOMAIN_ABI = [
  'function name() view returns (string)',
  'function version() view returns (string)',
];

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

  /**
   * Gasless lock typed data for a prepared transfer. Every EIP-3009 parameter is derived
   * deterministically from the trusted transfer record (authNonce = transferId, validBefore = expiry,
   * value = total), so `submit-authorization` can re-derive the exact same params and only needs the
   * client's signature — nothing the client sends can change what gets pulled or to where.
   */
  async buildLockAuthorizationTypedData(input: {
    senderWallet: string;
    chainId: number;
    totalLockedUsdcMicros: string;
    transferId: string;
    expiresAt: Date;
  }): Promise<{
    escrowAddress: string;
    usdcAddress: string;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    authNonce: string;
    typedData: {
      domain: { name: string; version: string; chainId: number; verifyingContract: string };
      primaryType: 'ReceiveWithAuthorization';
      types: Record<string, { name: string; type: string }[]>;
      message: Record<string, string>;
    };
  }> {
    const escrow = getEscrowAddress(input.chainId);
    if (!escrow || !ethers.isAddress(escrow)) {
      throw new Error(`SEND_CLAIM_ESCROW_ADDRESS is not configured for chain ${input.chainId}.`);
    }
    const usdc = getUsdcAddress(input.chainId);
    if (!usdc) {
      throw new Error(`USDC is not configured for chain ${input.chainId}.`);
    }

    const escrowAddress = ethers.getAddress(escrow);
    const sender = ethers.getAddress(input.senderWallet);
    const value = BigInt(input.totalLockedUsdcMicros);
    const validAfter = 0n;
    const validBefore = BigInt(Math.floor(input.expiresAt.getTime() / 1000));
    const authNonce = input.transferId; // unique bytes32 per transfer

    const provider = new ethers.JsonRpcProvider(getRpcUrlOrDefault(input.chainId));
    const erc20 = new ethers.Contract(usdc, ERC20_DOMAIN_ABI, provider);
    let name = 'USD Coin';
    let version = '2';
    try {
      name = await erc20.name();
    } catch {
      /* keep default */
    }
    try {
      version = await erc20.version();
    } catch {
      /* keep default */
    }

    return {
      escrowAddress,
      usdcAddress: usdc,
      value,
      validAfter,
      validBefore,
      authNonce,
      typedData: {
        domain: { name, version, chainId: input.chainId, verifyingContract: usdc },
        primaryType: 'ReceiveWithAuthorization',
        types: {
          ReceiveWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        message: {
          from: sender,
          to: escrowAddress,
          value: value.toString(),
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce: authNonce,
        },
      },
    };
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
