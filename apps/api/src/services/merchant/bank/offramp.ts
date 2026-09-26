import { randomUUID } from 'node:crypto';
import { encodeFunctionData, erc20Abi, type Address } from 'viem';
import type { Queryable } from '../../../db/db.js';
import { bridge } from '../../billerPayoutService.js';
import { chainId } from '../../chargeService.js';
import { USDC } from '../cashAccount.js';
import { shopWallet } from '../shopWallet.js';
import { audit } from '../security/audit.js';

/**
 * Withdrawing to a bank: the second hop of a bank-bound withdrawal, after what Clear owes has
 * settled into the shop's cash account (its wallet's USDC).
 *
 * Bridge is asked for a transfer (USDC on Base from the shop's wallet, dollars by ACH to the linked
 * bank); it answers with where to send the USDC; the shop's wallet sends it, signed by Clear's key
 * on the wallet (the same signer the redemption uses); Bridge pays the bank. Standard ACH is free
 * and takes 1–3 business days; same-day ACH carries Clear's 1% (Bridge's developer fee), as the
 * member app's cash-out does.
 *
 * Nothing is sent until Bridge has answered, and a transfer Bridge made but the wallet couldn't fund
 * is recorded as such (Bridge cancels an unfunded transfer). The shop is never told money moved
 * when it didn't.
 */

export type Speed = 'standard' | 'same_day';

export const SAME_DAY_FEE_PERCENT = Number(process.env.BRIDGE_INSTANT_WITHDRAW_FEE_PERCENT || '1');

/** Clear's fee on a withdrawal, in cents: none standard; the percentage same-day, rounded up. */
export const feeCents = (amountCents: number, speed: Speed) => (speed === 'same_day' ? Math.ceil((amountCents * SAME_DAY_FEE_PERCENT) / 100) : 0);

/** Bridge and the shop's wallet, as the off-ramp uses them: swapped for stand-ins in tests. */
export interface OfframpDeps {
  createTransfer(input: {
    idempotencyKey: string;
    customerId: string;
    externalAccountId: string;
    fromAddress: string;
    amountCents: number;
    speed: Speed;
  }): Promise<{ id: string; state: string; toAddress: string; amountMicros: bigint } | { error: string }>;
  /** The shop's wallet address, and a way to send USDC from it; an error when it can't sign here. */
  wallet(merchant: string): Promise<{ address: string; sendUsdc(to: string, micros: bigint): Promise<string> } | { error: string }>;
}

export function liveOfframp(): OfframpDeps {
  return {
    async createTransfer(input) {
      const r = await bridge<{ id?: string; state?: string; source_deposit_instructions?: { to_address?: string; amount?: string } }>('/transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': input.idempotencyKey },
        body: JSON.stringify({
          amount: (input.amountCents / 100).toFixed(2),
          on_behalf_of: input.customerId,
          ...(input.speed === 'same_day' ? { developer_fee_percent: String(SAME_DAY_FEE_PERCENT) } : {}),
          source: { payment_rail: 'base', currency: 'usdc', from_address: input.fromAddress },
          destination: { payment_rail: input.speed === 'same_day' ? 'ach_same_day' : 'ach', currency: 'usd', external_account_id: input.externalAccountId },
        }),
      });
      const di = r.data?.source_deposit_instructions;
      if (!r.ok || !r.data?.id || !di?.to_address || !di.amount) return { error: r.message || 'Bridge didn’t set up the transfer.' };
      return { id: r.data.id, state: r.data.state ?? 'awaiting_funds', toAddress: di.to_address, amountMicros: BigInt(Math.round(Number(di.amount) * 1_000_000)) };
    },
    async wallet(merchant) {
      const w = await shopWallet(merchant);
      if ('error' in w) return w;
      const usdc = USDC[chainId()];
      if (!usdc) return { error: 'No USDC on this chain.' };
      return {
        address: w.address,
        sendUsdc: async (to, micros) => {
          const hash = await w.send(usdc as Address, encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to as Address, micros] }));
          await w.publicClient.waitForTransactionReceipt({ hash });
          return hash;
        },
      };
    },
  };
}

export interface BankWithdrawal {
  id: string;
  state: string;
  feeCents: number;
  /** Why it hasn't gone, when it hasn't. */
  note: string | null;
}

/**
 * Send `amountCents` of the shop's cash account to its linked bank. The row is written first, so
 * whatever happens next is on the record; the transfer is keyed to it, so a retry can't send twice.
 */
export async function withdrawToBank(
  q: Queryable,
  deps: OfframpDeps,
  input: { merchant: string; staffId: string; bankAccountId: string; amountCents: number; speed: Speed },
): Promise<BankWithdrawal> {
  const { rows: bank } = await q.query<{ external_account_id: string; bridge_customer_id: string | null; mask: string }>(
    `SELECT b.external_account_id, p.bridge_customer_id, b.mask FROM merchant.bank_accounts b JOIN merchant.profiles p ON p.merchant = b.merchant
      WHERE b.id = $1 AND b.merchant = $2 AND b.removed_at IS NULL`,
    [input.bankAccountId, input.merchant],
  );
  const b = bank[0];
  if (!b || !b.bridge_customer_id) return { id: '', state: 'refused', feeCents: 0, note: 'Choose a bank linked in Where withdrawals go.' };
  const fee = feeCents(input.amountCents, input.speed);
  const id = `bwd_${randomUUID()}`;
  await q.query(
    `INSERT INTO merchant.bank_withdrawals (id, merchant, bank_account_id, amount_cents, fee_cents, speed, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, input.merchant, input.bankAccountId, input.amountCents, fee, input.speed, input.staffId],
  );
  const stop = async (state: string, note: string, extra: { transferId?: string; txHash?: string } = {}) => {
    await q.query('UPDATE merchant.bank_withdrawals SET state = $2, note = $3, bridge_transfer_id = COALESCE($4, bridge_transfer_id), tx_hash = COALESCE($5, tx_hash), updated_at = now() WHERE id = $1', [
      id,
      state,
      note,
      extra.transferId ?? null,
      extra.txHash ?? null,
    ]);
    return { id, state, feeCents: fee, note };
  };

  const wallet = await deps.wallet(input.merchant);
  if ('error' in wallet) return stop('requested', `Recorded; it goes to the bank once Clear can sign for the shop’s wallet (${wallet.error})`);
  const transfer = await deps.createTransfer({ idempotencyKey: id, customerId: b.bridge_customer_id, externalAccountId: b.external_account_id, fromAddress: wallet.address, amountCents: input.amountCents, speed: input.speed });
  if ('error' in transfer) return stop('refused', `Bridge didn’t take it: ${transfer.error}. Nothing left the cash account.`);
  let txHash: string;
  try {
    txHash = await wallet.sendUsdc(transfer.toAddress, transfer.amountMicros);
  } catch (e) {
    console.error('[bank withdrawal] funding failed', e instanceof Error ? e.message : e);
    return stop('unfunded', 'The cash account couldn’t send it just now. Nothing left it; Bridge cancels the transfer.', { transferId: transfer.id });
  }
  await q.query(`UPDATE merchant.bank_withdrawals SET state = 'sent', bridge_transfer_id = $2, tx_hash = $3, updated_at = now() WHERE id = $1`, [id, transfer.id, txHash]);
  await audit(q, {
    merchant: input.merchant,
    actor: input.staffId,
    action: 'bank.withdrawal_sent',
    ref: { type: 'bank_withdrawal', id },
    amountCents: input.amountCents,
    detail: { speed: input.speed, feeCents: fee, mask: b.mask, transfer: transfer.id, txHash },
  });
  return { id, state: 'sent', feeCents: fee, note: null };
}
