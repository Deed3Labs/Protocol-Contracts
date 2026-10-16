import type { Role } from '@clear/merchant-contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import type { Db } from '../db/db.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireDevice, requireManager, requireMerchant, requireOwner } from '../middleware/merchantAuth.js';
import { staffStore } from '../services/merchant/staffStore.js';
import { approveNoSale, drawerDay, saveDrawerEvents, type PinCheck } from '../services/merchant/terminal/drawerLog.js';
import { TERMINAL_STATUS, TerminalError } from '../services/merchant/terminal/errors.js';
import * as floor from '../services/merchant/terminal/floor.js';
import { addDevice, claimPoint, drawerKey, getDevice, listHardware, removeDevice, updateDevice } from '../services/merchant/terminal/hardware.js';
import { showOnPoint } from '../services/merchant/terminal/pointState.js';
import { defaultTexter, type Texter } from '../services/merchant/terminal/texts.js';

/**
 * Clear Terminal for the tablet (terminal reference, sections 1–9, 13b), mounted on /api/merchant.
 *
 *   GET    /hardware                  Points, drawers, printers (anyone on shift: Show on, the drawer)
 *   POST   /hardware                  owners: a drawer or printer the tablet found
 *   PATCH  /hardware/:id   DELETE     owners: settings, or unpair
 *   POST   /points/claim              owners: an unclaimed Point by its code, and its setup secret
 *   POST   /points/:id/show           an order, an alert, the test screen, or clear
 *   GET    /drawers/:id/key           an enrolled tablet: the drawer's signing key, kept for offline
 *   POST   /drawer/events             the drawer's log, once each however often it's sent
 *   POST   /drawer/no-sale            a No sale's reason and PIN, before the drawer opens
 *   GET    /drawer/:id/opens          Close the day › the drawer
 *   GET    /tables   PUT (managers)   the floor; Edit tables
 *   POST   /tables/:id/seat|clear     staff seat a table (clears a hold); a paid table is free again
 *   GET    /waitlist   POST           the list; add a party
 *   PATCH  /waitlist/:id              move, gone, or the table they'll get
 *   POST   /waitlist/:id/seat         the Seat sheet
 *   POST   /alerts   /alerts/:id/clear  Table ready, Order ready
 *   GET    /pickups   POST /orders/:id/picked-up   Home's Order ready
 *   GET    /table-requests   POST /table-requests/:id/answer   Calls and bills
 *
 * Built from its dependencies so the tests can run it on PGlite with a stand-in sign-in.
 */

export interface TerminalRouteDeps {
  db: () => Promise<Db | null>;
  auth: { merchant: RequestHandler; manager: RequestHandler; owner: RequestHandler; device: RequestHandler };
  texter: Texter;
  pinCheck: PinCheck;
  /** Where a claimed Point is told to find the API. */
  apiBase: () => string;
}

const pinCheck: PinCheck = async (merchant, pin) => {
  const staff = await staffStore.signInWithPin(merchant, pin);
  return staff ? { id: staff.id, role: staff.role as Role } : null;
};

export const defaultTerminalDeps = (): TerminalRouteDeps => ({
  db: merchantDb,
  auth: { merchant: requireMerchant, manager: requireManager, owner: requireOwner, device: requireDevice },
  texter: defaultTexter(),
  pinCheck,
  apiBase: () => (process.env.POINT_API_BASE_URL || process.env.API_PUBLIC_URL || 'https://api.useclear.org').replace(/\/+$/, ''),
});

export function merchantTerminalRouter(deps: TerminalRouteDeps = defaultTerminalDeps()): Router {
  const router = forwardAsyncErrors(Router());
  const { merchant: signedIn, manager, owner, device } = deps.auth;

  const run = (fn: (db: Db, req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response) => {
    const db = await deps.db();
    if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
    try {
      const out = await fn(db, req);
      if (out === undefined) return res.status(204).end();
      return res.status(status).json(out);
    } catch (error) {
      if (error instanceof TerminalError) return res.status(TERMINAL_STATUS[error.code]).json({ error: error.code, message: error.message });
      throw error;
    }
  };
  const m = (req: Request) => req.merchant!.merchant;
  const staff = (req: Request) => req.merchant!.staff.id;
  const id = (req: Request) => String(req.params.id);

  // ---- Hardware
  router.get('/hardware', signedIn, run((db, req) => listHardware(db, m(req))));
  router.post('/hardware', signedIn, owner, run((db, req) => addDevice(db, { merchant: m(req), staffId: staff(req), device: req.body }), 201));
  router.patch('/hardware/:id', signedIn, owner, run((db, req) => updateDevice(db, { merchant: m(req), staffId: staff(req), id: id(req), patch: req.body })));
  router.delete('/hardware/:id', signedIn, owner, run(async (db, req) => {
    await removeDevice(db, { merchant: m(req), staffId: staff(req), id: id(req) });
    return undefined;
  }));
  router.post('/points/claim', signedIn, owner, run((db, req) => claimPoint(db, { merchant: m(req), staffId: staff(req), request: req.body, apiBase: deps.apiBase() })));
  router.post('/points/:id/show', signedIn, run(async (db, req) => {
    await showOnPoint(db, { merchant: m(req), staffId: staff(req), pointId: id(req), request: req.body });
    return getDevice(db, m(req), id(req));
  }));

  // ---- The drawer
  router.get('/drawers/:id/key', device, signedIn, run((db, req) => drawerKey(db, { merchant: m(req), drawerId: id(req) })));
  router.post('/drawer/events', signedIn, run((db, req) => saveDrawerEvents(db, { merchant: m(req), staffId: staff(req), batch: req.body })));
  router.post('/drawer/no-sale', signedIn, run((db, req) => approveNoSale(db, deps.pinCheck, { merchant: m(req), staff: { id: staff(req), role: req.merchant!.staff.role as Role }, request: req.body })));
  router.get('/drawer/:id/opens', signedIn, run((db, req) => drawerDay(db, { merchant: m(req), sessionId: id(req) })));

  // ---- Tables and the wait list
  router.get('/tables', signedIn, run((db, req) => floor.floor(db, m(req))));
  router.put('/tables', signedIn, manager, run(async (db, req) => {
    await floor.saveTables(db, { merchant: m(req), staffId: staff(req), tables: req.body?.tables });
    return floor.floor(db, m(req));
  }));
  router.post('/tables/:id/seat', signedIn, run((db, req) => floor.seatTable(db, { merchant: m(req), staffId: staff(req), tableId: id(req), request: req.body })));
  router.post('/tables/:id/move', signedIn, run((db, req) => floor.moveTable(db, { merchant: m(req), staffId: staff(req), tableId: id(req), request: req.body })));
  router.post('/tables/:id/clear', signedIn, run((db, req) => floor.clearTable(db, { merchant: m(req), staffId: staff(req), tableId: id(req) })));
  router.get('/waitlist', signedIn, run((db, req) => floor.waitlist(db, m(req))));
  router.post('/waitlist', signedIn, run((db, req) => floor.addParty(db, { merchant: m(req), staffId: staff(req), party: req.body, texter: deps.texter }), 201));
  router.patch('/waitlist/:id', signedIn, run((db, req) => floor.updateParty(db, { merchant: m(req), staffId: staff(req), partyId: id(req), patch: req.body })));
  router.post('/waitlist/:id/seat', signedIn, run((db, req) => floor.seatParty(db, deps.texter, { merchant: m(req), staffId: staff(req), partyId: id(req), request: req.body })));
  router.post('/waitlist/:id/notify', signedIn, run((db, req) => floor.notifyParty(db, deps.texter, { merchant: m(req), staffId: staff(req), partyId: id(req) })));
  router.post('/waitlist/:id/no-show', signedIn, run((db, req) => floor.noShowParty(db, { merchant: m(req), staffId: staff(req), partyId: id(req) })));

  // ---- Alerts, Order ready, Calls and bills
  router.post('/alerts', signedIn, run((db, req) => floor.createAlert(db, deps.texter, { merchant: m(req), staffId: staff(req), request: req.body }), 201));
  router.post('/alerts/:id/clear', signedIn, run((db, req) => floor.clearAlert(db, { merchant: m(req), alertId: id(req) })));
  router.get('/pickups', signedIn, run((db, req) => floor.pickups(db, m(req))));
  router.post('/orders/:id/picked-up', signedIn, run((db, req) => floor.markPickedUp(db, { merchant: m(req), staffId: staff(req), orderId: id(req) })));
  router.get('/table-requests', signedIn, run((db, req) => floor.tableRequests(db, m(req))));
  router.post('/table-requests/:id/answer', signedIn, run((db, req) => floor.answerTableRequest(db, { merchant: m(req), staffId: staff(req), requestId: id(req) })));

  return router;
}
