import crypto from 'crypto';
import { ethers } from 'ethers';
import { savingsIntentService } from './savingsIntentService.js';

/**
 * Fully-gasless savings (Cash USDC ↔ Savings CLRUSD) via signed authorizations — the user only signs
 * off-chain, the relayer submits + pays gas. Deposit uses USDC EIP-3009 `receiveWithAuthorization`
 * (one signature, no approve). Redeem uses the vault's EIP-712 `Redeem` intent (one signature) plus a
 * one-time CLRUSD `approve(vault)` the user grants once (CLRUSD has no permit — decision A3).
 *
 * Separate from savingsIntentService's factory/funding-transfer flow: that one needs a factory address
 * and a gas-paying funding transfer; this one needs only the vault + tokens.
 */

const DEFAULT_USDC_BY_CHAIN: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
};

const ERC20_DOMAIN_ABI = [
  'function name() view returns (string)',
  'function version() view returns (string)',
] as const;

const VAULT_READ_ABI = [
  'function redeemNonces(address) view returns (uint256)',
  'function isAcceptedToken(address) view returns (bool)',
] as const;

export interface GaslessConfig {
  chainId: number;
  rpcUrl: string;
  vaultAddress: string;
  usdcAddress: string;
  clrusdAddress: string; // '' when not configured (only required for redeem)
}

function env(name: string): string | undefined {
  const value = process.env[name as keyof NodeJS.ProcessEnv];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

class SavingsGaslessService {
  resolveConfig(chainId?: number): GaslessConfig {
    const id = chainId ?? savingsIntentService.defaultChainId();
    const vaultAddress = env(`SAVINGS_ESA_VAULT_${id}`) || env(`VITE_ESA_VAULT_${id}`) || '';
    const usdcAddress = env(`SAVINGS_USDC_${id}`) || DEFAULT_USDC_BY_CHAIN[id] || '';
    const clrusdAddress = env(`SAVINGS_CLRUSD_${id}`) || env(`VITE_CLRUSD_${id}`) || '';

    if (!ethers.isAddress(vaultAddress)) {
      throw new Error(`ESA vault is not configured for chain ${id}.`);
    }
    if (!ethers.isAddress(usdcAddress)) {
      throw new Error(`USDC is not configured for chain ${id}.`);
    }

    return {
      chainId: id,
      rpcUrl: savingsIntentService.resolveRpcUrl(id),
      vaultAddress: ethers.getAddress(vaultAddress),
      usdcAddress: ethers.getAddress(usdcAddress),
      clrusdAddress: ethers.isAddress(clrusdAddress) ? ethers.getAddress(clrusdAddress) : '',
    };
  }

  /** USDC the vault currently holds — a redeem can only return up to this (else it reverts on-chain). */
  async vaultUsdcBalance(config: GaslessConfig): Promise<bigint> {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const usdc = new ethers.Contract(
      config.usdcAddress,
      ['function balanceOf(address) view returns (uint256)'],
      provider,
    );
    return (await usdc.balanceOf(config.vaultAddress)) as bigint;
  }

  private ttlSeconds(): number {
    const raw = process.env.SAVINGS_GASLESS_TTL_SECONDS;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600;
  }

  /** EIP-712 domain for an EIP-3009/2612 token, read from the token (name/version) at request time. */
  private async resolveTokenDomain(provider: ethers.JsonRpcProvider, token: string, chainId: number) {
    const erc20 = new ethers.Contract(token, ERC20_DOMAIN_ABI, provider);
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
    return { name, version, chainId, verifyingContract: token };
  }

  /** Deposit: USDC → CLRUSD. Returns the EIP-3009 typed data to sign + the params the relayer submits. */
  async buildDepositTypedData(input: { chainId?: number; ownerWallet: string; amount: string }) {
    const config = this.resolveConfig(input.chainId);
    const owner = ethers.getAddress(input.ownerWallet);
    const amount = savingsIntentService.parseAmountToMicros(input.amount);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    const now = Math.floor(Date.now() / 1000);
    const validAfter = '0';
    const validBefore = String(now + this.ttlSeconds());
    const authNonce = `0x${crypto.randomBytes(32).toString('hex')}`;
    const domain = await this.resolveTokenDomain(provider, config.usdcAddress, config.chainId);

    return {
      chainId: config.chainId,
      action: 'deposit' as const,
      vaultAddress: config.vaultAddress,
      token: config.usdcAddress,
      amountMicros: amount.toString(),
      typedData: {
        domain,
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
          from: owner,
          to: config.vaultAddress,
          value: amount.toString(),
          validAfter,
          validBefore,
          nonce: authNonce,
        },
      },
      submit: {
        depositor: owner,
        token: config.usdcAddress,
        amount: amount.toString(),
        receiver: owner,
        validAfter,
        validBefore,
        authNonce,
      },
    };
  }

  /** Redeem: CLRUSD → USDC. Returns the vault EIP-712 `Redeem` typed data + the one-time approve target. */
  async buildRedeemTypedData(input: { chainId?: number; ownerWallet: string; amount: string }) {
    const config = this.resolveConfig(input.chainId);
    if (!config.clrusdAddress) {
      throw new Error(`CLRUSD is not configured for chain ${config.chainId}.`);
    }
    const owner = ethers.getAddress(input.ownerWallet);
    const amount = savingsIntentService.parseAmountToMicros(input.amount);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const vault = new ethers.Contract(config.vaultAddress, VAULT_READ_ABI, provider);
    const nonce = (await vault.redeemNonces(owner)) as bigint;

    const now = Math.floor(Date.now() / 1000);
    const deadline = String(now + this.ttlSeconds());

    return {
      chainId: config.chainId,
      action: 'redeem' as const,
      vaultAddress: config.vaultAddress,
      token: config.usdcAddress,
      clrusdAddress: config.clrusdAddress,
      amountMicros: amount.toString(),
      nonce: nonce.toString(),
      // The frontend ensures CLRUSD.allowance(owner, vault) >= amount (one-time approve) before submit.
      approve: { token: config.clrusdAddress, spender: config.vaultAddress },
      typedData: {
        domain: {
          name: 'ESADepositVault',
          version: '1',
          chainId: config.chainId,
          verifyingContract: config.vaultAddress,
        },
        primaryType: 'Redeem',
        types: {
          Redeem: [
            { name: 'redeemer', type: 'address' },
            { name: 'token', type: 'address' },
            { name: 'clrusdAmount', type: 'uint256' },
            { name: 'receiver', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        message: {
          redeemer: owner,
          token: config.usdcAddress,
          clrusdAmount: amount.toString(),
          receiver: owner,
          nonce: nonce.toString(),
          deadline,
        },
      },
      submit: {
        redeemer: owner,
        token: config.usdcAddress,
        clrusdAmount: amount.toString(),
        receiver: owner,
        deadline,
      },
    };
  }
}

export const savingsGaslessService = new SavingsGaslessService();
