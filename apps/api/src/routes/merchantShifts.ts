import { Router, type Request, type Response } from 'express';
import { seesMoney } from '@clear/domain';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant } from '../middleware/merchantAuth.js';
import { endBreak, endShift, personHours, saveStaffHours, ShiftError, shiftsNow, staffWeek, startBreak } from '../services/merchant/shifts/shiftService.js';

/**
 * Shifts, breaks and staff hours, mounted on /api/merchant.
 *
 *   GET    /shifts                 anyone signed in: who is on shift now
 *   POST   /shifts/me/break        the caller starts a break
 *   DELETE /shifts/me/break        and ends it
 *   POST   /shifts/:staffId/end    owners and managers: end someone else's shift (a manager, only
 *                                  counter staff's); the caller's own ends with DELETE /session
 *   GET    /staff/week?date=       anyone signed in: the shop's hours and who is booked, that week
 *   GET    /staff/:id/hours?week=  owners and managers, or the person themselves
 *   PUT    /staff/:id/hours        owners; managers for counter staff and themselves
 *
 * A shift itself starts with a sign-in (POST /session, or the owner's on an enrolled tablet).
 */

const router = forwardAsyncErrors(Router());

function refuse(res: Response, error: unknown): void {
  if (error instanceof ShiftError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'invalid' ? 422 : 409;
    res.status(status).json({ error: error.code, message: error.message });
    return;
  }
  throw error;
}

async function db(res: Response) {
  const d = await merchantDb();
  if (!d) res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  return d;
}

/** Whether the caller may change `staffId`'s shift or hours: an owner anyone's, a manager counter staff's and their own. */
async function mayManage(req: Request, staffId: string): Promise<boolean> {
  const me = req.merchant!.staff;
  if (me.role === 'owner') return true;
  if (!seesMoney(me.role)) return false;
  if (staffId === me.id) return true;
  const d = await merchantDb();
  const { rows } = await d!.query<{ role: string }>('SELECT role FROM merchant.staff WHERE id = $1 AND merchant = $2', [staffId, req.merchant!.merchant]);
  return rows[0]?.role === 'counter';
}

router.get('/shifts', requireMerchant, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  res.json(await shiftsNow(d, req.merchant!.merchant));
});

router.post('/shifts/me/break', requireMerchant, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  try {
    res.json(await startBreak(d, { merchant: req.merchant!.merchant, staffId: req.merchant!.staff.id }));
  } catch (error) {
    refuse(res, error);
  }
});

router.delete('/shifts/me/break', requireMerchant, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  try {
    res.json(await endBreak(d, { merchant: req.merchant!.merchant, staffId: req.merchant!.staff.id }));
  } catch (error) {
    refuse(res, error);
  }
});

router.post('/shifts/:staffId/end', requireMerchant, requireManager, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  const staffId = String(req.params.staffId);
  if (!(await mayManage(req, staffId))) {
    res.status(403).json({ error: 'Forbidden', message: 'Only the owner ends a manager’s shift' });
    return;
  }
  await endShift(d, { merchant: req.merchant!.merchant, staffId, by: req.merchant!.staff.id });
  res.json({ ok: true });
});

router.get('/staff/week', requireMerchant, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
  res.json(await staffWeek(d, req.merchant!.merchant, date));
});

router.get('/staff/:id/hours', requireMerchant, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  const staffId = String(req.params.id);
  if (staffId !== req.merchant!.staff.id && !seesMoney(req.merchant!.staff.role)) {
    res.status(403).json({ error: 'Forbidden', message: 'that needs a manager' });
    return;
  }
  try {
    // `?week=` a date in the week the schedule is showing; this week when not given.
    const week = typeof req.query.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week) ? req.query.week : undefined;
    res.json(await personHours(d, req.merchant!.merchant, staffId, week));
  } catch (error) {
    refuse(res, error);
  }
});

router.put('/staff/:id/hours', requireMerchant, requireManager, async (req: Request, res: Response) => {
  const d = await db(res);
  if (!d) return;
  const staffId = String(req.params.id);
  if (!(await mayManage(req, staffId))) {
    res.status(403).json({ error: 'Forbidden', message: 'Only the owner sets a manager’s hours' });
    return;
  }
  try {
    res.json(await saveStaffHours(d, { merchant: req.merchant!.merchant, staffId, body: req.body }));
  } catch (error) {
    refuse(res, error);
  }
});

export default router;
