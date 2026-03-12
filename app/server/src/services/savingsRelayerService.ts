import crypto from 'crypto';
import { ethers } from 'ethers';
import { savingsIntentService, type SavingsIntentPayload } from './savingsIntentService.js';

const FACTORY_ABI = [
  'function settleDeterministic(bytes32 salt, (address depositor,address receiver,address transferToken,address vaultToken,address vault,uint256 amount,uint64 expiry,uint8 action) config) external returns (address escrow, uint256 resultAmount)',
  'function refundDeterministic(bytes32 salt, (address depositor,address receiver,address transferToken,address vaultToken,address vault,uint256 amount,uint64 expiry,uint8 action) config) external returns (address escrow, uint256 refundedAmount)',
] as const;

const ESCROW_ABI = [
  'function status() external view returns (uint8)',
] as const;

type RelayerMode = 'local_key' | 'cdp_server_wallet';

interface CdpEvmClientLike {
  getOrCreateAccount(options: { name: string }): Promise<{ address: string }>;
  sendTransaction(options: {
    address: string;
    network: string;
    transaction: {
      to: string;
      data: string;
      value: bigint;
    };
    idempotencyKey?: string;
  }): Promise<{ transactionHash: string }>;
}

interface CdpClientLike {
  evm: CdpEvmClientLike;
}

const CHAIN_ID_TO_CDP_NETWORK: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  137: 'polygon',
  8453: 'base',
  84532: 'base-sepolia',
  42161: 'arbitrum',
  11155111: 'ethereum-sepolia',
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTxHash(value: string): string {
  const normalized = value.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error('Relayer did not return a valid transaction hash.');
  }
  return normalized;
}

class SavingsRelayerService {
  private cdpClientPromise: Promise<CdpClientLike> | null = null;
  private cdpAddressByChain = new Map<number, string>();

  private relayerMode(): RelayerMode {
    const raw =
      process.env.SAVINGS_RELAYER_MODE?.trim().toLowerCase() ||
      process.env.SEND_RELAYER_MODE?.trim().toLowerCase() ||
      'cdp_server_wallet';
    return raw === 'local_key' ? 'local_key' : 'cdp_server_wallet';
  }

  private receiptTimeoutMs(): number {
    return parseIntEnv('SAVINGS_RELAYER_RECEIPT_TIMEOUT_MS', 120000);
  }

  private receiptPollMs(): number {
    return parseIntEnv('SAVINGS_RELAYER_RECEIPT_POLL_MS', 2000);
  }

  private resolvePrivateKey(): string {
    return (
      process.env.SAVINGS_RELAYER_PRIVATE_KEY?.trim() ||
      process.env.SEND_RELAYER_PRIVATE_KEY?.trim() ||
      ''
    );
  }

  private resolveCdpNetwork(chainId: number): string {
    const chainSpecific = process.env[`SAVINGS_CDP_NETWORK_${chainId}` as keyof NodeJS.ProcessEnv]?.trim();
    if (chainSpecific) return chainSpecific;

    const sendChainSpecific = process.env[`SEND_CDP_NETWORK_${chainId}` as keyof NodeJS.ProcessEnv]?.trim();
    if (sendChainSpecific) return sendChainSpecific;

    return (
      process.env.SAVINGS_CDP_NETWORK?.trim() ||
      process.env.SEND_CDP_NETWORK?.trim() ||
      CHAIN_ID_TO_CDP_NETWORK[chainId] ||
      ''
    );
  }

  private resolveCdpAccountName(chainId: number): string {
    const chainSpecific = process.env[`SAVINGS_CDP_EVM_ACCOUNT_NAME_${chainId}` as keyof NodeJS.ProcessEnv]?.trim();
    if (chainSpecific) return chainSpecific;

    const globalSavings = process.env.SAVINGS_CDP_EVM_ACCOUNT_NAME?.trim();
    if (globalSavings) return globalSavings;

    const sendSpecific = process.env[`SEND_CDP_EVM_ACCOUNT_NAME_${chainId}` as keyof NodeJS.ProcessEnv]?.trim();
    if (sendSpecific) return sendSpecific;

    return (
      process.env.SEND_CDP_EVM_ACCOUNT_NAME?.trim() ||
      (chainId === 84532 ? 'savings-relayer-base-sepolia' : `savings-relayer-chain-${chainId}`)
    );
  }

  private resolveCdpAccountAddressOverride(chainId: number): string {
    return (
      process.env[`SAVINGS_CDP_EVM_ACCOUNT_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv]?.trim() ||
      process.env.SAVINGS_CDP_EVM_ACCOUNT_ADDRESS?.trim() ||
      process.env[`SEND_CDP_EVM_ACCOUNT_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv]?.trim() ||
      process.env.SEND_CDP_EVM_ACCOUNT_ADDRESS?.trim() ||
      ''
    );
  }

  private resolveCdpOptions(): { apiKeyId: string; apiKeySecret: string; walletSecret: string; basePath?: string } {
    const apiKeyId =
      process.env.SAVINGS_CDP_API_KEY_ID?.trim() ||
      process.env.SEND_CDP_API_KEY_ID?.trim() ||
      process.env.CDP_API_KEY_ID?.trim() ||
      process.env.CDP_API_KEY_NAME?.trim() ||
      '';
    const apiKeySecret =
      process.env.SAVINGS_CDP_API_KEY_SECRET?.trim() ||
      process.env.SEND_CDP_API_KEY_SECRET?.trim() ||
      process.env.CDP_API_KEY_SECRET?.trim() ||
      '';
    const walletSecret =
      process.env.SAVINGS_CDP_WALLET_SECRET?.trim() ||
      process.env.SEND_CDP_WALLET_SECRET?.trim() ||
      process.env.CDP_WALLET_SECRET?.trim() ||
      '';
    const basePath =
      process.env.SAVINGS_CDP_BASE_PATH?.trim() ||
      process.env.SEND_CDP_BASE_PATH?.trim() ||
      '';

    if (!apiKeyId || !apiKeySecret || !walletSecret) {
      throw new Error('CDP relayer mode requires SAVINGS_CDP_* or SEND_CDP_* credentials.');
    }

    return {
      apiKeyId,
      apiKeySecret,
      walletSecret,
      ...(basePath ? { basePath } : {}),
    };
  }

  private async loadCdpClient(): Promise<CdpClientLike> {
    if (!this.cdpClientPromise) {
      this.cdpClientPromise = (async () => {
        const module = await import('@coinbase/cdp-sdk');
        if (!module || typeof module.CdpClient !== 'function') {
          throw new Error('Could not load @coinbase/cdp-sdk.');
        }

        return new module.CdpClient(this.resolveCdpOptions()) as CdpClientLike;
      })();
    }

    return this.cdpClientPromise;
  }

  private async resolveCdpAddress(chainId: number): Promise<string> {
    const cached = this.cdpAddressByChain.get(chainId);
    if (cached) return cached;

    const override = this.resolveCdpAccountAddressOverride(chainId);
    if (override) {
      const normalized = ethers.getAddress(override);
      this.cdpAddressByChain.set(chainId, normalized);
      return normalized;
    }

    const client = await this.loadCdpClient();
    const account = await client.evm.getOrCreateAccount({ name: this.resolveCdpAccountName(chainId) });
    const normalized = ethers.getAddress(account.address);
    this.cdpAddressByChain.set(chainId, normalized);
    return normalized;
  }

  private async waitForReceipt(chainId: number, txHash: string): Promise<void> {
    const config = savingsIntentService.resolveChainConfig(chainId);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const timeoutMs = this.receiptTimeoutMs();
    const pollMs = this.receiptPollMs();
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        if (receipt.status !== 1) {
          throw new Error('Relayer transaction reverted.');
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error('Timed out waiting for relayer transaction confirmation.');
  }

  private buildConfigTuple(payload: SavingsIntentPayload) {
    return {
      depositor: payload.ownerWallet,
      receiver: payload.receiverWallet,
      transferToken: payload.transferToken,
      vaultToken: payload.vaultToken,
      vault: payload.vaultAddress,
      amount: BigInt(payload.amount),
      expiry: BigInt(payload.expiry),
      action: payload.action === 'deposit' ? 0 : 1,
    };
  }

  private async sendViaLocalKey(chainId: number, data: string): Promise<string> {
    const privateKey = this.resolvePrivateKey();
    if (!privateKey) {
      throw new Error('Local relayer mode requires SAVINGS_RELAYER_PRIVATE_KEY or SEND_RELAYER_PRIVATE_KEY.');
    }

    const config = savingsIntentService.resolveChainConfig(chainId);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const tx = await signer.sendTransaction({
      to: config.factoryAddress,
      data,
      value: 0n,
    });

    const txHash = normalizeTxHash(tx.hash);
    await this.waitForReceipt(chainId, txHash);
    return txHash;
  }

  private async sendViaCdp(chainId: number, data: string): Promise<string> {
    const client = await this.loadCdpClient();
    const config = savingsIntentService.resolveChainConfig(chainId);
    const address = await this.resolveCdpAddress(chainId);
    const network = this.resolveCdpNetwork(chainId);
    if (!network) {
      throw new Error(`No CDP network configured for savings chain ${chainId}.`);
    }

    const tx = await client.evm.sendTransaction({
      address,
      network,
      transaction: {
        to: config.factoryAddress,
        data,
        value: 0n,
      },
      idempotencyKey: crypto.randomUUID(),
    });

    const txHash = normalizeTxHash(tx.transactionHash);
    await this.waitForReceipt(chainId, txHash);
    return txHash;
  }

  async getIntentStatus(payload: SavingsIntentPayload): Promise<number | null> {
    const config = savingsIntentService.resolveChainConfig(payload.chainId);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const code = await provider.getCode(payload.escrowAddress);
    if (!code || code === '0x') {
      return null;
    }

    const escrow = new ethers.Contract(payload.escrowAddress, ESCROW_ABI, provider);
    return Number((await escrow.status()) as bigint);
  }

  async settleIntent(payload: SavingsIntentPayload): Promise<string> {
    const iface = new ethers.Interface(FACTORY_ABI);
    const data = iface.encodeFunctionData('settleDeterministic', [payload.salt, this.buildConfigTuple(payload)]);

    if (this.relayerMode() === 'local_key') {
      return this.sendViaLocalKey(payload.chainId, data);
    }

    return this.sendViaCdp(payload.chainId, data);
  }

  async refundIntent(payload: SavingsIntentPayload): Promise<string> {
    const iface = new ethers.Interface(FACTORY_ABI);
    const data = iface.encodeFunctionData('refundDeterministic', [payload.salt, this.buildConfigTuple(payload)]);

    if (this.relayerMode() === 'local_key') {
      return this.sendViaLocalKey(payload.chainId, data);
    }

    return this.sendViaCdp(payload.chainId, data);
  }
}

export const savingsRelayerService = new SavingsRelayerService();
