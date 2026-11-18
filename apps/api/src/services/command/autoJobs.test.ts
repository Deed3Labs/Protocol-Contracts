import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { autoJobs } from './autoJobs.js';
import { auxRows, retiredRows, timelocksOf } from './inventoryCards.js';
import { payoutTopUpsSeed } from './payoutTopUps.js';

/* Build → Security's automatic jobs and Contracts' cards under the map (brief update 2, section 6). No chain reads. */

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

const POOL = '0x3c334D3AeD134191B7Ad0744a23978D71357BB15';
const WALLET = '0xC0C4EC7875D1838C0AE610accC16AAdCDb475068';
const NOW = Date.parse('2026-11-25T12:00:00Z');

describe('automatic jobs', () => {
  test('every switch off: four rows, each "Not on yet" and waiting, with its wallet and its switch', async () => {
    const jobs = await autoJobs(db, { env: { PAYOUT_TOPUP_WALLET: WALLET }, topUps: async () => payoutTopUpsSeed(NOW), keeper: () => ({ at: NOW, result: 'RED' }) });
    expect(jobs.map((j) => [j.id, j.w, j.a, j.run[0], j.st, j.off[0], j.at])).toEqual([
      ['topup', 'payout-topup-base-sepolia', '0xC0C4…5068', 'Not on yet', 'wait', 'PAYOUT_TOPUP_ENABLED', null],
      ['fees', 'cl-fees-base-sepolia', '0xB9ed…cDFd', 'Not on yet', 'wait', 'ASSURANCE_FEE_PAYER_ENABLED', null],
      ['keeper', 'No wallet', 'read-only', 'Not on yet', 'wait', 'PAYOUT_KEEPER_ENABLED', null],
      ['settlement', 'settlement-desk-base-sepolia', '—', 'Not on yet', 'wait', 'SETTLEMENT_FUNDING_ENABLED', null],
    ]);
    // the top-up rule's own horizon, and the fee payer's need for the new pool
    expect(jobs[0].d).toBe('Decision 51 · CL Operating to the PayoutPool when 14 days is short');
    expect(jobs[1].run[1]).toBe('Needs the new pool’s address · ASSURANCE_POOL_V2_84532');
    // no key anywhere
    expect(JSON.stringify(jobs)).not.toMatch(/0x[0-9a-fA-F]{64}/);
  });

  test('on: each one’s last run from what it recorded, ok', async () => {
    const env = { PAYOUT_TOPUP_ENABLED: '1', ASSURANCE_FEE_PAYER_ENABLED: '1', [`ASSURANCE_POOL_V2_84532`]: POOL, PAYOUT_KEEPER_ENABLED: 'true' };
    await db.query(`INSERT INTO command.assurance_snapshots (chain_id, day, pool, available_coverage, backstop_balance, backstop_floor, coverage_cap) VALUES (84532, '2026-11-25', $1, 0, 0, 0, 0)`, [
      POOL.toLowerCase(),
    ]);
    await db.query(`UPDATE command.assurance_snapshots SET read_at = $1`, [new Date(NOW - 3600e3)]);
    const jobs = await autoJobs(db, { env, topUps: async () => payoutTopUpsSeed(NOW), keeper: () => ({ at: NOW - 600e3, result: 'GREEN' }) });
    expect(jobs.map((j) => [j.run, j.st])).toEqual([
      [['Checked 25 Nov, 11:54 UTC', 'Nothing to top up'], 'ok'],
      [['Checked 25 Nov, 11:00 UTC', 'Nothing to pay'], 'ok'],
      [['Green · 25 Nov, 11:50 UTC', 'Funded ahead of every deadline'], 'ok'],
      [['Not on yet', 'Turns on when SETTLEMENT_FUNDING_ENABLED is set'], 'wait'],
    ]);
    // the limit is the one the job read from the chain
    expect(jobs[0].lim).toEqual(['$5,000 a week', 'Set on chain · $3,216.30 spent this period']);
  });

  test('on, and stopped or short: bad', async () => {
    const env = { PAYOUT_TOPUP_ENABLED: 'on', ASSURANCE_FEE_PAYER_ENABLED: '1', [`ASSURANCE_POOL_V2_84532`]: POOL, PAYOUT_KEEPER_ENABLED: '1' };
    await db.query(`INSERT INTO command.assurance_items (chain_id, kind, month, source_tag, amount, status, error) VALUES (84532, 'fee', '2026-10-01', 0, 6870000, 'failed', 'execution reverted')`);
    const halted = { ...payoutTopUpsSeed(NOW), halted: { id: 7, error: 'fund reverted' } };
    const jobs = await autoJobs(db, { env, topUps: async () => halted, keeper: () => ({ at: NOW, result: 'AMBER' }) });
    expect(jobs.map((j) => [j.run, j.st])).toEqual([
      [['Stopped', 'Top-up 7 failed: fund reverted'], 'bad'],
      [['Stopped', 'The fee for 2026-10 failed: execution reverted'], 'bad'],
      [['Amber · 25 Nov, 12:00 UTC', 'Ops is emailed once a day'], 'bad'],
      [['Not on yet', 'Turns on when SETTLEMENT_FUNDING_ENABLED is set'], 'wait'],
    ]);
  });

  test('on, but nothing recorded yet: waiting for its first run', async () => {
    await db.query('DELETE FROM command.assurance_items');
    await db.query('DELETE FROM command.assurance_snapshots');
    const env = { PAYOUT_TOPUP_ENABLED: '1', ASSURANCE_FEE_PAYER_ENABLED: '1', [`ASSURANCE_POOL_V2_84532`]: POOL, PAYOUT_KEEPER_ENABLED: '1', SETTLEMENT_FUNDING_ENABLED: '1' };
    const jobs = await autoJobs(db, { env, topUps: async () => null, keeper: () => null, settlement: async () => null });
    expect(jobs.map((j) => [j.run[0], j.st])).toEqual([
      ['Not run yet', 'wait'],
      ['Not run yet', 'wait'],
      ['Not run yet', 'wait'],
      ['Not run yet', 'wait'],
    ]);
  });
});

describe('the cards under the map, by name', () => {
  const inv = (...names: string[]) => new Map(names.map((n, i) => [n, { address: `0x${(i + 1).toString(16).padStart(40, '0')}` }]));

  test('an OffersIssuer record makes the old one replaced by it; a timelock the table doesn’t know still shows, with no words', () => {
    const m = inv('OffersIssuer', 'OffersIssuerPreAudit', 'DeedTimelock', 'EarnTimelock', 'CreditTimelock', 'Create2Deployer');
    expect(timelocksOf(m)).toEqual(['CreditTimelock', 'EarnTimelock', 'DeedTimelock']);
    expect(auxRows(m).map((r) => [r[0], r[2], r[3]])).toEqual([
      ['CreditTimelock', 'Holds the credit contracts’ upgrades and settings for 7 days', 'Clear Treasury Safe, as the Ops Safe'],
      ['EarnTimelock', 'Holds EarnControls, the Yield Pool, BondVault and the bond contracts for 7 days', 'Clear Lending Safe'],
      ['DeedTimelock', '…', ''],
      ['Create2Deployer', 'Deploys contracts to addresses known in advance', 'No one: a helper'],
    ]);
    expect(retiredRows(m)).toEqual({ CTR_OLD: [['OffersIssuer (old)', '0x0000…0002', 'Replaced by the 17 Nov deploy']], CTR_OLD_N: 0 });
  });

  test('AssurancePool and ClearUSD are retired only once what replaced them is recorded; a V1 only beside its successor', () => {
    expect(retiredRows(inv('AssurancePool', 'ClearUSD', 'FooV1', 'BarV1', 'Bar', 'BondValuerLegacy'))).toEqual({ CTR_OLD: [], CTR_OLD_N: 2 });
    expect(retiredRows(inv('AssurancePool', 'AssurancePoolV2')).CTR_OLD).toEqual([['AssurancePool v1', '0x0000…0001', 'Replaced by AssurancePool v2']]);
  });
});
