import { ethers } from 'ethers';
import { assertCdpNetworkMatches, expectedCdpNetwork } from '../cdpNetworkGuard.js';

/*
 * The payout top-up wallet: a Coinbase CDP server wallet the owner created (PAYOUT_TOPUP_CDP_ACCOUNT_NAME,
 * "payout-topup-base-sepolia" on Base Sepolia), signing the way the savings and send relayers do
 * (savingsRelayerService.ts). It is looked up by name, never created here, and must be the address in
 * PAYOUT_TOPUP_WALLET: the job refuses to send from any other.
 *
 * Credentials are the relayers' (SAVINGS_CDP_*, SEND_CDP_*, or CDP_* API key id, secret and wallet
 * secret). Nothing here reads or holds a private key.
 *
 * `cdpWalletSender` is the same thing for any job's own named wallet: the settlement funding desk
 * (services/settlementFunding/deskCdp.ts) uses it with its own names.
 */

export interface CdpEvm {
  getAccount(options: { name: string }): Promise<{ address: string }>;
  sendTransaction(options: {
    address: string;
    network: string;
    transaction: { to: string; data: string; value: bigint };
    idempotencyKey?: string;
  }): Promise<{ transactionHash: string }>;
}

const first = (env: Record<string, string | undefined>, ...keys: string[]) => keys.map((k) => env[k]?.trim()).find(Boolean) ?? '';

export function topUpAccountName(chainId: number, env: Record<string, string | undefined> = process.env): string {
  return first(env, `PAYOUT_TOPUP_CDP_ACCOUNT_NAME_${chainId}`, 'PAYOUT_TOPUP_CDP_ACCOUNT_NAME') || (chainId === 84532 ? 'payout-topup-base-sepolia' : `payout-topup-chain-${chainId}`);
}

/** What a job's CDP wallet is called, where its overrides live, and how its errors read. */
export interface CdpWalletSpec {
  /** The CDP account's name: looked up, never created. */
  accountName: string;
  /** Env var names for the CDP network, the chain-suffixed one first. */
  networkVars: string[];
  /** The env var holding the wallet's address, for messages. */
  walletVar: string;
  /** "payout top-up wallet", "settlement desk wallet": for messages. */
  label: string;
}

/** Sends from one named CDP server wallet, and only from the address the job was configured with. */
export function cdpWalletSender(chainId: number, wallet: string, spec: CdpWalletSpec, env: Record<string, string | undefined> = process.env, load?: () => Promise<CdpEvm>) {
  let evm: Promise<CdpEvm> | null = null;
  let checked = false;
  const network = first(env, ...spec.networkVars) || expectedCdpNetwork(chainId) || '';
  const client = () =>
    (evm ??= load
      ? load()
      : (async () => {
          const apiKeyId = first(env, 'SAVINGS_CDP_API_KEY_ID', 'SEND_CDP_API_KEY_ID', 'CDP_API_KEY_ID', 'CDP_API_KEY_NAME');
          const apiKeySecret = first(env, 'SAVINGS_CDP_API_KEY_SECRET', 'SEND_CDP_API_KEY_SECRET', 'CDP_API_KEY_SECRET');
          const walletSecret = first(env, 'SAVINGS_CDP_WALLET_SECRET', 'SEND_CDP_WALLET_SECRET', 'CDP_WALLET_SECRET');
          if (!apiKeyId || !apiKeySecret || !walletSecret) throw new Error(`The ${spec.label} needs the CDP credentials (CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET).`);
          const mod = await import('@coinbase/cdp-sdk');
          return new mod.CdpClient({ apiKeyId, apiKeySecret, walletSecret }).evm as unknown as CdpEvm;
        })());

  return {
    network,
    async send(tx: { to: string; data: string }, idempotencyKey: string): Promise<string> {
      if (!network) throw new Error(`No CDP network for chain ${chainId}.`);
      // A testnet chain paired with a mainnet network name would sign on mainnet (cdpNetworkGuard).
      assertCdpNetworkMatches(chainId, network, spec.label);
      const c = await client();
      if (!checked) {
        const account = await c.getAccount({ name: spec.accountName });
        if (ethers.getAddress(account.address) !== ethers.getAddress(wallet)) {
          throw new Error(`The CDP account "${spec.accountName}" is ${account.address}, not ${spec.walletVar} ${wallet}: refusing to send.`);
        }
        checked = true;
      }
      const sent = await c.sendTransaction({ address: ethers.getAddress(wallet), network, transaction: { to: tx.to, data: tx.data, value: 0n }, idempotencyKey });
      const hash = sent.transactionHash?.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) throw new Error('CDP did not return a transaction hash.');
      return hash;
    },
  };
}

export function cdpTopUpSender(chainId: number, wallet: string, env: Record<string, string | undefined> = process.env, load?: () => Promise<CdpEvm>) {
  return cdpWalletSender(
    chainId,
    wallet,
    {
      accountName: topUpAccountName(chainId, env),
      networkVars: [`PAYOUT_TOPUP_CDP_NETWORK_${chainId}`, 'PAYOUT_TOPUP_CDP_NETWORK'],
      walletVar: 'PAYOUT_TOPUP_WALLET',
      label: 'payout top-up wallet',
    },
    env,
    load,
  );
}
