import { useState } from 'react';
import Modal from './Modal';
import { Btn, Chip, Line, Rows } from './brand/anatomy';
import { CopyIcon, EyeIcon } from './brand/icons';
import type { CashAccount } from '@/lib/clearModel';

/**
 * One account number, hidden by default with a reveal toggle and a copy action.
 *
 * Hidden is the resting state on purpose: this surface gets opened in public, and the number is only
 * needed for the moments you're handing it over. Copy works without revealing, so the common case
 * never puts it on screen at all. An account number is an identifier, so it is set in Plex Mono.
 */
function NumberRow({
  label,
  value,
  /** How many trailing digits stay visible while hidden. Zero masks the lot. */
  reveals = 0,
}: {
  label: string;
  value: string;
  reveals?: number;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const tail = reveals > 0 ? value.slice(-reveals) : '';
  const masked = '•'.repeat(Math.max(0, value.length - reveals)) + (tail ? ` ${tail}` : '');

  return (
    <div>
      <Line className="items-center!">
        <div className="min-w-0">
          <p className="c-label">{label}</p>
          <p className="c-mono mt-1 truncate text-sec!">{shown ? value : masked}</p>
        </div>
        <span className="flex shrink-0 gap-[6px]">
          <Btn
            className="h-[30px]! w-[34px] p-0!"
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
          >
            <EyeIcon />
          </Btn>
          <Btn
            className="h-[30px]! w-[34px] p-0!"
            aria-label={copied ? `${label} copied` : `Copy ${label}`}
            onClick={() => {
              navigator.clipboard?.writeText(value).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <CopyIcon />
          </Btn>
        </span>
      </Line>
    </div>
  );
}

/**
 * Account details — behind Details on Spendable.
 *
 * Main is the two numbers; the footer is the direct-deposit chip and the way to hand the details to
 * someone. The numbers come from the member's virtual account (see HomeRoute), read on demand and
 * never cached.
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
  const share = () => {
    const text = `Routing number: ${account.routingNumber}\nAccount number: ${account.accountNumber}`;
    if (navigator.share) {
      navigator.share({ title: 'Account details', text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Account details"
      description="Your account and routing numbers, for receiving a paycheck or a transfer."
      footer={
        <Line className="items-center!">
          {account.directDepositActive ? (
            <Chip tone="settled" core>
              Direct deposit
            </Chip>
          ) : (
            <span className="c-det">Direct deposit not set up</span>
          )}
          <Btn onClick={share}>Share details</Btn>
        </Line>
      }
    >
      <p className="c-det mb-s2">Use these to receive your paycheck or move money in from another bank.</p>
      <Rows>
        <NumberRow label="Routing number" value={account.routingNumber} />
        <NumberRow label="Account number" value={account.accountNumber} reveals={4} />
      </Rows>
    </Modal>
  );
}
