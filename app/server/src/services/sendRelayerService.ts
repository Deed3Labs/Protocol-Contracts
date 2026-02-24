import crypto from 'crypto';
import { ethers } from 'ethers';

const CLAIM_ESCROW_ABI = [
  'function claimToWallet(bytes32 transferId, address recipientWallet)',
  'function claimToPayoutTreasury(bytes32 transferId)',
] as const;
const CLAIM_ESCROW_INTERFACE = new ethers.Interface(CLAIM_ESCROW_ABI);

export interface RelayerTxResult {
  txHash: string;
  mode: 'onchain' | 'simulated';
}

type RelayerMode = 'local_key' | 'managed_webhook' | 'cdp_server_wallet';

type ManagedRelayerAction = 'claimToWallet' | 'claimToPayoutTreasury';

interface ManagedRelayerRequest {
  action: ManagedRelayerAction;
  transferId: string;
  chainId?: number;
  recipientWallet?: string;
  escrowAddress: string;
  rpcUrl?: string;
  call: {
    to: string;
    data: string;
  };
}

interface ManagedRelayerResponse {
  txHash?: unknown;
  hash?: unknown;
  transactionHash?: unknown;
  mode?: unknown;
  status?: unknown;
  error?: unknown;
  message?: unknown;
}

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

interface CdpClientOptionsLike {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  basePath?: string;
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

function simulatedTxHash(seed: string): string {
  return `0x${crypto.createHash('sha256').update(seed).digest('hex')}`;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRelayerMode(rawValue: string | undefined): RelayerMode {
  const normalized = (rawValue || 'local_key').trim().toLowerCase();
  if (normalized === 'managed_webhook') {
    return 'managed_webhook';
  }
  if (normalized === 'cdp_server_wallet') {
    return 'cdp_server_wallet';
  }
  return 'local_key';
}

function isValidTxHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

function parseTxHashFromManagedResponse(payload: ManagedRelayerResponse): string | null {
  const candidate =
    typeof payload.txHash === 'string'
      ? payload.txHash
      : typeof payload.hash === 'string'
      ? payload.hash
      : typeof payload.transactionHash === 'string'
      ? payload.transactionHash
      : null;

  if (!candidate) return null;
  const normalized = candidate.trim();
  return isValidTxHash(normalized) ? normalized : null;
}

function parseMessageFromUnknown(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload.trim();
  }

  if (payload && typeof payload === 'object') {
    const maybeMessage = (payload as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage.trim();
    }
    const maybeError = (payload as { error?: unknown }).error;
    if (typeof maybeError === 'string' && maybeError.trim().length > 0) {
      return maybeError.trim();
    }
  }

  return fallback;
}

function isCdpInitializationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('CDP relayer mode requires') ||
    error.message.includes('Could not load @coinbase/cdp-sdk') ||
    error.message.includes('CDP SDK EVM client is unavailable') ||
    error.message.includes('SEND_CDP_EVM_ACCOUNT_ADDRESS must be a valid address')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SendRelayerService {
  private cdpClientPromise: Promise<CdpClientLike> | null = null;
  private cdpAccountAddressByChain = new Map<number, string>();

  private requireReceiptConfirmation(): boolean {
    return (process.env.SEND_RELAYER_REQUIRE_RECEIPT_CONFIRMATION || 'true').trim().toLowerCase() !== 'false';
  }

  private receiptTimeoutMs(): number {
    return parseIntEnv('SEND_RELAYER_RECEIPT_TIMEOUT_MS', 120000);
  }

  private receiptPollMs(): number {
    return parseIntEnv('SEND_RELAYER_RECEIPT_POLL_MS', 2000);
  }

  private resolveEscrowAddress(chainId?: number): string {
    if (chainId && process.env[`SEND_CLAIM_ESCROW_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv]) {
      return (process.env[`SEND_CLAIM_ESCROW_ADDRESS_${chainId}` as keyof NodeJS.ProcessEnv] || '').trim();
    }
    return (process.env.SEND_CLAIM_ESCROW_ADDRESS || '').trim();
  }

  private resolveRpcUrl(chainId?: number): string {
    const chainSpecific = chainId
      ? (process.env[`SEND_RPC_URL_${chainId}` as keyof NodeJS.ProcessEnv] || '').trim()
      : '';
    if (chainSpecific) return chainSpecific;
    return (process.env.SEND_RELAYER_RPC_URL || '').trim();
  }

  private resolveChainId(chainId?: number): number {
    if (typeof chainId === 'number' && Number.isFinite(chainId) && chainId > 0) {
      return chainId;
    }

    const rawDefaultChainId = (process.env.SEND_DEFAULT_CHAIN_ID || '').trim();
    if (!rawDefaultChainId) {
      return 8453;
    }

    const parsed = parseInt(rawDefaultChainId, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 8453;
  }

  private resolveCdpNetwork(chainId?: number): string {
    const resolvedChainId = this.resolveChainId(chainId);
    const chainSpecific = (process.env[`SEND_CDP_NETWORK_${resolvedChainId}` as keyof NodeJS.ProcessEnv] || '').trim();
    if (chainSpecific) {
      return chainSpecific;
    }

    const globalNetwork = (process.env.SEND_CDP_NETWORK || '').trim();
    if (globalNetwork) {
      return globalNetwork;
    }

    return CHAIN_ID_TO_CDP_NETWORK[resolvedChainId] || '';
  }

  private resolveCdpAccountName(chainId?: number): string {
    const resolvedChainId = this.resolveChainId(chainId);
    const chainSpecific = (
      process.env[`SEND_CDP_EVM_ACCOUNT_NAME_${resolvedChainId}` as keyof NodeJS.ProcessEnv] || ''
    ).trim();
    if (chainSpecific) {
      return chainSpecific;
    }

    const globalName = (process.env.SEND_CDP_EVM_ACCOUNT_NAME || '').trim();
    if (globalName) {
      return globalName;
    }

    if (resolvedChainId === 8453) {
      return 'send-relayer-base-mainnet';
    }
    if (resolvedChainId === 84532) {
      return 'send-relayer-base-sepolia';
    }

    return `send-relayer-chain-${resolvedChainId}`;
  }

  private resolveCdpAccountAddressOverride(chainId?: number): string {
    const resolvedChainId = this.resolveChainId(chainId);
    const chainSpecific = (
      process.env[`SEND_CDP_EVM_ACCOUNT_ADDRESS_${resolvedChainId}` as keyof NodeJS.ProcessEnv] || ''
    ).trim();
    if (chainSpecific) {
      return chainSpecific;
    }

    return (process.env.SEND_CDP_EVM_ACCOUNT_ADDRESS || '').trim();
  }

  private resolveCdpClientOptions(): CdpClientOptionsLike | null {
    const apiKeyId = (process.env.SEND_CDP_API_KEY_ID || process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY_NAME || '').trim();
    const apiKeySecret = (process.env.SEND_CDP_API_KEY_SECRET || process.env.CDP_API_KEY_SECRET || '').trim();
    const walletSecret = (process.env.SEND_CDP_WALLET_SECRET || process.env.CDP_WALLET_SECRET || '').trim();
    const basePath = (process.env.SEND_CDP_BASE_PATH || '').trim();

    if (!apiKeyId || !apiKeySecret || !walletSecret) {
      return null;
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
        const clientOptions = this.resolveCdpClientOptions();
        if (!clientOptions) {
          throw new Error(
            'CDP relayer mode requires SEND_CDP_API_KEY_ID/CDP_API_KEY_ID, SEND_CDP_API_KEY_SECRET/CDP_API_KEY_SECRET, and SEND_CDP_WALLET_SECRET/CDP_WALLET_SECRET'
          );
        }

        const cdpModule = (await import('@coinbase/cdp-sdk').catch(() => null)) as
          | {
              CdpClient?: new (options?: CdpClientOptionsLike) => unknown;
            }
          | null;

        if (!cdpModule || typeof cdpModule.CdpClient !== 'function') {
          throw new Error(
            'Could not load @coinbase/cdp-sdk. Install it in the app/server runtime to use SEND_RELAYER_MODE=cdp_server_wallet'
          );
        }

        const instance = new cdpModule.CdpClient(clientOptions) as { evm?: CdpEvmClientLike };
        if (
          !instance.evm ||
          typeof instance.evm.getOrCreateAccount !== 'function' ||
          typeof instance.evm.sendTransaction !== 'function'
        ) {
          throw new Error('CDP SDK EVM client is unavailable; verify @coinbase/cdp-sdk version and credentials');
        }

        return { evm: instance.evm };
      })();
    }

    return this.cdpClientPromise;
  }

  private cdpSeed(request: ManagedRelayerRequest): string {
    return `cdp:${request.action}:${request.transferId}:${request.chainId || this.resolveChainId()}:${request.recipientWallet || ''}:${Date.now()}`;
  }

  private async resolveCdpRelayerAddress(chainId?: number): Promise<string> {
    const resolvedChainId = this.resolveChainId(chainId);
    const addressOverride = this.resolveCdpAccountAddressOverride(resolvedChainId);
    if (addressOverride) {
      if (!ethers.isAddress(addressOverride)) {
        throw new Error('SEND_CDP_EVM_ACCOUNT_ADDRESS must be a valid address');
      }
      return ethers.getAddress(addressOverride);
    }

    const cached = this.cdpAccountAddressByChain.get(resolvedChainId);
    if (cached) {
      return cached;
    }

    const cdp = await this.loadCdpClient();
    const accountName = this.resolveCdpAccountName(resolvedChainId);
    const account = await cdp.evm.getOrCreateAccount({ name: accountName });

    if (!account || typeof account.address !== 'string' || !ethers.isAddress(account.address)) {
      throw new Error('CDP getOrCreateAccount did not return a valid EVM address');
    }

    const normalizedAddress = ethers.getAddress(account.address);
    this.cdpAccountAddressByChain.set(resolvedChainId, normalizedAddress);
    return normalizedAddress;
  }

  private async callCdpServerWallet(request: ManagedRelayerRequest): Promise<RelayerTxResult> {
    const network = this.resolveCdpNetwork(request.chainId);
    if (!network) {
      return this.simulationOrThrow(
        this.cdpSeed(request),
        `No CDP network configured for chainId=${request.chainId || this.resolveChainId()}. Set SEND_CDP_NETWORK or SEND_CDP_NETWORK_<chainId>`
      );
    }

    if (!this.resolveCdpClientOptions()) {
      return this.simulationOrThrow(
        this.cdpSeed(request),
        'CDP relayer mode requires SEND_CDP_API_KEY_ID/CDP_API_KEY_ID, SEND_CDP_API_KEY_SECRET/CDP_API_KEY_SECRET, and SEND_CDP_WALLET_SECRET/CDP_WALLET_SECRET'
      );
    }

    let cdp: CdpClientLike;
    let address: string;
    try {
      cdp = await this.loadCdpClient();
      address = await this.resolveCdpRelayerAddress(request.chainId);
    } catch (error) {
      if (isCdpInitializationError(error)) {
        return this.simulationOrThrow(
          this.cdpSeed(request),
          error instanceof Error ? error.message : 'CDP relayer initialization failed'
        );
      }
      throw error;
    }

    const idempotencyKey = crypto.randomUUID();

    const txResult = await cdp.evm.sendTransaction({
      address,
      network,
      transaction: {
        to: request.call.to,
        data: request.call.data,
        value: 0n,
      },
      idempotencyKey,
    });

    const txHash = typeof txResult?.transactionHash === 'string' ? txResult.transactionHash.trim() : '';
    if (!isValidTxHash(txHash)) {
      throw new Error('CDP sendTransaction did not return a valid transaction hash');
    }

    await this.waitForConfirmedReceipt(txHash, request.chainId);

    return {
      txHash,
      mode: 'onchain',
    };
  }

  private relayerMode(): RelayerMode {
    return parseRelayerMode(process.env.SEND_RELAYER_MODE);
  }

  private allowSimulation(): boolean {
    return (process.env.SEND_RELAYER_ALLOW_SIMULATION || 'true').trim().toLowerCase() === 'true';
  }

  private simulationOrThrow(seed: string, reason: string): RelayerTxResult {
    if (!this.allowSimulation()) {
      throw new Error(reason);
    }

    return {
      txHash: simulatedTxHash(seed),
      mode: 'simulated',
    };
  }

  private buildSigner(chainId?: number): { provider: ethers.JsonRpcProvider; signer: ethers.Wallet; escrowAddress: string } | null {
    const rpcUrl = this.resolveRpcUrl(chainId);
    const relayerKey = (process.env.SEND_RELAYER_PRIVATE_KEY || '').trim();
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

  private async callManagedSigner(request: ManagedRelayerRequest): Promise<RelayerTxResult> {
    const webhookUrl = (process.env.SEND_RELAYER_MANAGED_SIGNER_URL || '').trim();
    if (!webhookUrl) {
      return this.simulationOrThrow(
        `managed:${request.action}:${request.transferId}:${request.recipientWallet || ''}:${Date.now()}`,
        'SEND_RELAYER_MANAGED_SIGNER_URL is required when SEND_RELAYER_MODE=managed_webhook'
      );
    }

    const timeoutMs = parseIntEnv('SEND_RELAYER_MANAGED_SIGNER_TIMEOUT_MS', 15000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SEND_RELAYER_MANAGED_SIGNER_SECRET
            ? { 'X-Send-Relayer-Secret': process.env.SEND_RELAYER_MANAGED_SIGNER_SECRET }
            : {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as ManagedRelayerResponse;
      if (!response.ok) {
        throw new Error(
          parseMessageFromUnknown(
            payload,
            `Managed signer call failed (${response.status})`
          )
        );
      }

      const txHash = parseTxHashFromManagedResponse(payload);
      if (!txHash) {
        throw new Error('Managed signer response did not include a valid tx hash');
      }

      await this.waitForConfirmedReceipt(txHash, request.chainId, request.rpcUrl);

      return {
        txHash,
        mode: 'onchain',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async waitForConfirmedReceipt(txHash: string, chainId?: number, rpcUrlOverride?: string): Promise<void> {
    if (!this.requireReceiptConfirmation()) {
      return;
    }

    const rpcUrl = (rpcUrlOverride || this.resolveRpcUrl(chainId)).trim();
    if (!rpcUrl) {
      throw new Error(
        'Cannot confirm relayer transaction receipt: configure SEND_RELAYER_RPC_URL or SEND_RPC_URL_<chainId>'
      );
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const deadline = Date.now() + this.receiptTimeoutMs();
    let lastError: unknown = null;

    while (Date.now() < deadline) {
      try {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) {
          if (receipt.status !== 1) {
            throw new Error(`Relayer transaction reverted on-chain (${txHash})`);
          }
          return;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('reverted on-chain')) {
          throw error;
        }
        lastError = error;
      }

      await delay(this.receiptPollMs());
    }

    if (lastError instanceof Error) {
      throw new Error(`Timed out waiting for relayer receipt (${txHash}): ${lastError.message}`);
    }

    throw new Error(`Timed out waiting for relayer receipt (${txHash})`);
  }

  async claimToWallet(transferId: string, recipientWallet: string, chainId?: number): Promise<RelayerTxResult> {
    const escrowAddress = this.resolveEscrowAddress(chainId);
    if (!escrowAddress || !ethers.isAddress(escrowAddress)) {
      return this.simulationOrThrow(
        `wallet:${transferId}:${recipientWallet}:${Date.now()}`,
        'SEND_CLAIM_ESCROW_ADDRESS is required and must be a valid address'
      );
    }

    if (!ethers.isAddress(recipientWallet)) {
      throw new Error('recipientWallet must be a valid address');
    }

    if (this.relayerMode() === 'managed_webhook') {
      const data = CLAIM_ESCROW_INTERFACE.encodeFunctionData('claimToWallet', [transferId, recipientWallet]);
      return this.callManagedSigner({
        action: 'claimToWallet',
        transferId,
        chainId,
        recipientWallet,
        escrowAddress,
        rpcUrl: this.resolveRpcUrl(chainId) || undefined,
        call: {
          to: escrowAddress,
          data,
        },
      });
    }

    if (this.relayerMode() === 'cdp_server_wallet') {
      const data = CLAIM_ESCROW_INTERFACE.encodeFunctionData('claimToWallet', [transferId, recipientWallet]);
      return this.callCdpServerWallet({
        action: 'claimToWallet',
        transferId,
        chainId,
        recipientWallet,
        escrowAddress,
        call: {
          to: escrowAddress,
          data,
        },
      });
    }

    const signerContext = this.buildSigner(chainId);
    if (!signerContext) {
      return this.simulationOrThrow(
        `wallet:${transferId}:${recipientWallet}:${Date.now()}`,
        'Relayer local key mode requires SEND_RELAYER_RPC_URL and SEND_RELAYER_PRIVATE_KEY'
      );
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
    const escrowAddress = this.resolveEscrowAddress(chainId);
    if (!escrowAddress || !ethers.isAddress(escrowAddress)) {
      return this.simulationOrThrow(
        `treasury:${transferId}:${Date.now()}`,
        'SEND_CLAIM_ESCROW_ADDRESS is required and must be a valid address'
      );
    }

    if (this.relayerMode() === 'managed_webhook') {
      const data = CLAIM_ESCROW_INTERFACE.encodeFunctionData('claimToPayoutTreasury', [transferId]);
      return this.callManagedSigner({
        action: 'claimToPayoutTreasury',
        transferId,
        chainId,
        escrowAddress,
        rpcUrl: this.resolveRpcUrl(chainId) || undefined,
        call: {
          to: escrowAddress,
          data,
        },
      });
    }

    if (this.relayerMode() === 'cdp_server_wallet') {
      const data = CLAIM_ESCROW_INTERFACE.encodeFunctionData('claimToPayoutTreasury', [transferId]);
      return this.callCdpServerWallet({
        action: 'claimToPayoutTreasury',
        transferId,
        chainId,
        escrowAddress,
        call: {
          to: escrowAddress,
          data,
        },
      });
    }

    const signerContext = this.buildSigner(chainId);
    if (!signerContext) {
      return this.simulationOrThrow(
        `treasury:${transferId}:${Date.now()}`,
        'Relayer local key mode requires SEND_RELAYER_RPC_URL and SEND_RELAYER_PRIVATE_KEY'
      );
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
