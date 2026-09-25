import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (p: string) => readFileSync(join(import.meta.dir, p), 'utf8');

/*
 * The redemption path, checked where it can be without a Privy key and a funded paymaster.
 *
 * What a test here CANNOT do is send a sponsored user operation: that needs Clear's authorization
 * key and a ZeroDev project, neither of which belongs in a test run. What it can do is hold the
 * two promises that failing either of would be worst — a server that is not configured refuses
 * rather than pretending, and a shop is never told money moved when it did not.
 */
describe('redeeming without the configuration to do it', function () {
  test('refuses rather than attempting anything', async function () {
    // The test process has no Privy key, no authorization key and no ZeroDev project.
    const { redemptionConfigured, redemptionGap, redeemForMerchant } = await import('./payoutRedemption.js');
    expect(redemptionConfigured()).toBe(false);
    expect(redemptionGap()).toBeTruthy();

    const result = await redeemForMerchant({
      merchant: '0xA7193395Fab6cCd29a43e04148f270a6aE2FFd31',
      amountMicros: 97_500_000n,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(redemptionGap()!);
  });
});

describe('what the code promises in its own text', function () {
  const service = source('payoutRedemption.ts');
  // How it sends from the shop's wallet, shared with the monthly fee bill.
  const wallet = source('shopWallet.ts');
  const route = source('../../routes/merchant.ts');

  test('approves only when the allowance is short, then redeems', function () {
    // Both are sponsored, so two transactions cost the shop nothing — and staying on
    // `eth_sendTransaction` keeps them inside the policy that bounds Clear's signer, which a
    // batched `wallet_sendCalls` would fall outside.
    expect(service).toContain("functionName: 'approve'");
    expect(service).toContain("functionName: 'redeem'");
    expect(service).toContain('if (allowance < amount)');
  });

  test('lets Privy pay the gas rather than a paymaster of ours', function () {
    // The whole of the gasless story is this flag. An earlier version built 7702 delegation, a
    // Kernel account and a paymaster to achieve what it does.
    expect(service).toContain('shopWallet(input.merchant)');
    expect(wallet).toContain('sponsor: true');
    expect(service + wallet).not.toContain('zerodev');
  });

  test('redeems at the merchant address rather than a new one', function () {
    // The shop's own wallet sends it. The registry entry, the credits, the claim and the cash
    // account are one address by construction, and nothing here introduces a second.
    expect(wallet).toContain('getWalletByAddress');
    expect(wallet).toContain('org.walletAddress');
  });

  test('records a redemption only when it worked', function () {
    // The failure branch must not touch the payout row: a request nobody settled is the truth, and
    // the old code's whole discipline was never claiming money had moved.
    const withdraw = route.slice(route.indexOf("'/payouts/withdraw'"), route.indexOf("'/payouts/redeem'"));
    expect(withdraw).toContain('if (redemption.ok)');
    expect(withdraw).toContain('recordRedemption');
    expect(withdraw).toContain(
      "status: redemption?.ok && redemption.paidNow && destination === 'cash' ? 'paid' : 'requested'",
    );
  });

  test('calls a bank-bound withdrawal paid only when the bank leg exists, which it does not', function () {
    /*
     * Redemption puts USDC in the shop's own wallet, which IS the cash account — the same address
     * by construction. The hop from there to a bank is an off-ramp nothing here performs, so a
     * bank-bound withdrawal that redeemed is one hop done out of two. Saying "paid" would be the
     * exact overclaim the old request-only code was careful never to make.
     */
    const withdraw = route.slice(route.indexOf("'/payouts/withdraw'"), route.indexOf("'/payouts/redeem'"));
    expect(withdraw).toContain("destination === 'cash' ? 'paid' : 'requested'");
    expect(withdraw).toContain('inCashAccount: redemption.paidNow');
  });

  test('only redeems money that is owed, never the cash account', function () {
    // Cash-account money is already the shop's and has no claim to redeem. Redeeming against it
    // would take credits for money they already hold.
    expect(route).toContain("if (source === 'owed' && redemptionConfigured())");
  });
});
