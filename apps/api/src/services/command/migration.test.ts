import { describe, expect, test } from 'bun:test';
import { testDb } from '../../db/testDb.js';

describe('command schema', () => {
  test('the seven seed groups are there, Members automatic', async () => {
    const { db } = await testDb();
    const { rows } = await db.query<{ key: string; auto: boolean }>('SELECT key, auto FROM command.groups ORDER BY key');
    expect(rows.map((r) => r.key)).toEqual(['admin', 'board', 'field', 'investors', 'members', 'outside', 'protocol']);
    expect(rows.filter((r) => r.auto).map((r) => r.key)).toEqual(['members']);
  });

  test('the audit log takes rows and refuses UPDATE, DELETE and TRUNCATE', async () => {
    const { db } = await testDb();
    await db.query(`INSERT INTO command.audit_log (who, area, action, result) VALUES ('Kai', 'access', 'Invited someone', 'done')`);
    await expect(db.query(`UPDATE command.audit_log SET action = 'edited'`)).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM command.audit_log')).rejects.toThrow(/append-only/);
    await expect(db.query('TRUNCATE command.audit_log')).rejects.toThrow(/append-only/);
    expect((await db.query('SELECT count(*)::int AS n FROM command.audit_log')).rows[0]).toEqual({ n: 1 });
  });

  test('nobody approves their own proposal, in the database too', async () => {
    const { db } = await testDb();
    const { rows } = await db.query<{ id: string }>(`INSERT INTO command.people (name) VALUES ('Kai') RETURNING id`);
    const kai = rows[0].id;
    const p = await db.query<{ id: string }>(
      `INSERT INTO command.proposals (kind, area, summary, payload, proposed_by) VALUES ('access', 'access', 'x', '{}', $1) RETURNING id`,
      [kai],
    );
    await expect(
      db.query(`UPDATE command.proposals SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2`, [kai, p.rows[0].id]),
    ).rejects.toThrow(/proposals_second_person/);
  });
});
