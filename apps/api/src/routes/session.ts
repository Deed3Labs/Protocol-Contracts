import { Router, type Request, type Response } from 'express';
import { SESSION_LOCK_AFTER_MS, sessionLock } from '../services/session/sessionLock.js';

/*
 * The server-side lock (middleware/sessionLock).
 *
 *   GET  /api/session          { locked } -- answered even while locked, so the app can show the lock
 *   POST /api/session/active   the member used the app; refused while locked, like everything else
 *
 * Opening a locked session is Face ID the server verified (routes/stepUp /verify), or signing in again.
 */
const sessionRouter = Router();

sessionRouter.get('/', async (req: Request, res: Response) => {
  const sessionId = req.auth?.sessionId;
  const userId = req.auth?.profileUuid;
  if (!sessionId || !userId || !sessionLock.available()) return res.json({ locked: false, lockAfterMs: SESSION_LOCK_AFTER_MS });
  try {
    return res.json({ locked: await sessionLock.locked(sessionId, userId), lockAfterMs: SESSION_LOCK_AFTER_MS });
  } catch {
    return res.json({ locked: false, lockAfterMs: SESSION_LOCK_AFTER_MS });
  }
});

sessionRouter.post('/active', async (req: Request, res: Response) => {
  const sessionId = req.auth?.sessionId;
  const userId = req.auth?.profileUuid;
  if (sessionId && userId && sessionLock.available()) {
    await sessionLock.touch(sessionId, userId).catch(() => undefined);
  }
  return res.json({ ok: true });
});

export default sessionRouter;
