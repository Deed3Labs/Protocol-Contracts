import crypto from 'crypto';
import { ethers } from 'ethers';

const CLAIM_ESCROW_ABI = [
  'function claimToWallet(bytes32 transferId, address recipientWallet)',
  'function claimToPayoutTreasury(bytes32 transferId)',
] as const;

export interface RelayerTxResult {
  txHash: string;
  mode: 'onchain' | 'simulated';
}

function simulatedTxHash(seed: string): string {
  return `0x${crypto.createHash('sha256').update(seed).digest('hex')}`;
}

class SendRelayerService {
  private resolveEscrowAddress(chainId?: number): string {
    if (chainId && process.env[`SEND_CLAIM_ESCROW_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv]) {
      return (process.env[`SEND_CLAIM_ESCROW_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv] || '').trim();
    }
    return (process.env.SEND_CLAIM_ESCROW_ADDRESS || '').trim();
  }

  private buildSigner(chainId?: number): { provider: ethers.JsonRpcProvider; signer: ethers.Wallet; escrowAddress: string } | null {
    const rpcUrl = process.env.SEND_RELAYER_RPC_URL || '';
    const relayerKey = process.env.SEND_RELAYER_PRIVATE_KEY || '';
    const escrowAddress = this.resolveEscrowAddress(chainId);

    if (!rpcUrl || !relayerKey || !escrowAddress) {
      return null;
    }

    if (!ethers.isAddress(escrowAddress)) {
      throw new Error('SEND_CLAIM_ESCROW_ADDRESS must be a valid address');
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(relayerKey, provider);
    return { provider, signer, escrowAddress };
  }

  async claimToWallet(transferId: string, recipientWallet: string, chainId?: number): Promise<RelayerTxResult> {
    const signerContext = this.buildSigner(chainId);
    if (!signerContext) {
      return {
        txHash: simulatedTxHash(`wallet:${transferId}:${recipientWallet}:${Date.now()}`),
        mode: 'simulated',
      };
    }

    const contract = new ethers.Contract(signerContext.escrowAddress, CLAIM_ESCROW_ABI, signerContext.signer);
    const tx = await contract.claimToWallet(transferId, recipientWallet);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Relayer wallet claim transaction failed');
    }

    return {
      txHash: tx.hash,
      mode: 'onchain',
    };
  }

  async claimToPayoutTreasury(transferId: string, chainId?: number): Promise<RelayerTxResult> {
    const signerContext = this.buildSigner(chainId);
    if (!signerContext) {
      return {
        txHash: simulatedTxHash(`treasury:${transferId}:${Date.now()}`),
        mode: 'simulated',
      };
    }

    const contract = new ethers.Contract(signerContext.escrowAddress, CLAIM_ESCROW_ABI, signerContext.signer);
    const tx = await contract.claimToPayoutTreasury(transferId);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error('Relayer treasury claim transaction failed');
    }

    return {
      txHash: tx.hash,
      mode: 'onchain',
    };
  }
}

export const sendRelayerService = new SendRelayerService();
