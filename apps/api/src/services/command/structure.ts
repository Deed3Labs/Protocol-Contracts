import contractsFx from '@clear/command-types/src/fixtures/contracts.json';
import governanceFx from '@clear/command-types/src/fixtures/governance.json';
import moneyFx from '@clear/command-types/src/fixtures/money.json';
import type { Db, Queryable } from '../../db/db.js';

/*
 * The co-op's structure, which is real before anything has happened (Phase 9): the protocol's
 * contracts and how they connect, the entities and who owns them, each board's seats, who decides
 * what, and the accounts Money keeps (their balances are the chain's and the bank's, never stored here).
 * An account added later (BondVault) is added to a list that's already there; nothing else is. Written on every start into the tables that are empty, seed or not; never over
 * anything there.
 *
 * Only the shape: no people, no dates, no events. Every entity starts not formed (planned) and every
 * seat empty; a contract's version and address are the chain's once Contracts is live. What happens
 * (filings, meetings, votes, changes, signers) is recorded as it happens.
 */

async function empty(db: Queryable, table: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n === 0;
}

/** The accounts Money keeps: the prototype's six, and BondVault, where bond buyers' money is: the co-op's to use, owed back at maturity. */
const ACCOUNTS = [
  ...moneyFx.accounts,
  { id: 'bond', name: 'BondVault', why: 'Bond buyers’ money · the co-op’s to use, paid back at maturity', group: 'coop', source: 'protocol', swatch: 'color-mix(in srgb,var(--land) 70%,var(--fg))' },
];

/** A seat's note when it says how the seat is filled, not when ("Elect 15 Jan"). */
const howFilled = (note: string | undefined) => (note && !/\d/.test(note) ? note : null);

export async function structureCommand(db: Db): Promise<string[]> {
  const done: string[] = [];
  await db.transaction(async (tx) => {
    if ((await empty(tx, 'command.contracts')) && (await empty(tx, 'command.contract_links'))) {
      const C = contractsFx as unknown as Record<string, any>;
      for (const [i, [id, name, ver, layer, st, addr, what, x, y, band]] of (C.contracts as any[]).entries()) {
        await tx.query(
          'INSERT INTO command.contracts (id, position, name, version, layer, status, address, purpose, map_x, map_y, band, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)',
          [id, i, name, ver, layer, st, addr, what, x, y, band],
        );
      }
      for (const [i, [from, to, kind, verb, label, side]] of (C.links as any[]).entries()) {
        await tx.query('INSERT INTO command.contract_links (position, from_id, to_id, kind, verb, label, label_side) VALUES ($1, $2, $3, $4, $5, $6, $7)', [i, from, to, kind, verb, label, side ?? null]);
      }
      done.push(`${C.contracts.length} contracts`);
    }

    let added = 0;
    for (const [i, a] of ACCOUNTS.entries()) {
      const r = await tx.query('INSERT INTO command.accounts (id, position, name, purpose, owner_group, source, swatch) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING id', [
        a.id,
        i,
        a.name,
        a.why,
        a.group,
        a.source,
        a.swatch,
      ]);
      added += r.rows.length;
    }
    if (added) done.push(`${added} accounts`);

    if (await empty(tx, 'command.entities')) {
      const G = governanceFx as unknown as Record<string, any>;
      // parents point at entities, so every entity goes in before any parent is set
      for (const [i, { row: [id, name, kind, , role, x, y], owned, under, facts }] of (G.entities as any[]).entries()) {
        // of the facts, only how it's taxed is the structure's; formation dates, numbers and officers come when it forms
        const keep = facts?.tax ? { tax: facts.tax } : null;
        await tx.query(
          `INSERT INTO command.entities (id, position, name, kind, status, role, map_x, map_y, owned, under, facts) VALUES ($1, $2, $3, $4, 'planned', $5, $6, $7, $8, $9, $10)`,
          [id, i, name, kind, role, x, y, owned, under, keep ? JSON.stringify(keep) : null],
        );
      }
      for (const e of G.entities as any[]) if (e.parent) await tx.query('UPDATE command.entities SET parent_id = $2 WHERE id = $1', [e.row[0], e.parent]);
      if (await empty(tx, 'command.boards'))
        for (const [i, [name, ent, seats, note]] of (G.boards as any[]).entries()) {
          await tx.query('INSERT INTO command.boards (position, name, entity_id, note) VALUES ($1, $2, $3, $4)', [i, name, ent, note]);
          for (const [j, [cls, , , , sn]] of (seats as any[]).entries()) {
            await tx.query('INSERT INTO command.board_seats (board, position, class, holder, starts_at, ends_at, note) VALUES ($1, $2, $3, NULL, NULL, NULL, $4)', [name, j, cls, howFilled(sn)]);
          }
        }
      if (await empty(tx, 'command.reserved_matters'))
        for (const [i, [d, roles]] of (G.matters as any[]).entries()) await tx.query('INSERT INTO command.reserved_matters (position, decision, roles, open) VALUES ($1, $2, $3, NULL)', [i, d, roles]);
      done.push(`${G.entities.length} entities`, `${G.boards.length} boards`);
    }
  });
  return done;
}
