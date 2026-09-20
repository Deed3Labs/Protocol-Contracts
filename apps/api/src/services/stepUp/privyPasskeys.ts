import { PrivyClient } from '@privy-io/server-auth';

/*
 * Taking a passkey off a member's Privy account when the app cannot.
 *
 * Privy will not unenrol an MFA method without MFA verification, and the method here IS the passkey
 * -- so a member who deleted it from their phone is asked for the thing they are removing, and the
 * dashboard offers no way out either. The app secret alone cannot do it: the ordinary account-unlink
 * refuses ("MFA-enrolled passkeys must be unlinked via POST /users/{userId}/passkeys/unlink"), and
 * that route wants the member's own access token.
 *
 * Which the API is already holding: it arrives as the Bearer token on every request, verified by
 * requireAuth. So this is the one place that can do it, and it does it only behind the same check as
 * registering a replacement -- a sign-in made minutes ago, which takes a code to the member's own
 * email or phone.
 */

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const AUTH_API = 'https://auth.privy.io/api/v1';

export interface UnlinkResult {
  unlinked: string[];
  /** Privy's own words, when it refused. Kept because this route is new ground. */
  failures: { credentialId: string; reason: string }[];
}

let client: PrivyClient | null = null;
function privy(): PrivyClient | null {
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) return null;
  if (!client) client = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
  return client;
}

/** The credential ids of every passkey on this account. */
export async function passkeysOf(userId: string): Promise<string[]> {
  const p = privy();
  if (!p) return [];
  const user = await p.getUser(userId);
  return (user.linkedAccounts ?? [])
    .filter((a): a is Extract<typeof a, { type: 'passkey' }> => a.type === 'passkey')
    .map((a) => a.credentialId);
}

/** Take every passkey off the account, MFA enrolment and all. `userToken` is the member's own. */
export async function unlinkPasskeys(userId: string, userToken: string): Promise<UnlinkResult> {
  const result: UnlinkResult = { unlinked: [], failures: [] };
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) return result;

  for (const credentialId of await passkeysOf(userId)) {
    try {
      const response = await fetch(`${AUTH_API}/users/${userId}/passkeys/unlink`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString('base64')}`,
          'privy-app-id': PRIVY_APP_ID,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ user_jwt: userToken, credential_id: credentialId }),
      });
      if (response.ok) {
        result.unlinked.push(credentialId);
        continue;
      }
      const reason = (await response.text().catch(() => '')).slice(0, 300);
      result.failures.push({ credentialId, reason: `${response.status} ${reason}` });
    } catch (error) {
      result.failures.push({ credentialId, reason: (error as Error)?.message ?? 'unreachable' });
    }
  }
  if (result.failures.length) console.warn('[face-id] Privy would not unlink a passkey:', result.failures.map((f) => f.reason).join('; '));
  return result;
}
