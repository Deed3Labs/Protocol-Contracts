import { useState, type ReactNode } from 'react';
import { IconCard, IconCash, IconChevronSm, IconClear, IconDiscount, IconLock14, IconSplit } from '@/brand/chargeIcons';
import { Segmented } from '@/brand/controls';
import { IconCloseLg } from '@/brand/icons';
import { Sheet, cx, Slab } from '@/brand/ui';
import { Breakdown, lineLabel } from '@/charge/start';
import { itemCount, totals, usd, type CartLine, type Discount, type Totals } from '@/charge/model';

/**
 * Checkout and the tip — New Charge reference, sections 2 and 3.
 *
 * One step between what is being charged and how it is paid. A typed amount's Continue and a
 * cart's Checkout both land here. The left side is the charge; the right asks one question, how
 * are they paying? Clear keeps the dark tile, because it is what the shop is here to offer.
 */

export type Method = 'clear' | 'card' | 'cash' | 'split';

export interface ChargeBody {
  /** Empty for a typed amount. */
  lines: CartLine[];
  /** A typed amount, when there are no lines. */
  typedCents?: number;
  discount?: Discount | null;
}

/** What the charge comes to before any tip. */
export function chargeTotal(b: ChargeBody) {
  return b.lines.length ? totals(b.lines, b.discount).totalCents : (b.typedCents ?? 0);
}

function PayTile({
  method,
  locked,
  onPick,
}: {
  method: Method;
  locked?: boolean;
  onPick?: (m: Method) => void;
}) {
  const t = {
    clear: ['Clear', 'Pay now or over time, approved on their phone', <IconClear key="i" />],
    card: ['Card', locked ? 'Connect Stripe in Settings to take cards' : 'Tap, insert or swipe on the counter reader', <IconCard key="i" />],
    cash: ['Cash', 'Enter what they hand over, see the change', <IconCash key="i" />],
    split: ['Split between methods', 'Part cash, part card, or any mix', <IconSplit key="i" />],
  }[method] as [string, string, ReactNode];
  return (
    <div
      className={cx('c-ck-t', method === 'clear' && 'c-clear', locked && 'c-ck-lock')}
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-disabled={locked || undefined}
      onClick={() => !locked && onPick?.(method)}
      onKeyDown={(e) => !locked && (e.key === 'Enter' || e.key === ' ') && onPick?.(method)}
    >
      <span className="c-ic">{t[2]}</span>
      <div>
        <p className="c-t">{t[0]}</p>
        <p className="c-det">{t[1]}</p>
      </div>
      {locked ? <IconLock14 /> : <IconChevronSm />}
    </div>
  );
}

/** The four ways to pay. Card stays in the list, greyed, until Stripe is connected. */
export function PayTiles({
  cardLocked,
  unavailable = [],
  onPick,
}: {
  cardLocked?: boolean;
  /** Ways to pay the backend cannot take yet; drawn locked like an unconnected card. */
  unavailable?: Method[];
  onPick?: (m: Method) => void;
}) {
  return (
    <div className="c-cmain c-ck-pay">
      {(['clear', 'card', 'cash', 'split'] as const).map((m) =>
        unavailable.includes(m) && m !== 'card' ? null : (
          <PayTile key={m} method={m} locked={m === 'card' && cardLocked} onPick={onPick} />
        ),
      )}
    </div>
  );
}

export function CheckoutView({
  body,
  server,
  cardLocked,
  unavailable,
  onEditCart,
  onDiscount,
  onRemoveDiscount,
  onPick,
}: {
  body: ChargeBody;
  /** A live shop: the order's totals, from the server, in place of the local estimate. */
  server?: Totals | null;
  cardLocked?: boolean;
  unavailable?: Method[];
  onEditCart?: () => void;
  onDiscount?: () => void;
  onRemoveDiscount?: () => void;
  onPick?: (m: Method) => void;
}) {
  const hasLines = body.lines.length > 0;
  const t = hasLines ? (server ?? totals(body.lines, body.discount)) : null;
  const total = server ? server.totalCents : chargeTotal(body);
  return (
    <Slab>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">This charge</p>
            <span className="c-det">
              {t ? (
                <>
                  {itemCount(t.count)} &middot;{' '}
                  <button type="button" className="c-ci-link" onClick={onEditCart}>
                    Edit cart
                  </button>
                </>
              ) : (
                'From the ticket'
              )}
            </span>
          </div>
        </div>
        <div className="c-cmain c-ci-sum">
          <div className="c-ci-hero">
            <p className="c-label">Total</p>
            <p className="c-f">{usd(total)}</p>
            {t && (
              <p className="c-det">
                {itemCount(t.count)} &middot; tax included
                {t.discountCents > 0 && (
                  <>
                    {' '}
                    &middot; <span className="c-t-sav">{usd(t.discountCents)} off</span>
                  </>
                )}
              </p>
            )}
          </div>
          {hasLines && (
            <div className="c-ci-lns c-ck-lns">
              {body.lines.map((l) => (
                <div key={l.key} className="c-kv">
                  <span>{lineLabel(l)}</span>
                  <span className="c-v">{usd(l.qty * l.unitCents)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="c-ck-adj">
            {body.discount && t ? (
              <div className="c-r">
                <span className="c-k">
                  <IconDiscount />
                  {body.discount.label}
                </span>
                <span className="c-v c-neg">
                  &minus;{usd(t.discountCents)}
                  <button type="button" className="c-ck-x" aria-label="Remove the discount" onClick={onRemoveDiscount}>
                    <IconCloseLg />
                  </button>
                </span>
              </div>
            ) : hasLines ? (
              <div className="c-r">
                <span className="c-k">
                  <IconDiscount />
                  Discount
                </span>
                <button type="button" className="c-ci-link" onClick={onDiscount}>
                  Add a code or an amount
                </button>
              </div>
            ) : null}
            <div className="c-r">
              <span className="c-k">Tip</span>
              <span className="c-det">Asked on their screen next</span>
            </div>
          </div>
          {t && <Breakdown t={t} after={!!body.discount} />}
        </div>
        <div className="c-cfoot">
          <p className="c-det">
            {hasLines ? 'Tax is worked out per line: parts are taxed, labour is not.' : 'Next: a tip on their side, then how they pay.'}
          </p>
        </div>
      </div>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">How are they paying?</p>
            <span className="c-det">One method, or split</span>
          </div>
        </div>
        <PayTiles cardLocked={cardLocked} unavailable={unavailable} onPick={onPick} />
        <div className="c-cfoot">
          <p className="c-det">Any of these asks for a tip first, on the customer&rsquo;s side of the screen.</p>
        </div>
      </div>
    </Slab>
  );
}

// ---- Discounts ----------------------------------------------------------------------------------

export interface CodeCheck {
  code: string;
  ok: boolean;
  /** "10% off the whole charge, before tax. Until Oct 31, once per customer." */
  says: string;
  percent?: number;
}

const REASONS = ['Returning customer', 'Price match', 'Damaged', 'Other'];

/**
 * A code or an amount. A code shows what it does and the new total before anything is applied; an
 * expired one says so and takes nothing off. An amount is a percent or a dollar figure with a
 * reason, and above the role's limit the sheet asks for an owner or manager PIN right there.
 */
export function DiscountSheet({
  lines,
  limitPercent,
  check,
  initialMode = 'code',
  initialCode = '',
  initialValue = '',
  initialReason = REASONS[0],
  pinFilled = 0,
  askPin,
  onApply,
  onClose,
  inline,
}: {
  lines: CartLine[];
  /** The role's limit, in percent. Counter staff 10, manager 25, owner none. */
  limitPercent: number | null;
  /** Look a code up. */
  check?: (code: string) => CodeCheck | null;
  initialMode?: 'code' | 'amount';
  initialCode?: string;
  initialValue?: string;
  initialReason?: string;
  pinFilled?: number;
  /** A live shop: over the limit, the owner or manager types their PIN here (the preview draws the dots). */
  askPin?: boolean;
  onApply?: (d: Discount, pin: string | null) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const [mode, setMode] = useState<'code' | 'amount'>(initialMode);
  const [code, setCode] = useState(initialCode);
  const [unit, setUnit] = useState<'%' | '$'>('%');
  const [value, setValue] = useState(initialValue);
  const [reason, setReason] = useState(initialReason);
  const found = code ? (check?.(code) ?? null) : null;

  const n = parseFloat(value || '0');
  const amountDiscount: Discount | null =
    mode === 'amount' && n > 0
      ? unit === '%'
        ? { label: `${n}% · ${reason}`, percent: n, reason }
        : { label: `${usd(Math.round(n * 100))} · ${reason}`, amountCents: Math.round(n * 100), reason }
      : null;
  const codeDiscount: Discount | null = found?.ok ? { label: found.percent ? `${found.code} · ${found.percent}% off` : found.code, percent: found.percent, code: found.code } : null;
  const d = mode === 'code' ? codeDiscount : amountDiscount;
  const after = d ? totals(lines, d) : null;
  const pct = d?.percent ?? (d?.amountCents ? (d.amountCents / Math.max(1, totals(lines).totalCents - totals(lines).taxCents)) * 100 : 0);
  const over = mode === 'amount' && limitPercent !== null && pct > limitPercent;
  const [pin, setPin] = useState('');
  const pinReady = askPin ? pin.length === 4 : pinFilled >= 4;

  return (
    <Sheet
      inline={inline}
      className="c-cc-sheet"
      title="Add a discount"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button
          type="button"
          className="c-btn c-btn-primary c-btn-lg"
          disabled={!d || (over && !pinReady)}
          onClick={() => d && onApply?.(d, over ? pin : null)}
        >
          {over ? 'Approve with PIN' : mode === 'code' && found?.ok ? `Apply ${found.code}` : 'Apply'}
        </button>
      }
    >
      <Segmented
        kind="wide"
        label="Discount by"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'code', label: 'Code' },
          { value: 'amount', label: 'Amount' },
        ]}
      />
      {mode === 'code' ? (
        <>
          <p className="c-label c-cc-fl">Code</p>
          <div className={cx('c-field c-cc-in c-ck-code', found && !found.ok && 'c-bad')}>
            <input
              aria-label="Code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{ border: 0, background: 'transparent', font: 'inherit', color: 'inherit', outline: 'none', flex: 1, minWidth: 0, padding: 0 }}
            />
            {found && (found.ok ? <span className="c-ok">Valid</span> : <span className="c-no">Expired</span>)}
          </div>
          {found && (
            <p className="c-det" style={{ marginTop: 8 }}>
              {found.says}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="c-ck-amtrow">
            <Segmented
              kind="inline"
              label="Percent or dollars"
              value={unit}
              onChange={setUnit}
              options={[
                { value: '%', label: '%' },
                { value: '$', label: '$' },
              ]}
            />
            <div className="c-field c-cc-in c-ck-big">
              {unit === '$' && '$'}
              <input
                inputMode="decimal"
                aria-label={unit === '%' ? 'Percent off' : 'Dollars off'}
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
                style={{ border: 0, background: 'transparent', font: 'inherit', color: 'inherit', outline: 'none', width: `${Math.max(1, value.length)}ch`, padding: 0 }}
              />
              {unit === '%' && '%'}
            </div>
          </div>
          <p className="c-label c-cc-fl">Why</p>
          <div className="c-iv-reason" role="radiogroup" aria-label="Why">
            {REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} className={cx('c-btn', reason === r && 'c-on')} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
        </>
      )}
      {after && (
        <div className="c-rows" style={{ marginTop: 'var(--s2)' }}>
          <div>
            <div className="c-kv">
              <span>Takes off</span>
              <span className="c-v c-t-sav">&minus;{usd(after.discountCents)}</span>
            </div>
          </div>
          <div>
            <div className="c-kv">
              <span>New total</span>
              <span className="c-v">{usd(after.totalCents)}</span>
            </div>
          </div>
        </div>
      )}
      {over && (
        <div className="c-ck-pin">
          <div>
            <p className="c-t">Over your limit</p>
            <p className="c-det">Counter staff can give up to {limitPercent}%. An owner or manager enters their PIN.</p>
          </div>
          {askPin ? (
            <input
              className="c-field c-cc-in"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              aria-label="Owner or manager PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              style={{ width: '6ch', letterSpacing: '0.3em', textAlign: 'center' }}
            />
          ) : (
            <div className="c-dots" role="img" aria-label={`${pinFilled} of 4 digits`}>
              {[0, 1, 2, 3].map((i) => (
                <i key={i} className={i < pinFilled ? 'c-f' : ''} />
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---- The tip ------------------------------------------------------------------------------------

export type TipChoice = { kind: 'none' } | { kind: 'preset'; cents: number } | { kind: 'custom'; cents: number };

/**
 * The customer's own tip, in dollars, typed on the device's number pad. The reference draws Custom
 * without an amount; this is the smallest thing that lets it take one.
 */
function CustomTip({ cents, onCents }: { cents: number; onCents: (cents: number) => void }) {
  const [text, setText] = useState(cents ? (cents / 100).toFixed(2) : '');
  return (
    <label className="c-ck-custom" style={{ display: 'block', marginTop: 'var(--s2)' }}>
      <span className="c-label" style={{ display: 'block', marginBottom: 6 }}>
        Your tip, in dollars
      </span>
      <input
        className="c-field"
        inputMode="decimal"
        autoFocus
        aria-label="Tip amount"
        placeholder="0.00"
        value={text}
        style={{ width: '100%', height: 48, fontSize: 'var(--t-fig)', textAlign: 'center' }}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
          if (/\.\d{3,}$/.test(v)) return;
          setText(v);
          const n = Math.round(Number(v || '0') * 100);
          onCents(Number.isFinite(n) ? Math.min(n, 99_999_00) : 0);
        }}
      />
    </label>
  );
}

/**
 * Asked once, on the customer's side of the screen, before they pay any way at all. The tip is
 * added to the total and goes with whatever they pay with.
 */
export function TipView({
  shop,
  totalCents,
  count,
  presets,
  tip,
  onTip,
  onContinue,
}: {
  shop: string;
  totalCents: number;
  /** Items in the cart; absent for a typed amount. */
  count?: number;
  /** The shop's presets, in cents. */
  presets: number[];
  tip: TipChoice | null;
  onTip?: (t: TipChoice) => void;
  onContinue?: () => void;
}) {
  const tipCents = tip && tip.kind !== 'none' ? tip.cents : 0;
  return (
    <Slab>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">For the customer</p>
            <span className="c-det">Turn the screen</span>
          </div>
        </div>
        <div className="c-cmain c-ci-sum">
          <div className="c-ck-brand">
            <IconClear />
            <span>{shop}</span>
          </div>
          <div className="c-ci-hero" style={{ marginTop: 'var(--s3)' }}>
            <p className="c-label">Your total</p>
            <p className="c-f">{usd(totalCents)}</p>
            {count !== undefined && <p className="c-det">{itemCount(count)} &middot; tax included</p>}
          </div>
          {tipCents > 0 && (
            <div className="c-ci-small">
              <div className="c-kv c-strong">
                <span>With a {usd(tipCents)} tip</span>
                <span className="c-v">{usd(totalCents + tipCents)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="c-cfoot">
          <p className="c-det">The tip goes to the shop&rsquo;s team, with whatever they pay with.</p>
        </div>
      </div>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Add a tip?</p>
            <span className="c-det">Optional</span>
          </div>
        </div>
        <div className="c-cmain c-ck-tipcell">
          <div className="c-ck-tips" role="radiogroup" aria-label="Tip">
            {presets.map((c) => {
              const on = tip?.kind === 'preset' && tip.cents === c;
              return (
                <button key={c} type="button" role="radio" aria-checked={on} className={cx('c-ck-tip', on && 'c-on')} onClick={() => onTip?.({ kind: 'preset', cents: c })}>
                  <b>${c % 100 ? (c / 100).toFixed(2) : c / 100}</b>
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={tip?.kind === 'custom'}
              className={cx('c-ck-tip', tip?.kind === 'custom' && 'c-on')}
              onClick={() => onTip?.({ kind: 'custom', cents: tip?.kind === 'custom' ? tip.cents : 0 })}
            >
              <b>Custom</b>
            </button>
          </div>
          {tip?.kind === 'custom' && <CustomTip cents={tip.cents} onCents={(cents) => onTip?.({ kind: 'custom', cents })} />}
          <button type="button" className="c-ck-notip" aria-pressed={tip?.kind === 'none'} onClick={() => onTip?.({ kind: 'none' })}>
            No tip
          </button>
        </div>
        <div className="c-cfoot">
          <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!tip || (tip.kind === 'custom' && tip.cents <= 0)} onClick={onContinue}>
            Continue &middot; {usd(totalCents + tipCents)}
          </button>
        </div>
      </div>
    </Slab>
  );
}
