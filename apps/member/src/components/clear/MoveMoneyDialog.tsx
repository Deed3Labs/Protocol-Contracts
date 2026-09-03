import { useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Modal from './Modal';
import Keypad from './Keypad';
import { applyKey } from '@/lib/amountEntry';
import { AlertMark, Spinner, Steps, Tick } from './MoveProgress';
import { stepsFor, type MoveStatus } from '@/lib/moveSteps';
import { money, count } from '@clear/domain';
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

/**
 * Where the money is going. The reference is explicit that the pool is "the same component as
 * savings, pointed at a different destination" — so it is a prop rather than a second modal.
 */
export type MoveDestination = 'savings' | 'pool' | 'bond';

/**
 * What a bond needs that neither of the others does.
 *
 * Bonds break the one rule the other two keep: everywhere else the number you type is the number
 * that moves. With a bond you choose **face value** — what you get back — and a smaller,
 * discounted amount leaves the account. So the hero carries both, with the price stated directly
 * beneath the face rather than buried in the summary.
 */
export interface BondTerms {
  /** Months offered, e.g. [6, 12, 24, 36]. Chips pick a term; the keypad types the face value. */
  termOptions: number[];
  months: number;
  onMonthsChange: (months: number) => void;
  /** What leaves the account today, quoted for the chosen face and term. */
  priceToday: number;
  /** e.g. "Aug 2028" on the leg, and "Aug 25, 2028" in the summary. */
  maturesShort: string;
  maturesLong: string;
  /** Annual rate, fixed for the life of the bond. */
  ratePercent: number;
  /** The haircut a bond is registered at — 9500 bps. */
  haircutBps: number;
  /**
   * The smallest face value the collection will mint, in whole units.
   *
   * Enforced on screen because it is enforced on chain and nowhere in between: the price quote
   * answers happily for a face below it, so a member could see "$4.84 today" for a bond the mint
   * then refuses — and the deployed build strips revert strings, so what came back was `0x`.
   */
  minFace: number;
  maxFace: number;
}

/** What the pool needs that savings does not. Absent for a savings move. */
export interface PoolTerms {
  /** e.g. 6.8 — variable, which is why the yield figure it produces is stated as approximate. */
  apyPercent: number;
  /**
   * The haircut the registry applies to a pool share, in basis points — 7000 on chain today.
   *
   * Carried rather than a precomputed delta, because the figure it produces moves as the member
   * types. A dollar lent backs seventy cents of limit, and the screen says so live.
   */
  haircutBps: number;
  /** Cash the pool can pay right now. Below the request, the rest queues. */
  freeNow: number;
  utilizationBps: number;
  /** The limit this withdrawal lands on, and what is owed against it. */
  limitAfter?: number;
  owed?: number;
}

function Leg({
  label,
  name,
  balance,
  note,
  side,
}: {
  label: string;
  name: string;
  /** Omitted when the leg has no running balance to show — a bond, before it exists. */
  balance?: number;
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
        {balance === undefined ? note : `${money(balance, { cents: true })}${note ? ` ${note}` : ''}`}
      </p>
    </div>
  );
}

/**
 * One line of the summary.
 *
 * `accent` is what the choice earns — tinted, and always the first row. `gain` is what it does to
 * the credit limit — green, divided off, and always the last. Between them sit plain facts.
 */
function Row({
  label,
  value,
  accent,
  gain,
}: {
  label: string;
  value: string;
  accent?: boolean;
  gain?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex justify-between text-[12.5px] leading-[2]',
        accent && 'text-tier-boost-fg',
        gain && 'mt-2 border-t-[0.5px] border-border pt-2',
      )}
    >
      <span className={accent ? undefined : 'text-foreground-secondary'}>{label}</span>
      <span className={cn('tabular-nums', gain && 'font-medium text-positive')}>{value}</span>
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
  destination?: MoveDestination;
  pool?: PoolTerms;
  bond?: BondTerms;
  /** e.g. "Jan 2028" — the only number on the screen about the thing they actually want. */
  reachesGoalBy?: string;
  /** e.g. "2 months later" — what a withdrawal costs in time. */
  goalShift?: string;
  busy?: boolean;
  error?: string | null;
  /**
   * Where the move has got to. Absent while the member is still deciding.
   *
   * Replaces a `txHash` that only ever said "done". Money moving deserves more than a spinner in
   * a button, and a failure deserves more than a red line under the amount.
   */
  progress?: { status: MoveStatus; step: number; failureNote?: string } | null;
  onMove: (amount: number) => void;
  /**
   * Reports the amount as it is typed.
   *
   * Needed by any destination whose consequences have to be fetched rather than computed — a bond
   * quotes its price from the chain for the face value on screen, and a price that only appeared
   * after pressing Buy would be a price nobody agreed to before agreeing to it.
   */
  onAmountChange?: (amount: number) => void;
  /** The offer made right after a move lands — "Save more", "See your bonds". */
  onAgain?: () => void;
  /** Retry after a failure, with the amount still on screen. */
  onRetry?: () => void;
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
  destination = 'savings',
  pool,
  bond,
  reachesGoalBy,
  goalShift,
  busy = false,
  error = null,
  progress = null,
  onMove,
  onAmountChange,
  onAgain,
  onRetry,
  onAddMoney,
  onAutoSave,
}: MoveMoneyProps) {
  /*
   * Starts empty, showing $0.00.
   *
   * A prefilled figure has to be cleared before it can be replaced, and on a keypad that means
   * pressing backspace three times before typing the first digit of what you actually wanted. The
   * chips are there for anyone who does want a round number; the pad is for everyone else, and it
   * should be ready to type into.
   *
   * Empty rather than the string "0", so the first keypress replaces nothing — `applyKey` already
   * treats a leading zero as a value to overwrite, but starting empty means it never has to.
   */
  const [typed, setTyped] = useState('');

  /** One place that changes the amount, so nothing can move it without the caller hearing. */
  const changeTyped = (next: string | ((current: string) => string)) => {
    setTyped((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      onAmountChange?.(Number(value) || 0);
      return value;
    });
  };

  const isDeposit = direction === 'deposit';
  const isPool = destination === 'pool';
  const isBond = destination === 'bond';
  // The pool can be fully lent — a state savings does not have. What is free to take is capped by
  // the pool's cash, not by the member's position.
  const poolFree = isPool && pool ? Math.min(savingsFree, pool.freeNow) : savingsFree;
  const amount = Number(typed) || 0;
  // Each leg carries its balance, so the constraint is visible before anything is typed and the
  // "All" chip has a stated meaning.
  const available = isDeposit ? cashReady : isPool ? poolFree : savingsFree;
  // "An amount and a keypad, not three preset buttons" — someone lending $3,400 because that is
  // what is spare should not have to pick $1,000. The chips are shortcuts; the pad is the input.
  const presets = isPool ? [500, 1000, 2500] : isDeposit ? [100, 250, 500] : [100, 500, 1000];
  const over = amount > available;
  const shortBy = amount - available;
  // A bond is measured against the collection's limits rather than against a balance.
  const belowMin = isBond && bond ? amount > 0 && amount < bond.minFace : false;
  const aboveMax = isBond && bond ? amount > bond.maxFace : false;

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
    changeTyped('');
  };

  const amountBlock = (dim = false) => (
    <>
      {/* The pool can be fully lent; savings cannot. Named at the top so the constrained figures
          below have a reason before they are read. */}
      {isPool && !isDeposit && over && (
        <p className="mb-2 text-[10px] uppercase tracking-[0.5px] text-muted-foreground">
          Pool is fully lent
        </p>
      )}
      <p className="mb-0.5 text-[11px] text-muted-foreground">
        {isBond ? 'Face value — what you get back' : 'Amount'}
      </p>
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
      {/* The one place a bond differs from everything else on screen: what leaves the account is
          not what was typed. Stated directly under the hero rather than left to the summary. */}
      {isBond && bond && !over && !belowMin && !aboveMax && (
        <p className="mb-3 text-[13px] text-tier-boost-fg">
          You pay {money(bond.priceToday, { cents: true })} today
        </p>
      )}

      {/* Stated as the gap, like every other constraint on this screen, and the pad stays live. */}
      {isBond && bond && belowMin && (
        <p className="mb-3 text-[13px] text-tier-boost-fg">
          {money(bond.minFace - amount, { cents: true })} below the{' '}
          {money(bond.minFace, { cents: true })} smallest bond
        </p>
      )}
      {isBond && bond && aboveMax && (
        <p className="mb-3 text-[13px] text-tier-boost-fg">
          {money(amount - bond.maxFace, { cents: true })} above the{' '}
          {money(bond.maxFace, { cents: true })} largest bond
        </p>
      )}

      {over && (
        // Stated as the difference, because that is the number they can act on — not as a refusal.
        <p className="mb-3 text-[11.5px] text-tier-boost-fg">
          {money(shortBy, { cents: true })} more than is{' '}
          {isDeposit ? 'ready to allocate' : isPool ? 'free right now' : 'free to move'}
        </p>
      )}
    </>
  );

  const route = (
    <div className="relative mb-3.5 grid grid-cols-2 items-stretch gap-1">
      <Leg
        side="left"
        label="From"
        name={isDeposit ? 'Cash account' : isPool ? 'Yield pool' : 'Savings'}
        balance={isDeposit ? cashReady : isPool ? poolFree : savingsFree}
        // "free" on every leg, per the reference. It means the same thing in both places — money
        // that can move — even though what constrains it differs: unallocated on the cash side,
        // unencumbered on the savings side, and not lent out on the pool's.
        note={isDeposit ? 'free' : isPool && pool && pool.freeNow < savingsFree ? 'free now' : 'free'}
      />
      {isBond && bond ? (
        // A bond has no running balance to show until it exists, so the leg carries the date it
        // matures instead.
        <Leg side="right" label="To" name="BurnerBond" note={`Matures ${bond.maturesShort}`} />
      ) : (
        <Leg
          side="right"
          label="To"
          name={isDeposit ? (isPool ? 'Yield pool' : 'Savings') : 'Cash account'}
          balance={isDeposit ? savingsTotal : cashReady}
        />
      )}

      {isBond ? (
        /*
         * One arrow, not two.
         *
         * It sits where the swap sits on the other two, but points one way and its circle is
         * filled rather than white — so it reads as a direction, not a control. A two-headed swap
         * would promise a reversal the product cannot do before maturity.
         */
        <span
          aria-hidden
          // Same circle, same position, same background as the swap on the other two — only the
          // glyph differs. Two heads means you can flip it; one head means you cannot, and that
          // reads instantly without changing anything else about the control.
          className="absolute left-1/2 top-1/2 z-[2] flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[0.5px] border-border bg-background ring-4 ring-background"
        >
          <ArrowRight className="h-[14px] w-[14px] text-muted-foreground" />
        </span>
      ) : (
        <button
          type="button"
          onClick={swap}
          disabled={busy}
          aria-label="Swap direction"
          className="absolute left-1/2 top-1/2 z-[2] flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[0.5px] border-border bg-background ring-4 ring-background disabled:opacity-50"
        >
          <ArrowLeftRight className="h-[13px] w-[13px] text-foreground-secondary" />
        </button>
      )}
    </div>
  );

  const chips = isBond && bond ? (
    <>
      <p className="mb-[7px] mt-0.5 text-[10px] uppercase tracking-[0.5px] text-muted-foreground">Term</p>
      <div className="mb-3 flex gap-1.5">
        {bond.termOptions.map((months) => (
          <Button
            key={months}
            variant="clear"
            size="xs"
            className={cn('flex-1', months === bond.months && 'border-tier-boost bg-tier-boost/10 text-tier-boost-fg')}
            onClick={() => bond.onMonthsChange(months)}
          >
            {months} mo
          </Button>
        ))}
      </div>
    </>
  ) : (
    <div className="mb-3 flex gap-1.5">
      {presets.map((preset) => (
        <Button
          key={preset}
          variant="clear"
          size="xs"
          className={cn('flex-1', amount === preset && 'border-tier-boost bg-tier-boost/10 text-tier-boost-fg')}
          onClick={() => changeTyped(String(preset))}
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
        onClick={() => changeTyped(String(available))}
      >
        {/* "All free" rather than "All" — it moves everything that can move, and the word does the
            explaining. */}
        {isDeposit ? 'All' : 'All free'}
      </Button>
    </div>
  );

  const pad = <Keypad onKey={(key) => changeTyped((current) => applyKey(current, key))} disabled={busy} />;

  /**
   * The summary: one bordered box, five lines, the same shape at every destination.
   *
   * It was two containers — a tinted box for what the choice earns, then bare rows under a
   * hairline. One box does it, with colour carrying the distinction a second container was
   * carrying: **what this earns** is tinted on its own row at the top, **what it adds to the
   * credit limit** is green and always last.
   *
   * Last and green because it is the one consequence common to all three products, and the one
   * easiest to forget you are getting — a member reading three different modals should find it in
   * the same place each time.
   */
  const summaryRows = (past = false) => (
    <div className="mb-3 rounded-[10px] border-[0.5px] border-border px-3.5 py-3">
      {isBond && bond ? (
        <>
          {/* Done leads with the gain, not the payment: the member already knows what left their
              account — they confirmed it. What they bought is the difference and a date. */}
          <Row label={past ? 'You paid' : 'You pay today'} value={money(bond.priceToday, { cents: true })} />
          <Row
            label={past ? 'You gain' : 'You get at maturity'}
            value={money(past ? Math.max(0, amount - bond.priceToday) : amount, { cents: true })}
            accent={past}
          />
          <Row label="Matures" value={bond.maturesLong} />
          {/* One line, not two. The rate and what it is worth in dollars are the same fact, and a
              buyer needs both to compare terms — splitting them made the reader multiply. */}
          <Row
            label="Yield"
            value={`${bond.ratePercent.toFixed(1)}% fixed · +${money(Math.max(0, amount - bond.priceToday), { cents: true })}`}
            accent
          />
          <Row
            label={past ? 'Your limit rose by' : 'Adds to your credit limit'}
            value={`+${money((bond.priceToday * bond.haircutBps) / 10_000, { cents: true })}`}
            gain
          />
        </>
      ) : isPool && pool && isDeposit ? (
        <>
          <Row label="Earning" value={`${pool.apyPercent}% APY`} accent />
          <Row label="Position after" value={money(after.savings, { cents: true })} />
          <Row
            label="Yield a year"
            value={`~${money((after.savings * pool.apyPercent) / 100, { cents: true })}`}
          />
          <Row label="Withdraw" value="Any time" />
          <Row
            label={past ? 'Your credit limit rose by' : 'Backs your credit limit'}
            value={`+${money((amount * pool.haircutBps) / 10_000, { cents: true })}`}
            gain
          />
        </>
      ) : isPool && pool ? (
        <>
          {/* Taking money out is the same five lines with the signs turned round. The earn row
              still leads, because what a withdrawal costs in yield is the thing being weighed. */}
          <Row
            label="Yield lost"
            value={`~${money((amount * pool.apyPercent) / 100, { cents: true })} a year`}
            accent
          />
          <Row label="Position after" value={money(after.savings, { cents: true })} />
          <Row label="Arrives" value={over ? 'Some queued' : 'Within 24 hours'} />
          <Row label="Pool utilization" value={`${Math.round(pool.utilizationBps / 100)}%`} />
          <Row
            label="Your credit limit drops by"
            value={`−${money((amount * pool.haircutBps) / 10_000, { cents: true })}`}
            gain
          />
        </>
      ) : isDeposit ? (
        <>
          <Row label="Credits earned" value={`+${count(amount)}`} accent />
          <Row label={past ? 'Savings' : 'Savings after'} value={money(after.savings, { cents: true })} />
          <Row label={past ? 'Credits' : 'Credits after'} value={`${count(after.credits)} of ${count(creditsGoal)}`} />
          <Row label={`Reaches ${count(creditsGoal)} by`} value={reachesGoalBy ?? '—'} />
          {/* Savings backs the line at 100%, so a dollar saved is a dollar of limit. */}
          <Row
            label={past ? 'Your credit limit rose by' : 'Adds to your credit limit'}
            value={`+${money(amount, { cents: true })}`}
            gain
          />
        </>
      ) : (
        <>
          <Row label="Credits given up" value={`−${count(amount)}`} accent />
          <Row label="Savings after" value={money(after.savings, { cents: true })} />
          <Row
            label={`Reaches ${count(creditsGoal)} by`}
            value={`${reachesGoalBy ?? '—'}${goalShift ? ` · ${goalShift}` : ''}`}
          />
          <Row label="Your credit limit drops by" value={`−${money(amount, { cents: true })}`} gain />
        </>
      )}
    </div>
  );

  // Kept from the earlier reference. The update that introduced the single summary draws only
  // deposits, which is not evidence a withdrawal should say less — and this is the sentence that
  // stops "credits given up" reading as though vested credits were at risk.
  // The question a member withdrawing is actually asking is whether they stay above what they owe,
  // so the panel names the limit it lands on rather than only the drop.
  const landingNote = isPool && !isDeposit && pool?.limitAfter !== undefined && (
    <p className="mb-3 text-[11px] leading-[1.55] text-muted-foreground">
      Limit falls to {money(pool.limitAfter, { cents: true })}
      {pool.owed !== undefined ? `, still above the ${money(pool.owed, { cents: true })} you owe.` : '.'}
    </p>
  );

  // Context rather than consequence, which is why desktop moves it under the keypad.
  const lockNote = isBond && bond && (
    <p className="mb-3 rounded-[10px] bg-secondary/50 px-3.5 py-[11px] text-[12px] leading-[1.6] text-foreground-secondary">
      Locked until maturity — but it backs your credit line at {Math.round(bond.haircutBps / 100)}%,
      so you can borrow against it any time for 0.65% a cycle.
    </p>
  );

  const vestingNote = !isPool && !isDeposit && (
    <p className="mb-3 text-[11px] leading-[1.55] text-muted-foreground">
      Vested credits stay. Only the credits this money was still earning are given up.
    </p>
  );

  // The pool has a state savings does not: it can be fully lent. Asking for more than is free is
  // not a mistake to refuse — pay what is there and queue the rest, which is what the contract's
  // requestWithdrawal exists for.
  const canQueue = isPool && !isDeposit && over;

  /*
   * The three things that actually happen, named.
   *
   * The reference draws savings and bonds; the others follow the same shape — money leaves, the
   * thing it is going into takes it, and the consequence a member cares about lands. That last
   * step is the least obvious and the one most worth watching, because it is why a locked
   * position is not a locked-away position.
   */
  const stepLabels = isBond
    ? ['Paid from your cash account', 'Issuing the bond', 'Adding it to your credit line']
    : isPool
      ? isDeposit
        ? ['Taken from your cash account', 'Adding to the pool', 'Adding it to your credit line']
        : ['Redeeming from the pool', 'Returning to your cash account', 'Updating your credit line']
      : isDeposit
        ? ['Taken from your cash account', 'Adding to your savings', `Crediting ${count(amount)} equity credits`]
        : ['Taken from your savings', 'Returning to your cash account', 'Updating your credit line'];

  const movingTitle = isBond
    ? 'Buying your bond'
    : `${isDeposit ? 'Moving' : 'Taking'} ${money(amount, { cents: true })}`;

  const movingSub = isBond && bond
    ? `${money(bond.priceToday, { cents: true })} → ${money(amount, { cents: true })} at maturity`
    : isDeposit
      ? `Cash account → ${isPool ? 'Yield pool' : 'Savings'}`
      : `${isPool ? 'Yield pool' : 'Savings'} → Cash account`;

  const doneTitle = isBond
    ? 'Bond bought'
    : isPool
      ? `${money(amount, { cents: true })} ${isDeposit ? 'added' : 'taken'}`
      : isDeposit
        ? `${money(amount, { cents: true })} saved`
        : `${money(amount, { cents: true })} moved`;

  const progressView = progress && (
    <>
      <div className="py-2 text-center">
        {progress.status === 'processing' ? <Spinner /> : progress.status === 'done' ? <Tick /> : <AlertMark />}
        <p className="mb-1 mt-4 text-[19px] font-medium">
          {/* "Nothing moved" is the headline, not the error. The only question a member has when
              something fails with their money is whether they still have it. */}
          {progress.status === 'processing' ? movingTitle : progress.status === 'done' ? doneTitle : 'Nothing moved'}
        </p>
        <p className="text-[12.5px] text-foreground-secondary">
          {progress.status === 'processing'
            ? movingSub
            : progress.status === 'done'
              ? isBond && bond
                ? `${money(amount, { cents: true })} face · matures ${bond.maturesLong}`
                : 'Just now'
              : `Your ${money(amount, { cents: true })} is still in your ${isDeposit ? 'cash account' : isPool ? 'pool position' : 'savings'}`}
        </p>
      </div>

      <div className="mb-3 mt-4">
        {progress.status === 'done' ? (
          summaryRows(true)
        ) : (
          <Steps
            steps={
              progress.status === 'failed'
                ? // Taken, then returned. A member who watched money leave needs to watch it come
                  // back, not be told it never left.
                  [
                    { label: stepLabels[0], state: 'done' as const },
                    { label: `Returned — ${progress.failureNote ?? 'it did not go through'}`, state: 'done' as const },
                  ]
                : stepsFor(stepLabels, progress.step, progress.status)
            }
          />
        )}
      </div>

      {progress.status === 'processing' && (
        <p className="rounded-[10px] bg-secondary/50 px-3.5 py-[11px] text-[12px] leading-[1.6] text-foreground-secondary">
          Usually a few seconds. <strong className="font-medium text-foreground">You can close this</strong> — it
          finishes on its own{isBond ? '.' : ' and lands in your activity either way.'}
        </p>
      )}

      {progress.status === 'done' && (
        <>
          <Button size="xs" className="mb-2 w-full py-3" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          {/* The moment right after a deposit is the only moment somebody is inclined to make
              another. */}
          <Button size="xs" variant="clear" className="w-full text-xs" onClick={onAgain}>
            {isBond ? 'See your bonds' : isPool ? 'Add more' : 'Save more'}
          </Button>
        </>
      )}

      {progress.status === 'failed' && (
        <>
          <Button size="xs" className="mb-2 w-full py-3" onClick={onRetry}>
            Try again
          </Button>
          <Button size="xs" variant="clear" className="w-full text-xs" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
        </>
      )}
    </>
  );

  const bondLimit = isBond && bond && (belowMin || aboveMax);

  const action = bondLimit && bond ? (
    <>
      <div className="mb-3 rounded-[10px] bg-secondary/50 px-3.5 py-[11px]">
        <p className="text-[12px] leading-[1.6] text-foreground-secondary">
          Bonds run from{' '}
          <strong className="font-medium text-foreground">{money(bond.minFace, { cents: true })}</strong> to{' '}
          <strong className="font-medium text-foreground">{money(bond.maxFace, { cents: true })}</strong> of face
          value.
        </p>
      </div>
      <Button
        size="xs"
        variant="clear"
        className="w-full py-3 text-muted-foreground"
        onClick={() => changeTyped(String(belowMin ? bond.minFace : bond.maxFace))}
      >
        Use {money(belowMin ? bond.minFace : bond.maxFace, { cents: true })} instead
      </Button>
    </>
  ) : canQueue ? (
    <>
      <div className="mb-3 rounded-[10px] border-[0.5px] border-border bg-secondary/50 px-3.5 py-[11px]">
        <p className="text-[12px] leading-[1.6] text-foreground-secondary">
          The rest is lent out. <strong className="font-medium text-foreground">Queue it</strong> and
          it is sent as members repay.
        </p>
      </div>
      <Button size="xs" className="mb-2 w-full py-[11px]" disabled={busy} onClick={() => onMove(available)}>
        Take {money(available, { cents: true })} now
      </Button>
      <Button size="xs" variant="clear" className="w-full text-xs" disabled={busy} onClick={() => onMove(amount)}>
        Queue the remaining {money(amount - available, { cents: true })}
      </Button>
      <p className="mt-2.5 text-center text-[11px] leading-[1.55] text-muted-foreground">
        Sent automatically. Nothing to come back and do.
      </p>
    </>
  ) : over ? (
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
        onClick={() => changeTyped(String(available))}
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
        ) : isBond ? (
          'Buy this bond'
        ) : isPool ? (
          `${isDeposit ? 'Add' : 'Take'} ${money(amount, { cents: true })}`
        ) : (
          `Move ${money(amount, { cents: true })} to ${isDeposit ? 'savings' : 'cash'}`
        )}
      </Button>
      {isBond ? null : (
      <p className="mt-2.5 text-center text-[11px] leading-[1.55] text-muted-foreground">
        {isPool
          ? isDeposit
            ? 'Rate moves with how much of the pool is lent.'
            : 'Sent to your cash account.'
          : isDeposit
            ? 'Instant. You can move it back any time.'
            : 'Instant. Move it back whenever you like.'}
      </p>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        isBond
          ? 'Buy a bond'
          : isPool
            ? isDeposit
              ? 'Add to the pool'
              : 'Take from the pool'
            : 'Move money'
      }
      description={
        isBond
          ? 'Choose a face value and a term, and review what the bond costs today.'
          : isPool
            ? 'Move money between your cash account and the yield pool.'
            : 'Move money between your cash account and savings.'
      }
      // The desktop dialog is 360px by default, and the two-column layout below needs the width
      // the reference gives it — a 216px keypad beside a column that still has to fit "Credits
      // earned" on one line. Forced into 360px it wraps to one word per line, which is what it
      // did. Only widened where the two-column layout applies: Modal switches to a bottom sheet
      // below 640px, the same breakpoint the grid uses, so the two never disagree.
      className={nothingReady ? undefined : 'sm:max-w-[640px] sm:p-[21px]'}
    >
      {progress ? (
        progressView
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
            {summaryRows()}
            {vestingNote}
            {landingNote}
            <div className="sm:hidden">{lockNote}</div>
          </div>
          <div className="hidden sm:block">
            {pad}
            {/* Context, not consequence, so on desktop it sits on the input side where there is
                room rather than interrupting the read down the left. */}
            <div className="mt-3">{lockNote}</div>
          </div>
          <div className="sm:col-span-2">{action}</div>
        </div>
      )}
    </Modal>
  );
}
