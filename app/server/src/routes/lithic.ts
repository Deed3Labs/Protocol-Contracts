import express, { type Request, type Response } from 'express';
import { isConfigured } from '../services/lithic/lithicClient.js';
import {
  ensureProvisioned,
  getDepositInstructions,
  type ProvisionKycInput,
} from '../services/lithic/provisioningService.js';
import { lithicStore } from '../services/lithic/lithicStore.js';

const router = express.Router();

/*
 * Member-facing Lithic endpoints — spec step 2.
 *
 * The wallet always comes from the verified session, never from the request: these responses carry
 * bank account and routing numbers, and taking an address from the caller would let any signed-in
 * member enumerate everyone else's. Same rule the Bridge virtual-account route follows.
 */

function sessionWallet(req: Request): string {
  return String(req.auth?.smartWallet || req.auth?.walletAddress || '')
    .trim()
    .toLowerCase();
}

/**
 * GET /api/lithic/account — provisioning state, and the deposit numbers when they exist.
 *
 * Best-effort by design: an unconfigured integration or an unprovisioned member both answer with a
 * shape the UI can render, rather than an error it has to special-case.
 */
router.get('/account', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  if (!isConfigured() || !lithicStore.isConfigured()) {
    return res.json({ configured: false, provisioned: false, deposit: null });
  }

  try {
    const record = await lithicStore.get(wallet);
    if (!record) {
      return res.json({ configured: true, provisioned: false, deposit: null });
    }

    const deposit = record.cashFinancialAccountToken ? await getDepositInstructions(wallet) : null;

    res.json({
      configured: true,
      provisioned: true,
      status: record.status,
      statusReasons: record.statusReasons,
      // Cards can work before the cash account exists; the UI needs to tell those apart.
      hasCashAccount: Boolean(record.cashFinancialAccountToken),
      deposit,
    });
  } catch (error) {
    console.error('[lithic] account read failed:', error);
    res.status(500).json({ error: 'Failed to read Lithic account' });
  }
});

/**
 * POST /api/lithic/account — provision this member's banking identity.
 *
 * Takes the KYC fields in the body because we do not hold them: the member record has legal name,
 * email, phone and city, and Lithic's KYC needs date of birth, a government id and a street
 * address. Rather than half-submit, this rejects with the list of what's missing.
 */
router.post('/account', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  if (!isConfigured() || !lithicStore.isConfigured()) {
    return res.status(503).json({ error: 'Lithic is not configured' });
  }

  const body = (req.body ?? {}) as Partial<ProvisionKycInput> & { address?: Record<string, string> };
  const missing: string[] = [];
  if (!body.firstName) missing.push('firstName');
  if (!body.lastName) missing.push('lastName');
  if (!body.email) missing.push('email');
  if (!body.phoneNumber) missing.push('phoneNumber');
  if (!body.address?.address1) missing.push('address.address1');
  if (!body.address?.city) missing.push('address.city');
  if (!body.address?.state) missing.push('address.state');
  if (!body.address?.postal_code) missing.push('address.postal_code');

  const workflow = body.workflow ?? 'KYC_BASIC';
  if (workflow !== 'KYC_EXEMPT') {
    if (!body.dob) missing.push('dob');
    if (!body.governmentId) missing.push('governmentId');
  }
  if (workflow === 'KYC_BYO' && !body.kycPassedTimestamp) missing.push('kycPassedTimestamp');

  if (missing.length > 0) {
    return res.status(400).json({ error: 'Missing KYC fields', missing });
  }

  try {
    const result = await ensureProvisioned(wallet, {
      workflow,
      firstName: body.firstName!,
      lastName: body.lastName!,
      email: body.email!,
      phoneNumber: body.phoneNumber!,
      dob: body.dob,
      governmentId: body.governmentId,
      kycPassedTimestamp: body.kycPassedTimestamp,
      address: {
        address1: body.address!.address1,
        address2: body.address!.address2,
        city: body.address!.city,
        state: body.address!.state,
        postal_code: body.address!.postal_code,
        country: body.address!.country || 'USA',
      },
    });

    res.json({
      status: result.status,
      provisioned: Boolean(result.record),
      kycStatus: result.record?.status ?? null,
      statusReasons: result.record?.statusReasons ?? [],
      hasCashAccount: Boolean(result.record?.cashFinancialAccountToken),
      awaitingFinancialAccounts: result.awaitingFinancialAccounts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provisioning failed';
    console.error('[lithic] provisioning failed:', message);
    res.status(502).json({ error: message });
  }
});

export default router;
