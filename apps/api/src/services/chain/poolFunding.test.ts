import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { poolFundedKinds } from './poolFunding.js';

const service = readFileSync(new URL('./poolFunding.ts', import.meta.url), 'utf8');
const settle = readFileSync(new URL('./cardSettlementService.ts', import.meta.url), 'utf8');
const usdc = readFileSync(new URL('./usdcRepaymentService.ts', import.meta.url), 'utf8');
const sweeper = readFileSync(new URL('../../jobs/cardSettlementSweeper.ts', import.meta.url), 'utf8');

describe('which tiers the pool funds', () => {
  test('the unsecured tiers by default; secured tiers are backed by the member’s own collateral', () => {
    delete process.env.POOL_FUNDED_TIER_KINDS;
    expect([...poolFundedKinds()].sort()).toEqual(['BOOST', 'INCOME']);
    process.env.POOL_FUNDED_TIER_KINDS = 'income, boost, pool_share';
    expect(poolFundedKinds().has('POOL_SHARE')).toBe(true);
    delete process.env.POOL_FUNDED_TIER_KINDS;
  });
});

describe('the pool lends when its tiers are drawn, and is repaid — carry included — when they are repaid', () => {
  test('TierDrawn on a pool tier is a borrow; TierRepaid is a repayment', () => {
    expect(service).toContain("parsed.name === 'TierDrawn' ? 'borrow' : 'repay'");
    expect(service).toContain('if (!funded.has(kind)) continue;');
  });

  test('borrowed into the card-funding wallet; repaid with USDC through LendingPool.repay (above principal is yield)', () => {
    expect(service).toContain('await pool.borrow(amount, signer.address)');
    expect(service).toContain('await pool.repay(amount)');
  });

  test('every transaction we write, and every member repayment we record, is read for pool movements', () => {
    expect(settle.match(/await recordPoolMovements\(await tx\.wait\(1\)\);/g)?.length).toBeGreaterThanOrEqual(5);
    expect(settle).not.toMatch(/\n\s*await tx\.wait\(1\);/);
    expect(usdc).toContain('await recordPoolMovements(receipt);');
  });

  test('once per event, never throwing after a transaction that landed', () => {
    expect(service).toContain('PRIMARY KEY (tx_hash, log_index)');
    expect(service).toContain('ON CONFLICT (tx_hash, log_index) DO NOTHING');
    expect(service).toMatch(/export async function recordPoolMovements[\s\S]{0,200}try \{/);
  });

  test('short of pool cash or of USDC to repay: waits and says how much, rather than failing', () => {
    expect(service).toContain('pool has ${cash} to lend, needs ${amount}');
    expect(service).toContain('top up from treasury');
  });

  test('the sweep settles them last, after the passes that create them', () => {
    expect(sweeper.indexOf('await settlePoolMovements()')).toBeGreaterThan(sweeper.indexOf('await enforceDisputes()'));
  });
});
