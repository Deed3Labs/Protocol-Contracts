import { describe, expect, test } from 'bun:test';
import { decodeFunctionData, getAddress, keccak256, stringToHex, type Abi } from 'viem';
import { BUILDERS, CONTRACTS, BuildError, housingRef, type ChainRead } from './safeTx.js';
import { actionFor } from './actions.js';

/*
 * The Housing Allowance Record's writer actions: each body is checked, waits for a second person, and
 * builds one call to the record from the Clear Treasury Safe, with a ref made from what it is.
 */

const SAFE = '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50';
const MEMBER = '0x00000000000000000000000000000000000000a1';
const RECORD = CONTRACTS.HousingAllowanceRecord;
process.env.COMMAND_SAFE_ADDRESS = SAFE;

const chain = (writer: boolean): ChainRead => ({
  read: async (_a, _abi, fn, args) => {
    if (fn === 'HOUSING_WRITER_ROLE') return keccak256(stringToHex('HOUSING_WRITER_ROLE'));
    if (fn === 'hasRole') return writer && getAddress(String(args[1])) === getAddress(SAFE);
    throw new Error(`unexpected read ${fn}`);
  },
});
const build = (kind: string, b: unknown, writer = true) => BUILDERS[`members.${kind}`](b, { db: {} as any, chain: chain(writer) });
const decode = (data: `0x${string}`) => decodeFunctionData({ abi: RECORD.functions as Abi, data });

describe('Housing Allowance writer actions', () => {
  test('the record is in Command’s chain record', () => {
    expect(RECORD?.address).toBe(getAddress('0x26D8540881249bcD253810aBC2242b5a572729B5'));
  });

  test('each waits for a second person and goes to the outbox', async () => {
    for (const kind of ['housing-open', 'housing-payment', 'housing-move', 'housing-end', 'housing-price']) {
      const a = actionFor('members', kind)!;
      expect(a).toBeDefined();
      expect(await a.second!({} as any, {} as any)).toBe(true);
      expect(a.outbox).toBe(true);
    }
  });

  test('bodies refuse a bad wallet or home', () => {
    const open = actionFor('members', 'housing-open')!.body;
    expect(open.safeParse({ member: 'nope', homeId: '1', price: 100 }).success).toBe(false);
    expect(open.safeParse({ member: MEMBER, homeId: '0', price: 100 }).success).toBe(false);
    expect(open.safeParse({ member: MEMBER, homeId: '12', price: 0 }).success).toBe(false);
    expect(open.parse({ member: MEMBER, homeId: '12', price: 250000 })).toMatchObject({ carryFromHome: '0' });
    expect(actionFor('members', 'housing-payment')!.body.safeParse({ member: MEMBER, homeId: '12', usd: 10 }).success).toBe(false);
  });

  test('open: the member, the home, the price at 6 decimals, the carried home and a ref', async () => {
    const [c] = await build('housing-open', { member: MEMBER, homeId: '12', price: 250000.5, carryFromHome: '0' });
    expect(c.to).toBe(getAddress(RECORD.address));
    const d = decode(c.data);
    expect(d.functionName).toBe('open');
    expect(d.args).toEqual([getAddress(MEMBER), 12n, 250_000_500_000n, 0n, housingRef('open', getAddress(MEMBER), '12')]);
  });

  test('a payment’s ref follows its reference, so two payments differ and one built twice is the same', async () => {
    const b = { member: MEMBER, homeId: '12', usd: 500, reference: 'wire 1' };
    const [x] = await build('housing-payment', b);
    const [y] = await build('housing-payment', b);
    const [z] = await build('housing-payment', { ...b, reference: 'wire 2' });
    expect(x.data).toBe(y.data);
    expect(x.data).not.toBe(z.data);
    expect(decode(x.data).functionName).toBe('recordPayment');
  });

  test('move, end and price build their calls', async () => {
    const [m] = await build('housing-move', { member: MEMBER, fromHome: '12', toHome: '13', price: 300000, deductions: 1200, credit: 0 });
    expect(decode(m.data)).toMatchObject({ functionName: 'move', args: [getAddress(MEMBER), 12n, 13n, 300_000_000_000n, 1_200_000_000n, 0n, housingRef('move', getAddress(MEMBER), '12', '13')] });
    const [e] = await build('housing-end', { member: MEMBER, homeId: '12', deductions: 0 });
    expect(decode(e.data).functionName).toBe('end');
    const [p] = await build('housing-price', { member: MEMBER, homeId: '12', price: 240000, reason: 'Appraisal' });
    expect(decode(p.data)).toMatchObject({ functionName: 'lowerPrice', args: [getAddress(MEMBER), 12n, 240_000_000_000n, keccak256(stringToHex('Appraisal'))] });
  });

  test('refused when Command’s Safe is not the record’s writer', async () => {
    await expect(build('housing-end', { member: MEMBER, homeId: '12', deductions: 0 }, false)).rejects.toBeInstanceOf(BuildError);
  });
});
