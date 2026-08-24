import { useMemo, useState } from 'react';
import { ArrowDownUp, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import Keypad from './Keypad';
import { applyKey } from '@/lib/amountEntry';
import { money, count } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Move money — savings. One component, two directions.
 *
 * Cash to savings mints CLRUSD; savings to cash redeems it. Same layout and keypad both ways —
 * only the pair and the consequence change. Savings draws from **Ready to allocate**, the USDC
 * already sitting in the cash account, so both directions move money that is already inside Clear.
 *
 * **Amount first, route second.** The member arrived knowing the direction; what they are deciding
 * is how much. So the figure and the pad lead, and the pair sits under them as confirmation rather
 * than as a choice to make.
 *
 * **The cost of withdrawing is stated, not moralised** — credits given up, limit dropped, home date
 * pushed back. Three facts, no warning tone. A member taking their own money out is exercising the
 * thing that makes this an equity account rather than a lock-up, and the screen's job is to make
 * sure they know the price, not to talk them out of paying it.
 *
 * **Empty is a different screen, not a disabled button.** Nothing ready to allocate is not a
 * failed amount — it is a member who needs to bring money in first, and that is the only place
 * auto-save is offered.
 */

export type MoveDirection = 'deposit' | 'withdraw';

/** The two legs, butted together with the swap on the seam so the pair reads as one object. */
function Leg({
  label,
  name,
  balance,
  note,
  side,
}: {
  label: string;
  name: string;
  balance: number;
  note?: string;
  side: 'top' | 'bottom';
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-[0.5px] border-border bg-surface-1 px-3.5 py-3',
        // Facing corners tight, outer corners round: the seam reads as a join rather than as two
        // separate cards that happen to be adjacent.
        side === 'top' ? 'rounded-t-[10px] rounded-b-[4px]' : 'rounded-b-[10px] rounded-t-[4px]',
      )}
    >
      <div className="min-w-0">
        <p className="mb-0.5 text-[10px] uppercase tracking-[0.4px] text-muted-foreground">{label}</p>
        <p className="truncate text-[13px]">{name}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[13px] tabular-nums">{money(balance, { cents: true })}</p>
        {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}

function ConsequenceRow({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-foreground-secondary">{label}</span>
      <span
        className={cn(
          'tabular-nums',
          tone === 'up' && 'text-tier-savings-fg',
          tone === 'down' && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export interface MoveMoneyProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: MoveDirection;
  onDirectionChange: (direction: MoveDirection) => void;
  /** USDC already in the cash account and not spendable on the card — what savings draws from. */
  cashReady: number;
  savingsTotal: number;
  /** Savings not pledged against the credit line. Withdrawing is capped here, not at the total. */
  savingsFree: number;
  credits: number;
  creditsGoal: number;
  creditLimitToday: number;
  /** e.g. "Jan 2028" — desktop shows it, and it moves as they type. */
  reachesGoalBy?: string;
  /** e.g. "2 months later" — only meaningful on a withdrawal. */
  goalShift?: string;
  busy?: boolean;
  error?: string | null;
  txHash?: string | null;
  onMove: (amount: number) => void;
  onAddMoney?: () => void;
  onAutoSave?: () => void;
}

export default function MoveMoneyDialog({
  open,
  onOpenChange,
  direction,
  onDirectionChange,
  cashReady,
  savingsTotal,
  savingsFree,
  credits,
  creditsGoal,
  creditLimitToday,
  reachesGoalBy,
  goalShift,
  busy = false,
  error = null,
  txHash = null,
  onMove,
  onAddMoney,
  onAutoSave,
}: MoveMoneyProps) {
  const [typed, setTyped] = useState('250');

  const isDeposit = direction === 'deposit';
  const amount = Number(typed) || 0;
  // Each leg carries its own balance, which is what gives "All" and "All free" stated meanings.
  const available = isDeposit ? cashReady : savingsFree;
  const presets = isDeposit ? [100, 250, 500] : [100, 500, 1000];
  const over = amount > available;

  const after = useMemo(
    () => ({
      savings: isDeposit ? savingsTotal + amount : savingsTotal - amount,
      credits: isDeposit ? credits + amount : Math.max(0, credits - amount),
    }),
    [isDeposit, savingsTotal, credits, amount],
  );

  // Nothing to allocate is a screen of its own — a member who needs to bring money in, not one who
  // typed a bad number. Only on the deposit leg: with savings to draw on, the other direction works.
  const nothingReady = isDeposit && cashReady <= 0;

  const swap = () => {
    onDirectionChange(isDeposit ? 'withdraw' : 'deposit');
    setTyped('');
  };

  const legs = (
    <div className="relative mb-3">
      <Leg
        side="top"
        label="From"
        name={isDeposit ? 'Cash account' : 'Savings'}
        balance={isDeposit ? cashReady : savingsTotal}
        note={isDeposit ? 'ready' : savingsFree < savingsTotal ? `${money(savingsFree)} free` : 'free'}
      />
      <div className="h-1" />
      <Leg
        side="bottom"
        label="To"
        name={isDeposit ? 'Savings' : 'Cash account'}
        balance={isDeposit ? savingsTotal : cashReady}
      />
      {/* On the seam, with a ring in the surface colour so it punches cleanly through the gap. */}
      <button
        type="button"
        onClick={swap}
        disabled={busy}
        aria-label="Swap direction"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-secondary p-1.5 ring-4 ring-background disabled:opacity-50"
      >
        <ArrowDownUp className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Move money"
      description="Move money between your cash account and savings."
    >
      {txHash ? (
        <div className="py-2 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-positive/15">
            <Check className="h-[22px] w-[22px] text-positive" strokeWidth={2.4} />
          </div>
          <p className="text-2xl font-medium">{money(amount, { cents: true })}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Moved to {isDeposit ? 'savings' : 'cash'}
            {isDeposit ? ` · ${count(amount)} in equity credits` : ''}
          </p>
          <Button size="xs" variant="clear" className="mt-4 w-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      ) : nothingReady ? (
        <>
          <p className="mb-2 text-[10px] uppercase tracking-[0.4px] text-muted-foreground">
            Nothing ready to allocate
          </p>
          {legs}
          <p className="mb-1 text-[15px] font-medium">Add money first</p>
          <p className="mb-3.5 text-[13px] leading-relaxed text-foreground-secondary">
            This moves money you already hold in Clear. Bring some in and it lands ready to
            allocate.
          </p>
          <Button size="xs" className="mb-2 w-full" onClick={onAddMoney}>
            Add money
          </Button>
          {/* Offered here and nowhere else: it is the answer to an empty account, not a second
              way to do what this screen already does. */}
          <Button size="xs" variant="clear" className="w-full" onClick={onAutoSave}>
            Set up auto-save instead
          </Button>
        </>
      ) : (
        <>
          <p className="mb-1 text-[10px] uppercase tracking-[0.4px] text-muted-foreground">Amount</p>
          <p className="mb-3 text-center font-display text-[38px] font-medium leading-none tracking-[-0.5px]">
            ${typed === '' ? '0' : typed.split('.')[0] || '0'}
            <span className="text-[22px] text-muted-foreground">
              .{(typed.split('.')[1] ?? '').padEnd(2, '0').slice(0, 2)}
            </span>
          </p>

          <div className="mb-3 flex gap-1.5">
            {presets.map((preset) => (
              <Button
                key={preset}
                variant="clear"
                size="xs"
                className={cn('flex-1', amount === preset && 'border-tier-boost text-tier-boost-fg')}
                onClick={() => setTyped(String(preset))}
              >
                {money(preset)}
              </Button>
            ))}
            <Button
              variant="clear"
              size="xs"
              className={cn('flex-1', amount === available && available > 0 && 'border-tier-boost text-tier-boost-fg')}
              onClick={() => setTyped(String(available))}
            >
              {isDeposit ? 'All' : 'All free'}
            </Button>
          </div>

          {legs}

          <div className="mb-3">
            <Keypad onKey={(key) => setTyped((current) => applyKey(current, key))} disabled={busy} />
          </div>

          <div className="mb-3 space-y-1 border-t-[0.5px] border-border pt-2.5">
            {isDeposit ? (
              <>
                <ConsequenceRow label="Credits earned" value={`+${count(amount)}`} tone="up" />
                <ConsequenceRow label="Your limit rises by" value={`+${money(amount, { cents: true })}`} tone="up" />
              </>
            ) : (
              <>
                <ConsequenceRow label="Credits given up" value={`−${count(amount)}`} tone="down" />
                <ConsequenceRow label="Your limit drops by" value={`−${money(amount, { cents: true })}`} tone="down" />
              </>
            )}
            <ConsequenceRow label="Savings after" value={money(after.savings, { cents: true })} />
            <ConsequenceRow
              label={isDeposit ? 'Credits after' : 'Reaches goal'}
              value={
                isDeposit
                  ? `${count(after.credits)} of ${count(creditsGoal)}`
                  : `${reachesGoalBy ?? '—'}${goalShift ? ` · ${goalShift}` : ''}`
              }
            />
            {isDeposit && reachesGoalBy && (
              // Desktop earns this extra line, and it moves as they type.
              <ConsequenceRow label="Reaches goal by" value={reachesGoalBy} />
            )}
          </div>

          {!isDeposit && (
            <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Vested credits stay. Only the credits this money was still earning are given up.
            </p>
          )}

          {over && (
            <p className="mb-2 text-[11px] leading-relaxed text-negative">
              That&rsquo;s more than the {money(available, { cents: true })}{' '}
              {isDeposit ? 'ready to allocate' : 'free to move'}.
            </p>
          )}
          {error && <p className="mb-2 text-[11px] leading-relaxed text-negative">{error}</p>}

          <Button
            size="xs"
            className="w-full"
            disabled={busy || over || amount <= 0}
            onClick={() => onMove(amount)}
          >
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Moving…
              </>
            ) : (
              `Move ${money(amount, { cents: true })} to ${isDeposit ? 'savings' : 'cash'}`
            )}
          </Button>

          {isDeposit && (
            <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
              Instant. You can move it back any time.
            </p>
          )}

          {/* The limit today, so the rise above has something to be a rise from. */}
          {creditLimitToday > 0 && (
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Limit today {money(creditLimitToday)}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
