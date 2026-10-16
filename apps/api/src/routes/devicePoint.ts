import { createHash } from 'node:crypto';
import { ActivatePoint, type PointScreen } from '@clear/merchant-contracts';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import type { Db } from '../db/db.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { limitByAddress } from '../middleware/rateLimiter.js';
import { nextChange, onShopChange, WAIT_MS } from '../services/merchant/terminal/bus.js';
import { TERMINAL_STATUS, TerminalError } from '../services/merchant/terminal/errors.js';
import { pointButton } from '../services/merchant/terminal/floor.js';
import { firmwareForPoint } from '../services/merchant/terminal/firmware.js';
import { activatePoint, pointByKey, recordHealth, sawPoint, type PointIdentity } from '../services/merchant/terminal/hardware.js';
import { screenFor } from '../services/merchant/terminal/pointState.js';

/**
 * The device API a Point talks to (terminal reference, section 14; docs/hardware/point-device-api.md).
 * A Point authenticates with its own device key (`Authorization: Bearer`), never a person's session.
 *
 *   POST /api/device/point/activate   once, with the setup secret the tablet passed it: its key
 *   GET  /api/device/point/state      what to show, with an ETag. On battery it asks with
 *                                     If-None-Match and the answer waits until something changes
 *                                     (304 after ~25s if nothing did)
 *   GET  /api/device/point/stream     plugged in: the same, as server-sent events
 *   POST /api/device/point/health     battery, signal, firmware, the case
 *   POST /api/device/point/event      a Pay case button
 *   GET  /api/device/point/firmware   its model's newest signed firmware (204: none)
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      point?: PointIdentity;
    }
  }
}

export interface DevicePointDeps {
  db: () => Promise<Db | null>;
  limit: RequestHandler;
  /** How long a long poll waits for a change (shorter in tests). */
  waitMs?: number;
}

export const defaultDevicePointDeps = (): DevicePointDeps => ({ db: merchantDb, limit: limitByAddress('point-activate', 60_000, 10) });

const etagOf = (screen: PointScreen) => `"${createHash('sha256').update(JSON.stringify(screen)).digest('base64url').slice(0, 22)}"`;

export function devicePointRouter(deps: DevicePointDeps = defaultDevicePointDeps()): Router {
  const router = forwardAsyncErrors(Router());

  const refuse = (res: Response, error: unknown) => {
    if (error instanceof TerminalError) return res.status(TERMINAL_STATUS[error.code]).json({ error: error.code, message: error.message });
    throw error;
  };

  async function asPoint(req: Request, res: Response, next: NextFunction) {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'Unavailable', message: 'not available right now' });
    const header = req.headers.authorization || '';
    const point = await pointByKey(db, header.startsWith('Bearer ') ? header.slice(7).trim() : '');
    if (!point) return res.status(401).json({ error: 'Unauthorized', message: 'this Point isn’t set up' });
    req.point = point;
    await sawPoint(db, point);
    next();
  }

  router.post('/activate', deps.limit, async (req, res) => {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'Unavailable', message: 'not available right now' });
    const parsed = ActivatePoint.safeParse(req.body);
    if (!parsed.success) return res.status(422).json({ error: 'invalid', message: 'A code and the setup secret' });
    try {
      res.json(await activatePoint(db, parsed.data));
    } catch (error) {
      refuse(res, error);
    }
  });

  router.get('/state', asPoint, async (req, res) => {
    const db = (await deps.db())!;
    const point = req.point!;
    let { screen, nextChangeAt } = await screenFor(db, point.deviceId);
    const asked = req.headers['if-none-match'];
    if (asked && asked === etagOf(screen)) {
      // Hold the answer until the shop changes, what it shows lapses by itself, or the wait runs out.
      const wait = deps.waitMs ?? WAIT_MS;
      const until = nextChangeAt ? Math.min(wait, nextChangeAt.getTime() - Date.now() + 50) : wait;
      await nextChange(point.merchant, until);
      ({ screen, nextChangeAt } = await screenFor(db, point.deviceId));
      if (asked === etagOf(screen)) return res.status(304).end();
    }
    res.setHeader('ETag', etagOf(screen));
    res.setHeader('Cache-Control', 'no-store');
    res.json(screen);
  });

  router.get('/stream', asPoint, async (req, res) => {
    const db = (await deps.db())!;
    const point = req.point!;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let last = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const send = async () => {
      if (closed) return;
      const { screen, nextChangeAt } = await screenFor(db, point.deviceId);
      const tag = etagOf(screen);
      if (tag !== last) {
        last = tag;
        res.write(`event: state\nid: ${tag}\ndata: ${JSON.stringify(screen)}\n\n`);
      }
      if (timer) clearTimeout(timer);
      if (nextChangeAt) timer = setTimeout(() => void send().catch(() => undefined), Math.max(0, nextChangeAt.getTime() - Date.now() + 50));
    };
    const stop = onShopChange(point.merchant, () => void send().catch(() => undefined));
    // A comment every 20s keeps proxies from closing a quiet stream.
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
    req.on('close', () => {
      closed = true;
      stop();
      clearInterval(beat);
      if (timer) clearTimeout(timer);
    });
    await send();
  });

  // The newest firmware for this Point's model, signed; 204 when none is published (docs, 7).
  router.get('/firmware', asPoint, async (req, res) => {
    const m = await firmwareForPoint((await deps.db())!, req.point!.deviceId);
    res.setHeader('Cache-Control', 'no-store');
    if (!m) return res.status(204).end();
    res.json(m);
  });

  router.post('/health', asPoint, async (req, res) => {
    try {
      await recordHealth((await deps.db())!, req.point!, req.body);
      res.status(204).end();
    } catch (error) {
      refuse(res, error);
    }
  });

  router.post('/event', asPoint, async (req, res) => {
    try {
      const request = await pointButton((await deps.db())!, { point: req.point!, event: req.body });
      res.json({ request });
    } catch (error) {
      refuse(res, error);
    }
  });

  return router;
}
