import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { TOTALS } from './levels.js';
import type { ChainReader } from './onchain.js';
import { contractsSection, moneySection } from './sections.js';
import { structureCommand } from './structure.js';

/* Phase 9: the co-op's structure is there with no seed, and only its shape: no people, no dates. */

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
});

describe('the structure', () => {
  test('writes the contracts, entities, boards and who decides, once', async () => {
    const first = await structureCommand(db);
    expect(first).toEqual(['31 contracts', '7 accounts', '9 entities', '3 boards']);
    // a second start leaves it alone
    expect(await structureCommand(db)).toEqual([]);
  });

  test('every entity starts not formed, under its owner', async () => {
    const { rows } = await db.query<{ id: string; status: string; parent_id: string | null; facts: Record<string, unknown> | null }>('SELECT id, status, parent_id, facts FROM command.entities ORDER BY position');
    expect(rows.map((r) => r.status)).toEqual(Array(9).fill('planned'));
    expect(rows.find((r) => r.id === 'mgr')!.parent_id).toBe('hold');
    // no formation dates, numbers or officers
    for (const r of rows) for (const k of ['formed', 'ein', 'officers']) expect(r.facts?.[k]).toBeUndefined();
  });

  test('the boards keep their seats, every one empty', async () => {
    const { rows } = await db.query<{ board: string; n: number; held: number; dated: number }>(
      `SELECT board, count(*)::int AS n, count(holder)::int AS held, count(starts_at)::int + count(ends_at)::int AS dated FROM command.board_seats GROUP BY board ORDER BY board`,
    );
    expect(rows).toEqual([
      { board: 'ClearLabs board', n: 3, held: 0, dated: 0 },
      { board: 'Co-op board', n: 5, held: 0, dated: 0 },
      { board: 'Holdings board', n: 7, held: 0, dated: 0 },
    ]);
    const { rows: notes } = await db.query<{ note: string }>('SELECT note FROM command.board_seats WHERE note IS NOT NULL');
    expect(notes.every((r) => !/\d/.test(r.note))).toBe(true);
  });

  test('the contracts keep their map, without the prototype’s notes', async () => {
    const { rows } = await db.query<{ n: number; notes: number }>('SELECT count(*)::int AS n, count(note)::int AS notes FROM command.contracts');
    expect(rows[0]).toEqual({ n: 31, notes: 0 });
    const { rows: links } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM command.contract_links');
    expect(links[0].n).toBeGreaterThan(0);
    for (const t of ['agreements', 'contract_changes', 'contract_releases', 'signers', 'filings', 'board_people', 'resolutions', 'member_votes', 'account_snapshots', 'account_entries', 'figures']) {
      const { rows: r } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM command.${t}`);
      expect(r[0].n).toBe(0);
    }
  });
});

describe('Money with only the structure', () => {
  test('answers live with zeros, never a crash or a NaN', async () => {
    const env = process.env.PROVIDER_MONEY;
    process.env.PROVIDER_MONEY = 'live';
    try {
      const chain: ChainReader = {
        read: async (calls) =>
          calls.map((c) => (c.fn === 'asset' || c.fn === 'reserveToken' ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e' : c.fn === 'decimals' ? 6n : c.contract === 'BondVault' && c.fn === 'held' ? 290_380_000n : 0n)),
      };
      const m: any = await moneySection(db, { level: TOTALS, reveal: false, now: new Date(), chain });
      // by group: BondVault is set aside, beside the payout pool and the AssurancePool
      expect(m.ACCTS.map((a: any[]) => a[0])).toEqual(['sav', 'yld', 'pay', 'ap', 'bond', 'ops', 'coop']);
      // BondVault holds the bond buyers' money, read from the chain; the rest have nothing yet
      expect(m.ACCTS.map((a: any[]) => [a[0], a[5]]).filter(([, v]: any[]) => v)).toEqual([['bond', 290.38]]);
      for (const [k, v] of Object.entries(m.M)) expect([k, Number.isFinite(v)]).toEqual([k, true]);
      expect([m.AP_BAL, m.UNSEC, m.COOP_W, m.FLOWS]).toEqual([[0], [0], [], []]);
    } finally {
      env == null ? delete process.env.PROVIDER_MONEY : (process.env.PROVIDER_MONEY = env);
    }
  });
});

describe('Contracts with only the structure', () => {
  test('the header is the chain’s: the newest block indexed, and no Safe until one is set', async () => {
    const env = { p: process.env.PROVIDER_CONTRACTS, s: process.env.COMMAND_SAFE_ADDRESS };
    process.env.PROVIDER_CONTRACTS = 'live';
    delete process.env.COMMAND_SAFE_ADDRESS;
    try {
      await db.query('INSERT INTO command.chain_cursor (chain_id, indexed_to) VALUES (84532, 49815448)');
      const c: any = await contractsSection(db, { level: TOTALS, reveal: false, now: new Date() });
      expect(c.figures['contracts.chain']).toEqual({ network: 'Base Sepolia', block: 49815448, safe: 'No Ops Safe yet', threshold: 0, delayHours: 0 });
      expect(c.CTR).toHaveLength(31);
    } finally {
      env.p == null ? delete process.env.PROVIDER_CONTRACTS : (process.env.PROVIDER_CONTRACTS = env.p);
      if (env.s != null) process.env.COMMAND_SAFE_ADDRESS = env.s;
    }
  });
});
