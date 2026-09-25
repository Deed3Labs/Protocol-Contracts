import { seesMoney } from '@clear/domain';
import { Router, type Request, type Response } from 'express';
import { merchantDb } from '../config/merchantDb.js';
import { forwardAsyncErrors } from '../middleware/asyncRouter.js';
import { requireManager, requireMerchant } from '../middleware/merchantAuth.js';
import * as catalog from '../services/merchant/catalog/catalogService.js';
import { importCatalog } from '../services/merchant/catalog/importService.js';

/**
 * Inventory (card-processing prompt, Phase 6), mounted on /api/merchant.
 *
 *   GET   /catalog                          items, options, stock; cost only for managers and owners
 *   POST  /catalog/items                    managers: add an item
 *   POST  /catalog/import                   managers: many items from a spreadsheet; matches add stock
 *   PATCH /catalog/items/:id                managers: change it (past charges keep their prices)
 *   POST  /catalog/items/:id/archive        managers
 *   PUT   /catalog/items/:id/options        managers: replace its option groups
 *   POST  /catalog/stock                    managers: receive, return, damage, count
 *   GET   /catalog/items/:id/stock          managers: every stock change, newest first
 *   GET   /reorders   POST /reorders        managers: what's coming, and marking something reordered
 *   POST  /reorders/:id/receive             managers: it arrived
 *   GET   /discount-codes                   everyone (the counter applies them)
 *   POST  /discount-codes                   managers
 */

const router = forwardAsyncErrors(Router());

const STATUS: Record<catalog.CatalogError['code'], number> = { not_found: 404, invalid: 422, not_tracked: 422, code_taken: 409, archived: 409 };

async function run(res: Response, fn: (db: NonNullable<Awaited<ReturnType<typeof merchantDb>>>) => Promise<unknown>) {
  const db = await merchantDb();
  if (!db) return res.status(503).json({ error: 'Unavailable', message: 'merchant database is not configured' });
  try {
    res.json(await fn(db));
  } catch (error) {
    if (error instanceof catalog.CatalogError) return res.status(STATUS[error.code]).json({ error: error.code, message: error.message });
    throw error;
  }
}

const m = (req: Request) => req.merchant!.merchant;
const staff = (req: Request) => req.merchant!.staff.id;

router.get('/catalog', requireMerchant, (req, res) => run(res, (db) => catalog.listCatalog(db, m(req), { seesCost: seesMoney(req.merchant!.staff.role) })));
router.post('/catalog/import', requireMerchant, requireManager, (req, res) => run(res, (db) => importCatalog(db, { merchant: m(req), staffId: req.merchant!.staff.id, body: req.body })));
router.post('/catalog/items', requireMerchant, requireManager, (req, res) => run(res, (db) => catalog.createItem(db, { merchant: m(req), staffId: staff(req), item: req.body })));
router.patch('/catalog/items/:id', requireMerchant, requireManager, (req, res) => run(res, (db) => catalog.updateItem(db, { merchant: m(req), itemId: String(req.params.id), patch: req.body })));
router.post('/catalog/items/:id/archive', requireMerchant, requireManager, (req, res) => run(res, (db) => catalog.archiveItem(db, { merchant: m(req), itemId: String(req.params.id) })));
router.put('/catalog/items/:id/options', requireMerchant, requireManager, (req, res) =>
  run(res, (db) => catalog.saveOptionGroups(db, { merchant: m(req), itemId: String(req.params.id), groups: req.body?.groups ?? req.body })),
);
router.post('/catalog/stock', requireMerchant, requireManager, (req, res) => run(res, (db) => catalog.adjustStock(db, { merchant: m(req), staffId: staff(req), adjustment: req.body })));
router.get('/catalog/items/:id/stock', requireMerchant, requireManager, (req, res) => run(res, (db) => catalog.stockHistory(db, { merchant: m(req), itemId: String(req.params.id) })));
router.get('/reorders', requireMerchant, requireManager, (req, res) => run(res, (db) => catalog.listReorders(db, m(req))));
router.post('/reorders', requireMerchant, requireManager, (req, res) => run(res, (db) => catalog.markReordered(db, { merchant: m(req), staffId: staff(req), reorder: req.body })));
router.post('/reorders/:id/receive', requireMerchant, requireManager, (req, res) =>
  run(res, (db) => catalog.receiveReorder(db, { merchant: m(req), staffId: staff(req), reorderId: String(req.params.id), quantity: Number(req.body?.quantity) })),
);
router.get('/discount-codes', requireMerchant, (req, res) => run(res, (db) => catalog.listDiscountCodes(db, m(req))));
router.post('/discount-codes', requireMerchant, requireManager, (req, res) => run(res, (db) => catalog.createDiscountCode(db, { merchant: m(req), staffId: staff(req), code: req.body })));

export default router;
