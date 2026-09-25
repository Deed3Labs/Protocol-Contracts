import { PrivyClient } from '@privy-io/node';
import { createPublicClient, http, type Address, type Chain, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { chainId } from '../chargeService.js';
import { merchantOrgFor } from './privyOrg.js';

/*
 * Sending from a shop's own wallet as Clear's signer, with Privy paying the gas. Shared by the
 * payout redemption (payoutRedemption.ts) and the monthly fee bill (fees/privyFeeCollector.ts).
 *
 * **Privy sponsors the gas.** `sponsor: true` on the wallet's own RPC: no paymaster of ours, no
 * bundler. Clear is an authorized signer on the shop's wallet (privySigner.ts), under a policy that
 * names `eth_sendTransaction`, so each call is one plain transaction rather than a batch the policy
 * doesn't cover.
 */

const APP_ID = (process.env.PRIVY_APP_ID || '').trim();
const APP_SECRET = (process.env.PRIVY_APP_SECRET || '').trim();
const AUTHORIZATION_PRIVATE_KEY = (process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || '').trim();

export const CHAINS: Record<number, Chain> = { 8453: base, 84532: baseSepolia };

let client: PrivyClient | null = null;
function privy(): PrivyClient | null {
  if (!APP_ID || !APP_SECRET) return null;
  if (!client) client = new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET });
  return client;
}

/** Why Clear can't send from a shop's wallet on this server, or null when it can. */
export function shopWalletGap(): string | null {
  if (!privy()) return 'Privy is not configured on this server.';
  if (!AUTHORIZATION_PRIVATE_KEY) return "Clear's signing key is not configured on this server.";
  if (!CHAINS[chainId()]) return `No chain configuration for ${chainId()}.`;
  return null;
}

export interface ShopWallet {
  address: Address;
  chain: Chain;
  publicClient: PublicClient;
  /** Sends one transaction from the shop's wallet and follows it to a hash. Throws if it fails. */
  send(to: Address, data: `0x${string}`): Promise<`0x${string}`>;
}

/** The shop's wallet, ready to send from; or why not, in words a shop can be told. */
export async function shopWallet(merchant: string): Promise<ShopWallet | { error: string }> {
  const gap = shopWalletGap();
  if (gap) return { error: gap };
  const p = privy()!;
  const chain = CHAINS[chainId()]!;

  const org = await merchantOrgFor(merchant);
  if (!org) return { error: 'This shop has no wallet on file.' };

  // By address, not by the id we stored: a stale `privy_wallet_id` is a 404 that would read as a
  // shop with no wallet at all.
  const wallet = await p
    .wallets()
    .getWalletByAddress({ address: org.walletAddress })
    .catch(() => null);
  if (!wallet) return { error: 'Privy has no wallet at this shop’s address.' };

  const caip2 = `eip155:${chain.id}` as const;

  /*
   * A sponsored send is a user operation, not a transaction, and it comes back saying so:
   *
   *   { hash: "", user_operation_hash: "0x…", sponsorship_provider: "alchemy", transaction_id: "…" }
   *
   * There is no transaction hash yet because a bundler has not yet included it. So this follows
   * the `transaction_id` until Privy reports one, rather than reading `hash` and finding an empty
   * string — which an earlier version of this did, and would have failed on every sponsored send
   * while looking like a chain problem.
   *
   * What the receipt shows afterwards is worth recording: the wallet is EIP-7702 delegated by
   * Privy, and the user operation's sender is the merchant's own address. So the contract sees the
   * merchant as msg.sender, which is the entire reason this address can be the shop everywhere.
   */
  const settle = async (transactionId: string): Promise<`0x${string}`> => {
    for (let i = 0; i < 40; i++) {
      const tx = await p.transactions().get(transactionId);
      if (tx.transaction_hash) return tx.transaction_hash as `0x${string}`;
      if (tx.status === 'failed' || tx.status === 'execution_reverted' || tx.status === 'provider_error') {
        throw new Error(`Privy reported the transaction ${tx.status}.`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('The transaction was accepted but has not been included yet.');
  };

  const send = async (to: Address, data: `0x${string}`) => {
    const result = (await p.wallets().ethereum().sendTransaction(wallet.id, {
      caip2,
      params: { transaction: { to, data, chain_id: chain.id } },
      // The whole of the gasless story. Privy's own sponsorship, configured in their dashboard,
      // rather than a paymaster of ours to keep funded.
      sponsor: true,
      authorization_context: { authorization_private_keys: [AUTHORIZATION_PRIVATE_KEY] },
    } as never)) as { hash?: string; transaction_id?: string };
    if (result.hash) return result.hash as `0x${string}`;
    if (!result.transaction_id) throw new Error('Privy returned neither a hash nor a transaction to follow.');
    return settle(result.transaction_id);
  };

  return {
    address: wallet.address as Address,
    chain,
    publicClient: createPublicClient({ chain, transport: http() }) as PublicClient,
    send,
  };
}
