import { useMemo, useState, type ReactNode } from 'react';
import Modal from './Modal';
import Keypad from './Keypad';
import { Btn } from './brand/anatomy';
import { ArrowIcon, SwapIcon } from './brand/icons';
import { applyKey } from '@/lib/amountEntry';
import { AlertMark, Steps, Tick } from './MoveProgress';
import { stepsFor, type MoveStatus } from '@/lib/moveSteps';
import { money, count } from '@clear/domain';
import { cn } from '@/lib/utils';

/**
 * Move money — savings, the pool and bonds. One component.
 *
 * A modal is a component: **header** is the title and the close; **main is everything you touch to
 * change the number** — the amount, the quick amounts, the route and the keypad; **footer is what
 * happens as a result, and the commit** — the consequence lines and the button. That split is why the
 * summary needs no border of its own: the footer rule above it and the sheet edge below contain it.
 *
 * **Amount first, route second.** The member arrived knowing the direction; what they are deciding is
 * how much. The route and the keypad are built like the Home slab — cells on a shared seam — with the
 * swap sitting on the seam between the legs.
 *
 * **Cobalt marks the reason you are here**, once: the earn row. The credit-limit line is settled green
 * when it rises and plain ink when it falls, never red — withdrawing states its cost without
 * moralising.
 *
 * **Never block the keypad.** Somebody typing more than they have gets told what is wrong underneath,
 * stated as the difference, because that is the number they can act on.
 */

export type MoveDirection = 'deposit' | 'withdraw';

/**
 * Where the money is going. The pool is "the same component as savings, pointed at a different
 * destination" — so it is a prop rather than a second modal.
 */
export type MoveDestination = 'savings' | 'pool' | 'bond';

/**
 * What a bond needs that neither of the others does.
 *
 * Bonds break the one rule the other two keep: everywhere else the number you type is the number
 * that moves. With a bond you choose **face value** — what you get back — and a smaller, discounted
 * amount leaves the account. So the hero carries both, with what you pay directly beneath in cobalt.
 */
export interface BondTerms {
  /** Months offered, e.g. [6, 12, 24, 36]. Chips pick a term; the keypad types the face value. */
  termOptions: number[];
  months: number;
  onMonthsChange: (months: number) => void;
  /** What leaves the account today, quoted for the chosen face and term. */
  priceToday: number;
  /** e.g. "Aug 2028". */
  maturesShort: string;
  /** e.g. "Aug 25, 2028" — on the leg and in the summary. */
  maturesLong: string;
  /** Annual rate, fixed for the life of the bond. */
  ratePercent: number;
  /** The haircut a bond is registered at — 9500 bps. */
  haircutBps: number;
  /**
   * The smallest face value the collection will mint, in whole units. Enforced on screen because it
   * is enforced on chain and nowhere in between: the price quote answers happily for a face below it.
   */
  minFace: number;
  maxFace: number;
  /** Bonds the member holds before this one, for the done screen's count. */
  heldBefore?: number;
}

/** What the pool needs that savings does not. Absent for a savings move. */
export interface PoolTerms {
  /** e.g. 6.8 — variable, which is why the yield figure it produces is stated as approximate. */
  apyPercent: number;
  /** The haircut the registry applies to a pool share, in basis points — 7000 on chain today. */
  haircutBps: number;
  /** Cash the pool can pay right now. Below the request, the rest queues. */
  freeNow: number;
  utilizationBps: number;
  /** The credit limit today, before this withdrawal, and what the member carries against it. */
  limit?: number;
  owed?: number;
}

/** One leg of the route: a cell on the seam. */
function Leg({ label, name, balance }: { label: string; name: string; balance: string }) {
  return (
    <div className="c-leg">
      <p className="c-label">{label}</p>
      <p className="c-nm">{name}</p>
      <p className="c-bal">{balance}</p>
    </div>
  );
}

/**
 * One consequence line. `accent` is what the choice earns — cobalt, and always first. `gain` is what
 * it does to the credit limit — below a rule, and always last; `down` when it falls, which drops the
 * green for ink.
 */
function Row({
  label,
  value,
  accent,
  gain,
  down,
  short,
}: {
  label: string;
  value: string;
  accent?: boolean;
  gain?: boolean;
  down?: boolean;
  /** A broken constraint — the one line on these screens that takes absent red. */
  short?: boolean;
}) {
  return (
    <div className={cn(accent && 'c-earn', short && 'c-short', gain && 'c-limit', gain && down && 'c-down')}>
      <span>{label}</span>
      <span>{value}</span>
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
  /** e.g. "2 later" — what a withdrawal costs in time. */
  goalShift?: string;
  busy?: boolean;
  error?: string | null;
  /** Where the move has got to. Absent while the member is still deciding. */
  progress?: { status: MoveStatus; step: number; failureNote?: string } | null;
  onMove: (amount: number) => void;
  /**
   * Reports the amount as it is typed. Needed by any destination whose consequences have to be
   * fetched rather than computed — a bond quotes its price from the chain for the face on screen.
   */
  onAmountChange?: (amount: number) => void;
  /** The offer made right after a move lands — "Save more", "See your bonds". */
  onAgain?: () => void;
  /** Retry after a failure, with the amount still on screen. */
  onRetry?: () => void;
  /**
   * A pool withdrawal that would drop the limit below what the member carries, where Ready to
   * allocate can cover the gap: repay that much first, then withdraw, as one action.
   */
  onRepayAndMove?: (repay: number, amount: number) => void;
  /** The same, where it cannot: the way to repaying, beside taking the safe maximum. */
  onRepayFirst?: () => void;
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
  onRepayAndMove,
  onRepayFirst,
  onAddMoney,
  onAutoSave,
}: MoveMoneyProps) {
  /*
   * Starts empty, showing $0.00. A prefilled figure has to be cleared before it can be replaced, and
   * on a keypad that means pressing delete three times before typing the first digit.
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
  // Some of the member's position is lent out right now, so not all of it can leave today.
  const poolLent = isPool && !!pool && pool.freeNow < savingsFree;
  const amount = Number(typed) || 0;
  // Each leg carries its balance, so the constraint is visible before anything is typed and the
  // "All" chip has a stated meaning.
  const available = isDeposit ? cashReady : isPool ? poolFree : savingsFree;
  // The chips are shortcuts; the pad is the input.
  const presets = isPool ? [500, 1000, 2500] : isDeposit ? [100, 250, 500] : [100, 500, 1000];
  const over = amount > available;
  // The pool can be fully lent. Asking for more than is free is not a mistake to refuse — pay what is
  // there and queue the rest, which is what the contract's requestWithdrawal exists for.
  const canQueue = isPool && !isDeposit && over;

  /*
   * A withdrawal is never refused, only paired or capped. Where the limit it lands on would fall
   * below what the member carries, the gap is either repaid from Ready to allocate in the same action,
   * or, when that cannot cover it, the button offers the most that is safe. The keypad never clamps
   * what was typed and the button is never dead.
   */
  const cents = (v: number) => Math.round(v * 100) / 100;
  const limitAfter = isPool && !isDeposit && pool?.limit !== undefined ? pool.limit - (amount * pool.haircutBps) / 10_000 : null;
  const carried = isPool && !isDeposit ? pool?.owed : undefined;
  const shortfall = limitAfter !== null && carried !== undefined && !canQueue && amount > 0 ? Math.max(0, cents(carried - limitAfter)) : 0;
  const coverable = shortfall > 0 && cashReady >= shortfall;
  const safeMax =
    pool?.limit !== undefined && carried !== undefined
      ? Math.max(0, Math.floor(((pool.limit - carried) * 10_000) / pool.haircutBps))
      : 0;
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
      <p className="c-label">{isBond ? 'Face value — what you get back' : 'Amount'}</p>
      <p className={cn('c-bigamt', dim && 'text-ink-28')}>
        {/* Grouped for reading, but the typed string stays the source — formatting the whole figure
            would fight the decimal point somebody is part-way through entering. */}
        ${Number(typed.split('.')[0] || 0).toLocaleString('en-US')}
        <span className={dim ? undefined : 'c-dec'}>.{(typed.split('.')[1] ?? '').padEnd(2, '0').slice(0, 2)}</span>
      </p>
      {/* What leaves the account is not what was typed: stated directly under the hero. */}
      {isBond && bond && !over && !belowMin && !aboveMax && (
        <p className="c-paytoday">You pay {money(bond.priceToday, { cents: true })} today</p>
      )}
      {/* Stated as the gap, like every other constraint on this screen, and the pad stays live. */}
      {isBond && bond && belowMin && (
        <p className="c-sub mt-[6px]">
          {money(bond.minFace - amount, { cents: true })} below the {money(bond.minFace, { cents: true })} smallest bond
        </p>
      )}
      {isBond && bond && aboveMax && (
        <p className="c-sub mt-[6px]">
          {money(amount - bond.maxFace, { cents: true })} above the {money(bond.maxFace, { cents: true })} largest bond
        </p>
      )}
      {over && !canQueue && (
        // Stated as the difference, because that is the number they can act on — not as a refusal.
        <p className="c-sub mt-[6px]">
          {money(shortBy, { cents: true })} more than is{' '}
          {isDeposit ? 'ready to allocate' : isPool ? 'free right now' : 'free to move'}
        </p>
      )}
    </>
  );

  const route = (
    <div className="c-route">
      <Leg
        label="From"
        name={isDeposit ? 'Cash account' : isPool ? 'Yield pool' : 'Savings'}
        // "free" where something caps what can move: unallocated cash, unencumbered savings, and a
        // pool position only once some of it is lent out. A pool position that can all leave is just
        // its balance.
        balance={`${money(isDeposit ? cashReady : isPool ? poolFree : savingsFree, { cents: true })}${
          !isDeposit && isPool && !poolLent ? '' : ' free'
        }`}
      />
      {isBond && bond ? (
        // A bond has no running balance until it exists, so the leg carries the date it matures.
        <Leg label="To" name="BurnerBond" balance={bond.maturesLong} />
      ) : (
        <Leg
          label="To"
          name={isDeposit ? (isPool ? 'Yield pool' : 'Savings') : 'Cash account'}
          balance={money(isDeposit ? savingsTotal : cashReady, { cents: true })}
        />
      )}
      {isBond ? (
        // One arrow rather than two: a bond cannot go back to cash before maturity.
        <span aria-hidden className="c-swap cursor-default">
          <ArrowIcon className="text-ink-70" />
        </span>
      ) : (
        <button type="button" onClick={swap} disabled={busy} aria-label="Swap direction" className="c-swap">
          <SwapIcon className="text-ink-70" />
        </button>
      )}
    </div>
  );

  const chips = isBond && bond ? (
      <>
        {/* No quick amounts for a bond — there is no habitual round figure, and the keypad is the
            point. The chips pick the term instead. */}
        <p className="c-label mb-s1 mt-s2">Term</p>
        <div className="c-qc mt-0!">
          {bond.termOptions.map((months) => (
            <Btn
              key={months}
              className={cn('c-chip-q', months === bond.months && 'c-on')}
              aria-pressed={months === bond.months}
              onClick={() => bond.onMonthsChange(months)}
            >
              {months} mo
            </Btn>
          ))}
        </div>
      </>
    ) : (
      <div className="c-qc">
        {presets.map((preset) => (
          <Btn
            key={preset}
            className={cn('c-chip-q', amount === preset && 'c-on')}
            aria-pressed={amount === preset}
            onClick={() => changeTyped(String(preset))}
          >
            {money(preset)}
          </Btn>
        ))}
        <Btn
          className={cn('c-chip-q', amount === available && available > 0 && !presets.includes(amount) && 'c-on')}
          onClick={() => changeTyped(String(available))}
        >
          {/* "All free" on a savings withdrawal — it moves everything that can move, and the word does
              the explaining. The pool's leg already says what is free, so its chip is plain "All". */}
          {isDeposit || isPool ? 'All' : 'All free'}
        </Btn>
      </div>
    );

  const pad = <Keypad onKey={(key) => changeTyped((current) => applyKey(current, key))} disabled={busy} />;

  /**
   * The consequences: five lines, the same shape at every destination. What this earns leads, in
   * cobalt; what it does to the credit limit closes, below a rule — the one consequence common to
   * all three products, so a member finds it in the same place each time.
   */
  const summaryRows = (past = false) => (
    <div className="c-conseq">
      {isBond && bond ? (
        past ? (
          <>
            <Row
              label="Yield"
              value={`${bond.ratePercent.toFixed(1)}% fixed · +${money(Math.max(0, amount - bond.priceToday), { cents: true })}`}
              accent
            />
            <Row label="Face value" value={money(amount, { cents: true })} />
            <Row label="Matures" value={bond.maturesLong} />
            {bond.heldBefore !== undefined && <Row label="Bonds held" value={count(bond.heldBefore + 1)} />}
            <Row
              label="Your credit limit rose by"
              value={`+${money((bond.priceToday * bond.haircutBps) / 10_000, { cents: true })}`}
              gain
            />
          </>
        ) : (
          <>
            <Row label="You pay today" value={money(bond.priceToday, { cents: true })} />
            <Row label="You get at maturity" value={money(amount, { cents: true })} />
            <Row label="Matures" value={bond.maturesLong} />
            {/* One line, not two: the rate and what it is worth in dollars are the same fact. */}
            <Row
              label="Yield"
              value={`${bond.ratePercent.toFixed(1)}% fixed · +${money(Math.max(0, amount - bond.priceToday), { cents: true })}`}
              accent
            />
            <Row
              label="Adds to your credit limit"
              value={`+${money((bond.priceToday * bond.haircutBps) / 10_000, { cents: true })}`}
              gain
            />
          </>
        )
      ) : isPool && pool && isDeposit ? (
        <>
          <Row label="Earning" value={`${pool.apyPercent}% APY`} accent />
          <Row label="Position after" value={money(after.savings, { cents: true })} />
          <Row label="Yield a year" value={`~${money((after.savings * pool.apyPercent) / 100, { cents: true })}`} />
          <Row label="Withdraw" value="Any time" />
          <Row
            label={past ? 'Your credit limit rose by' : 'Backs your credit limit'}
            value={`+${money((amount * pool.haircutBps) / 10_000, { cents: true })}`}
            gain
          />
        </>
      ) : isPool && pool && over ? (
        <>
          {/* Asking for more than is free is answered, not refused: what comes now leads, then what
              waits, and how it arrives. */}
          <Row label="Available now" value={money(available, { cents: true })} accent />
          <Row label="Queued" value={money(amount - available, { cents: true })} />
          <Row label="Sent as members repay" value="Automatically" />
          <Row
            label="Your credit limit drops by"
            value={`−${money((amount * pool.haircutBps) / 10_000, { cents: true })}`}
            gain
            down
          />
        </>
      ) : isPool && pool && shortfall > 0 && coverable ? (
        <>
          <Row label="Repaid first" value={`${money(shortfall, { cents: true })} from Ready to allocate`} accent />
          <Row label="You carry" value={money(carried ?? 0, { cents: true })} />
          <Row label="Limit after" value={money(limitAfter ?? 0, { cents: true })} />
          <Row
            label="Left to spend after"
            value={money(Math.max(0, (limitAfter ?? 0) - ((carried ?? 0) - shortfall)), { cents: true })}
            gain
            down
          />
        </>
      ) : isPool && pool && shortfall > 0 ? (
        <>
          <Row label="Short by" value={money(shortfall, { cents: true })} short />
          <Row label="You carry" value={money(carried ?? 0, { cents: true })} />
          <Row label="Ready to allocate" value={money(cashReady, { cents: true })} />
          <Row label="Most you can take now" value={money(safeMax, { cents: true })} gain down />
        </>
      ) : isPool && pool ? (
        <>
          {/* Taking money out is the same lines with the signs turned round. The earn row still leads,
              because what a withdrawal costs in yield is the thing being weighed. */}
          <Row label="Yield given up" value={`~${money((amount * pool.apyPercent) / 100, { cents: true })} a year`} accent />
          <Row label="Position after" value={money(after.savings, { cents: true })} />
          {/* The question a member withdrawing is actually asking: where the limit lands. */}
          {pool.limit !== undefined && (
            <Row label="Limit after" value={money(pool.limit - (amount * pool.haircutBps) / 10_000, { cents: true })} />
          )}
          <Row
            label="Your credit limit drops by"
            value={`−${money((amount * pool.haircutBps) / 10_000, { cents: true })}`}
            gain
            down
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
          <Row label={`Reaches ${count(creditsGoal)} by`} value={`${reachesGoalBy ?? '—'}${goalShift ? ` · ${goalShift}` : ''}`} />
          {/* The line that stops "credits given up" reading as though vested credits were at risk. */}
          <Row label="Vested credits" value="Keep them" />
          <Row label="Your credit limit drops by" value={`−${money(amount, { cents: true })}`} gain down />
        </>
      )}
    </div>
  );

  // Context rather than consequence, which is why desktop keeps it under the keypad. A bond's is what
  // locked means; a partly lent pool's is how much of the position is out.
  const lockNote = isBond && bond ? (
    <p className="c-det mt-s2">
      Locked until maturity, but it backs your credit line at {Math.round(bond.haircutBps / 100)}%, so you can borrow
      against it any time for 0.65% a cycle.
    </p>
  ) : shortfall > 0 ? (
    <p className="c-det c-errline mt-s2">
      {amount >= savingsFree ? 'Taking all of it' : `Taking ${money(amount, { cents: true })}`} leaves your limit{' '}
      {money(shortfall, { cents: true })} below the {money(carried ?? 0, { cents: true })} you carry.
    </p>
  ) : isPool && !isDeposit && poolLent ? (
    <p className="c-det mt-s2">
      Only {money(poolFree, { cents: true })} is free right now. {money(savingsFree - poolFree, { cents: true })} of your
      position is lent out.
    </p>
  ) : null;

  /*
   * The three things that actually happen, named: money leaves, the thing it is going into takes it,
   * and the consequence a member cares about lands.
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

  const movingTitle = isBond ? 'Buying your bond' : `${isDeposit ? 'Moving' : 'Taking'} ${money(amount, { cents: true })}`;

  const movingSub =
    isBond && bond
      ? `${money(bond.priceToday, { cents: true })} today, ${money(amount, { cents: true })} at maturity`
      : isDeposit
        ? `Cash account to ${isPool ? 'Yield pool' : 'Savings'}`
        : `${isPool ? 'Yield pool' : 'Savings'} to Cash account`;

  const doneTitle = isBond
    ? 'Bond bought'
    : isPool
      ? `${money(amount, { cents: true })} ${isDeposit ? 'added' : 'taken'}`
      : isDeposit
        ? `${money(amount, { cents: true })} saved`
        : `${money(amount, { cents: true })} moved`;

  const title = isBond ? 'Buy a bond' : isPool && isDeposit ? 'Add to the pool' : 'Move money';

  // ---- Progress: the modal replaces its own content. ----
  let body: ReactNode;
  let footer: ReactNode;

  if (progress) {
    body = (
      <>
        <div className="c-mhero">
          {progress.status === 'done' ? <Tick /> : progress.status === 'failed' ? <AlertMark /> : null}
          <p className={cn('c-fig text-fig', progress.status !== 'processing' && 'mt-s2')}>
            {/* "Nothing moved" is the headline, not the error. The only question a member has when
                something fails with their money is whether they still have it. */}
            {progress.status === 'processing' ? movingTitle : progress.status === 'done' ? doneTitle : 'Nothing moved'}
          </p>
          <p className="c-sub mt-s1">
            {progress.status === 'processing'
              ? movingSub
              : progress.status === 'done'
                ? isBond && bond
                  ? `${money(amount, { cents: true })} face · matures ${bond.maturesLong}`
                  : 'Just now'
                : `Your ${money(amount, { cents: true })} is still in your ${isDeposit ? 'cash account' : isPool ? 'pool position' : 'savings'}`}
          </p>
        </div>
        {progress.status !== 'done' && (
          <Steps
            steps={
              progress.status === 'failed'
                ? // Taken, then returned. A member who watched money leave needs to watch it come back.
                  [
                    { label: stepLabels[0], state: 'done' as const },
                    { label: `Returned, ${progress.failureNote ?? 'it did not go through'}`, state: 'done' as const },
                  ]
                : stepsFor(stepLabels, progress.step, progress.status)
            }
          />
        )}
      </>
    );

    footer =
      progress.status === 'processing' ? (
        <p className="c-det">
          Usually a few seconds. <strong className="font-semibold text-ink">You can close this</strong> —{' '}
          {`it finishes on its own${isBond ? '.' : ' and lands in your activity either way.'}`}
        </p>
      ) : progress.status === 'done' ? (
        <>
          {summaryRows(true)}
          {/* The moment right after a deposit is the only moment somebody is inclined to make another. */}
          <div className="c-pair mt-s2">
            <Btn primary onClick={() => onOpenChange(false)}>
              Done
            </Btn>
            <Btn onClick={onAgain}>{isBond ? 'See your bonds' : isPool ? 'Add more' : 'Save more'}</Btn>
          </div>
        </>
      ) : (
        <div className="c-pair">
          <Btn primary onClick={onRetry}>
            Try again
          </Btn>
          <Btn onClick={() => onOpenChange(false)}>Not now</Btn>
        </div>
      );
  } else if (nothingReady) {
    body = (
      <>
        <p className="c-label mb-s1">Nothing to move</p>
        {amountBlock(true)}
        {route}
      </>
    );
    footer = (
      <>
        <p className="text-sec font-semibold">Add money first</p>
        <p className="c-det mt-1">
          This moves money you already hold in Clear. Bring some in and it lands ready to allocate.
        </p>
        <Btn primary lg className="mt-s2" onClick={onAddMoney}>
          Add money
        </Btn>
        {/* Offered here and nowhere else — the one moment the suggestion helps rather than nags. */}
        <Btn lg className="mt-s1" onClick={onAutoSave}>
          Set up auto-save instead
        </Btn>
      </>
    );
  } else {
    const bondLimit = isBond && bond && (belowMin || aboveMax);

    const action = bondLimit && bond ? (
        <>
          <p className="c-det mt-s2">
            Bonds run from <strong className="font-semibold text-ink">{money(bond.minFace, { cents: true })}</strong> to{' '}
            <strong className="font-semibold text-ink">{money(bond.maxFace, { cents: true })}</strong> of face value.
          </p>
          <Btn lg className="mt-s2" onClick={() => changeTyped(String(belowMin ? bond.minFace : bond.maxFace))}>
            Use {money(belowMin ? bond.minFace : bond.maxFace, { cents: true })} instead
          </Btn>
        </>
      ) : shortfall > 0 && coverable ? (
        <>
          {error && <p className="c-det mt-s2 text-absent">{error}</p>}
          <Btn primary lg className="mt-s2" disabled={busy} onClick={() => onRepayAndMove?.(shortfall, amount)}>
            {busy
              ? 'Moving…'
              : `Repay ${money(shortfall, { cents: true })} and withdraw ${money(amount, { cents: true })}`}
          </Btn>
        </>
      ) : shortfall > 0 ? (
        <>
          {error && <p className="c-det mt-s2 text-absent">{error}</p>}
          <div className="c-pair mt-s2">
            <Btn primary disabled={busy || safeMax <= 0} onClick={() => onMove(safeMax)}>
              Take {money(safeMax, { cents: true })}
            </Btn>
            <Btn onClick={onRepayFirst}>Repay first</Btn>
          </div>
        </>
      ) : canQueue ? (
        <>
          {error && <p className="c-det mt-s2 text-absent">{error}</p>}
          {/* One move: what is free goes now and the rest queues, in the same batch. */}
          <Btn primary lg className="mt-s2" disabled={busy} onClick={() => onMove(amount)}>
            {busy ? 'Moving…' : `Take ${money(available, { cents: true })} now and queue the rest`}
          </Btn>
        </>
      ) : over ? (
        <>
          <p className="c-det mt-s2">
            Move <strong className="font-semibold text-ink">{money(available, { cents: true })}</strong> instead
            {isDeposit ? ', or add money to your cash account first.' : '.'}
          </p>
          <Btn lg className="mt-s2" onClick={() => changeTyped(String(available))}>
            Move to {isDeposit ? 'savings' : 'cash'}
          </Btn>
        </>
      ) : (
        <>
          {error && <p className="c-det mt-s2 text-absent">{error}</p>}
          <Btn primary lg className="mt-s2" disabled={busy || amount <= 0} onClick={() => onMove(amount)}>
            {busy
              ? 'Moving…'
              : isBond
                ? 'Buy this bond'
                : isPool && isDeposit
                  ? `Add ${money(amount, { cents: true })}`
                  : `Move ${money(amount, { cents: true })} to ${isDeposit ? 'savings' : 'cash'}`}
          </Btn>
          {!isBond && isDeposit && (
            <p className="c-det mt-s1 text-center">
              {isPool ? 'Rate moves with how much of the pool is lent.' : 'Instant. You can move it back any time.'}
            </p>
          )}
        </>
      );

    // Desktop gives the keypad a fixed 216px column so keys never stretch. Amount, term and route
    // stay one continuous read on the left; the consequences run the full width of the footer.
    body = (
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_216px] sm:items-start sm:gap-s3">
        <div>
          {amountBlock()}
          {chips}
          {route}
          <div className="sm:hidden">
            {pad}
            {lockNote}
          </div>
        </div>
        <div className="hidden sm:block">
          {pad}
          {lockNote}
        </div>
      </div>
    );
    // Whether the limit this withdrawal lands on still clears what the member carries — and when it
    // does not, why the button below is paired or capped.
    const carryNote =
      limitAfter !== null && carried !== undefined && !canQueue ? (
        <div className="c-footnote">
          <p>
            {shortfall === 0
              ? `Still above the ${money(carried, { cents: true })} you carry.`
              : coverable
                ? `Repaying ${money(shortfall, { cents: true })} first keeps your limit level with what you carry. It comes out of Ready to allocate, and nothing leaves Clear.`
                : `${money(safeMax, { cents: true })} is the most you can take without dropping below what you carry. Clear some of the ${money(carried, { cents: true })} and the rest frees up.`}
          </p>
        </div>
      ) : null;
    footer = (
      <>
        {summaryRows()}
        {carryNote}
        {action}
      </>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      // Done clears the title: the hero says what happened, and the title would only repeat it.
      titleHidden={progress?.status === 'done'}
      description={
        isBond
          ? 'Choose a face value and a term, and review what the bond costs today.'
          : isPool
            ? 'Move money between your cash account and the yield pool.'
            : 'Move money between your cash account and savings.'
      }
      // The wide sheet — 640px and square, like the guide's `.sheet.wide` — only where the two-column
      // form applies. Modal is a bottom sheet below 640px, the same breakpoint the grid uses.
      className={nothingReady ? undefined : progress ? undefined : 'sm:w-[640px] sm:max-w-[640px] sm:rounded-none'}
      footer={footer}
    >
      {body}
    </Modal>
  );
}
