import { Check } from 'lucide-react';
import { dollars, formatCalendarDate, merchantFee, merchantPayout } from '@clear/domain';
import { Inset, PrimaryButton } from '@/shell/ui';

/**
 * Confirmed — reference section 05.
 *
 * The fee is shown here every time. A merchant who learns their real rate from a monthly statement
 * feels sold to; one who sees $23.50 as it happens is being told the truth when it is cheapest to
 * hear.
 */
export function ChargeConfirmed({
  amount,
  memberName,
  discountRate,
  paidOut,
  onDone,
}: {
  amount: number;
  memberName: string;
  discountRate: number;
  paidOut: string;
  onDone: () => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-1 items-start gap-3.5 @[900px]:grid-cols-2">
        <div className="flex items-center gap-3.5">
          <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-[var(--clear-bg-success)]">
            <Check size={23} strokeWidth={2.4} className="text-[var(--clear-text-success)]" aria-hidden />
          </div>
          <div>
            <p className="m-0 text-[26px] font-medium tabular-nums">{dollars(amount)}</p>
            <p className="m-0 mt-1 text-[12.5px] text-[var(--clear-text-muted)]">
              {memberName} · approved just now
            </p>
          </div>
        </div>

        <Inset className="!px-4 !py-3.5">
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">You receive</span>
            <span className="font-medium tabular-nums">
              {dollars(merchantPayout(amount, discountRate))}
            </span>
          </div>
          <div className="mt-[7px] flex justify-between text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">Fee</span>
            <span className="tabular-nums">
              {dollars(merchantFee(amount, discountRate))} ·{' '}
              {Math.round(discountRate * 1000) / 10}%
            </span>
          </div>
          <div className="mt-[7px] flex justify-between border-t-[0.5px] border-[var(--clear-border)] pt-[9px] text-[13px]">
            <span className="text-[var(--clear-text-secondary)]">Paid out</span>
            <span>{formatCalendarDate(paidOut)}</span>
          </div>
        </Inset>
      </div>

      <PrimaryButton onClick={onDone} className="mt-4 !py-[13px]">
        Done
      </PrimaryButton>
    </div>
  );
}
