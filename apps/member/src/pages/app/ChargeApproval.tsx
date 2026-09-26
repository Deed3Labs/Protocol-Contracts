import { useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { SplitConsequences, SplitControl } from '@/components/clear/SplitChooser';
import { Btn, CFoot, CHead, CMain, Line } from '@/components/clear/brand/anatomy';
import { ChevronIcon, CloseIcon } from '@/components/clear/brand/icons';
import { Tick } from '@/components/clear/MoveProgress';
import { splitQuote } from '@/lib/clearModel';
import { money } from '@clear/domain';

/**
 * A charge arrives: the member side of paying a shop.
 *
 * Merchant App References/clear-app-pay-choice. What a member sees after scanning the shop's code,
 * before anything has happened. **One question first: pay now, or over time.** Paying now is the
 * cheaper way for both sides, so it comes first and states its whole cost in its own row; over time
 * states its starting payment and its rate, so the difference is visible without a warning.
 *
 *   choose  the shop, who raised it and when, the amount, what it includes, and the two ways to pay
 *   now     where it comes from (Ready to allocate; Spendable shown, not for shops yet), then one
 *           button. Short of it is its own screen: the difference, and the two real next steps
 *   over    the split flow as it was, with "In full" renamed "Next cycle": beside a Pay now button,
 *           "In full" would read as the same thing, when it means clearing at the cycle's end
 *   paid    the live dot, where it came from, and that the counter already sees it
 *
 * **The split is chosen here, on the member's phone, and nowhere else.** A service writer must not be
 * picking somebody's repayment terms, which is why the merchant's request carries an amount and
 * nothing about repayment.
 *
 * Presentational, like the onboarding flows. `ChargeApprovalRoute` fetches, pays, approves and
 * declines.
 */

export type PayMode = 'choose' | 'now' | 'over';

export interface ChargeApprovalProps {
  merchantName: string;
  /** Whole units, not cents — `money` and the split control both work in units. */
  amount: number;
  /** First name of whoever raised it at the counter. */
  raisedBy?: string | null;
  /** When it was raised (ISO). */
  raisedAt?: string | null;
  /** The sale's lines, when it came from one; in cents. */
  items?: { name: string; quantity: number; cents: number }[] | null;
  taxCents?: number | null;
  discountCents?: number | null;

  mode?: PayMode;
  onModeChange?: (mode: PayMode) => void;
  /** Set under the pay-over-time minimum (units): over time is shown greyed, with this as the reason. */
  overTimeMinimum?: number | null;

  // ---- Pay now
  /** The member's USDC: what pays now. Null while it is being read. */
  readyToAllocate?: number | null;
  /** Card cash. Shown, never picked: it can't pay a shop yet. Null when there is no figure. */
  spendable?: number | null;
  onPayNow?: () => void;
  /** The button's words while paying: "Confirm with Face ID…", "Paying…", "Checking…". */
  payingLabel?: string | null;
  onAddMoney?: () => void;
  /** Paid now: when, and what Ready to allocate holds afterwards. */
  paid?: { at: string | null; left: number | null; receiptUrl?: string | null } | null;
  /** Sent, and not on chain yet. */
  onItsWay?: boolean;
  onDone?: () => void;

  // ---- Pay over time
  splitInto: number;
  onSplitChange: (splitInto: number) => void;
  splitOptions?: number[];
  ratePerCycle?: number;
  rate?: string;
  /** Null while unread — the cell says so rather than inventing a figure. */
  perCycleLimit?: number | null;
  clearsFromLabel?: string;
  firstPaymentOn?: string;
  doneBy: (splitInto: number) => string;
  busy?: boolean;
  error?: string | null;
  onApprove: () => void;
  /** The sheet's close. Closing a charge at the counter is declining it for now. */
  onDecline: () => void;
  /** Set once approved over time — the screen becomes the confirmation rather than navigating away. */
  approved?: boolean;
  /**
   * The charge's code, shown as a way into the installed app — set only where the platform will
   * not open it for us. Null everywhere else, including inside the app itself, where the line
   * would be telling somebody to go where they already are.
   */
  appHandoffCode?: string | null;
}

const usd = (n: number) => money(n, { cents: true });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');

function StoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10h16l-1.5-5h-13z" />
      <path d="M5 10v9h14v-9" />
      <path d="M10 19v-5h4v5" />
    </svg>
  );
}
function NowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function OverTimeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="1" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function NextIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/** The shop, who raised it and when, the amount, and what it includes one tap away. */
function ChargeHead({
  merchantName,
  amount,
  raisedBy,
  raisedAt,
  items,
  taxCents,
  discountCents,
}: Pick<ChargeApprovalProps, 'merchantName' | 'amount' | 'raisedBy' | 'raisedAt' | 'items' | 'taxCents' | 'discountCents'>) {
  const [open, setOpen] = useState(false);
  const count = items?.reduce((n, i) => n + i.quantity, 0) ?? 0;
  const by = [raisedBy ? `Raised by ${raisedBy}` : null, raisedAt ? clock(raisedAt) : null].filter(Boolean).join(' · ');
  return (
    <>
      <div className="c-pc-shop">
        <span className="c-pc-mk">
          <StoreIcon />
        </span>
        <div className="min-w-0">
          <p className="c-pc-t truncate">{merchantName}</p>
          {by && <p className="c-det">{by}</p>}
        </div>
      </div>
      <p className="c-fig c-pc-amt">{usd(amount)}</p>
      {items && items.length > 0 && (
        <>
          <p className="c-det c-pc-inc">
            <button type="button" className="c-pc-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              What’s included
            </button>{' '}
            &middot; {count} item{count === 1 ? '' : 's'}
            {taxCents ? ', tax included' : ''}
          </p>
          {open && (
            <div className="c-pc-items">
              {items.map((item, i) => (
                <div key={i}>
                  <span>
                    {item.quantity > 1 ? `${item.quantity} × ` : ''}
                    {item.name}
                  </span>
                  <span>{usd(item.cents / 100)}</span>
                </div>
              ))}
              {discountCents ? (
                <div>
                  <span>Discount</span>
                  <span>−{usd(discountCents / 100)}</span>
                </div>
              ) : null}
              {taxCents ? (
                <div>
                  <span>Tax</span>
                  <span>{usd(taxCents / 100)}</span>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Top({ title, onBack, onClose, closeLabel, busy }: { title: string; onBack?: () => void; onClose: () => void; closeLabel: string; busy?: boolean }) {
  return (
    <CHead>
      <Line className="items-center!">
        <span className="flex min-w-0 items-center gap-2.5">
          {onBack && (
            <button type="button" onClick={onBack} disabled={busy} aria-label="Back" className="c-mclose">
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}
          <span className="c-mtitle truncate">{title}</span>
        </span>
        <button type="button" onClick={onClose} disabled={busy} aria-label={closeLabel} className="c-mclose">
          <CloseIcon />
        </button>
      </Line>
    </CHead>
  );
}

function Sum({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="c-pc-sum">
      {rows.map(([k, v], i) => (
        <div key={i} className="c-kv">
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function ChargeApproval(props: ChargeApprovalProps) {
  const {
    merchantName,
    amount,
    raisedBy = null,
    overTimeMinimum = null,
    readyToAllocate = null,
    spendable = null,
    onPayNow,
    payingLabel = null,
    onAddMoney,
    paid = null,
    onItsWay = false,
    onDone,
    splitInto,
    onSplitChange,
    splitOptions = [1, 2, 4, 12],
    ratePerCycle = 0.02,
    perCycleLimit = null,
    clearsFromLabel = 'Balance only',
    firstPaymentOn,
    doneBy,
    busy = false,
    error = null,
    onApprove,
    onDecline,
    approved = false,
    appHandoffCode = null,
  } = props;
  const [ownMode, setOwnMode] = useState<PayMode>('choose');
  const mode = props.mode ?? ownMode;
  const setMode = (m: PayMode) => (props.onModeChange ? props.onModeChange(m) : setOwnMode(m));
  const overTimeOff = overTimeMinimum != null;
  const head = <ChargeHead {...props} />;
  const rate = `${Math.round(ratePerCycle * 1000) / 10}% a cycle on what you still owe`;

  /*
   * Full width on a phone, capped only where a phone-shaped column stops making sense. This route
   * renders outside AppShell, so it carries the page colour and gutter itself.
   */
  const frame = (children: ReactNode) => (
    <div className="c-text min-h-screen bg-paper">
      <div className="w-full px-5 py-8 lg:mx-auto lg:max-w-[420px]">
        <div className="c-sheet c-modal">{children}</div>
      </div>
    </div>
  );

  // ---- Paid now, or on its way ------------------------------------------------------------------
  if (paid || onItsWay) {
    return frame(
      <>
        <Top title={paid ? 'Paid' : 'Paying'} onClose={onDone ?? onDecline} closeLabel="Done" />
        <CMain>
          <div className="c-pc-done">
            {paid && <span className="c-pc-live c-ping" aria-hidden />}
            <p className="c-fig c-pc-amt">{usd(amount)}</p>
            <p className="c-pc-t">{paid ? `Paid to ${merchantName}` : 'Your payment is on its way'}</p>
            <p className="c-det">
              {paid
                ? ['From Ready to allocate', paid.at ? clock(paid.at) : null, `${raisedBy ?? 'The shop'} sees it on the counter now`].filter(Boolean).join(' · ')
                : `We’ll mark it paid to ${merchantName} as soon as it lands. Don’t pay again.`}
            </p>
          </div>
          {paid && (
            <Sum
              rows={[
                ['Carry', '—'],
                ['To clear later', '—'],
                ['Ready to allocate now', paid.left == null ? '—' : usd(paid.left)],
              ]}
            />
          )}
        </CMain>
        <CFoot>
          <Btn lg onClick={onDone ?? onDecline}>
            Done
          </Btn>
          {paid?.receiptUrl && (
            <p className="c-det c-pc-alt">
              <a className="c-pc-link" href={paid.receiptUrl} target="_blank" rel="noreferrer">
                Receipt
              </a>
            </p>
          )}
        </CFoot>
      </>,
    );
  }

  // ---- Approved over time -----------------------------------------------------------------------
  if (approved) {
    return frame(
      <>
        <CMain>
          <div className="c-mhero">
            <Tick />
            <p className="c-fig mt-s2 text-fig">{usd(amount)}</p>
            <p className="c-sub mt-s1">
              {merchantName} &middot; {splitInto === 1 ? 'next cycle' : `split in ${splitInto}`}
            </p>
          </div>
        </CMain>
        <CFoot>
          <div className="c-conseq">
            <div>
              <span>First payment</span>
              <span>
                {/* The same figure the split control quoted a moment ago, from the same function.
                    Dividing the amount by the split would drop the carry and tell a member their
                    first payment is smaller than the one that will actually be taken. */}
                {usd(splitQuote(amount, splitInto, ratePerCycle).perCycle)}
                {firstPaymentOn ? ` on ${firstPaymentOn}` : ''}
              </span>
            </div>
            <div>
              <span>Clears from</span>
              <span>{clearsFromLabel}</span>
            </div>
          </div>
          {/* The one moment a member is most receptive to the point of the whole co-op: they
              have just agreed to pay carry, and the way not to is one sentence long. */}
          <div className="c-footnote">
            <p className="c-label mb-1">MAKE THE NEXT ONE FREE</p>
            <p>Save anything at all and you borrow against your own money instead — at no cost.</p>
          </div>
        </CFoot>
      </>,
    );
  }

  const handoff = appHandoffCode && (
    /*
      iOS will not open an installed home screen app for a scanned link, so a member who has Clear
      on their home screen lands here in Safari, signed out. Nothing routes around that, so the way
      across is the code itself — already on the merchant's screen, and the in-app scanner takes a
      typed one.
    */
    <p className="mt-s1">
      Have the Clear app? Open it and enter <span className="c-mono text-ink">{appHandoffCode}</span> on the Scan screen.
    </p>
  );
  const errorLine = error && <p className="c-det mt-s2 text-ink">{error}</p>;

  // ---- Pay now ----------------------------------------------------------------------------------
  if (mode === 'now') {
    const covers = readyToAllocate != null && readyToAllocate >= amount;
    const short = readyToAllocate != null && !covers ? Math.round((amount - readyToAllocate) * 100) / 100 : null;
    const working = busy || Boolean(payingLabel);
    return frame(
      <>
        <Top title="Pay now" onBack={() => setMode('choose')} onClose={onDecline} closeLabel="Not now" busy={working} />
        <CMain>
          {head}
          <p className="c-label c-pc-q">Pay from</p>
          {/* Card cash can't pay a shop yet: shown so the member knows where it stands, never picked. */}
          <div className="c-pc-src c-off" aria-disabled="true">
            <span className="c-pc-radio" aria-hidden />
            <div>
              <p className="c-pc-t">Spendable</p>
              <p className="c-det">Your card cash · not for paying shops yet</p>
            </div>
            <span className="c-pc-bal">{spendable == null ? '—' : usd(spendable)}</span>
          </div>
          <div className={`c-pc-src${covers ? '' : ' c-off'}`} role="radio" aria-checked={covers} aria-disabled={!covers}>
            <span className={`c-pc-radio${covers ? ' c-on' : ''}`} aria-hidden />
            <div>
              <p className="c-pc-t">Ready to allocate</p>
              {short != null ? (
                <p className="c-det c-pc-short">{usd(short)} more than this has</p>
              ) : (
                <p className="c-det">Your Clear cash</p>
              )}
            </div>
            <span className="c-pc-bal">{readyToAllocate == null ? '…' : usd(readyToAllocate)}</span>
          </div>
          {covers && (
            <Sum
              rows={[
                [merchantName, usd(amount)],
                ['Carry', '—'],
                ['Ready to allocate after', usd(Math.round((readyToAllocate! - amount) * 100) / 100)],
              ]}
            />
          )}
          {short != null && (
            <div className="c-pc-note">
              <p className="c-pc-t">Not enough in your Clear cash to pay now</p>
              <p className="c-det">
                {overTimeOff
                  ? `Add ${usd(short)} to pay it.`
                  : `Add ${usd(short)}, or pay over time and clear it from what you have.`}
              </p>
            </div>
          )}
        </CMain>
        <CFoot>
          {errorLine}
          {short != null ? (
            <div className="c-pc-pair">
              <Btn lg primary={overTimeOff} onClick={onAddMoney}>
                Add money
              </Btn>
              {!overTimeOff && (
                <Btn primary lg onClick={() => setMode('over')}>
                  Pay over time
                </Btn>
              )}
            </div>
          ) : (
            <>
              <Btn primary lg className="mt-s2" onClick={onPayNow} disabled={!covers || working}>
                {payingLabel ?? `Pay ${usd(amount)}`}
              </Btn>
              {!overTimeOff && (
                <p className="c-det c-pc-alt">
                  <button type="button" className="c-pc-link" disabled={working} onClick={() => setMode('over')}>
                    Pay over time instead
                  </button>
                </p>
              )}
            </>
          )}
        </CFoot>
      </>,
    );
  }

  // ---- Pay over time ----------------------------------------------------------------------------
  if (mode === 'over' && !overTimeOff) {
    return frame(
      <>
        <Top title="Pay over time" onBack={() => setMode('choose')} onClose={onDecline} closeLabel="Not now" busy={busy} />
        <CMain>
          {head}
          <p className="c-label c-pc-q">Clear it in</p>
          <SplitControl amount={amount} options={splitOptions} ratePerCycle={ratePerCycle} splitInto={splitInto} onChange={onSplitChange} />
        </CMain>
        <CFoot>
          <SplitConsequences amount={amount} ratePerCycle={ratePerCycle} splitInto={splitInto} doneBy={doneBy} />
          <p className="c-det mt-s1">{rate[0]!.toUpperCase() + rate.slice(1)}. Clearing early always costs less. You can change this any time.</p>
          {errorLine}
          <Btn primary lg className="mt-s2" onClick={onApprove} disabled={busy}>
            {busy ? 'One moment…' : 'Approve'}
          </Btn>
          <p className="c-det c-pc-alt">
            <button type="button" className="c-pc-link" disabled={busy} onClick={() => setMode('now')}>
              Pay now instead
            </button>
          </p>
          <div className="c-foot2 mt-s2 border-t border-ink-13 pt-s2 [--fp:12px]">
            <div>
              <p className="c-det">
                <span className="c-muted">Limit</span>{' '}
                <span className="text-ink">{perCycleLimit == null ? 'Not set' : `${usd(perCycleLimit)}/cycle`}</span>
              </p>
              <ChevronIcon className="shrink-0 text-ink-50" />
            </div>
            <div>
              <p className="c-det">
                <span className="c-muted">Clears from</span> <span className="text-ink">{clearsFromLabel}</span>
              </p>
              <ChevronIcon className="shrink-0 text-ink-50" />
            </div>
          </div>
        </CFoot>
      </>,
    );
  }

  // ---- Choosing ---------------------------------------------------------------------------------
  const from = splitQuote(amount, Math.max(...splitOptions.filter((n) => n > 1), 1), ratePerCycle).perCycle;
  const offered = splitOptions.filter((n) => n > 1);
  const inWords = offered.length > 1 ? `${offered.slice(0, -1).join(', ')} or ${offered[offered.length - 1]}` : String(offered[0] ?? '');
  return frame(
    <>
      <Top title="Pay a shop" onClose={onDecline} closeLabel="Not now" busy={busy} />
      <CMain>
        {head}
        <p className="c-label c-pc-q">How do you want to pay?</p>
        <button type="button" className="c-pc-opt" onClick={() => setMode('now')} disabled={busy}>
          <span className="c-pc-ic">
            <NowIcon />
          </span>
          <div>
            <p className="c-pc-t">Pay now</p>
            <p className="c-det">From your Clear cash. Nothing to clear later.</p>
          </div>
          <span className="c-pc-r">
            <b>{usd(amount)}</b>
          </span>
        </button>
        {overTimeOff ? (
          <div className="c-pc-opt c-off" aria-disabled="true">
            <span className="c-pc-ic">
              <OverTimeIcon />
            </span>
            <div>
              <p className="c-pc-t">Pay over time</p>
              <p className="c-det">For charges of {usd(overTimeMinimum!)} or more</p>
            </div>
          </div>
        ) : (
          <button type="button" className="c-pc-opt" onClick={() => setMode('over')} disabled={busy}>
            <span className="c-pc-ic">
              <OverTimeIcon />
            </span>
            <div>
              <p className="c-pc-t">Pay over time</p>
              <p className="c-det">
                From {usd(from)} a cycle{inWords ? `, in ${inWords}` : ''}. {rate[0]!.toUpperCase() + rate.slice(1)}.
              </p>
            </div>
            <span className="c-pc-r">
              <NextIcon />
            </span>
          </button>
        )}
      </CMain>
      <CFoot>
        <div className="c-footnote c-pc-foot mt-0! border-t-0! pt-0!">
          <p>You have not been charged yet &middot; Expires in 24 hours</p>
          {handoff}
        </div>
        {errorLine}
      </CFoot>
    </>,
  );
}
