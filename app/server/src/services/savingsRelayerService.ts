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

const VAULT_ABI = [
  'function depositWithAuthorization(address depositor, address token, uint256 amount, address receiver, uint256 validAfter, uint256 validBefore, bytes32 authNonce, uint8 v, bytes32 r, bytes32 s) external returns (uint256 minted)',
  'function redeemWithAuthorization(address redeemer, address token, uint256 clrusdAmount, address receiver, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external returns (uint256 returnedAmount)',
  'function executeMandateDeposit(address depositor, address token, uint256 amountPerRun, uint64 interval, uint32 maxRuns, uint256 startAt, uint256 expiry, uint256 nonce, uint8 v, bytes32 r, bytes32 s) external returns (uint256 minted)',
] as const;

const PERMIT_ABI = [
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
] as const;

export interface DepositMandateArgs {
  depositor: string;
  token: string;
  amountPerRun: bigint;
  interval: number; // seconds
  maxRuns: number;
  startAt: bigint; // unix seconds
  expiry: bigint; // unix seconds
  nonce: bigint;
  v: number;
  r: string;
  s: string;
}

export interface PermitArgs {
  owner: string;
  spender: string;
  value: bigint;
  deadline: bigint;
  v: number;
  r: string;
  s: string;
}

export interface DepositAuthorizationArgs {
  depositor: string;
  token: string;
  amount: bigint;
  receiver: string;
  validAfter: bigint;
  validBefore: bigint;
  authNonce: string;
  v: number;
  r: string;
  s: string;
}

export interface RedeemAuthorizationArgs {
  redeemer: string;
  token: string;
  clrusdAmount: bigint;
  receiver: string;
  deadline: bigint;
  v: number;
  r: string;
  s: string;
}

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
    const provider = new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(chainId));
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

  private async sendViaLocalKey(chainId: number, to: string, data: string): Promise<string> {
    const privateKey = this.resolvePrivateKey();
    if (!privateKey) {
      throw new Error('Local relayer mode requires SAVINGS_RELAYER_PRIVATE_KEY or SEND_RELAYER_PRIVATE_KEY.');
    }

    const provider = new ethers.JsonRpcProvider(savingsIntentService.resolveRpcUrl(chainId));
    const signer = new ethers.Wallet(privateKey, provider);
    const tx = await signer.sendTransaction({ to, data, value: 0n });

    const txHash = normalizeTxHash(tx.hash);
    await this.waitForReceipt(chainId, txHash);
    return txHash;
  }

  private async sendViaCdp(chainId: number, to: string, data: string): Promise<string> {
    const client = await this.loadCdpClient();
    const address = await this.resolveCdpAddress(chainId);
    const network = this.resolveCdpNetwork(chainId);
    if (!network) {
      throw new Error(`No CDP network configured for savings chain ${chainId}.`);
    }

    const tx = await client.evm.sendTransaction({
      address,
      network,
      transaction: { to, data, value: 0n },
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

  private async submit(chainId: number, to: string, data: string): Promise<string> {
    return this.relayerMode() === 'local_key'
      ? this.sendViaLocalKey(chainId, to, data)
      : this.sendViaCdp(chainId, to, data);
  }

  async settleIntent(payload: SavingsIntentPayload): Promise<string> {
    const config = savingsIntentService.resolveChainConfig(payload.chainId);
    const iface = new ethers.Interface(FACTORY_ABI);
    const data = iface.encodeFunctionData('settleDeterministic', [payload.salt, this.buildConfigTuple(payload)]);
    return this.submit(payload.chainId, config.factoryAddress, data);
  }

  async refundIntent(payload: SavingsIntentPayload): Promise<string> {
    const config = savingsIntentService.resolveChainConfig(payload.chainId);
    const iface = new ethers.Interface(FACTORY_ABI);
    const data = iface.encodeFunctionData('refundDeterministic', [payload.salt, this.buildConfigTuple(payload)]);
    return this.submit(payload.chainId, config.factoryAddress, data);
  }

  /** Gasless deposit (USDC → CLRUSD): relayer submits the user's EIP-3009 authorization to the vault. */
  async depositWithAuthorization(
    chainId: number,
    vaultAddress: string,
    args: DepositAuthorizationArgs,
  ): Promise<string> {
    const iface = new ethers.Interface(VAULT_ABI);
    const data = iface.encodeFunctionData('depositWithAuthorization', [
      args.depositor,
      args.token,
      args.amount,
      args.receiver,
      args.validAfter,
      args.validBefore,
      args.authNonce,
      args.v,
      args.r,
      args.s,
    ]);
    return this.submit(chainId, ethers.getAddress(vaultAddress), data);
  }

  /** Gasless redeem (CLRUSD → USDC): relayer submits the user's EIP-712 Redeem intent to the vault. */
  async redeemWithAuthorization(
    chainId: number,
    vaultAddress: string,
    args: RedeemAuthorizationArgs,
  ): Promise<string> {
    const iface = new ethers.Interface(VAULT_ABI);
    const data = iface.encodeFunctionData('redeemWithAuthorization', [
      args.redeemer,
      args.token,
      args.clrusdAmount,
      args.receiver,
      args.deadline,
      args.v,
      args.r,
      args.s,
    ]);
    return this.submit(chainId, ethers.getAddress(vaultAddress), data);
  }

  /** Autopay: execute one recurring-deposit run from the user's signed mandate (relayer = OPERATOR). */
  async executeMandateDeposit(chainId: number, vaultAddress: string, a: DepositMandateArgs): Promise<string> {
    const iface = new ethers.Interface(VAULT_ABI);
    const data = iface.encodeFunctionData('executeMandateDeposit', [
      a.depositor,
      a.token,
      a.amountPerRun,
      a.interval,
      a.maxRuns,
      a.startAt,
      a.expiry,
      a.nonce,
      a.v,
      a.r,
      a.s,
    ]);
    return this.submit(chainId, ethers.getAddress(vaultAddress), data);
  }

  /** Submit a user-signed EIP-2612 permit (relayer pays gas) so the vault gets a standing allowance. */
  async submitPermit(chainId: number, tokenAddress: string, a: PermitArgs): Promise<string> {
    const iface = new ethers.Interface(PERMIT_ABI);
    const data = iface.encodeFunctionData('permit', [a.owner, a.spender, a.value, a.deadline, a.v, a.r, a.s]);
    return this.submit(chainId, ethers.getAddress(tokenAddress), data);
  }
}

export const savingsRelayerService = new SavingsRelayerService();
