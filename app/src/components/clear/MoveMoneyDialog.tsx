import { useMemo, useState } from 'react';
import { ArrowLeftRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import Keypad from './Keypad';
import { applyKey } from '@/lib/amountEntry';
import { money, count } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Move money — savings. One component, two directions.
 *
 * Cash to savings mints CLRUSD; savings to cash redeems it. Same layout, same keypad — what
 * changes is the pair at the top and the consequence underneath. Both directions move money that
 * is already inside Clear.
 *
 * **Amount first, route second.** The member already knows which way they are going; they arrived
 * from Save or from the savings page. What they are deciding is *how much*, so that gets the top
 * of the screen and the route sits under it as confirmable context.
 *
 * **Two cards with the swap between them, rather than stacked.** Side by side reads as one
 * movement, and the icon in the middle is the control that reverses it — not a different menu item.
 *
 * **Never block the keypad.** Somebody typing more than they have gets told what is wrong
 * underneath, stated as the difference, because that is the number they can act on. Disabling the
 * pad would leave them holding a figure with no way to find out why it will not go.
 *
 * **The cost of withdrawing is stated, not moralised.** Credits given up, limit dropped, home date
 * pushed back. No warning icon and no "are you sure" — the member has a reason, and the numbers
 * are enough.
 */

export type MoveDirection = 'deposit' | 'withdraw';

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
  side: 'left' | 'right';
}) {
  return (
    <div
      className={cn(
        'min-w-0 bg-secondary/50 px-3.5 py-[11px]',
        // Facing corners tight, outer corners round, and the facing side padded wide enough to
        // keep the text clear of the swap sitting on the seam.
        side === 'left' ? 'rounded-l-[10px] rounded-r-[4px] pr-[25px]' : 'rounded-r-[10px] rounded-l-[4px] pl-[25px]',
      )}
    >
      <p className="mb-[5px] text-[9.5px] uppercase leading-none tracking-[0.4px] text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-[13px] leading-[1.3]">{name}</p>
      <p className="mt-0.5 truncate text-[11.5px] leading-[1.35] text-muted-foreground">
        {money(balance, { cents: true })}
        {note ? ` ${note}` : ''}
      </p>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn('flex justify-between text-[12.5px] leading-[2]', accent && 'text-tier-boost-fg')}>
      <span className={accent ? undefined : 'text-foreground-secondary'}>{label}</span>
      <span className="tabular-nums">{value}</span>
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
  /** Savings not pledged against drawn credit. The leg shows this, not the headline balance. */
  savingsFree: number;
  credits: number;
  creditsGoal: number;
  /** e.g. "Jan 2028" — the only number on the screen about the thing they actually want. */
  reachesGoalBy?: string;
  /** e.g. "2 months later" — what a withdrawal costs in time. */
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
  // Each leg carries its balance, so the constraint is visible before anything is typed and the
  // "All" chip has a stated meaning.
  const available = isDeposit ? cashReady : savingsFree;
  const presets = isDeposit ? [100, 250, 500] : [100, 500, 1000];
  const over = amount > available;
  const shortBy = amount - available;

  const after = useMemo(
    () => ({
      savings: isDeposit ? savingsTotal + amount : savingsTotal - amount,
      credits: isDeposit ? credits + amount : Math.max(0, credits - amount),
    }),
    [isDeposit, savingsTotal, credits, amount],
  );

  // The member is one step earlier than this modal assumes, so it names the actual next action.
  const nothingReady = isDeposit && cashReady <= 0;

  const swap = () => {
    onDirectionChange(isDeposit ? 'withdraw' : 'deposit');
    setTyped('');
  };

  const amountBlock = (dim = false) => (
    <>
      <p className="mb-0.5 text-[11px] text-muted-foreground">Amount</p>
      <p
        className={cn(
          'font-display text-[38px] font-medium leading-[1.05] tracking-[-1.2px]',
          dim ? 'text-border' : undefined,
          over ? 'mb-[5px]' : 'mb-[13px]',
        )}
      >
        {/* Grouped for reading, but the typed string stays the source — formatting the whole
            figure would fight the decimal point somebody is part-way through entering. */}
        ${Number(typed.split('.')[0] || 0).toLocaleString('en-US')}
        <span className={dim ? undefined : 'text-border'}>
          .{(typed.split('.')[1] ?? '').padEnd(2, '0').slice(0, 2)}
        </span>
      </p>
      {over && (
        // Stated as the difference, because that is the number they can act on — not as a refusal.
        <p className="mb-3 text-[11.5px] text-tier-boost-fg">
          {money(shortBy, { cents: true })} more than is {isDeposit ? 'ready to allocate' : 'free to move'}
        </p>
      )}
    </>
  );

  const route = (
    <div className="relative mb-3.5 grid grid-cols-2 items-stretch gap-1">
      <Leg
        side="left"
        label="From"
        name={isDeposit ? 'Cash account' : 'Savings'}
        balance={isDeposit ? cashReady : savingsFree}
        note={isDeposit ? 'ready' : 'free'}
      />
      <Leg
        side="right"
        label="To"
        name={isDeposit ? 'Savings' : 'Cash account'}
        balance={isDeposit ? savingsTotal : cashReady}
      />
      <button
        type="button"
        onClick={swap}
        disabled={busy}
        aria-label="Swap direction"
        className="absolute left-1/2 top-1/2 z-[2] flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[0.5px] border-border bg-background ring-4 ring-background disabled:opacity-50"
      >
        <ArrowLeftRight className="h-[13px] w-[13px] text-foreground-secondary" />
      </button>
    </div>
  );

  const chips = (
    <div className="mb-3 flex gap-1.5">
      {presets.map((preset) => (
        <Button
          key={preset}
          variant="clear"
          size="xs"
          className={cn('flex-1', amount === preset && 'border-tier-boost bg-tier-boost/10 text-tier-boost-fg')}
          onClick={() => setTyped(String(preset))}
        >
          {money(preset)}
        </Button>
      ))}
      <Button
        variant="clear"
        size="xs"
        className={cn(
          'flex-1',
          amount === available && available > 0 && 'border-tier-boost bg-tier-boost/10 text-tier-boost-fg',
        )}
        onClick={() => setTyped(String(available))}
      >
        {/* "All free" rather than "All" — it moves everything that can move, and the word does the
            explaining. */}
        {isDeposit ? 'All' : 'All free'}
      </Button>
    </div>
  );

  const pad = <Keypad onKey={(key) => setTyped((current) => applyKey(current, key))} disabled={busy} />;

  const consequences = (
    <>
      {isDeposit ? (
        <div className="mb-3 rounded-[10px] border-[0.5px] border-tier-boost/40 bg-tier-boost/[0.08] px-3.5 py-3">
          <Row label="Credits earned" value={`+${count(amount)}`} accent />
          <Row label="Your limit rises by" value={`+${money(amount, { cents: true })}`} accent />
        </div>
      ) : (
        // Neutral, not accented. The figures are the point; colouring them would be the warning
        // tone the reference is explicit about not using.
        <div className="mb-3 rounded-[10px] border-[0.5px] border-border bg-secondary/50 px-3.5 py-3">
          <Row label="Credits given up" value={`−${count(amount)}`} />
          <Row label="Your limit drops by" value={`−${money(amount, { cents: true })}`} />
          <p className="mt-[7px] text-[11px] leading-[1.55] text-muted-foreground">
            Vested credits stay. Only the credits this money was still earning are given up.
          </p>
        </div>
      )}

      <div className="mb-3.5 border-t-[0.5px] border-border pt-2.5">
        <Row label="Savings after" value={money(after.savings, { cents: true })} />
        {isDeposit ? (
          <Row label="Credits after" value={`${count(after.credits)} of ${count(creditsGoal)}`} />
        ) : (
          <Row
            label={`Reaches ${count(creditsGoal)} by`}
            value={`${reachesGoalBy ?? '—'}${goalShift ? ` · ${goalShift}` : ''}`}
          />
        )}
        {/* The extra line desktop earns: the only number on the screen about the thing they
            actually want. Hidden on a narrow modal, which is already tall enough. */}
        {isDeposit && reachesGoalBy && (
          <div className="hidden sm:block">
            <Row label={`Reaches ${count(creditsGoal)} by`} value={reachesGoalBy} />
          </div>
        )}
      </div>
    </>
  );

  const action = over ? (
    <>
      <div className="mb-3 rounded-[10px] bg-secondary/50 px-3.5 py-[11px]">
        <p className="text-[12px] leading-[1.6] text-foreground-secondary">
          Move <strong className="font-medium text-foreground">{money(available, { cents: true })}</strong> instead
          {isDeposit ? ', or add money to your cash account first.' : '.'}
        </p>
      </div>
      <Button
        size="xs"
        variant="clear"
        className="w-full py-3 text-muted-foreground"
        onClick={() => setTyped(String(available))}
      >
        Move to {isDeposit ? 'savings' : 'cash'}
      </Button>
    </>
  ) : (
    <>
      {error && <p className="mb-2 text-[11px] leading-relaxed text-negative">{error}</p>}
      <Button size="xs" className="w-full py-3" disabled={busy || amount <= 0} onClick={() => onMove(amount)}>
        {busy ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Moving…
          </>
        ) : (
          `Move ${money(amount, { cents: true })} to ${isDeposit ? 'savings' : 'cash'}`
        )}
      </Button>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
        {isDeposit ? 'Instant. You can move it back any time.' : 'Instant. Move it back whenever you like.'}
      </p>
    </>
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
          <p className="mb-2 text-[10px] uppercase tracking-[0.5px] text-muted-foreground">Nothing to move</p>
          {amountBlock(true)}
          {route}
          <p className="mb-[7px] text-sm font-medium">Add money first</p>
          <p className="mb-3.5 text-[12px] leading-[1.6] text-foreground-secondary">
            This moves money you already hold in Clear. Bring some in and it lands ready to
            allocate.
          </p>
          <Button size="xs" className="mb-2 w-full py-[11px]" onClick={onAddMoney}>
            Add money
          </Button>
          {/* Offered here and nowhere else — the one moment the suggestion helps rather than nags. */}
          <Button size="xs" variant="clear" className="w-full text-xs" onClick={onAutoSave}>
            Set up auto-save instead
          </Button>
        </>
      ) : (
        // Desktop gives the keypad a column of its own: input on one side, the amount and its
        // consequences on the other, so the eye stops ping-ponging between a number and the thing
        // that changes it. The pad is a fixed width because keys should not stretch.
        <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_216px] sm:items-start sm:gap-5">
          <div>
            {amountBlock()}
            {chips}
            {route}
            <div className="mb-3 sm:hidden">{pad}</div>
            {consequences}
          </div>
          <div className="hidden sm:block">{pad}</div>
          <div className="sm:col-span-2">{action}</div>
        </div>
      )}
    </Modal>
  );
}
