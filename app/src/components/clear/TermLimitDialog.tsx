import { Button } from '@/components/ui/button';
import Modal from './Modal';
import { money } from '@/lib/money';
import {
  bindingTermLimit,
  termPlansPerCycle,
  termPlansTotal,
  type TermPlans,
} from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** One constraint, with what it means. The binding one carries the accent. */
function Constraint({
  label,
  used,
  limit,
  note,
  binding,
}: {
  label: string;
  used: number;
  limit: number;
  note: string;
  binding?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-[10px] border-[0.5px] px-3.5 py-[11px]',
        binding ? 'border-tier-boost' : 'border-border',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn('text-xs', binding ? 'text-tier-boost-fg' : 'text-foreground-secondary')}>
          {label}
        </span>
        <span
          className={cn('text-sm font-medium tabular-nums', binding && 'text-tier-boost-fg')}
        >
          {money(used, { cents: true })} of {money(limit, { cents: true })}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * Your term limit — design spec §4c, opened from the shelf's `Limit` cell.
 *
 * Two constraints, and the lower one applies. **Both are shown even though only one binds**, because
 * a member who sees only the binding figure can't tell what would move it — and the two move for
 * completely different reasons: one tracks the money flowing through their accounts, the other is a
 * flat ceiling that doesn't care how much they earn.
 *
 * It leads by saying what sets the limit, because the assumption otherwise is a credit score, and
 * the whole point is that it isn't one. Nothing here is applied for.
 */
export default function TermLimitDialog({
  data,
  onManageAccounts,
  open,
  onOpenChange,
}: {
  data: TermPlans;
  onManageAccounts?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const binding = bindingTermLimit(data);
  const readFrom = data.accounts.filter((a) => a.readForLimit);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Your term limit"
      description="What you can schedule across term plans, and what sets it."
    >
      <p className="mb-3.5 text-xs leading-relaxed text-foreground-secondary">
        Set by the income landing in your accounts and what already goes out of them — not a
        credit score.
      </p>

      <div className="mb-3.5 space-y-2">
        {data.perCycleLimit !== undefined && (
          <Constraint
            label="Payments a cycle"
            used={termPlansPerCycle(data)}
            limit={data.perCycleLimit}
            note={
              binding === 'perCycle'
                ? 'Across every open plan. This is the one binding you now.'
                : 'Across every open plan.'
            }
            binding={binding === 'perCycle'}
          />
        )}
        {data.balanceLimit !== undefined && (
          <Constraint
            label="Total open at once"
            used={termPlansTotal(data)}
            limit={data.balanceLimit}
            note={
              binding === 'balance'
                ? 'A ceiling regardless of income. This is the one binding you now.'
                : 'A ceiling regardless of income.'
            }
            binding={binding === 'balance'}
          />
        )}
      </div>

      {readFrom.length > 0 && (
        <>
          <p className="mb-1.5 text-[11px] tracking-[0.2px] text-muted-foreground">INCOME AND OUTGOINGS READ FROM</p>
          <div className="mb-3.5 text-xs leading-loose">
            {readFrom.map((account) => (
              <div key={account.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-foreground-secondary">{account.name}</span>
                <span className="shrink-0">{account.kind}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-foreground-secondary">Your Clear balance</span>
              <span className="shrink-0">Cash account</span>
            </div>
          </div>
        </>
      )}

      <Button variant="clear" size="xs" className="mb-2.5 w-full" onClick={onManageAccounts}>
        Manage linked accounts
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        It grows as your income holds steady and plans clear on time. Nothing to apply for.
      </p>
    </Modal>
  );
}
