import crypto from 'crypto';
import { ethers } from 'ethers';

export type SavingsIntentAction = 'deposit' | 'redeem';

export interface SavingsIntentPayload {
  chainId: number;
  salt: string;
  escrowAddress: string;
  ownerWallet: string;
  receiverWallet: string;
  transferToken: string;
  vaultToken: string;
  vaultAddress: string;
  amount: string;
  expiry: number;
  action: SavingsIntentAction;
}

interface SavingsChainConfig {
  chainId: number;
  rpcUrl: string;
  factoryAddress: string;
  vaultAddress: string;
  clrusdAddress: string;
  usdcAddress: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TRANSFER_EVENT_TOPIC = ethers.id('Transfer(address,address,uint256)');
const FACTORY_ABI = [
  'function predictIntentAddress(bytes32 salt) external view returns (address)',
] as const;

const DEFAULT_USDC_BY_CHAIN: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
};

function normalizeAddress(value: string): string {
  return ethers.getAddress(value);
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

class SavingsIntentService {
  private resolveIntentSecret(): string {
    const secret =
      process.env.SAVINGS_INTENT_TOKEN_SECRET?.trim() ||
      process.env.SEND_CONTACT_ENCRYPTION_KEY?.trim() ||
      process.env.SESSION_SECRET?.trim() ||
      '';

    if (!secret) {
      throw new Error('SAVINGS_INTENT_TOKEN_SECRET is required to issue savings intents.');
    }

    return secret;
  }

  defaultChainId(): number {
    return parseIntEnv('SAVINGS_HOME_CHAIN_ID', parseIntEnv('CLRUSD_HOME_CHAIN_ID', 84532));
  }

  resolveRpcUrl(chainId: number): string {
    const keys = [
      `SAVINGS_RPC_URL_${chainId}`,
      `SEND_RPC_URL_${chainId}`,
      chainId === 84532 ? 'SAVINGS_BASE_SEPOLIA_RPC_URL' : '',
      chainId === 84532 ? 'BASE_SEPOLIA_RPC_URL' : '',
      chainId === 8453 ? 'SAVINGS_BASE_MAINNET_RPC_URL' : '',
      chainId === 8453 ? 'BASE_MAINNET_RPC_URL' : '',
    ].filter(Boolean);

    for (const key of keys) {
      const value = process.env[key as keyof NodeJS.ProcessEnv]?.trim();
      if (value) return value;
    }

    if (chainId === 84532) return 'https://sepolia.base.org';
    if (chainId === 8453) return 'https://mainnet.base.org';

    throw new Error(`No RPC URL configured for savings chain ${chainId}.`);
  }

  resolveChainConfig(chainId?: number): SavingsChainConfig {
    const resolvedChainId = chainId ?? this.defaultChainId();
    const factoryAddress =
      process.env[`SAVINGS_INTENT_FACTORY_${resolvedChainId}` as keyof NodeJS.ProcessEnv]?.trim() ||
      process.env.SAVINGS_INTENT_FACTORY?.trim() ||
      '';
    const vaultAddress =
      process.env[`SAVINGS_ESA_VAULT_${resolvedChainId}` as keyof NodeJS.ProcessEnv]?.trim() ||
      process.env[`VITE_ESA_VAULT_${resolvedChainId}` as keyof NodeJS.ProcessEnv]?.trim() ||
      '';
    const clrusdAddress =
      process.env[`SAVINGS_CLRUSD_${resolvedChainId}` as keyof NodeJS.ProcessEnv]?.trim() ||
      process.env[`VITE_CLRUSD_${resolvedChainId}` as keyof NodeJS.ProcessEnv]?.trim() ||
      '';
    const usdcAddress =
      process.env[`SAVINGS_USDC_${resolvedChainId}` as keyof NodeJS.ProcessEnv]?.trim() ||
      DEFAULT_USDC_BY_CHAIN[resolvedChainId] ||
      ZERO_ADDRESS;

    if (!factoryAddress || !ethers.isAddress(factoryAddress)) {
      throw new Error(`Savings intent factory is not configured for chain ${resolvedChainId}.`);
    }
    if (!vaultAddress || !ethers.isAddress(vaultAddress)) {
      throw new Error(`ESA vault is not configured for chain ${resolvedChainId}.`);
    }
    if (!clrusdAddress || !ethers.isAddress(clrusdAddress)) {
      throw new Error(`CLRUSD is not configured for chain ${resolvedChainId}.`);
    }
    if (!usdcAddress || !ethers.isAddress(usdcAddress)) {
      throw new Error(`USDC is not configured for chain ${resolvedChainId}.`);
    }

    return {
      chainId: resolvedChainId,
      rpcUrl: this.resolveRpcUrl(resolvedChainId),
      factoryAddress: normalizeAddress(factoryAddress),
      vaultAddress: normalizeAddress(vaultAddress),
      clrusdAddress: normalizeAddress(clrusdAddress),
      usdcAddress: normalizeAddress(usdcAddress),
    };
  }

  parseAmountToMicros(value: string): bigint {
    const trimmed = value.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
      throw new Error('Amount must be a positive number with up to 6 decimals.');
    }

    const [wholeRaw, fractionRaw = ''] = trimmed.split('.');
    const result = BigInt(wholeRaw) * 1_000_000n + BigInt(fractionRaw.padEnd(6, '0'));
    if (result <= 0n) {
      throw new Error('Amount must be greater than zero.');
    }
    return result;
  }

  formatMicros(value: bigint): string {
    const whole = value / 1_000_000n;
    const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  }

  async predictEscrowAddress(chainId: number, salt: string): Promise<string> {
    const config = this.resolveChainConfig(chainId);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const factory = new ethers.Contract(config.factoryAddress, FACTORY_ABI, provider);
    const predicted = (await factory.predictIntentAddress(salt)) as string;
    return normalizeAddress(predicted);
  }

  createIntentToken(payload: SavingsIntentPayload): string {
    const body = JSON.stringify(payload);
    const encoded = base64UrlEncode(body);
    const signature = crypto
      .createHmac('sha256', this.resolveIntentSecret())
      .update(encoded)
      .digest('base64url');

    return `${encoded}.${signature}`;
  }

  verifyIntentToken(token: string, options?: { allowExpired?: boolean }): SavingsIntentPayload {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) {
      throw new Error('Savings intent token is invalid.');
    }

    const expected = crypto
      .createHmac('sha256', this.resolveIntentSecret())
      .update(encoded)
      .digest('base64url');

    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new Error('Savings intent token signature is invalid.');
    }

    const parsed = JSON.parse(base64UrlDecode(encoded)) as SavingsIntentPayload;
    if (!options?.allowExpired && parsed.expiry <= Math.floor(Date.now() / 1000)) {
      throw new Error('Savings intent has expired.');
    }
    return {
      ...parsed,
      escrowAddress: normalizeAddress(parsed.escrowAddress),
      ownerWallet: normalizeAddress(parsed.ownerWallet),
      receiverWallet: normalizeAddress(parsed.receiverWallet),
      transferToken: normalizeAddress(parsed.transferToken),
      vaultToken: normalizeAddress(parsed.vaultToken),
      vaultAddress: normalizeAddress(parsed.vaultAddress),
    };
  }

  buildIntentPayload(input: {
    chainId?: number;
    ownerWallet: string;
    receiverWallet?: string;
    action: SavingsIntentAction;
    amount: string;
    ttlSeconds?: number;
  }): Promise<SavingsIntentPayload> {
    const config = this.resolveChainConfig(input.chainId);
    const ownerWallet = normalizeAddress(input.ownerWallet);
    const receiverWallet = normalizeAddress(input.receiverWallet || input.ownerWallet);
    const amountMicros = this.parseAmountToMicros(input.amount);
    const ttlSeconds = input.ttlSeconds ?? parseIntEnv('SAVINGS_INTENT_TTL_SECONDS', 3600);
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const salt = `0x${crypto.randomBytes(32).toString('hex')}`;

    const transferToken =
      input.action === 'deposit' ? config.usdcAddress : config.clrusdAddress;
    const vaultToken = config.usdcAddress;

    return this.predictEscrowAddress(config.chainId, salt).then((escrowAddress) => ({
      chainId: config.chainId,
      salt,
      escrowAddress,
      ownerWallet,
      receiverWallet,
      transferToken,
      vaultToken,
      vaultAddress: config.vaultAddress,
      amount: amountMicros.toString(),
      expiry,
      action: input.action,
    }));
  }

  async verifyFundingTransfer(
    payload: SavingsIntentPayload,
    txHash: string
  ): Promise<{ valid: boolean; reason?: string }> {
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash.trim())) {
      return { valid: false, reason: 'Funding transaction hash is invalid.' };
    }

    const config = this.resolveChainConfig(payload.chainId);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash.trim());
    if (!receipt || receipt.status !== 1) {
      return { valid: false, reason: 'Funding transaction failed or is not mined yet.' };
    }

    const expectedAmount = BigInt(payload.amount);
    const ownerTopic = ethers.zeroPadValue(payload.ownerWallet, 32).toLowerCase();
    const escrowTopic = ethers.zeroPadValue(payload.escrowAddress, 32).toLowerCase();

    const matchingTransfer = receipt.logs.find((log) => {
      if (normalizeAddress(log.address) !== payload.transferToken) return false;
      if (log.topics.length < 3) return false;
      if (log.topics[0].toLowerCase() !== TRANSFER_EVENT_TOPIC.toLowerCase()) return false;
      if (log.topics[1].toLowerCase() !== ownerTopic) return false;
      if (log.topics[2].toLowerCase() !== escrowTopic) return false;

      try {
        return BigInt(log.data) === expectedAmount;
      } catch {
        return false;
      }
    });

    if (!matchingTransfer) {
      return { valid: false, reason: 'Funding transfer does not match the expected token, sender, receiver, or amount.' };
    }

    return { valid: true };
  }
}

export const savingsIntentService = new SavingsIntentService();
