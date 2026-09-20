import { Router, type Request, type Response } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { stepUpStore, type StepUpCredential } from '../services/stepUp/stepUpStore.js';
import { issueChallenge, issueStepUpToken, redeemChallenge, stepUpTokenValid } from '../services/stepUp/stepUpToken.js';
import { STEP_UP_HEADER, stepUpRequired } from '../middleware/stepUp.js';
import { sessionLock } from '../services/session/sessionLock.js';

/*
 * Server-verified Face ID (see middleware/stepUp for where it is required).
 *
 *   GET    /status             whether this member has a credential here
 *   POST   /register/options   start adding one (the first needs only the session; any after it,
 *                              a fresh Face ID from one already registered)
 *   POST   /register/verify    finish adding one; also counts as a Face ID check
 *   POST   /options            start a check
 *   POST   /verify             finish a check -> a two-minute step-up token
 *   DELETE /                   remove them all (Face ID off), behind a Face ID check itself
 *
 * A verified check also opens a session the server-side lock closed (middleware/sessionLock).
 *
 * The relying party is the page's own domain, read from its Origin, and only for Clear's domains:
 * a credential made on demo.useclear.org answers only there.
 */
const stepUpRouter = Router();

/*
 * The site our credentials belong to.
 *
 * Deliberately the registrable domain (useclear.org) rather than the page's host
 * (demo.useclear.org), which is where Privy registers its sign-in passkeys. A passkey is offered only
 * for its own site, so this keeps the two apart: the sign-in prompt shows only the passkey that signs
 * in, and ours shows only ours. Both work on every Clear subdomain.
 */
function relyingParty(req: Request): { rpID: string; hostRpID: string; origin: string } | null {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const extra = (process.env.STEP_UP_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const host = url.hostname;
  const ours =
    extra.includes(origin) ||
    (url.protocol === 'https:' && (host === 'useclear.org' || host.endsWith('.useclear.org'))) ||
    (url.protocol === 'http:' && host === 'localhost');
  if (!ours) return null;
  const apex = host === 'useclear.org' || host.endsWith('.useclear.org') ? 'useclear.org' : host;
  return { rpID: apex, hostRpID: host, origin };
}

/**
 * The member's credentials for this request, and the site they answer for.
 *
 * Credentials registered before the move to the registrable domain still carry the page's host, and
 * they must keep working -- a member cannot register a replacement without Face ID from one of these.
 */
function credentialsFor(all: StepUpCredential[], rp: { rpID: string; hostRpID: string }): { rpId: string; credentials: StepUpCredential[] } {
  const preferred = all.filter((c) => c.rpId === rp.rpID);
  if (preferred.length) return { rpId: rp.rpID, credentials: preferred };
  return { rpId: rp.hostRpID, credentials: all.filter((c) => c.rpId === rp.hostRpID) };
}

const userOf = (req: Request) => req.auth?.profileUuid || '';

async function openSession(req: Request): Promise<void> {
  const sessionId = req.auth?.sessionId;
  const userId = userOf(req);
  if (sessionId && userId && sessionLock.available()) await sessionLock.touch(sessionId, userId, true);
}

const transportsOf = (t: string[]) => t as AuthenticatorTransportFuture[];
const challengeBytes = (c: string) => new Uint8Array(Buffer.from(c, 'base64url'));

stepUpRouter.get('/status', async (req: Request, res: Response) => {
  const userId = userOf(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!stepUpStore.available()) return res.json({ enrolled: false, available: false });
  try {
    const credentials = await stepUpStore.listFor(userId);
    return res.json({ enrolled: credentials.length > 0, available: true, count: credentials.length });
  } catch (error) {
    console.error('[step-up] status failed', (error as Error)?.message);
    return res.status(503).json({ error: 'Could not read Face ID status' });
  }
});

stepUpRouter.post('/register/options', async (req: Request, res: Response) => {
  const userId = userOf(req);
  const rp = relyingParty(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!rp) return res.status(400).json({ error: 'Face ID is not available on this site.' });
  if (!stepUpStore.available()) return res.status(503).json({ error: 'Face ID cannot be set up just now.' });

  const existing = await stepUpStore.listFor(userId);
  // Adding a device is how someone holding only a stolen session would get past Face ID -- so it
  // takes Face ID from a device already on the account.
  if (existing.length && !stepUpTokenValid(req.header(STEP_UP_HEADER) || undefined, userId)) {
    return stepUpRequired(req, res);
  }

  const options = await generateRegistrationOptions({
    rpName: 'Clear',
    rpID: rp.rpID,
    userName: req.auth?.email || req.auth?.phone || 'Clear member',
    userDisplayName: 'Clear',
    userID: new TextEncoder().encode(userId),
    challenge: challengeBytes(issueChallenge(userId, 'register')),
    attestationType: 'none',
    excludeCredentials: existing.filter((c) => c.rpId === rp.rpID).map((c) => ({ id: c.credentialId, transports: transportsOf(c.transports) })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  return res.json({ options });
});

stepUpRouter.post('/register/verify', async (req: Request, res: Response) => {
  const userId = userOf(req);
  const rp = relyingParty(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!rp) return res.status(400).json({ error: 'Face ID is not available on this site.' });
  try {
    const result = await verifyRegistrationResponse({
      response: req.body?.response,
      expectedChallenge: (c: string) => redeemChallenge(c, userId, 'register'),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo) {
      return res.status(400).json({ error: 'Face ID was not set up. Please try again.' });
    }
    const { credential } = result.registrationInfo;
    await stepUpStore.add({
      credentialId: credential.id,
      userId,
      rpId: rp.rpID,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? [],
    });
    console.log(`[step-up] credential registered for a member on ${rp.rpID}`);
    return res.json({ enrolled: true, ...issueStepUpToken(userId) });
  } catch (error) {
    console.warn('[step-up] registration rejected', (error as Error)?.message);
    return res.status(400).json({ error: 'Face ID was not set up. Please try again.' });
  }
});

stepUpRouter.post('/options', async (req: Request, res: Response) => {
  const userId = userOf(req);
  const rp = relyingParty(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!rp) return res.status(400).json({ error: 'Face ID is not available on this site.' });
  const { rpId, credentials } = credentialsFor(await stepUpStore.listFor(userId), rp);
  if (!credentials.length) return res.status(409).json({ error: 'No Face ID set up here.', code: 'STEP_UP_NOT_ENROLLED' });
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    challenge: challengeBytes(issueChallenge(userId, 'prove')),
    allowCredentials: credentials.map((c) => ({ id: c.credentialId, transports: transportsOf(c.transports) })),
    userVerification: 'required',
  });
  return res.json({ options });
});

stepUpRouter.post('/verify', async (req: Request, res: Response) => {
  const userId = userOf(req);
  const rp = relyingParty(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!rp) return res.status(400).json({ error: 'Face ID is not available on this site.' });
  const response = req.body?.response;
  const { rpId, credentials } = credentialsFor(await stepUpStore.listFor(userId), rp);
  const credential = credentials.find((c) => c.credentialId === response?.id);
  // Only the member's own credentials are looked at, so another member's cannot answer for them.
  if (!credential) return res.status(400).json({ error: 'Face ID did not match.' });
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (c: string) => redeemChallenge(c, userId, 'prove'),
      expectedOrigin: rp.origin,
      expectedRPID: rpId,
      credential: {
        id: credential.credentialId,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: transportsOf(credential.transports),
      },
      requireUserVerification: true,
    });
    if (!result.verified) return res.status(400).json({ error: 'Face ID did not match.' });
    await stepUpStore.markUsed(credential.credentialId, result.authenticationInfo.newCounter);
    // Face ID the server checked is also what opens a locked session (middleware/sessionLock).
    await openSession(req);
    return res.json(issueStepUpToken(userId));
  } catch (error) {
    console.warn('[step-up] check rejected', (error as Error)?.message);
    return res.status(400).json({ error: 'Face ID did not match.' });
  }
});

stepUpRouter.delete('/', async (req: Request, res: Response) => {
  const userId = userOf(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const credentials = await stepUpStore.listFor(userId);
  // Turning Face ID off is the other way round it, so it asks for Face ID too.
  if (credentials.length && !stepUpTokenValid(req.header(STEP_UP_HEADER) || undefined, userId)) {
    return stepUpRequired(req, res);
  }
  const removed = await stepUpStore.removeAll(userId);
  return res.json({ removed });
});

export default stepUpRouter;
