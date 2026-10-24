import { merchantDb } from '../../config/merchantDb.js';
import { requireIdentity } from '../../middleware/auth.js';
import { limitByAddress } from '../../middleware/rateLimiter.js';
import { commandRouter, commandSharedRouter } from '../../routes/command.js';
import { indexerCatchUp } from '../../jobs/commandIndexer.js';
import { memberStore } from '../memberStore.js';

/**
 * The Command Center's router with the real pieces: the shared Postgres (migrations run at start-up
 * with the merchant ones), Privy, the member store for "has a Clear account", and Resend.
 *
 * Env: COMMAND_ADMIN_EMAILS (comma-separated; each becomes Admin on first sign-in), COMMAND_APP_URL
 * (where invite links point, default https://command.useclear.org), and the API's RESEND_API_KEY and
 * RESEND_FROM.
 */
/** Shared document links: opened without signing in, so mounted ahead of the Command Center's router. */
export function liveCommandSharedRouter() {
  return commandSharedRouter({ db: merchantDb });
}

export function liveCommandRouter() {
  return commandRouter({
    db: merchantDb,
    identify: requireIdentity,
    isMember: async (auth) =>
      !!(await memberStore.resolveCanonicalAuthSubject({
        authSubject: auth.profileUuid,
        profileUuid: auth.profileUuid,
        walletAddress: auth.walletAddress || null,
        walletAddresses: auth.addresses,
        email: auth.email,
        phone: auth.phone,
      })),
    mail: sendMail,
    indexer: { catchUp: indexerCatchUp },
    adminEmails: () => (process.env.COMMAND_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean),
    appUrl: () => process.env.COMMAND_APP_URL || 'https://command.useclear.org',
    limits: {
      signIn: limitByAddress('command-sign-in', 60_000, 10),
      write: limitByAddress('command-write', 60_000, 60),
    },
  });
}

async function sendMail(m: { to: string; subject: string; text: string }): Promise<void> {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) throw new Error('Email isn’t set up on this server (RESEND_API_KEY), so the invite can’t be sent');
  const from = (process.env.RESEND_FROM || 'Clear <receipts@useclear.org>').trim();
  const r = await fetch((process.env.RESEND_API_BASE_URL || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`Resend refused the email (${r.status})`);
}
