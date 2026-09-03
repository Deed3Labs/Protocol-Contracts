import { Pool, type PoolConfig } from 'pg';

let postgresPool: Pool | null = null;

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldUseSsl(connectionString: string): boolean {
  const sslMode = (process.env.POSTGRES_SSL_MODE || process.env.PGSSLMODE || '').toLowerCase().trim();
  if (sslMode) {
    return sslMode !== 'disable' && sslMode !== 'allow';
  }

  if (connectionString.includes('sslmode=require')) {
    return true;
  }

  return process.env.NODE_ENV === 'production';
}

function getPoolConfig(): PoolConfig | null {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.PG_CONNECTION_STRING ||
    '';

  if (!connectionString) {
    return null;
  }

  const sslEnabled = shouldUseSsl(connectionString);

  return {
    connectionString,
    // Five, not ten. Two pools at ten each held twenty connections open against Railway Postgres,
    // and an idle connection is not free on either side — Node keeps a socket and Postgres forks a
    // backend with its own work_mem. This app's concurrency is nowhere near ten per pool, and
    // POSTGRES_POOL_MAX raises it the moment a slow-query backlog says otherwise.
    max: parseIntEnv('POSTGRES_POOL_MAX', 5),
    idleTimeoutMillis: parseIntEnv('POSTGRES_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: parseIntEnv('POSTGRES_CONNECTION_TIMEOUT_MS', 10_000),
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  };
}

export function getPostgresPool(): Pool | null {
  if (postgresPool) {
    return postgresPool;
  }

  const config = getPoolConfig();
  if (!config) {
    return null;
  }

  postgresPool = new Pool(config);
  postgresPool.on('error', (error: Error) => {
    console.error('Postgres pool error:', error.message);
  });

  return postgresPool;
}

let payPool: Pool | null = null;

/**
 * Pool for the Clear Pay equity-credit ledger.
 *
 * Uses PAY_DATABASE_URL when set, so the ledger can live in its own database; falls back to the
 * shared pool otherwise — and the fallback is the cheaper arrangement, not a degraded one. A second
 * Railway Postgres is a second instance billed and a second set of connections held, for tables
 * that no query ever joins across. Unset PAY_DATABASE_URL after moving the tables across and this
 * collapses to one database with no code change.
 */
export function getPayPool(): Pool | null {
  const connectionString = process.env.PAY_DATABASE_URL || '';
  if (!connectionString) return getPostgresPool();
  if (payPool) return payPool;

  payPool = new Pool({
    connectionString,
    max: parseIntEnv('POSTGRES_POOL_MAX', 5),
    idleTimeoutMillis: parseIntEnv('POSTGRES_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: parseIntEnv('POSTGRES_CONNECTION_TIMEOUT_MS', 10_000),
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  payPool.on('error', (error: Error) => console.error('Pay Postgres pool error:', error.message));
  return payPool;
}

export async function closePostgresPool(): Promise<void> {
  if (!postgresPool) {
    return;
  }

  const pool = postgresPool;
  postgresPool = null;
  await pool.end();
}
