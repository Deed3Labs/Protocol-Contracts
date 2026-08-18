import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import type { LinkedAccount } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Payment account — design spec §4c, opened from the shelf's "Clears from" footer.
 *
 * The same list as Settings › Linked accounts, scoped to the ACH fallback. It leads by saying the
 * Clear balance is always used first, because otherwise picking an account reads as choosing who
 * gets paid — and a member who thinks that will keep money out of Clear to steer it.
 */
export default function PaymentAccountDialog({
  accounts,
  selectedId,
  onSelect,
  onLink,
  open,
  onOpenChange,
}: {
  accounts: LinkedAccount[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onLink?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Payment account"
      description="Choose which linked account term plans clear from after your Clear balance."
    >
      <p className="mb-3.5 text-xs leading-relaxed text-foreground-secondary">
        Your Clear balance is always used first. This is where the rest comes from.
      </p>

      <div className="mb-3.5 space-y-2">
        {accounts.map((account) => {
          const selected = account.id === selectedId;
          return (
            <button
              key={account.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect?.(account.id)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-[10px] border-[0.5px] px-3.5 py-[11px] text-left',
                selected ? 'border-tier-boost' : 'border-border',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px]">{account.name}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {account.detail}
                </span>
              </span>
              {selected && (
                <CircleCheck className="h-4 w-4 shrink-0 text-tier-boost-fg" strokeWidth={2} />
              )}
            </button>
          );
        })}
      </div>

      <Button variant="clear" size="xs" className="mb-2.5 w-full" onClick={onLink}>
        Link another account
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Changing this applies to every term plan. Nothing scheduled is missed — the next clearing
        uses the new account.
      </p>
    </Modal>
  );
}
