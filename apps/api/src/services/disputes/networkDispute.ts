import { getLithic } from '../lithic/lithicClient.js';

/*
 * Opening a card dispute with the network, through Lithic (POST /v1/disputes).
 *
 * The reason is one of Lithic's codes, chosen by the member from plain words — "charged twice" is
 * DUPLICATED — because the network decides on the reason, and a free-text note alone would go in as
 * OTHER and be weaker for it. The member's own words go in `customer_note`.
 *
 * Never throws. A dispute Lithic would not open is still a dispute we hold, so the caller gets the
 * error back to keep beside it and tell the member.
 */

export const CARD_REASONS = {
  wrong_amount: 'INCORRECT_AMOUNT',
  charged_twice: 'DUPLICATED',
  not_received: 'GOODS_SERVICES_NOT_RECEIVED',
  not_as_described: 'GOODS_SERVICES_NOT_AS_DESCRIBED',
  other: 'OTHER',
} as const;

export type CardReason = keyof typeof CARD_REASONS;

export function isCardReason(value: unknown): value is CardReason {
  return typeof value === 'string' && value in CARD_REASONS;
}

export async function openCardDispute(input: {
  transactionToken: string;
  amountCents: number;
  reason: CardReason;
  note: string;
}): Promise<{ disputeToken: string; status: string } | { error: string }> {
  const lithic = getLithic();
  if (!lithic) return { error: 'Cards are not connected, so the card network was not told.' };
  try {
    const dispute = await lithic.disputes.create({
      transaction_token: input.transactionToken,
      amount: input.amountCents,
      reason: CARD_REASONS[input.reason],
      customer_filed_date: new Date().toISOString(),
      customer_note: input.note.slice(0, 1000),
    });
    return { disputeToken: dispute.token, status: String(dispute.status ?? 'NEW') };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[disputes] Lithic would not open the dispute:', message);
    return { error: message };
  }
}
