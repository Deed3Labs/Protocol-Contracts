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

function resolveDefaultPoolMax(): number {
  const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  if (process.env.NODE_ENV === 'production' && isRailway) {
    // Railway Postgres plans are often connection-constrained; prefer a safer default when unset.
    return 3;
  }
  return 10;
}

function resolveConnectionLabel(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const database = url.pathname.replace(/^\//, '') || '(default)';
    const port = url.port || '5432';
    return `${url.hostname}:${port}/${database}`;
  } catch {
    return 'configured';
  }
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
  const max = parseIntEnv('POSTGRES_POOL_MAX', resolveDefaultPoolMax());

  return {
    connectionString,
    max,
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
  console.info(
    `[Postgres] Pool initialized target=${resolveConnectionLabel(config.connectionString || '')} `
      + `max=${config.max ?? 'default'} idleMs=${config.idleTimeoutMillis ?? 'default'} `
      + `connectTimeoutMs=${config.connectionTimeoutMillis ?? 'default'} ssl=${Boolean(config.ssl)}`
  );
  postgresPool.on('error', (error: Error) => {
    console.error('Postgres pool error:', error.message);
  });

  return postgresPool;
}

export async function closePostgresPool(): Promise<void> {
  if (!postgresPool) {
    return;
  }

  const pool = postgresPool;
  postgresPool = null;
  await pool.end();
}
