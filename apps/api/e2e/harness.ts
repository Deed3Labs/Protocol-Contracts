import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Shared by the end-to-end runs (live.ts, contract.ts): boots the real API as it runs in production
 * against the Postgres in DATABASE_URL, and seeds Mike's Tire through the real stores (staff with
 * hashed PINs, real sessions, a connected card account).
 */

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
export const WEBHOOK_SECRET = 'whsec_e2e_local';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function bootApi(opts: { port: number; databaseUrl: string; stripeKey: string | null }) {
  const server = spawn('bun', ['src/index.ts'], {
    cwd: API_DIR,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      PORT: String(opts.port),
      DATABASE_URL: opts.databaseUrl,
      POSTGRES_SSL_MODE: process.env.POSTGRES_SSL_MODE ?? 'disable',
      ...(opts.stripeKey ? { STRIPE_SECRET_KEY: opts.stripeKey } : {}),
      STRIPE_CONNECT_WEBHOOK_SECRET: WEBHOOK_SECRET,
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const stop = () => server.kill('SIGTERM');
  process.on('exit', stop);
  const base = `http://localhost:${opts.port}/api`;
  for (let i = 0; ; i++) {
    if (i > 60) throw new Error(`The API didn't come up:\n${log.slice(-3000)}`);
    const up = await fetch(`${base}/merchant/cards/availability`).then((r) => r.status).catch(() => 0);
    if (up === 401) break;
    await sleep(1000);
  }
  return { base, stop, log: () => log };
}

export const PINS = { owner: '9090', manager: '4321', jen: '1111', luis: '2222' };

/** Mike's Tire in the database at DATABASE_URL, with one session per person. */
export async function seedShop(opts: { databaseUrl: string; stripeAccount: string | null }) {
  process.env.DATABASE_URL = opts.databaseUrl;
  process.env.POSTGRES_SSL_MODE = process.env.POSTGRES_SSL_MODE ?? 'disable';
  const { getMerchantPool } = await import('../src/config/merchantDb.js');
  const { poolDb } = await import('../src/db/db.js');
  const { staffStore } = await import('../src/services/merchant/staffStore.js');
  const { sessionStore } = await import('../src/services/merchant/sessionStore.js');
  const { connectorStore } = await import('../src/services/merchant/cards/connectorStore.js');
  const db = poolDb(getMerchantPool()!);

  const merchant = `0x${Date.now().toString(16).padStart(40, '0')}`;
  await db.query(
    `INSERT INTO merchant.profiles (merchant, name, address_line1, address_city, address_region, address_postal_code) VALUES ($1, 'Mike''s Tire', '412 Colton Ave', 'Redlands', 'CA', '92374')`,
    [merchant],
  );
  const staff = {
    owner: (await staffStore.add({ merchant, name: 'Mike', role: 'owner', secret: PINS.owner }))!,
    manager: (await staffStore.add({ merchant, name: 'Dana', role: 'manager', secret: PINS.manager }))!,
    jen: (await staffStore.add({ merchant, name: 'Jen', role: 'counter', secret: PINS.jen }))!,
    luis: (await staffStore.add({ merchant, name: 'Luis', role: 'counter', secret: PINS.luis }))!,
  };
  const token = Object.fromEntries(await Promise.all(Object.entries(staff).map(async ([k, s]) => [k, (await sessionStore.create(s))!.token]))) as Record<keyof typeof staff, string>;
  if (opts.stripeAccount) {
    // One live connection per account: an earlier run's shop on this test database lets it go.
    await db.query(`UPDATE merchant.card_connectors SET disconnected_at = now() WHERE provider = 'stripe' AND external_account_id = $1 AND disconnected_at IS NULL`, [opts.stripeAccount]);
    await connectorStore.insert(db, { merchant, provider: 'stripe', externalAccountId: opts.stripeAccount, connectedBy: staff.owner.id });
    await connectorStore.applyStatus(db, { provider: 'stripe', externalAccountId: opts.stripeAccount, chargesEnabled: true, detailsSubmitted: true, at: new Date() });
  }
  return { db, merchant, staff, token, end: () => getMerchantPool()?.end() };
}
