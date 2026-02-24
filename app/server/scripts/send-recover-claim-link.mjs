#!/usr/bin/env node
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

function parseArgs(argv) {
  const parsed = {
    rowId: null,
    transferId: null,
    lookupClaimToken: null,
    claimToken: null,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--row-id') {
      parsed.rowId = Number.parseInt(String(argv[i + 1] || ''), 10);
      i += 1;
      continue;
    }
    if (current === '--transfer-id') {
      parsed.transferId = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (current === '--lookup-claim-token') {
      parsed.lookupClaimToken = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (current === '--claim-token') {
      parsed.claimToken = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (current === '--force') {
      parsed.force = true;
    }
  }

  return parsed;
}

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/send-recover-claim-link.mjs --row-id <id> [--claim-token <token>] [--force]',
      '  node scripts/send-recover-claim-link.mjs --transfer-id <bytes32> [--claim-token <token>] [--force]',
      '  node scripts/send-recover-claim-link.mjs --lookup-claim-token <token> [--claim-token <token>] [--force]',
      '',
      'Notes:',
      '  - --force is required when transfer is currently terminal (CLAIMED_*, REFUNDED, EXPIRED).',
      '  - Script resets status to CLAIM_STARTED and clears claimed_at/refunded_at.',
      '  - Verify on-chain state before forcing terminal transfers.',
    ].join('\n')
  );
}

function hashClaimToken(token, pepper) {
  return crypto.createHash('sha256').update(`claim:${token}:${pepper}`, 'utf8').digest('hex');
}

function generateClaimToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function isTerminalStatus(status) {
  return (
    status === 'CLAIMED_DEBIT' ||
    status === 'CLAIMED_BANK' ||
    status === 'CLAIMED_WALLET' ||
    status === 'REFUNDED' ||
    status === 'EXPIRED'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ((!Number.isFinite(args.rowId) || args.rowId <= 0) && !args.transferId && !args.lookupClaimToken) {
    usage();
    process.exit(1);
  }

  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const tokenPepper = process.env.SEND_TOKEN_PEPPER || '';
  const claimToken = args.claimToken || generateClaimToken();
  const claimTokenHash = hashClaimToken(claimToken, tokenPepper);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const lookup = args.transferId
      ? await client.query(
          `
          SELECT id, transfer_id, status, expires_at
          FROM send_transfers
          WHERE transfer_id = $1
          LIMIT 1
          `,
          [args.transferId]
        )
      : args.lookupClaimToken
      ? await client.query(
          `
          SELECT id, transfer_id, status, expires_at
          FROM send_transfers
          WHERE claim_token_hash = $1
          LIMIT 1
          `,
          [hashClaimToken(args.lookupClaimToken, tokenPepper)]
        )
      : await client.query(
          `
          SELECT id, transfer_id, status, expires_at
          FROM send_transfers
          WHERE id = $1
          LIMIT 1
          `,
          [args.rowId]
        );

    if (lookup.rows.length === 0) {
      console.error('Transfer not found');
      process.exit(1);
    }

    const row = lookup.rows[0];
    const status = String(row.status || '');
    const now = Date.now();
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;

    if (isTerminalStatus(status) && !args.force) {
      console.error(
        `Transfer is in terminal status (${status}). Re-run with --force only after verifying on-chain that it is still unclaimed.`
      );
      process.exit(1);
    }

    if (expiresAt && now > expiresAt.getTime() && !args.force) {
      console.error('Transfer is expired. Re-run with --force if you want to reopen claim manually.');
      process.exit(1);
    }

    await client.query(
      `
      UPDATE send_transfers
      SET
        claim_token_hash = $1,
        status = 'CLAIM_STARTED',
        claimed_at = NULL,
        refunded_at = NULL,
        updated_at = NOW()
      WHERE id = $2
      `,
      [claimTokenHash, row.id]
    );

    const claimBase = (process.env.SEND_CLAIM_APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
    console.log('Transfer repaired');
    console.log(`rowId=${row.id}`);
    console.log(`transferId=${row.transfer_id}`);
    console.log(`claimUrl=${claimBase}/claim/${claimToken}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed to recover claim link');
  process.exit(1);
});
