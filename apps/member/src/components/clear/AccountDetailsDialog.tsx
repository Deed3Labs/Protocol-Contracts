import { useState } from 'react';
import { Eye, EyeOff, Copy, Check, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card from './Card';
import Modal from './Modal';
import type { CashAccount } from '@/lib/clearModel';

/**
 * One account number, hidden by default with a reveal toggle and a copy action.
 *
 * Hidden is the resting state on purpose: this surface gets opened in public — at
 * a desk, on a phone — and the number is only needed for the moments you're
 * actually handing it over. Copy works without revealing, so the common case
 * never puts it on screen at all.
 */
function NumberRow({
  label,
  value,
  /** How many trailing digits stay visible while hidden. Zero masks the lot. */
  reveals = 0,
  last,
}: {
  label: string;
  value: string;
  reveals?: number;
  last?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const tail = reveals > 0 ? value.slice(-reveals) : '';
  const masked = '•'.repeat(Math.max(0, value.length - reveals)) + (tail ? ` ${tail}` : '');

  return (
    <div
      className={`flex items-center justify-between gap-3 py-2.5 ${last ? '' : 'border-b-[0.5px] border-border'}`}
    >
      <div className="min-w-0">
        <p className="text-xs text-foreground-secondary">{label}</p>
        <p className="mt-[3px] truncate font-mono text-[13px]">{shown ? value : masked}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button
          variant="clear"
          size="xs"
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
        </Button>
        <Button
          variant="clear"
          size="xs"
          aria-label={`Copy ${label}`}
          onClick={() => {
            navigator.clipboard?.writeText(value).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-tier-savings-fg" strokeWidth={1.75} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * Cash account details — behind "Account details" on Home.
 *
 * When this is wired, the numbers come from the member's Bridge virtual account
 * (see components/app-ui/DepositInstructions, which already renders the real
 * thing and handles the not-yet-provisioned and unverified cases).
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
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Account details"
      description="Your account and routing numbers, for receiving a paycheck or a transfer."
    >
      <Card className="mb-3">
        <p className="mb-2.5 text-xs text-foreground-secondary">
          Use these to receive your paycheck or transfer money in.
        </p>
        <NumberRow label="Routing number" value={account.routingNumber} />
        <NumberRow label="Account number" value={account.accountNumber} reveals={4} last />
      </Card>

      <Card className="mb-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-foreground-secondary">Direct deposit</span>
          {account.directDepositActive ? (
            <span className="flex items-center gap-1.5 text-[11px] text-tier-savings-fg">
              <CircleCheck className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
              Active
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Not set up</span>
          )}
        </div>
        <p className="mt-[7px] text-[11px] leading-relaxed text-muted-foreground">
          {account.directDepositActive
            ? `Payroll from ${account.employer} arrives here. Routing your paycheck raises your income-backed limit.`
            : 'Routing your paycheck here raises your income-backed limit.'}
        </p>
      </Card>

      <Button variant="clear" size="xs" className="mb-2 w-full">
        Send instructions to my employer
      </Button>
      <Button variant="clear" size="xs" className="w-full">
        Download prefilled form
      </Button>
    </Modal>
  );
}
