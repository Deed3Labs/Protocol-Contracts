import { useState } from 'react';
import { Check, Copy, Landmark, Loader2 } from 'lucide-react';
import { useBridge } from '@/context/BridgeContext';
import { useKyc } from '@/context/KycContext';

/*
 * The user's Bridge USD virtual-account deposit instructions — used for direct deposit (paycheck),
 * a manual bank push, or wire. Money sent here is auto-converted to USDC in the primary wallet.
 *
 * This is also the ONLY inbound fiat rail: Bridge does not debit bank accounts (no ACH pull), so a
 * deposit is always something the member pushes from their bank. Verified but no account yet → we
 * can open one on the spot (`provision`); unverified → the KYC CTA.
 */

/** Bridge's rail ids → what a person would call them. */
const RAIL_LABELS: Record<string, string> = {
  ach_push: 'ACH',
  ach_same_day: 'same-day ACH',
  wire: 'wire',
  fednow: 'instant (FedNow)',
};
const railLabel = (rail: string) => RAIL_LABELS[rail] ?? rail;

function Row({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium tabular-nums text-foreground">{value}</div>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {copied ? <Check className="h-4 w-4 text-positive" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function DepositInstructions() {
  const { virtualAccount: va, provision } = useBridge();
  const { openKyc, verified } = useKyc();
  const [opening, setOpening] = useState(false);

  if (va.status !== 'active') {
    // Verified already → we can open the USD account right here. Otherwise KYC comes first.
    const onClick = async () => {
      if (!verified) {
        openKyc();
        return;
      }
      setOpening(true);
      try {
        await provision();
      } finally {
        setOpening(false);
      }
    };
    return (
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={opening}
        className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border p-3 text-left transition-colors hover:bg-secondary/40 disabled:opacity-60"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
          {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">Activate your account &amp; routing numbers</span>
          <span className="block text-[11px] text-muted-foreground">
            {verified ? 'Open your USD account via Bridge.' : 'Verify your identity to open a USD account via Bridge.'}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-info">{verified ? (opening ? 'Opening…' : 'Activate') : 'Verify'}</span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {va.beneficiary && <Row label="Account holder" value={va.beneficiary} />}
      <Row label="Account number" value={va.accountNumber} />
      <Row label="Routing number" value={va.routingNumber} />
      <p className="flex items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
        <Landmark className="h-3.5 w-3.5" /> {va.bankName || 'Bridge'} — use for direct deposit
        {va.paymentRails.length > 0 ? `, ${va.paymentRails.map(railLabel).join(' or ')}` : ', ACH or wire'}. Funds arrive as USDC.
      </p>
    </div>
  );
}
