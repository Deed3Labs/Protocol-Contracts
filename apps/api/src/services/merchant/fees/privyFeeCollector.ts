import { encodeFunctionData, isAddress, type Address } from 'viem';
import { chainId } from '../../chargeService.js';
import { USDC } from '../cashAccount.js';
import { shopWallet, shopWalletGap } from '../shopWallet.js';
import type { FeeCollector } from './feeBilling.js';

/*
 * Collects Clear's monthly fee bill as USDC from the shop's own wallet (its cash account), sent by
 * Clear's signer on that wallet with Privy paying the gas (shopWallet.ts). The same signer and
 * policy the owner granted at onboarding; a plain ERC-20 transfer carries no native value, so it
 * sits inside the policy's ceiling.
 *
 * **Off until it's switched on.** Null (no collector) unless CLEAR_FEE_COLLECTION_ADDRESS names
 * where Clear's fees go and the wallet plumbing is configured. Bills are still raised and shown
 * without it; they wait as `due`. Switch it on only once the merchant agreement covers taking the
 * fee this way.
 */

const ERC20 = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/** Why fee bills can't be collected on this server, or null when they can. */
export function feeCollectionGap(): string | null {
  const to = (process.env.CLEAR_FEE_COLLECTION_ADDRESS || '').trim();
  if (!to) return 'CLEAR_FEE_COLLECTION_ADDRESS is not set on this server.';
  if (!isAddress(to)) return 'CLEAR_FEE_COLLECTION_ADDRESS is not an address.';
  if (!USDC[chainId()]) return `No USDC on chain ${chainId()}.`;
  return shopWalletGap();
}

export function privyFeeCollector(): FeeCollector | null {
  if (feeCollectionGap()) return null;
  const to = process.env.CLEAR_FEE_COLLECTION_ADDRESS!.trim() as Address;
  const usdc = USDC[chainId()]! as Address;
  return {
    async collect({ merchant, amountCents }) {
      const wallet = await shopWallet(merchant);
      if ('error' in wallet) return { ok: false, short: false, reason: wallet.error };
      // USDC is 6dp; a cent is 10,000 of its units.
      const amount = BigInt(amountCents) * 10_000n;
      const held = await wallet.publicClient.readContract({ address: usdc, abi: ERC20, functionName: 'balanceOf', args: [wallet.address] });
      if (held < amount) return { ok: false, short: true, reason: `The cash account holds ${held / 10_000n} cents of the ${amountCents} due` };

      // From here a failure is thrown, not returned: the transfer may have gone.
      const hash = await wallet.send(usdc, encodeFunctionData({ abi: ERC20, functionName: 'transfer', args: [to, amount] }));
      const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`The fee transfer ${hash} reverted`);
      return { ok: true, txHash: hash };
    },
  };
}
