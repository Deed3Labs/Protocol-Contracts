import { INTEGRATIONS_LIVE, apiGet, apiPost } from './client';

/*
 * Bridge customers + endorsements + virtual accounts, fronted by our backend.
 * Docs: https://apidocs.bridge.xyz/platform/customers/overview
 * Backend maps these to: POST /customers, GET /customers/:id (kyc_status + endorsements),
 * the endorsement request (`base`), and the virtual-account create/fetch (deposit instructions).
 */

export type KycStatus = 'not_started' | 'active' | 'under_review' | 'approved' | 'rejected';
export type EndorsementStatus = 'incomplete' | 'approved' | 'revoked';

export interface VirtualAccountDTO {
  status: 'none' | 'provisioning' | 'active';
  accountNumber: string;
  routingNumber: string;
  bankName: string;
  beneficiary: string;
}

export interface CreateCustomerInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  birthDate?: string;
  /** Persona inquiry handed to Bridge as persona_inquiry_type / persona_idv_link. */
  personaInquiryId?: string | null;
}

export interface BridgeCustomer {
  id: string;
  kycStatus: KycStatus;
}

export async function createCustomer(input: CreateCustomerInput): Promise<BridgeCustomer> {
  if (INTEGRATIONS_LIVE) return apiPost<BridgeCustomer>('/bridge/customers', input);
  return { id: `cus_mock_${Date.now().toString(36)}`, kycStatus: 'active' };
}

export async function getCustomer(id: string): Promise<{ kycStatus: KycStatus; baseEndorsement: EndorsementStatus }> {
  if (INTEGRATIONS_LIVE) return apiGet(`/bridge/customers/${id}`);
  return { kycStatus: 'active', baseEndorsement: 'approved' };
}

/** Request the `base` (USD/ACH+wire) endorsement; returns its status. */
export async function ensureBaseEndorsement(id: string): Promise<EndorsementStatus> {
  if (INTEGRATIONS_LIVE) return (await apiPost<{ status: EndorsementStatus }>(`/bridge/customers/${id}/endorsements`, { type: 'base' })).status;
  return 'approved';
}

/** Create (if needed) and fetch the USD virtual-account deposit instructions. */
export async function ensureVirtualAccount(id: string): Promise<VirtualAccountDTO> {
  if (INTEGRATIONS_LIVE) return apiGet<VirtualAccountDTO>(`/bridge/customers/${id}/virtual_account`);
  return { status: 'active', accountNumber: '1500 0048 2917', routingNumber: '101 019 644', bankName: 'Lead Bank', beneficiary: 'Steven Spark' };
}
