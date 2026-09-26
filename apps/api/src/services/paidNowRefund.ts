import { ethers } from 'ethers';
import { encodeFunctionData, erc20Abi, type Address } from 'viem';
import { chainProvider } from './chain/provider.js';
import { chargeStore, type ChargeRow } from './chargeStore.js';
import { usdcAddressFor } from './savingsGaslessService.js';
import { shopWallet } from './merchant/shopWallet.js';
import type { SettleResult } from './refundSettlement.js';

/*
 * Refunding a charge the member paid now, from their Clear cash.
 *
 * There is no plan to close: the money is in the shop's wallet and in Clear's. So it goes back the
 * way it came, both halves, and the member gets the whole amount:
 *
 *   the shop's share   from the shop's own wallet, sent by Clear's signer on it (shopWallet.ts)
 *   Clear's fee        from Clear's operator wallet: nobody profits from a sale that didn't happen
 *
 * Nothing moves unless both can. The shop's cash and Clear's are read first, and a refund the shop's
 * cash can't cover is refused with the figures, not taken on credit: it waits until the shop adds
 * cash or its next payout lands.
 *
 * Two transfers can't be one transaction here (two different senders), so each is recorded on the
 * charge as it goes: `sending` before, the hash after. A retried refund skips what already went,
 * and one left `sending` (the process died mid-transfer) is never sent again blind: it needs a
 * look, and says so.
 */

const UNITS_PER_CENT = 10_000n;
const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function transfer(address to, uint256 amount) returns (bool)'];
const SENDING = 'sending';

/**
 * The chain, as this module uses it. One object so a test can stand in for the network; nothing
 * else replaces it.
 */
export const refundChain = {
  async receipt(chainId: number, hash: string): Promise<{ status: number } | null> {
    const r = await chainProvider(chainId).getTransactionReceipt(hash);
    return r ? { status: r.status ?? 0 } : null;
  },
  async known(chainId: number, hash: string): Promise<boolean> {
    return Boolean(await chainProvider(chainId).getTransaction(hash));
  },
  async balance(chainId: number, token: string, who: string): Promise<bigint> {
    return new ethers.Contract(token, ERC20, chainProvider(chainId)).balanceOf(who);
  },
  /** Clear's wallet for returning fees: the operator key the server already writes to chain with. */
  clearAddress(): string | null {
    const key = operatorKey();
    return key ? new ethers.Wallet(key).address : null;
  },
  /** Sends from Clear's wallet; `onHash` runs before the wait so a crash leaves the hash behind. */
  async sendFromClear(chainId: number, token: string, to: string, units: bigint, onHash: (hash: string) => Promise<void>): Promise<boolean> {
    const operator = new ethers.Wallet(operatorKey()!, chainProvider(chainId));
    const tx = await (new ethers.Contract(token, ERC20, operator) as ethers.Contract).transfer(to, units);
    await onHash(String(tx.hash).toLowerCase());
    return (await tx.wait())?.status === 1;
  },
  shopWallet,
};

const usd = (units: bigint) => (Number(units) / 1_000_000).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function operatorKey(): string | null {
  const raw = (process.env.CREDIT_OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!raw) return null;
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

/** The two halves of a full refund: what the shop received, and Clear's fee. They add up to the charge. */
export function paidNowRefundLegs(charge: Pick<ChargeRow, 'amountCents' | 'payoutCents'>): { shopCents: number; clearCents: number } {
  const shopCents = Math.min(charge.amountCents, Math.max(0, charge.payoutCents));
  return { shopCents, clearCents: charge.amountCents - shopCents };
}

/**
 * A leg recorded by hash, asked of the chain: landed, failed (so it is sent again), or still going.
 * Returns the charge as it now stands, or a reason to stop.
 */
async function checkLeg(charge: ChargeRow, leg: 'shop' | 'clear'): Promise<ChargeRow | string> {
  const hash = charge.refundLegs[leg];
  if (!hash || hash === SENDING) return charge;
  const receipt = await refundChain.receipt(charge.chainId, hash);
  if (receipt?.status === 1) return charge;
  if (!receipt && (await refundChain.known(charge.chainId, hash))) return 'Part of this refund is still going through. Try again in a minute.';
  // Reverted, or gone from the node: nothing moved, so it can go again.
  await chargeStore.setRefundLeg(charge.code, leg, null, hash);
  return { ...charge, refundLegs: { ...charge.refundLegs, [leg]: null } };
}

export async function settlePaidNowRefund(input: ChargeRow): Promise<SettleResult> {
  if (!input.paidNow || !input.memberWallet) return { ok: false, reason: 'This charge was not paid now.' };
  if (input.refundLegs.shop === SENDING || input.refundLegs.clear === SENDING) {
    return { ok: false, reason: 'Part of this refund may already be on its way. It needs a look before it is tried again.' };
  }
  let charge = input;
  try {
    for (const leg of ['shop', 'clear'] as const) {
      const checked = await checkLeg(charge, leg);
      if (typeof checked === 'string') return { ok: false, reason: checked };
      charge = checked;
    }
  } catch (error) {
    console.error('[refund] paid-now leg check failed for', input.code, error instanceof Error ? error.message : error);
    return { ok: false, reason: 'We couldn’t check the refund just now. Try again in a moment.' };
  }
  const token = usdcAddressFor(charge.chainId);
  if (!token) return { ok: false, reason: 'Refunds are not available on this network.' };
  const clear = refundChain.clearAddress();
  const member = charge.memberWallet as Address;
  const { shopCents, clearCents } = paidNowRefundLegs(charge);
  const shopUnits = BigInt(shopCents) * UNITS_PER_CENT;
  const clearUnits = BigInt(clearCents) * UNITS_PER_CENT;
  const needShop = shopUnits > 0n && !charge.refundLegs.shop;
  const needClear = clearUnits > 0n && !charge.refundLegs.clear;

  // ---- Both halves checked before either moves.
  const shop = needShop ? await refundChain.shopWallet(charge.merchantAddress) : null;
  if (shop && 'error' in shop) return { ok: false, reason: shop.error };
  if (needClear && !clear) return { ok: false, reason: 'Clear can’t return its fee on this server. Nothing was refunded.' };
  try {
    if (shop && !('error' in shop)) {
      const held = await refundChain.balance(charge.chainId, token, shop.address);
      if (held < shopUnits) {
        return {
          ok: false,
          reason: `Your Clear cash holds ${usd(held)}, and this refund needs ${usd(shopUnits)} from it. Add cash, or approve it again after your next payout. Nothing was refunded.`,
        };
      }
    }
    if (needClear && clear) {
      const held = await refundChain.balance(charge.chainId, token, clear);
      if (held < clearUnits) return { ok: false, reason: 'Clear can’t return its fee just now. Nothing was refunded — try again shortly.' };
    }
  } catch (error) {
    console.error('[refund] paid-now balance read failed for', charge.code, error instanceof Error ? error.message : error);
    return { ok: false, reason: 'We couldn’t check the balances just now. Nothing was refunded — try again in a moment.' };
  }

  // ---- The shop's share, from its own wallet.
  if (needShop && shop && !('error' in shop)) {
    if (!(await chargeStore.setRefundLeg(charge.code, 'shop', SENDING, null))) {
      return { ok: false, reason: 'This refund is already being settled.' };
    }
    try {
      const hash = await shop.send(token as Address, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [member, shopUnits] }));
      await chargeStore.setRefundLeg(charge.code, 'shop', hash.toLowerCase(), SENDING);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[refund] shop leg failed for', charge.code, message);
      // Privy saying it failed means nothing left; anything else (not included yet) might have.
      if (/reported the transaction (failed|execution_reverted|provider_error)/.test(message)) {
        await chargeStore.setRefundLeg(charge.code, 'shop', null, SENDING);
        return { ok: false, reason: 'The refund from your Clear cash didn’t go through. Nothing was refunded.' };
      }
      return { ok: false, reason: 'The refund from your Clear cash was sent but hasn’t landed yet. It needs a look before it is tried again.' };
    }
  }

  // ---- Clear's fee, from Clear's wallet.
  if (needClear && clear) {
    if (!(await chargeStore.setRefundLeg(charge.code, 'clear', SENDING, null))) {
      return { ok: false, reason: 'This refund is already being settled.' };
    }
    let hash: string | null = null;
    try {
      const landed = await refundChain.sendFromClear(charge.chainId, token, member, clearUnits, async (h) => {
        hash = h;
        await chargeStore.setRefundLeg(charge.code, 'clear', h, SENDING);
      });
      if (!landed) throw new Error('reverted');
    } catch (error) {
      console.error('[refund] Clear leg failed for', charge.code, error instanceof Error ? error.message : error);
      if (!hash) {
        await chargeStore.setRefundLeg(charge.code, 'clear', null, SENDING);
        return {
          ok: false,
          reason: needShop
            ? 'Your part went back to them; Clear’s fee didn’t yet. Approve it again to finish.'
            : 'Clear’s fee didn’t go back. Approve it again to finish.',
        };
      }
      // Sent, and it didn't confirm here. The hash is on the charge, so trying again asks the chain
      // about it (checkLeg) rather than sending it twice.
      return { ok: false, reason: 'Clear’s part was sent and hasn’t confirmed yet. Approve it again in a minute to finish.' };
    }
  }

  return { ok: true, returnedCents: charge.amountCents, carryWithheldCents: 0 };
}
