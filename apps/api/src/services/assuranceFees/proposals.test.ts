import { describe, expect, test } from 'bun:test';
import { ethers } from 'ethers';
import { ERC20_ABI, POOL_ABI } from './chain';
import { fundingProposal, interchangeBatch, interchangeCalls } from './proposals';

const ERC20 = new ethers.Interface(ERC20_ABI);
const POOL = new ethers.Interface(POOL_ABI);
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const POOL_ADDR = '0x00000000000000000000000000000000000a55a1';
const CL_FEES = '0xB9ed7ea800c3a32a8F2cf7d2aB50AE2d4831cDFd';
const CL_OPERATING = '0xfAFf1081F77bF528bA21eea590f251a755bCdf65';
const CLEAR_LENDING = '0xAE8FF4Fa84d786Ece2C7Ab87886A2CD6086c419d';
const TREASURY = '0x52e6102B7C22eeC7A68B11Dd71faC7D6D9AEcf50';

describe('funding: CL Operating moves exactly the amount to the CL Fees wallet', () => {
  const p = fundingProposal({ chainId: 84532, clOperating: CL_OPERATING, clearLendingSafe: CLEAR_LENDING, clFees: CL_FEES, token: USDC, amount: 26_301_369n, kind: 'fee', month: '2026-10', itemId: 'item-1', at: 1 });

  test('one call: USDC.transfer(CL Fees, amount), nothing else', () => {
    expect(p.batch.transactions).toHaveLength(1);
    const [t] = p.batch.transactions;
    expect(t.to).toBe(USDC);
    expect(t.value).toBe('0');
    const call = ERC20.parseTransaction({ data: t.data })!;
    expect(call.name).toBe('transfer');
    expect(call.args[0]).toBe(CL_FEES);
    expect(call.args[1]).toBe(26_301_369n);
  });

  test('a Transaction Builder batch for CL Operating, owned by the Clear Lending Safe, with a link to open it', () => {
    expect(p.batch).toMatchObject({ version: '1.0', chainId: '84532' });
    expect(p.via).toBe('transaction_builder');
    expect(p.safe).toBe(CL_OPERATING);
    expect(p.owner).toBe(CLEAR_LENDING);
    expect(p.link).toBe(`https://app.safe.global/apps/open?safe=basesep:${CL_OPERATING}&appUrl=${encodeURIComponent('https://apps-portal.safe.global/tx-builder')}`);
    expect(p.batch.meta.description).toContain('Step 5');
    expect(p.batch.meta.description).toContain('$26.30');
  });

  test('refuses nothing to fund', () => {
    expect(() => fundingProposal({ chainId: 84532, clOperating: CL_OPERATING, clearLendingSafe: null, clFees: CL_FEES, token: USDC, amount: 0n, kind: 'fee', month: '2026-10', itemId: 'x' })).toThrow();
  });
});

describe('interchange: the Clear Treasury Safe approves exactly x, then deposits x under INTERCHANGE', () => {
  test('approve(pool, x) on USDC, then deposit(2, x) on the pool', () => {
    const calls = interchangeCalls(POOL_ADDR, USDC, 308_641_972n);
    expect(calls.map((c) => c.to)).toEqual([USDC, ethers.getAddress(POOL_ADDR)]);
    const approve = ERC20.parseTransaction({ data: calls[0].data })!;
    expect([approve.name, approve.args[0], approve.args[1]]).toEqual(['approve', ethers.getAddress(POOL_ADDR), 308_641_972n]);
    const deposit = POOL.parseTransaction({ data: calls[1].data })!;
    expect([deposit.name, Number(deposit.args[0]), deposit.args[1]]).toEqual(['deposit', 2, 308_641_972n]);
  });

  test('the batch file says what it is: 25% of the month’s interchange', () => {
    const b = interchangeBatch({ chainId: 84532, safe: TREASURY, pool: POOL_ADDR, token: USDC, amount: 250_000_000n, interchange: 1_000_000_000n, bps: 2500n, month: '2026-10' });
    expect(b.transactions).toHaveLength(2);
    expect(b.meta.description).toContain('25% of $1,000.00');
    expect(b.meta.description).toContain('$250.00');
  });
});
