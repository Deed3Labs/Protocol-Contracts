import type { ReactNode } from 'react';
import { IconCard, IconCash, IconChevronSm, IconClear, IconReaderApproved } from '@/brand/chargeIcons';
import { Chip } from '@/brand/controls';
import { cx, Slab } from '@/brand/ui';
import { Keypad } from '@/charge/start';
import { usd } from '@/charge/model';

/**
 * Cash and a split — New Charge reference, sections 6 and 7.
 *
 * Cash: what is due, what they handed over, and the change, in that order. Taking it opens the
 * drawer and shows the change at full size. A split: one payment at a time against what is left,
 * and parts that are paid stay paid when a later one fails.
 */

/** The quick amounts: exact, then the next round figures above what is due. */
export function quickAmounts(dueCents: number): { label: string; cents: number }[] {
  const up = (step: number) => Math.ceil(dueCents / step) * step;
  const out = [{ label: 'Exact', cents: dueCents }];
  for (const c of [up(2000), up(5000), up(10000)]) {
    if (c > dueCents && !out.some((o) => o.cents === c)) out.push({ label: usd(c).replace(/\.00$/, ''), cents: c });
  }
  return out.slice(0, 4);
}

export function CashView({
  dueCents,
  tipLabel,
  givenCents,
  onKey,
  onQuick,
  onTake,
}: {
  dueCents: number;
  /** "No tip", or "With a $10.00 tip" */
  tipLabel: string;
  givenCents: number;
  onKey?: (k: string) => void;
  onQuick?: (cents: number) => void;
  onTake?: () => void;
}) {
  const change = givenCents - dueCents;
  return (
    <Slab>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Cash</p>
            <span className="c-det">{tipLabel}</span>
          </div>
        </div>
        <div className="c-cmain c-ci-sum">
          <div className="c-ci-hero">
            <p className="c-label">Due</p>
            <p className="c-f">{usd(dueCents)}</p>
          </div>
          <div className="c-ck-given">
            <p className="c-label">Handed over</p>
            <div className="c-mc-amount c-ck-in" aria-live="polite">
              {usd(givenCents)}
              <span className="c-caret" />
            </div>
          </div>
          <div className="c-ck-quick">
            {quickAmounts(dueCents).map((q) => (
              <button key={q.label} type="button" className={cx('c-btn', givenCents === q.cents && 'c-on')} onClick={() => onQuick?.(q.cents)}>
                {q.label}
              </button>
            ))}
          </div>
          <div className="c-ck-change">
            <span>Change to give</span>
            <b>{change >= 0 ? usd(change) : '—'}</b>
          </div>
        </div>
        <div className="c-cfoot">
          <p className="c-det">The drawer opens when you take it.</p>
        </div>
      </div>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Amount handed over</p>
            <span className="c-det">Or tap a quick amount</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-mc-pad">
            <Keypad onKey={(k) => onKey?.(k)} />
            <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={givenCents < dueCents} onClick={onTake}>
              Take {usd(givenCents)} cash
            </button>
          </div>
        </div>
        <div className="c-cfoot">
          <p className="c-det">Counted against the drawer at the end of the shift.</p>
        </div>
      </div>
    </Slab>
  );
}

export function CashPaidView({
  dueCents,
  givenCents,
  at,
  receipt,
  onDone,
  onNew,
}: {
  dueCents: number;
  givenCents: number;
  /** "4:41pm" */
  at: string;
  receipt: ReactNode;
  onDone?: () => void;
  onNew?: () => void;
}) {
  const change = givenCents - dueCents;
  return (
    <Slab>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Change</p>
            <Chip tone="settled" dot>
              Drawer open
            </Chip>
          </div>
        </div>
        <div className="c-cmain c-ci-sum">
          <div className="c-ci-hero">
            <p className="c-label">Give back</p>
            <p className="c-f c-ck-chg">{usd(change)}</p>
            <p className="c-det">
              From {usd(givenCents)} handed over, for {usd(dueCents)}
            </p>
          </div>
          <div className="c-ci-small">
            <div className="c-kv">
              <span>Handed over</span>
              <span className="c-v">{usd(givenCents)}</span>
            </div>
            <div className="c-kv">
              <span>Charge</span>
              <span className="c-v">{usd(dueCents)}</span>
            </div>
            <div className="c-kv c-strong">
              <span>Change</span>
              <span className="c-v">{usd(change)}</span>
            </div>
          </div>
        </div>
        <div className="c-cfoot">
          <p className="c-det">Close the drawer once the change is given.</p>
        </div>
      </div>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Paid</p>
            <Chip tone="settled" dot>
              Cash
            </Chip>
          </div>
        </div>
        <div className="c-cmain c-cc-main">
          <div className="c-cc-wait c-ok">
            <IconReaderApproved />
            <p className="c-cc-h">Paid in cash</p>
            <p className="c-det">{at} &middot; stock came off the shelf</p>
          </div>
          {receipt}
        </div>
        <div className="c-cfoot">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-det">Added to the drawer</span>
            <span className="c-pair" style={{ flexShrink: 0 }}>
              <button type="button" className="c-btn" onClick={onDone}>
                Done
              </button>
              <button type="button" className="c-btn c-btn-primary" onClick={onNew}>
                New charge
              </button>
            </span>
          </div>
        </div>
      </div>
    </Slab>
  );
}

// ---- Split --------------------------------------------------------------------------------------

export type LegMethod = 'clear' | 'card' | 'cash';

export interface Leg {
  method: LegMethod;
  amountCents: number;
  /** "4:38pm · no change", "Choose below", "Visa ending 4242 · the bank declined it" */
  det: string;
  state: 'paid' | 'next' | 'declined';
}

const METHOD_ICON: Record<LegMethod, ReactNode> = { clear: <IconClear />, card: <IconCard />, cash: <IconCash /> };
const METHOD_NAME: Record<LegMethod, string> = { clear: 'Clear', card: 'Card', cash: 'Cash' };

/** What is left, a bar of what is paid, and each part with its state. */
export function SplitLegsCell({ totalCents, legs }: { totalCents: number; legs: Leg[] }) {
  const paid = legs.filter((l) => l.state === 'paid').reduce((s, l) => s + l.amountCents, 0);
  const left = totalCents - paid;
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Split</p>
          <span className="c-det">Total {usd(totalCents)}</span>
        </div>
      </div>
      <div className="c-cmain c-ci-sum">
        <div className="c-ci-hero">
          <p className="c-label">Left to pay</p>
          <p className="c-f">{usd(left)}</p>
        </div>
        <div className="c-ck-prog" role="img" aria-label={`${usd(paid)} of ${usd(totalCents)} paid`}>
          <i style={{ width: `${((paid / totalCents) * 100).toFixed(1)}%` }} />
        </div>
        <p className="c-det c-ck-progcap">
          <span className="c-t-sav">{usd(paid)} paid</span> &middot; {usd(left)} to go
        </p>
        <div className="c-ck-legs">
          {legs.map((l, i) => (
            <div key={i} className={cx('c-ck-leg', l.state === 'next' && 'c-dim')}>
              <span className="c-ic">{METHOD_ICON[l.method]}</span>
              <div>
                <p className="c-t">{METHOD_NAME[l.method]}</p>
                <p className="c-det">{l.det}</p>
              </div>
              <span className="c-v">{usd(l.amountCents)}</span>
              {l.state === 'paid' ? (
                <Chip tone="settled" dot>
                  Paid
                </Chip>
              ) : l.state === 'declined' ? (
                <Chip tone="absent" dot>
                  Declined
                </Chip>
              ) : (
                <Chip tone="neutral">Next</Chip>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="c-cfoot">
        <p className="c-det">Paid parts stay paid if a later one fails.</p>
      </div>
    </div>
  );
}

export function SplitView({
  totalCents,
  legs,
  nextCents,
  method,
  onMethod,
  onCharge,
  typed,
  onAmount,
}: {
  totalCents: number;
  legs: Leg[];
  nextCents: number;
  method: LegMethod;
  onMethod?: (m: LegMethod) => void;
  onCharge?: () => void;
  /** Live: what's typed for this part ("40.00"); empty for all that's left. */
  typed?: string;
  onAmount?: (text: string) => void;
}) {
  const paid = legs.filter((l) => l.state === 'paid').reduce((s, l) => s + l.amountCents, 0);
  const all = nextCents === totalCents - paid;
  const tile = (m: LegMethod, det: string) => (
    <div
      className={cx('c-ck-t c-sm', m === 'clear' && 'c-clear', method === m && 'c-on')}
      role="radio"
      aria-checked={method === m}
      tabIndex={0}
      onClick={() => onMethod?.(m)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onMethod?.(m)}
    >
      <span className="c-ic">{METHOD_ICON[m]}</span>
      <div>
        <p className="c-t">{METHOD_NAME[m]}</p>
        <p className="c-det">{det}</p>
      </div>
      <IconChevronSm />
    </div>
  );
  return (
    <Slab>
      <SplitLegsCell totalCents={totalCents} legs={legs} />
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Next payment</p>
            <span className="c-det">The rest, or part of it</span>
          </div>
        </div>
        <div className="c-cmain c-ck-pay" role="radiogroup" aria-label="Next payment by">
          <div className="c-ck-next">
            <p className="c-label">Amount</p>
            {onAmount ? (
              <label className="c-mc-amount c-ck-in" style={{ display: 'flex', alignItems: 'baseline' }}>
                $
                <input
                  inputMode="decimal"
                  aria-label="Amount for this part"
                  placeholder={(nextCents / 100).toFixed(2)}
                  value={typed ?? ''}
                  onChange={(e) => onAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  style={{ border: 0, background: 'transparent', font: 'inherit', color: 'inherit', outline: 'none', padding: 0, width: '7ch' }}
                />
              </label>
            ) : (
              <div className="c-mc-amount c-ck-in" aria-live="polite">
                {usd(nextCents)}
                <span className="c-caret" />
              </div>
            )}
            <p className="c-det">{all ? 'All that is left. Type less to split it again.' : 'Part of what is left. The rest comes next.'}</p>
          </div>
          {tile('clear', 'Pay now or over time, on their phone')}
          {tile('card', 'On the counter reader')}
          {tile('cash', 'Enter what they hand over')}
        </div>
        <div className="c-cfoot">
          <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={onCharge}>
            Charge {usd(nextCents)} {method === 'cash' ? 'in cash' : method === 'card' ? 'by card' : 'with Clear'}
          </button>
        </div>
      </div>
    </Slab>
  );
}
