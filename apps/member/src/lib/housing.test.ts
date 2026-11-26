import { describe, expect, test } from 'bun:test';
import { encodeFunctionData, parseAbi } from 'viem';
import { contributeMismatch, creditRoom, housingFrom, pickHome, priceShares, redeemMismatch, redeemableNow, usdUnits } from './housing';
import { savingsTotal } from './clearModel';
import type { HousingHomeRecord, RedeemTypedData } from '@/utils/apiClient';

/*
 * The Housing Allowance on Savings: which record is shown, what can be redeemed, and the checks that
 * stop the phone signing or sending anything that is not what the sheet shows.
 */

const M = '0x00000000000000000000000000000000000000a1';
const ISSUER = '0xd254Bd2C78791a666eEfC4A7B6163d5d47C842a3';
const RECORD = '0x26D8540881249bcD253810aBC2242b5a572729B5';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const NOW = 1_790_000_000;

const rec = (over: Partial<HousingHomeRecord>): HousingHomeRecord => ({
  homeId: '12',
  status: 'signed',
  structurePrice: 250_000,
  creditPortion: 3_250,
  memberPortion: 18_400,
  total: 21_650,
  refundDue: 0,
  signedAt: '2026-11-01T00:00:00.000Z',
  endedAt: null,
  live: true,
  redeemable: false,
  payable: true,
  ...over,
});

describe('which record Savings shows', () => {
  test('the live one, named from the books, else its deed number', () => {
    const read = { member: M, homes: [rec({ homeId: '9', status: 'ended', live: false, signedAt: '2026-12-01T00:00:00.000Z' }), rec({})], creditPortionUsed: 3250, creditPortionCap: 54000 };
    expect(pickHome(read, '14 Alder Way')).toMatchObject({ homeId: '12', name: '14 Alder Way' });
    expect(pickHome({ ...read, homes: [rec({ live: false, status: 'moved' })] })?.name).toBe('Home #12');
    expect(pickHome(null)).toBeNull();
  });

  test('credits to redeem stop at the limit left', () => {
    const h = housingFrom({ member: M, homes: [rec({})], creditPortionUsed: 53_800, creditPortionCap: 54_000 }, { balance: 1_240, earned: 15_240, bySource: { saving: 0, rent: 0, bill: 0 } });
    expect(creditRoom(h)).toBe(200);
    expect(redeemableNow(h)).toBe(200);
    expect(h.member).toBe(M);
  });

  test('the bar splits the price between the two parts and never passes 100%', () => {
    expect(priceShares({ creditPortion: 25_000, memberPortion: 50_000, structurePrice: 250_000 })).toEqual({ credits: 10, money: 20 });
    expect(priceShares({ creditPortion: 54_000, memberPortion: 300_000, structurePrice: 250_000 })).toEqual({ credits: 21.6, money: 78.4 });
  });
});

describe('a redemption is signed only as the sheet shows it', () => {
  const td = (over: Partial<RedeemTypedData['message']> = {}, domain: Partial<RedeemTypedData['domain']> = {}): RedeemTypedData => ({
    domain: { name: 'Clear Credits', version: '1', chainId: 84532, verifyingContract: ISSUER, ...domain },
    types: { RedeemCredits: [] },
    primaryType: 'RedeemCredits',
    message: { member: M, homeId: '12', amount: (500n * 1_000_000n).toString(), nonce: '3', deadline: String(NOW + 1800), ...over },
  });
  const check = (typedData: RedeemTypedData) =>
    redeemMismatch({ typedData, shown: { member: M, homeId: '12', credits: 500 }, expected: { chainId: 84532, pointsIssuer: ISSUER }, nowSeconds: NOW });

  test('this member, this home, this many credits, this network and Points Issuer', () => {
    expect(check(td())).toBeNull();
    expect(check(td({ member: '0x00000000000000000000000000000000000000b2' }))).toBe('wrong account');
    expect(check(td({ homeId: '13' }))).toBe('wrong home');
    expect(check(td({ amount: (5000n * 1_000_000n).toString() }))).toBe('wrong amount');
    expect(check(td({}, { chainId: 8453 }))).toBe('wrong network');
    expect(check(td({}, { verifyingContract: RECORD }))).toBe('wrong contract');
    expect(check(td({}, { name: 'Something else' }))).toBe('wrong signing domain');
  });

  test('a deadline already past, or far off, is refused', () => {
    expect(check(td({ deadline: String(NOW - 1) }))).toBe('wrong deadline');
    expect(check(td({ deadline: String(NOW + 86_400) }))).toBe('wrong deadline');
  });
});

describe('a payment is sent only as the sheet shows it', () => {
  const abi = parseAbi(['function approve(address spender, uint256 amount)', 'function contribute(uint256 homeId, uint256 amount)']);
  const units = usdUnits(500);
  const calls = (o: { spender?: string; approveTo?: string; amount?: bigint; homeId?: bigint; to?: string } = {}) => [
    { to: o.approveTo ?? USDC, value: '0', data: encodeFunctionData({ abi, functionName: 'approve', args: [(o.spender ?? RECORD) as `0x${string}`, o.amount ?? units] }), label: '' },
    { to: o.to ?? RECORD, value: '0', data: encodeFunctionData({ abi, functionName: 'contribute', args: [o.homeId ?? 12n, o.amount ?? units] }), label: '' },
  ];
  const check = (c: ReturnType<typeof calls>) => contributeMismatch({ calls: c, shown: { homeId: '12', units }, expected: { usdc: USDC, record: RECORD } });

  test('approve the record for exactly the amount, then contribute it to this home', () => {
    expect(usdUnits(500)).toBe(500_000_000n);
    expect(usdUnits(1250.5)).toBe(1_250_500_000n);
    expect(check(calls())).toBeNull();
    expect(check(calls({ spender: M }))).toBe('wrong spender');
    expect(check(calls({ amount: units * 2n }))).toBe('wrong amount');
    expect(check(calls({ homeId: 13n }))).toBe('wrong home');
    expect(check(calls({ to: M }))).toBe('wrong contract');
    expect(check(calls().slice(0, 1))).toBe('unexpected calls');
  });
});

test('Savings is the cash in it: credits are never added as money', () => {
  expect(savingsTotal({ cash: 1500, vested: 1000, vesting: 500, credits: 1500, creditsGoal: 15000 } as Parameters<typeof savingsTotal>[0])).toBe(1500);
});
