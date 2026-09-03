import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppKitAccount } from '@/lib/walletCompat';
import { getBridgeStatus, openBridgeVirtualAccount, type BridgeStatus } from '@/utils/apiClient';

/*
 * Bridge customer + USD virtual account — the member's account & routing numbers.
 * Docs: https://apidocs.bridge.xyz/platform/customers/overview
 *
 * The backend (GET /api/bridge/status) resolves the Bridge customer from EVERY email Privy verified
 * for this session, so a member who already onboarded to Bridge under a different address (Google vs
 * email login, or via another Bridge-powered app) is matched instead of onboarded twice. Once their
 * KYC is `active` it opens (or reads) their virtual account — USD pushed there arrives as USDC.
 *
 * NOTE: fiat only ever moves INTO this account by push. Bridge does not debit bank accounts, so
 * there is no "pull from my bank" rail — the deposit instructions are the on-ramp.
 */

export type BridgeKycStatus = 'not_started' | 'active' | 'under_review' | 'approved' | 'rejected' | 'incomplete' | 'paused' | 'offboarded';
export type EndorsementStatus = 'incomplete' | 'approved' | 'revoked';

export interface VirtualAccount {
  status: 'none' | 'provisioning' | 'active';
  accountNumber: string;
  routingNumber: string;
  bankName: string;
  beneficiary: string;
  /** Inbound rails the account accepts, e.g. ["ach_push","wire"]. */
  paymentRails: string[];
}

interface BridgeValue {
  configured: boolean;
  customerStatus: BridgeKycStatus;
  /** `base` endorsement = USD payments (ACH + wire + virtual accounts). */
  baseEndorsement: EndorsementStatus;
  virtualAccount: VirtualAccount;
  /** Convenience: the USD virtual account is usable. */
  ready: boolean;
  loading: boolean;
  /** Re-read status from Bridge (call after the member finishes hosted KYC). */
  refresh: () => Promise<void>;
  /** Explicitly open the USD account once verified — mints account + routing numbers. */
  provision: () => Promise<void>;
}

const NONE: VirtualAccount = { status: 'none', accountNumber: '', routingNumber: '', bankName: '', beneficiary: '', paymentRails: [] };

const Ctx = createContext<BridgeValue | null>(null);

export function useBridge(): BridgeValue {
  return (
    useContext(Ctx) ?? {
      configured: false,
      customerStatus: 'not_started',
      baseEndorsement: 'incomplete',
      virtualAccount: NONE,
      ready: false,
      loading: false,
      refresh: async () => {},
      provision: async () => {},
    }
  );
}

function toVirtualAccount(va: BridgeStatus['virtualAccount']): VirtualAccount {
  if (!va?.accountNumber || !va?.routingNumber) return NONE;
  return {
    status: 'active',
    accountNumber: va.accountNumber,
    routingNumber: va.routingNumber,
    bankName: va.bankName ?? '',
    beneficiary: va.beneficiary ?? '',
    paymentRails: va.paymentRails ?? [],
  };
}

export function BridgeProvider({ children }: { children: ReactNode }) {
  const { isConnected } = useAppKitAccount();
  const [configured, setConfigured] = useState(false);
  const [customerStatus, setCustomerStatus] = useState<BridgeKycStatus>('not_started');
  const [baseEndorsement, setBaseEndorsement] = useState<EndorsementStatus>('incomplete');
  const [virtualAccount, setVirtualAccount] = useState<VirtualAccount>(NONE);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const s = await getBridgeStatus();
      setConfigured(s.configured);
      setCustomerStatus((s.kycStatus as BridgeKycStatus) || 'not_started');
      setBaseEndorsement(s.baseEndorsement ?? 'incomplete');
      setVirtualAccount(toVirtualAccount(s.virtualAccount));
    } catch {
      // Leave the last known state — the UI falls back to the "verify to activate" CTA.
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const provision = useCallback(async () => {
    const r = await openBridgeVirtualAccount();
    if (r.available && r.accountNumber && r.routingNumber) {
      setVirtualAccount({
        status: 'active',
        accountNumber: r.accountNumber,
        routingNumber: r.routingNumber,
        bankName: r.bankName ?? '',
        beneficiary: '',
        paymentRails: [],
      });
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isConnected) return;
    void refresh();
  }, [isConnected, refresh]);

  return (
    <Ctx.Provider
      value={{
        configured,
        customerStatus,
        baseEndorsement,
        virtualAccount,
        ready: virtualAccount.status === 'active',
        loading,
        refresh,
        provision,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
