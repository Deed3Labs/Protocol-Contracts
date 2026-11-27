import type { Request, Response } from 'express';
import { sessionLock } from '../services/session/sessionLock.js';

/*
 * Every signed-in request passes here (from requireAuth): a session idle past the lock is refused
 * with 423 APP_LOCKED -- not 401, which the app reads as "signed out" and tears the session down.
 *
 * Open while locked: only what it takes to open it again. Face ID the server checks
 * (/api/step-up/options, /verify, /status) and asking whether it is locked (GET /api/session).
 * The activity report is deliberately NOT open, so a locked session cannot report itself active.
 */
const OPEN_WHILE_LOCKED = [
  /^\/api\/step-up\/(options|verify|status)\/?$/,
  /^\/api\/session\/?$/,
];

export function openWhileLocked(req: Request): boolean {
  const path = (req.originalUrl || req.url || '').split('?')[0];
  if (path === '/api/session' || path === '/api/session/') return req.method === 'GET';
  return OPEN_WHILE_LOCKED.some((re) => re.test(path));
}

export async function sessionOpen(req: Request, res: Response): Promise<boolean> {
  const sessionId = req.auth?.sessionId;
  const userId = req.auth?.profileUuid;
  if (!sessionId || !userId || !sessionLock.available() || openWhileLocked(req)) return true;
  try {
    if (!(await sessionLock.locked(sessionId, userId))) return true;
  } catch (error) {
    // Open, unlike step-up: this is every request, and money moves still ask for Face ID there.
    console.error('[session-lock] could not read session', (error as Error)?.message);
    return true;
  }
  res.status(423).json({ error: 'Clear is locked. Open it with Face ID or sign in again.', code: 'APP_LOCKED' });
  return false;
}
