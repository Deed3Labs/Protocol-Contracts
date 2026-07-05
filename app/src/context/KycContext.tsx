import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import KycModal from '@/components/app-ui/KycModal';
import { track } from '@/lib/analytics';

export type KycStatus = 'unverified' | 'verified';

interface KycValue {
  status: KycStatus;
  verified: boolean;
  /** Persona "passport" — reusable for Bridge/Colossus provisioning (mock id once verified). */
  inquiryId: string | null;
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
      inquiryId: null,
      openKyc: () => {},
      gate: (action) => action(),
    }
  );
}

/**
 * KYC state for the redesign. Starts UNVERIFIED — money-movement actions (Add/Withdraw/Send/
 * Transfer/Pay/Borrow) are wrapped in `gate`, which opens the Persona KYC modal first and runs the
 * intended action on success. One verification unlocks everything (the reusable passport). Mock.
 */
export function KycProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<KycStatus>('unverified');
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const cbRef = useRef<(() => void) | null>(null);

  const openKyc = (onVerified?: () => void) => {
    cbRef.current = onVerified ?? null;
    setOpen(true);
    track('kyc_started');
  };
  const gate = (action: () => void) => {
    if (status === 'verified') action();
    else openKyc(action);
  };
  const handleVerified = (personaInquiryId?: string) => {
    setStatus('verified');
    track('kyc_verified');
    setInquiryId(personaInquiryId ?? `inq_${Date.now().toString(36)}`);
    setOpen(false);
    const cb = cbRef.current;
    cbRef.current = null;
    if (cb) setTimeout(cb, 200); // let the KYC modal close before opening the gated one
  };

  return (
    <Ctx.Provider value={{ status, verified: status === 'verified', inquiryId, openKyc, gate }}>
      {children}
      <KycModal open={open} onOpenChange={setOpen} onVerified={handleVerified} />
    </Ctx.Provider>
  );
}
