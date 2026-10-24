import { beforeAll, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/db.js';
import { testDb } from '../../db/testDb.js';
import { liveMemberSource } from './memberSource.js';

/*
 * The member source's own SQL, against tables with the member app's columns (memberStore, the
 * deposit receipts, Lithic's authorization decisions, charge requests): who has an account, the code
 * their onboarding sent back, all their wallets, and each wallet's first deposit and first spend.
 */

let db: Db;
beforeAll(async () => {
  ({ db } = await testDb());
  await db.exec(`
    CREATE TABLE members (id BIGSERIAL PRIMARY KEY, primary_wallet TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_authenticated_at TIMESTAMPTZ);
    CREATE TABLE member_onboarding (member_id BIGINT PRIMARY KEY REFERENCES members (id), invite_code TEXT);
    CREATE TABLE member_wallets (id BIGSERIAL PRIMARY KEY, member_id BIGINT NOT NULL REFERENCES members (id), wallet_address TEXT NOT NULL UNIQUE);
    CREATE TABLE deposit_receipts (rail TEXT NOT NULL, external_id TEXT NOT NULL, wallet TEXT NOT NULL, amount_cents BIGINT NOT NULL, received_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (rail, external_id));
    CREATE TABLE lithic_auth_decisions (transaction_token TEXT PRIMARY KEY, wallet TEXT, result TEXT NOT NULL, merchant JSONB, decided_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE charge_requests (code TEXT PRIMARY KEY, member_wallet TEXT NOT NULL, merchant_name TEXT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, resolved_at TIMESTAMPTZ);
    INSERT INTO members (id, primary_wallet, created_at, last_authenticated_at) VALUES (1, '0xAAA', '2026-10-20T10:00:00Z', '2026-10-24T09:00:00Z'), (2, '0xbbb', '2026-10-21T10:00:00Z', NULL);
    INSERT INTO member_onboarding VALUES (1, ' abcde-23456 '), (2, NULL);
    INSERT INTO member_wallets (member_id, wallet_address) VALUES (1, '0xAAA'), (1, '0xA2');
    INSERT INTO deposit_receipts VALUES ('bridge_va', 'd2', '0xaaa', 500, '2026-10-22T10:00:00Z'), ('lithic_ach', 'd1', '0xA2', 2500, '2026-10-21T10:00:00Z');
    INSERT INTO lithic_auth_decisions VALUES ('t1', '0xaaa', 'DECLINED', '{"descriptor":"X"}', '2026-10-21T12:00:00Z'), ('t2', '0xaaa', 'APPROVED', '{"descriptor":"Rosa''s Tacos"}', '2026-10-23T12:00:00Z');
    INSERT INTO charge_requests VALUES ('c1', '0xA2', 'Cajon Phone Repair', 'approved', '2026-10-22T08:00:00Z', '2026-10-22T08:05:00Z'), ('c2', '0xbbb', 'Uptown Barber', 'pending', '2026-10-22T08:00:00Z', NULL);
  `);
});

const source = () =>
  liveMemberSource({ main: () => db, pay: () => db, basics: async (ids) => new Map(ids.map((id) => [id, { legalName: id === 1 ? 'Ana Ruiz' : null, city: id === 1 ? 'Redlands' : null }])) });

describe('the member source', () => {
  test('everyone with an account, their code as onboarding sent it, and every wallet they have', async () => {
    const r = await source().roster({ names: true });
    expect(r.map((m) => ({ ...m, wallets: [...m.wallets].sort() }))).toEqual([
      { id: 1, createdAt: Date.parse('2026-10-20T10:00:00Z'), lastSeen: Date.parse('2026-10-24T09:00:00Z'), inviteCode: 'ABCDE-23456', wallets: ['0xa2', '0xaaa'], name: 'Ana Ruiz', city: 'Redlands' },
      { id: 2, createdAt: Date.parse('2026-10-21T10:00:00Z'), lastSeen: null, inviteCode: null, wallets: ['0xbbb'], name: null, city: null },
    ]);
    // names only when asked; the city either way
    expect((await source().roster({ names: false }))[0]).toMatchObject({ name: null, city: 'Redlands' });
  });

  test('each wallet’s first deposit says how they funded, and its first spend is a card purchase or a charge code', async () => {
    const m = await source().milestones(['0xaaa', '0xa2', '0xbbb']);
    expect(m.get('0xa2')).toEqual({ funded: { at: Date.parse('2026-10-21T10:00:00Z'), with: 'bank' }, spend: { at: Date.parse('2026-10-22T08:05:00Z'), shop: 'Cajon Phone Repair' } });
    expect(m.get('0xaaa')).toEqual({ funded: { at: Date.parse('2026-10-22T10:00:00Z'), with: 'deposit' }, spend: { at: Date.parse('2026-10-23T12:00:00Z'), shop: "Rosa's Tacos" } });
    // a pending charge isn't a spend
    expect(m.get('0xbbb')).toBeUndefined();
  });
});
