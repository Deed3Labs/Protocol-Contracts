import { useState } from 'react';
import { ArrowLeft, Copy, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import type { CashAccount } from '@/lib/clearModel';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-[13px] tabular-nums">{value}</p>
      </div>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {copied ? (
          <Check className="h-4 w-4 text-tier-savings-fg" strokeWidth={1.75} />
        ) : (
          <Copy className="h-4 w-4" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}

/**
 * Cash account details — behind the "Account details" action on Home.
 *
 * A dialog rather than an inline expansion: this is reference data you copy and
 * leave, not something you work in, and expanding it in place would push the
 * savings card down and break Home's two-column balance. It also matches the
 * limit breakdown and card details, which are already dialogs.
 *
 * Routing and account numbers are the member's Bridge virtual account — the only
 * inbound fiat rail, since Bridge pushes rather than pulls. When this is wired,
 * take the numbers from BridgeContext (see components/app-ui/DepositInstructions).
 */
export default function AccountDetailsDialog({
  account,
  open,
  onOpenChange,
}: {
  account: CashAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[380px] rounded-xl p-[15px]">
        <div className="mb-1 flex items-center gap-2.5">
          <DialogClose
            aria-label="Back"
            className="text-foreground-secondary transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </DialogClose>
          <DialogTitle className="text-[13px] font-medium">Account details</DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          Your account and routing numbers, for setting up a direct deposit.
        </DialogDescription>

        <div className="mt-1">
          <CopyRow label="Account number" value={account.accountNumber} />
          <CopyRow label="Routing number" value={account.routingNumber} />
          <CopyRow label="Account type" value="Checking" />
          <CopyRow label="Bank" value={account.bankName} />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Give these to your employer to set up direct deposit. Money arriving here lands in your
          cash account and spends first.
        </p>
      </DialogContent>
    </Dialog>
  );
}
