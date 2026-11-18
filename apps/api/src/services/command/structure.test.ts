import { readFileSync } from 'node:fs';
import contractsFx from '@clear/command-types/src/fixtures/contracts.json';
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
    expect(first).toEqual(['42 contracts', '7 accounts', '10 entities', '3 boards']);
    // a second start leaves it alone
    expect(await structureCommand(db)).toEqual([]);
  });

  test('every entity starts not formed, under its owner', async () => {
    const { rows } = await db.query<{ id: string; status: string; parent_id: string | null; facts: Record<string, unknown> | null }>('SELECT id, status, parent_id, facts FROM command.entities ORDER BY position');
    expect(rows.map((r) => r.status)).toEqual(Array(10).fill('planned'));
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
    // every board's first seat is its chair, and says how it's filled
    const { rows: first } = await db.query<{ board: string; class: string; note: string | null }>('SELECT board, class, note FROM command.board_seats WHERE position = 0 ORDER BY board');
    expect(first).toEqual([
      { board: 'ClearLabs board', class: 'c', note: 'Co-op reserved' },
      { board: 'Co-op board', class: 'c', note: 'Member-elected' },
      { board: 'Holdings board', class: 'c', note: 'Elected directly' },
    ]);
  });

  test('a database seeded before the chairs gets them from migration 0076, and running it again changes nothing', async () => {
    await db.query("UPDATE command.board_seats SET class = 'm', note = NULL WHERE board = 'Co-op board' AND position = 0");
    await db.query("UPDATE command.board_seats SET class = 'r', note = NULL WHERE board = 'ClearLabs board' AND position = 0");
    const sql = readFileSync(new URL('../../../migrations/0076_command_board_chairs.sql', import.meta.url), 'utf8');
    const statements = sql.replace(/^--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < 2; i++) for (const st of statements) await db.query(st);
    const { rows } = await db.query<{ board: string; position: number; class: string; note: string | null }>('SELECT board, position, class, note FROM command.board_seats WHERE board <> $1 AND position < 2 ORDER BY board, position', ['Holdings board']);
    expect(rows).toEqual([
      { board: 'ClearLabs board', position: 0, class: 'c', note: 'Co-op reserved' },
      { board: 'ClearLabs board', position: 1, class: 'r', note: null },
      { board: 'Co-op board', position: 0, class: 'c', note: 'Member-elected' },
      { board: 'Co-op board', position: 1, class: 'm', note: null },
    ]);
  });

  test('a database written before Clear Building Co. gets it and the drafting brief’s names from migration 0079, and running it again changes nothing', async () => {
    // the entities as the structure first wrote them
    await db.query("DELETE FROM command.entities WHERE id = 'lsub'");
    await db.query("UPDATE command.entities SET name = 'Clear Co-op', kind = 'Wyoming LLC · co-op' WHERE id = 'coop'");
    await db.query("UPDATE command.entities SET name = 'Manager LLC' WHERE id = 'mgr'");
    await db.query("UPDATE command.entities SET owned = '100%' WHERE id = 'hold'");
    await db.query("UPDATE command.entities SET parent_id = 'mgr', owned = NULL WHERE id = 'prop'");
    await db.query(`UPDATE command.entities SET facts = '{"tax":"Disregarded","steps":[["Name reserved",1],["Articles filed",0],["Operating agreement",0],["EIN",0],["Bank account",0]]}' WHERE id = 'lend'`);
    // and one someone renamed since: left as it is
    await db.query("UPDATE command.entities SET name = 'The Foundation (renamed)' WHERE id = 'fdn'");
    const sql = readFileSync(new URL('../../../migrations/0079_command_entities_building_co.sql', import.meta.url), 'utf8');
    // a statement ends at a semicolon that ends its line: Holdings' role has one inside it
    const statements = sql.replace(/^--.*$/gm, '').split(/;\s*$/m).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < 2; i++) for (const st of statements) await db.query(st);
    const { rows } = await db.query<{ id: string; name: string; parent_id: string | null; owned: string | null; step: string | null }>(
      "SELECT id, name, parent_id, owned, facts #>> '{steps,4,0}' AS step FROM command.entities WHERE id IN ('coop', 'mgr', 'hold', 'prop', 'lend', 'lsub', 'fdn') ORDER BY id",
    );
    expect(rows).toEqual([
      { id: 'coop', name: 'Clear Collective LLC', parent_id: null, owned: null, step: null },
      { id: 'fdn', name: 'The Foundation (renamed)', parent_id: null, owned: null, step: null },
      { id: 'hold', name: 'Clear Capital Holdings', parent_id: 'coop', owned: 'Class A', step: null },
      { id: 'lend', name: 'Clear Lending Co.', parent_id: 'hold', owned: '100%', step: 'CFL licence' },
      { id: 'lsub', name: 'Clear Building Co.', parent_id: 'hold', owned: '100%, once I-06 funds', step: null },
      { id: 'mgr', name: 'Clear Capital Management LLC', parent_id: 'hold', owned: '100%', step: null },
      { id: 'prop', name: 'Clear Properties Co.', parent_id: 'hold', owned: 'Majority, shrinking as contributors join', step: null },
    ]);
    const { rows: n } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM command.entities WHERE id = 'lsub'");
    expect(n[0].n).toBe(1);
  });

  test('a map written before brief update 2 gets the new one from migration 0080, keeping every id, and running it again changes nothing', async () => {
    const C = contractsFx as unknown as { contracts: any[][]; links: any[][] };
    const NEW = ['rs', 'pc', 'ec', 'lcm', 'ccp', 'pse', 'ca', 'hd', 'fcr', 'cta'];
    // the map as 0038 and 0073 left it: thirty-two contracts in two bands, no controller, OffersIssuer at the retired address
    await db.query('DELETE FROM command.contract_links');
    await db.query('DELETE FROM command.contracts WHERE id = ANY($1)', [NEW]);
    await db.query('ALTER TABLE command.contracts DROP CONSTRAINT contracts_band_check');
    await db.query("UPDATE command.contracts SET band = 'c', controller = ''");
    await db.query("ALTER TABLE command.contracts ADD CONSTRAINT contracts_band_check CHECK (band IN ('c', 'd'))");
    await db.query("UPDATE command.contracts SET address = '0x150E…841c', map_y = 37, purpose = 'old words' WHERE id = 'oi'");
    await db.query("UPDATE command.contracts SET layer = 3, version = 'v1.2' WHERE id IN ('lp', 'ap')");
    await db.query("INSERT INTO command.contract_links (position, from_id, to_id, kind, verb, label) VALUES (0, 'oi', 'cc', 'mint', 'gives $10 offers', '')");
    // and something that names a contract by id stays pointed at it
    await db.query("INSERT INTO command.contract_releases (contract_id, version, released_at) VALUES ('oi', 'v1.0', now())");
    const sql = readFileSync(new URL('../../../migrations/0080_command_contracts_map.sql', import.meta.url), 'utf8');
    const statements = sql.replace(/^--.*$/gm, '').split(/;\s*$/m).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < 2; i++) for (const st of statements) await db.query(st);
    const { rows } = await db.query<any>('SELECT * FROM command.contracts ORDER BY position');
    // the reference's map, as the fixture a new database is written from has it
    expect(rows.map((c) => [c.id, c.name, c.version, c.layer, c.status, c.address, c.purpose, Number(c.map_x), Number(c.map_y), c.band, c.controller])).toEqual(C.contracts);
    expect(rows.map((c) => c.position)).toEqual(C.contracts.map((_, i) => i));
    const { rows: links } = await db.query<any>('SELECT * FROM command.contract_links ORDER BY position');
    expect(links.map((l) => [l.from_id, l.to_id, l.kind, l.verb, l.label, ...(l.label_side != null ? [Number(l.label_side)] : [])])).toEqual(C.links);
    // OffersIssuer has no deployment record yet: no address, never the retired one's
    expect(rows.find((c) => c.id === 'oi').address).toBe('—');
    // the four not deployed, AssuranceOracle off the map, and who controls the rest
    expect(rows.filter((c) => c.status === 'later').map((c) => c.id)).toEqual(['lcm', 'cp', 'fcr', 'cta']);
    expect(rows.filter((c) => c.band === 'x').map((c) => c.id)).toEqual(['ao']);
    expect(rows.filter((c) => c.band !== 'x').length).toBe(41);
    expect(new Set(rows.map((c) => c.controller))).toEqual(new Set(['OPS', 'CF', 'CL', 'CO', 'AG', 'M', 'H', 'R', '']));
    const { rows: rel } = await db.query<{ contract_id: string }>('SELECT contract_id FROM command.contract_releases');
    expect(rel).toEqual([{ contract_id: 'oi' }]);
    await db.query('DELETE FROM command.contract_releases');
  });

  test('the contracts keep their map, without the prototype’s notes', async () => {
    const { rows } = await db.query<{ n: number; notes: number }>('SELECT count(*)::int AS n, count(note)::int AS notes FROM command.contracts');
    expect(rows[0]).toEqual({ n: 42, notes: 0 });
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
          calls.map((c) =>
            c.fn === 'asset' || c.fn === 'reserveToken'
              ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
              : c.fn === 'decimals'
                ? 6n
                : c.contract !== 'BondVault'
                  ? 0n
                  : ({ held: 290_380_000n, requiredReserve: 90_000_000n, deployableExcess: 200_380_000n, minReserveBps: 3000n, RESERVE_WINDOW: 90n * 86400n } as Record<string, bigint>)[c.fn] ?? 0n,
          ),
      };
      const m: any = await moneySection(db, { level: TOTALS, reveal: false, now: new Date(), chain });
      // by group: BondVault is the co-op's, after its operating cash and balance
      expect(m.ACCTS.map((a: any[]) => a[0])).toEqual(['sav', 'yld', 'pay', 'ap', 'ops', 'coop', 'bond']);
      // BondVault holds the bond buyers' money, read from the chain; the rest have nothing yet
      expect(m.ACCTS.map((a: any[]) => [a[0], a[5]]).filter(([, v]: any[]) => v)).toEqual([['bond', 290.38]]);
      // the co-op's to use, owed back at maturity: what it keeps back, and what the Safe may take
      expect(m.ACCTS.find((a: any[]) => a[0] === 'bond')[3]).toBe('coop');
      expect(m.figures['money.bondvault']).toEqual({ required: 90, deployable: 200.38, floorPct: 30, windowDays: 90 });
      // a figure is a number, or null where it can't be read (brief update 2's accounts), never NaN
      for (const [k, v] of Object.entries(m.M)) expect([k, v === null || Number.isFinite(v)]).toEqual([k, true]);
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
      expect(c.CTR).toHaveLength(42);
    } finally {
      env.p == null ? delete process.env.PROVIDER_CONTRACTS : (process.env.PROVIDER_CONTRACTS = env.p);
      if (env.s != null) process.env.COMMAND_SAFE_ADDRESS = env.s;
    }
  });
});
