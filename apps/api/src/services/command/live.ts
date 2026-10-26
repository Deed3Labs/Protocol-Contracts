import { merchantDb } from '../../config/merchantDb.js';
import { requireIdentity } from '../../middleware/auth.js';
import { limitByAddress } from '../../middleware/rateLimiter.js';
import { commandCatalogRouter, commandJoinRouter, commandRouter, commandSharedRouter, commandWebhookRouter } from '../../routes/command.js';
import { indexerCatchUp } from '../../jobs/commandIndexer.js';
import { githubCatchUp } from '../../jobs/commandGithub.js';
import { liveChainReader } from './onchain.js';
import { memberStore } from '../memberStore.js';
import { sendMail } from './mail.js';
import { liveMemberSource } from './memberSource.js';

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

/** The sandbox providers' webhooks (Plaid's): checked by signature, so mounted ahead too. */
export function liveCommandWebhookRouter() {
  return commandWebhookRouter({ db: merchantDb });
}

/** The site's join form posts here (Phase 7b): no sign-in, 5 a minute an address. */
export function liveCommandCatalogRouter() {
  return commandCatalogRouter({ db: merchantDb });
}

export function liveCommandJoinRouter() {
  return commandJoinRouter({ db: merchantDb, limit: limitByAddress('command-join', 60_000, 5) });
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
    code: { catchUp: githubCatchUp },
    memberSource: liveMemberSource(),
    chain: liveChainReader(),
    adminEmails: () => (process.env.COMMAND_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean),
    appUrl: () => process.env.COMMAND_APP_URL || 'https://command.useclear.org',
    limits: {
      signIn: limitByAddress('command-sign-in', 60_000, 10),
      write: limitByAddress('command-write', 60_000, 60),
    },
  });
}
