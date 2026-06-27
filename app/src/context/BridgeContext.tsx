import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useKyc } from '@/context/KycContext';
import * as bridge from '@/lib/integrations/bridge';

/*
 * Bridge customer + USD virtual account, modeled on Bridge's Customers API.
 * Docs: https://apidocs.bridge.xyz/platform/customers/overview
 *
 * Real flow (SEAM): collect identity (Persona inquiry + onboarding) → POST /customers with
 * first/last name, email, birth_date, residential_address, signed_agreement_id (ToS) and
 * identifying_information, plus persona_inquiry_type / persona_idv_link so Bridge runs the KYC →
 * poll `kyc_status` (not_started → active/under_review → approved/rejected) → request the `base`
 * endorsement (USD/ACH+wire) → create a virtual account → GET its deposit instructions
 * (routing/account/bank). The `base` endorsement being `approved` is what unlocks the account.
 *
 * Here it's mocked: provisioned automatically once KYC verifies. Replace the effect with the API.
 */

export type BridgeKycStatus = 'not_started' | 'active' | 'under_review' | 'approved' | 'rejected';
export type EndorsementStatus = 'incomplete' | 'approved' | 'revoked';

export interface VirtualAccount {
  status: 'none' | 'provisioning' | 'active';
  accountNumber: string;
  routingNumber: string;
  bankName: string;
  beneficiary: string;
}

interface BridgeValue {
  customerStatus: BridgeKycStatus;
  /** `base` endorsement = USD payments (ACH + wire + virtual accounts). */
  baseEndorsement: EndorsementStatus;
  virtualAccount: VirtualAccount;
  /** Convenience: the USD virtual account is usable. */
  ready: boolean;
}

const NONE: VirtualAccount = { status: 'none', accountNumber: '', routingNumber: '', bankName: '', beneficiary: '' };

const Ctx = createContext<BridgeValue | null>(null);

export function useBridge(): BridgeValue {
  return (
    useContext(Ctx) ?? { customerStatus: 'not_started', baseEndorsement: 'incomplete', virtualAccount: NONE, ready: false }
  );
}

export function BridgeProvider({ children }: { children: ReactNode }) {
  const { verified, inquiryId } = useKyc();
  const [customerStatus, setCustomerStatus] = useState<BridgeKycStatus>('not_started');
  const [baseEndorsement, setBaseEndorsement] = useState<EndorsementStatus>('incomplete');
  const [virtualAccount, setVirtualAccount] = useState<VirtualAccount>(NONE);

  // On KYC success: create the Bridge customer (passing the Persona inquiry), request the `base`
  // endorsement, then create/fetch the virtual account. Live → backend; otherwise mock fallback.
  useEffect(() => {
    if (!verified || customerStatus !== 'not_started') return;
    let cancelled = false;
    (async () => {
      try {
        const customer = await bridge.createCustomer({ personaInquiryId: inquiryId });
        if (cancelled) return;
        setCustomerStatus(customer.kycStatus);
        const endorsement = await bridge.ensureBaseEndorsement(customer.id);
        if (cancelled) return;
        setBaseEndorsement(endorsement);
        const va = await bridge.ensureVirtualAccount(customer.id);
        if (cancelled) return;
        setVirtualAccount(va);
      } catch {
        // leave unprovisioned on failure — surfaces as the "Verify to activate" CTA.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verified, customerStatus, inquiryId]);

  return (
    <Ctx.Provider
      value={{ customerStatus, baseEndorsement, virtualAccount, ready: virtualAccount.status === 'active' && baseEndorsement === 'approved' }}
    >
      {children}
    </Ctx.Provider>
  );
}
