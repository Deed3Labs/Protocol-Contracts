import { getLithic } from './lithicClient.js';
import { lithicStore } from './lithicStore.js';

/*
 * ID documents, without ever holding one.
 *
 * A member whose typed details did not match is asked for a photo of their licence or passport.
 * The obvious implementation — accept the file, forward it — would make us the custodian of every
 * member's government ID: in request logs, in whatever buffers it on the way through, in memory on
 * a box we do not control the retention of. That is exactly the responsibility we decided not to
 * take on when we made the SSN pass-through.
 *
 * So this never touches the image. Lithic hands out a presigned upload URL per required image and
 * the browser PUTs the file straight there. This module deals only in tokens and URLs:
 *
 *   requiredDocuments()  what Lithic still wants, and for which entity
 *   startUpload()        ask for the upload targets — returns URLs, not a destination of ours
 *   documentStatus()     whether the images landed and how the review went
 *
 * The URLs are short-lived by design. A stale one is re-requested rather than cached, because a
 * cached upload URL is a link to somewhere a member's passport can be written.
 */

export interface RequiredDocumentInfo {
  entityToken: string;
  /** e.g. DRIVERS_LICENSE, PASSPORT, PASSPORT_CARD. */
  validDocuments: string[];
  statusReasons: string[];
}

export interface UploadTarget {
  /** Which side of the document this URL takes. */
  imageType: 'FRONT' | 'BACK';
  uploadUrl: string;
  uploadToken: string;
}

export interface StartedUpload {
  documentToken: string;
  targets: UploadTarget[];
}

async function accountHolderToken(wallet: string): Promise<string | null> {
  const record = await lithicStore.get(wallet);
  return record?.accountHolderToken ?? null;
}

/** What Lithic is still waiting for. Empty when nothing is outstanding. */
export async function requiredDocuments(wallet: string): Promise<RequiredDocumentInfo[]> {
  const lithic = getLithic();
  const holder = await accountHolderToken(wallet);
  if (!lithic || !holder) return [];

  const account = await lithic.accountHolders.retrieve(holder);
  return (account.required_documents ?? []).map((doc) => ({
    entityToken: doc.entity_token,
    validDocuments: doc.valid_documents ?? [],
    statusReasons: doc.status_reasons ?? [],
  }));
}

/**
 * Ask Lithic where to put the images.
 *
 * A driver's licence needs two (front and back) and a passport one, and Lithic decides which by
 * returning one entry per image it wants — so nothing here hardcodes that pairing.
 */
export async function startUpload(
  wallet: string,
  documentType: string,
  entityToken: string,
): Promise<StartedUpload> {
  const lithic = getLithic();
  if (!lithic) throw new Error('Lithic not configured');
  const holder = await accountHolderToken(wallet);
  if (!holder) throw new Error('Member is not provisioned');

  const document = await lithic.accountHolders.uploadDocument(holder, {
    // Cast: the SDK's union is the full list including business documents, and the caller is
    // restricted to the individual ones by the route.
    document_type: documentType as Parameters<typeof lithic.accountHolders.uploadDocument>[1]['document_type'],
    entity_token: entityToken,
  });

  return {
    documentToken: document.token,
    targets: (document.required_document_uploads ?? []).map((upload) => ({
      imageType: upload.image_type,
      uploadUrl: upload.upload_url,
      uploadToken: upload.token,
    })),
  };
}

/** How the upload and its review are going. */
export async function documentStatus(
  wallet: string,
  documentToken: string,
): Promise<{ uploads: Array<{ imageType: string; status: string; statusReasons: string[] }> } | null> {
  const lithic = getLithic();
  const holder = await accountHolderToken(wallet);
  if (!lithic || !holder) return null;

  const document = await lithic.accountHolders.retrieveDocument(documentToken, {
    account_holder_token: holder,
  });
  return {
    uploads: (document.required_document_uploads ?? []).map((upload) => ({
      imageType: upload.image_type,
      status: (upload as unknown as { status?: string }).status ?? 'PENDING',
      statusReasons: (upload as unknown as { status_reasons?: string[] }).status_reasons ?? [],
    })),
  };
}
