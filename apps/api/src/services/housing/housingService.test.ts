import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { HousingError, housingTotals, parseHomeId, prepareContribute, prepareRedeem, readHousing, submitRedeem, ISSUER_REDEEM_ABI, RECORD_ABI, type HousingChain } from './housingService';
import type { Simulation } from '../chain/keeperKit';

/*
 * A member's Housing Allowance against a stand-in chain: what is read, what the member is asked to
 * sign, what their wallet is asked to send, and what is refused before it reaches the chain.
 */

const M = '0x00000000000000000000000000000000000000a1';
const OTHER = '0x00000000000000000000000000000000000000b2';
const PAYEE = '0x00000000000000000000000000000000000000c3';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const U = 1_000_000n;
const issuerIface = new ethers.Interface(ISSUER_REDEEM_ABI as unknown as string[]);
const recordIface = new ethers.Interface(RECORD_ABI as unknown as string[]);

function fake(over: Partial<HousingChain> = {}, sim: Simulation = { kind: 'ok', returnData: issuerIface.encodeFunctionResult('redeem', [500n * U]) }) {
  const sent: string[] = [];
  const records: Record<string, any> = {
    '12': { creditPortion: 1_000n * U, memberPortion: 4_000n * U, structurePrice: 250_000n * U, refundDue: 0n, signedAt: 1_780_000_000n, endedAt: 0n, status: 1 },
    '9': { creditPortion: 0n, memberPortion: 0n, structurePrice: 200_000n * U, refundDue: 300n * U, signedAt: 1_770_000_000n, endedAt: 1_775_000_000n, status: 4 },
  };
  const chain: HousingChain = {
    chainId: 84532,
    record: '0x26D8540881249bcD253810aBC2242b5a572729B5',
    issuer: '0xd254Bd2C78791a666eEfC4A7B6163d5d47C842a3',
    homesOf: async (m) => (m === M ? [9n, 12n] : []),
    allRecords: async () => [{ member: M, homeId: 9n }, { member: M, homeId: 12n }],
    holdSeconds: async () => 730n * 86_400n,
    recordOf: async (m, id) => (m === M ? records[id.toString()] : undefined) ??{ creditPortion: 0n, memberPortion: 0n, structurePrice: 0n, refundDue: 0n, signedAt: 0n, endedAt: 0n, status: 0 },
    occupantOf: async (id) => (id === 12n ? M : ethers.ZeroAddress),
    payeeOf: async (id) => (id === 12n ? PAYEE : ethers.ZeroAddress),
    isRedeemable: async () => false,
    lifetimeCreditPortion: async () => 1_000n * U,
    creditCap: async () => 54_000n * U,
    usdc: async () => USDC,
    nonces: async () => 3n,
    quote: async (_m, amount) => amount, // 1 credit = $1
    creditBalance: async () => 2_000n * U,
    relayer: {
      from: '0x8801',
      simulate: async () => sim,
      send: async (c) => {
        sent.push(c.data);
        return { hash: '0xfeed', logs: [], status: 1 };
      },
    },
    now: () => 1_790_000_000,
    ...over,
  };
  return { chain, sent };
}

describe('Housing Allowance reads', () => {
  test('every home the member has a record on, in dollars', async () => {
    const v = await readHousing(fake().chain, M);
    expect(v.creditPortionUsed).toBe(1000);
    expect(v.creditPortionCap).toBe(54000);
    expect(v.homes.map((h) => [h.homeId, h.status, h.live, h.payable])).toEqual([
      ['9', 'ended', false, false],
      ['12', 'signed', true, true],
    ]);
    expect(v.homes[1]).toMatchObject({ structurePrice: 250000, creditPortion: 1000, memberPortion: 4000, total: 5000, redeemable: false });
    expect(v.homes[0].refundDue).toBe(300);
  });

  test('a home id is a positive whole number', () => {
    expect(parseHomeId('12')).toBe(12n);
    for (const bad of ['0', '-1', 'abc', '1.5', '']) expect(() => parseHomeId(bad)).toThrow(HousingError);
  });
});

describe('redeeming credits', () => {
  test('the member signs RedeemCredits on the Points Issuer’s domain, with their nonce and a deadline', async () => {
    const r = await prepareRedeem(fake().chain, M, 12n, 500);
    expect(r.usd).toBe(500);
    expect(r.typedData.domain).toEqual({ name: 'Clear Credits', version: '1', chainId: 84532, verifyingContract: '0xd254Bd2C78791a666eEfC4A7B6163d5d47C842a3' });
    expect(r.typedData.message).toEqual({ member: M, homeId: '12', amount: (500n * U).toString(), nonce: '3', deadline: String(1_790_000_000 + 1800) });
  });

  test('the digest a wallet signs is the one the contract checks', async () => {
    const r = await prepareRedeem(fake().chain, M, 12n, 500);
    const w = ethers.Wallet.createRandom();
    const { types, domain, message } = r.typedData;
    const sig = await w.signTypedData(domain, types, { ...message, member: w.address });
    expect(ethers.verifyTypedData(domain, types, { ...message, member: w.address }, sig)).toBe(w.address);
  });

  test('refused before signing: no signed ELPA, too few credits, past the cap', async () => {
    await expect(prepareRedeem(fake().chain, M, 9n, 10)).rejects.toMatchObject({ code: 'NOT_SIGNED' });
    await expect(prepareRedeem(fake().chain, M, 12n, 2_001)).rejects.toMatchObject({ code: 'NOT_ENOUGH' });
    await expect(prepareRedeem(fake({ lifetimeCreditPortion: async () => 53_800n * U }).chain, M, 12n, 500)).rejects.toMatchObject({ code: 'OVER_CAP' });
    await expect(prepareRedeem(fake().chain, M, 12n, 1.5)).rejects.toMatchObject({ code: 'BAD_AMOUNT' });
  });

  test('a signed redemption is simulated, then sent with exactly what was signed', async () => {
    const f = fake();
    const sig = `0x${'11'.repeat(65)}`;
    const r = await submitRedeem(f.chain, M, 12n, 500, '1790001800', sig);
    expect(r).toEqual({ tx: '0xfeed', usd: 500 });
    const d = issuerIface.parseTransaction({ data: f.sent[0] })!;
    expect(d.name).toBe('redeem');
    expect([...d.args]).toEqual([ethers.getAddress(M), 12n, 500n * U, 1_790_001_800n, sig]);
  });

  test('a refusal comes back in words and nothing is sent', async () => {
    const f = fake({}, { kind: 'refused', error: { name: 'HousingOverCap', args: [] as any }, sentence: 'past $54,000' });
    await expect(submitRedeem(f.chain, M, 12n, 500, '1790001800', `0x${'11'.repeat(65)}`)).rejects.toMatchObject({ status: 409, code: 'HousingOverCap', message: 'past $54,000' });
    expect(f.sent).toHaveLength(0);
  });
});

describe('paying toward a home', () => {
  test('two calls for the member’s wallet: approve the record for exactly the amount, then contribute', async () => {
    const r = await prepareContribute(fake().chain, M, 12n, 1250.5);
    expect(r.usd).toBe(1250.5);
    expect(r.calls[0].to).toBe(USDC);
    const erc20 = new ethers.Interface(['function approve(address spender, uint256 amount)']);
    expect([...erc20.parseTransaction({ data: r.calls[0].data })!.args]).toEqual(['0x26D8540881249bcD253810aBC2242b5a572729B5', 1_250_500_000n]);
    const c = recordIface.parseTransaction({ data: r.calls[1].data })!;
    expect(c.name).toBe('contribute');
    expect([...c.args]).toEqual([12n, 1_250_500_000n]);
  });

  test('refused for a home without a signed ELPA, or with nowhere to pay', async () => {
    await expect(prepareContribute(fake().chain, OTHER, 12n, 100)).rejects.toMatchObject({ code: 'NOT_SIGNED' });
    await expect(prepareContribute(fake({ payeeOf: async () => ethers.ZeroAddress }).chain, M, 12n, 100)).rejects.toMatchObject({ code: 'NO_PAYEE' });
    await expect(prepareContribute(fake().chain, M, 12n, -5)).rejects.toMatchObject({ code: 'BAD_AMOUNT' });
  });
});

describe('every record together, for Command', () => {
  test('live portions and prices, refunds due, and an ended Credit Portion held or due to lapse', async () => {
    const records: Record<string, any> = {
      '12': { creditPortion: 1_000n * U, memberPortion: 4_000n * U, structurePrice: 250_000n * U, refundDue: 0n, signedAt: 1n, endedAt: 0n, status: 1 },
      '13': { creditPortion: 0n, memberPortion: 210_000n * U, structurePrice: 200_000n * U, refundDue: 0n, signedAt: 1n, endedAt: 0n, status: 1 },
      '9': { creditPortion: 700n * U, memberPortion: 0n, structurePrice: 200_000n * U, refundDue: 300n * U, signedAt: 1n, endedAt: 1_700_000_000n, status: 4 },
      '8': { creditPortion: 50n * U, memberPortion: 0n, structurePrice: 1n, refundDue: 25n * U, signedAt: 1n, endedAt: 1_789_000_000n, status: 4 },
      '7': { creditPortion: 0n, memberPortion: 0n, structurePrice: 1n, refundDue: 10n * U, signedAt: 1n, endedAt: 1n, status: 2 },
    };
    const f = fake({
      allRecords: async () => ['12', '13', '9', '8', '7'].map((id) => ({ member: M, homeId: BigInt(id) })),
      recordOf: async (_m, id) => records[id.toString()],
      isRedeemable: async (id) => id === 13n,
    });
    expect(await housingTotals(f.chain)).toEqual({
      records: 5,
      live: 2,
      creditPortion: 1000,
      memberPortion: 214000,
      price: 450000,
      redeemable: 1,
      refundsDue: 335,
      lapsesDue: { count: 1, creditPortion: 700 },
      held: { count: 1, creditPortion: 50 },
    });
  });
});
