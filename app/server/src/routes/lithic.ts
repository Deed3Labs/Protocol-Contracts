import express, { type Request, type Response } from 'express';
import { requiredDocuments, startUpload, documentStatus } from '../services/lithic/documentService.js';
import { redactError } from '../utils/redact.js';
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
    console.error('[lithic] account read failed:', redactError(error));
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
    /*
     * Redacted on both exits.
     *
     * This is the only request in the app carrying an SSN and a date of birth, and a provider that
     * rejects it commonly says which field was wrong by quoting it back. That message was going
     * straight into Railway's logs and straight to the browser in a 502 — neither of which is
     * "storing" it, and both of which outlive the request.
     */
    const message = redactError(error);
    console.error('[lithic] provisioning failed:', message);
    res.status(502).json({ error: message });
  }
});

/*
 * Document upload — URLs out, never bytes in.
 *
 * There is deliberately no endpoint here that accepts a file. A member's driver's licence goes from
 * their browser straight to Lithic's presigned URL; this only asks for the URL and reports on what
 * happened. Adding a multipart route later would quietly undo that, so: if you find yourself
 * writing one, the thing to change is this comment first.
 */

/** The individual documents a member can be asked for. Business types are not reachable here. */
const MEMBER_DOCUMENT_TYPES = new Set(['DRIVERS_LICENSE', 'PASSPORT', 'PASSPORT_CARD']);

/** GET /api/lithic/documents — what Lithic still wants from this member. */
router.get('/documents', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });
  if (!isConfigured() || !lithicStore.isConfigured()) return res.json({ required: [] });

  try {
    res.json({ required: await requiredDocuments(wallet) });
  } catch (error) {
    console.error('[lithic] required documents read failed:', redactError(error));
    res.status(502).json({ error: 'Could not read what is needed' });
  }
});

/** POST /api/lithic/documents — get the upload URLs for one document. */
router.post('/documents', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  const documentType = String(req.body?.documentType || '');
  const entityToken = String(req.body?.entityToken || '');
  if (!MEMBER_DOCUMENT_TYPES.has(documentType)) {
    return res.status(400).json({ error: 'Unsupported document type' });
  }
  if (!entityToken) return res.status(400).json({ error: 'entityToken is required' });

  try {
    res.json(await startUpload(wallet, documentType, entityToken));
  } catch (error) {
    const message = redactError(error);
    console.error('[lithic] document upload start failed:', message);
    res.status(502).json({ error: message });
  }
});

/** GET /api/lithic/documents/:token — did the images land, and what did review say. */
router.get('/documents/:token', async (req: Request, res: Response) => {
  const wallet = sessionWallet(req);
  if (!wallet) return res.status(400).json({ error: 'No wallet on session' });

  try {
    const status = await documentStatus(wallet, String(req.params.token));
    if (!status) return res.status(404).json({ error: 'No such document' });
    res.json(status);
  } catch (error) {
    console.error('[lithic] document status read failed:', redactError(error));
    res.status(502).json({ error: 'Could not read the document status' });
  }
});

export default router;
