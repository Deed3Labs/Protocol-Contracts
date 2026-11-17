import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('./usdcRepaymentService.ts', import.meta.url), 'utf8');
const deposits = readFileSync(new URL('../deposits/depositReceiptService.ts', import.meta.url), 'utf8');
const settle = readFileSync(new URL('./cardSettlementService.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../routes/credit.ts', import.meta.url), 'utf8');

describe('a USDC repayment is recorded from the chain, never from the request', () => {
  test('the amount is read from the transaction’s own events, for this member only', () => {
    expect(service).toContain("parsed?.name === 'CreditBalanceRepaid' && String(parsed.args.member).toLowerCase() === wallet");
    expect(service).toContain("parsed?.name === 'TierRepaid' && String(parsed.args.member).toLowerCase() === wallet");
    expect(route).not.toMatch(/req\.body\?\.amount/);
    expect(route).toContain("requireWalletMatch(req, res, wallet, 'wallet')");
  });

  test('a failed or foreign transaction records nothing', () => {
    expect(service).toContain("if (receipt.status !== 1) return { ok: false");
    expect(service).toContain("if (total === 0n) return { ok: false");
  });

  test('only what the card tiers absorbed reaches the card books, carry first', () => {
    // An ordinary repayment (nothing from savings) is carry first, then the dearest tier.
    expect(deposits).toContain('input.revolvingCents - toSavings,');
    expect(deposits).toContain('toSavings > 0 ? 0 : await readCarryOwed(client, wallet),');
  });

  test('once per transaction', () => {
    expect(deposits).toContain('ON CONFLICT (tx_hash) DO NOTHING');
    expect(deposits).toContain('return { recorded: false, duplicate: true, plan: null };');
  });

  test('it counts as cleared, so it is not read as carry', () => {
    expect(settle).toContain('const cleared = netted + repaidInUsdc;');
  });
});

describe('no deposit pays card debt on arrival (Phase 2b, 12.2)', () => {
  test('only auto-clear, on a Spendable deposit, touches the line; OFF and Bridge change nothing', () => {
    expect(deposits).toContain("new Set<DepositRail>(['lithic_ach'])");
    expect(deposits).toContain('if (!AUTO_CLEAR_RAILS.has(input.rail) || !input.autoClearOn) return { paysTermDue: false, earmarkCents: 0 };');
  });
});

describe('a repayment out of savings settles the savings tier in the books, as it did on chain', () => {
  test('SettledFromSavings from the Liquidator, for this member, goes straight to savings', () => {
    expect(service).toContain("parsed?.name === 'SettledFromSavings' && String(parsed.args.member).toLowerCase() === wallet");
    expect(deposits).toContain("[{ tier: 'savings', amountCents: toSavings }, ...rest.settlements]");
  });
});

describe('a savings-funded repayment is paid from savings in the books, not from cash', () => {
  test('the counter account is member_savings when the savings tier was settled from savings', () => {
    expect(deposits).toContain("fundedFromSavings > 0 && settlement.tier === 'savings' ? 'member_savings' : input.method === 'auto' ? 'member_cash_fiat' : 'member_cash_usdc'");
  });
});
