import { describe, expect, test } from 'bun:test';
import type { ActivityItem } from '@/hooks/useClearTransactions';
import type { ChargePayment } from '@/utils/apiClient';
import { mergedActivityRows } from './activityMapping';

/*
 * Paying a shop now is two USDC transfers in one transaction (the shop's share and Clear's fee), and
 * a refund two more back. Activity shows what the member did: paid Mike's Tire $940, once.
 */

const WALLET = '0xaaa';
const PAY = '0xpaytx';
const item = (id: string, amount: number, ts: number): ActivityItem => ({
  id: `${WALLET}:${id}`,
  name: amount < 0 ? 'Sent USDC' : 'Received USDC',
  category: 'Transfer' as ActivityItem['category'],
  date: 'Sep 26',
  ts,
  amount,
  status: 'completed' as ActivityItem['status'],
  source: WALLET,
  internal: false,
  spendCategory: 'Misc',
});
const payment = (over: Partial<ChargePayment> = {}): ChargePayment => ({
  code: 'ABCD1234',
  merchantName: 'Mike’s Tire',
  amountCents: 94_000,
  status: 'approved',
  paidAt: '2026-09-26T21:16:00Z',
  txHash: PAY,
  refundTxHashes: [],
  ...over,
});

describe('a shop paid now is one row in Activity', () => {
  const t = Date.parse('2026-09-26T21:16:00Z');
  const transfers = [item(`${PAY}-3`, -928.25, t), item(`${PAY}-4`, -11.75, t), item('0xother-1', -20, t - 1000)];

  test('the two transfers fold into one payment, named for the shop, for the whole amount', () => {
    const rows = mergedActivityRows(transfers, [], undefined, [], [payment()]);
    expect(rows.map((r) => [r.name, r.amount])).toEqual([
      ['Mike’s Tire', -940],
      ['Sent USDC', -20],
    ]);
    expect(rows[0]).toMatchObject({ kind: 'spending', paidFromLabel: 'Ready to allocate', status: 'Paid now' });
  });

  test('a refund is one row too, when its money is seen coming back', () => {
    const later = t + 86_400_000;
    const rows = mergedActivityRows(
      [...transfers, item('0xrefshop-1', 928.25, later), item('0xrefclear-1', 11.75, later)],
      [],
      undefined,
      [],
      [payment({ status: 'refunded', refundTxHashes: ['0xrefshop', '0xrefclear'] })],
    );
    expect(rows.map((r) => [r.name, r.amount, r.status])).toEqual([
      ['Refund from Mike’s Tire', 940, 'Refunded'],
      ['Mike’s Tire', -940, 'Refunded'],
      ['Sent USDC', -20, undefined],
    ]);
  });

  test('without any charge payments, the feed is as it was', () => {
    expect(mergedActivityRows(transfers, [], undefined, []).map((r) => r.name)).toEqual(['Sent USDC', 'Sent USDC', 'Sent USDC']);
  });
});
