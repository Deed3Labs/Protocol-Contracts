#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

function resolveTableName() {
  const configured = String(process.env.PLAID_TOKEN_STORE_TABLE || 'plaid_linked_items').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(configured)) {
    throw new Error('PLAID_TOKEN_STORE_TABLE must be a valid SQL identifier');
  }
  return configured;
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const tableName = resolveTableName();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const updatedRowsResult = await client.query(
      `
      WITH wallet_map AS (
        SELECT DISTINCT ON (wallet_address)
          member_id,
          wallet_address
        FROM (
          SELECT
            member_id,
            lower(wallet_address) AS wallet_address
          FROM member_wallets
          WHERE wallet_address IS NOT NULL
            AND wallet_address != ''
            AND status != 'REMOVED'

          UNION ALL

          SELECT
            id AS member_id,
            lower(primary_wallet) AS wallet_address
          FROM members
          WHERE primary_wallet IS NOT NULL
            AND primary_wallet != ''
        ) source
        ORDER BY wallet_address, member_id
      ),
      updated AS (
        UPDATE ${tableName} plaid
        SET
          member_id = wallet_map.member_id,
          updated_at = NOW()
        FROM wallet_map
        WHERE lower(plaid.wallet_address) = wallet_map.wallet_address
          AND plaid.member_id IS DISTINCT FROM wallet_map.member_id
        RETURNING plaid.wallet_address, plaid.item_id, plaid.member_id
      )
      SELECT COUNT(*)::int AS total
      FROM updated
      `
    );

    const remainingRowsResult = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM ${tableName}
      WHERE member_id IS NULL
      `
    );

    const sampleResult = await client.query(
      `
      SELECT wallet_address, item_id
      FROM ${tableName}
      WHERE member_id IS NULL
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 20
      `
    );

    console.log(
      JSON.stringify(
        {
          tableName,
          updatedRows: updatedRowsResult.rows[0]?.total ?? 0,
          remainingWithoutMemberId: remainingRowsResult.rows[0]?.total ?? 0,
          sampleUnresolvedRows: sampleResult.rows,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed to backfill Plaid member ownership');
  process.exit(1);
});
