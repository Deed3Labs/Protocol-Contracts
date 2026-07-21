import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import KycModal from '@/components/app-ui/KycModal';
import { useBridge } from '@/context/BridgeContext';
import { track } from '@/lib/analytics';

export type KycStatus = 'unverified' | 'verified';

interface KycValue {
  status: KycStatus;
  verified: boolean;
  /** Open the KYC flow; runs `onVerified` after a successful verification. */
  openKyc: (onVerified?: () => void) => void;
  /** Run `action` if already verified; otherwise open KYC first and run it on success. */
  gate: (action: () => void) => void;
}

const Ctx = createContext<KycValue | null>(null);

/** Safe default (no provider): treat as verified + run actions, so non-redesign trees never block. */
export function useKyc(): KycValue {
  return (
    useContext(Ctx) ?? {
      status: 'verified',
      verified: true,
      openKyc: () => {},
      gate: (action) => action(),
    }
  );
}

/**
 * KYC state, sourced from Bridge. Money-movement actions (Add/Withdraw/Send/Transfer/Pay/Borrow) are
 * wrapped in `gate`, which opens the verification modal first and runs the intended action on success.
 *
 * The verdict is Bridge's: a member counts as verified when their Bridge customer status is `active`.
 * That state lives on Bridge (not in this component), so it survives reloads and is consistent with
 * what the backend will let them actually do. When Bridge isn't configured we fall back to the local
 * flag so non-production environments still work.
 */
export function KycProvider({ children }: { children: ReactNode }) {
  const { customerStatus, refresh } = useBridge();
  const [open, setOpen] = useState(false);
  const cbRef = useRef<(() => void) | null>(null);

  // Bridge is the ONLY source of this verdict. There is no local override: verification exists purely
  // to unlock Bridge, so anything we decided locally would let someone past a gate Bridge still holds
  // shut — the UI would say "verified" and every transfer would then fail.
  const verified = customerStatus === 'active';
  const status: KycStatus = verified ? 'verified' : 'unverified';

  const openKyc = (onVerified?: () => void) => {
    cbRef.current = onVerified ?? null;
    setOpen(true);
    track('kyc_started');
  };
  const gate = (action: () => void) => {
    if (verified) action();
    else openKyc(action);
  };
  const handleVerified = () => {
    track('kyc_verified');
    void refresh();
    setOpen(false);
    const cb = cbRef.current;
    cbRef.current = null;
    if (cb) setTimeout(cb, 200); // let the KYC modal close before opening the gated one
  };

  return (
    <Ctx.Provider value={{ status, verified, openKyc, gate }}>
      {children}
      <KycModal open={open} onOpenChange={setOpen} onVerified={handleVerified} />
    </Ctx.Provider>
  );
}
