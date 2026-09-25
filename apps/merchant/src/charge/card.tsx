import { useState, type ReactNode } from 'react';
import {
  IconPrint,
  IconReaderApproved,
  IconReaderDeclined,
  IconReaderReading,
  IconReaderReady,
  IconReceiptEmail,
  IconReceiptText,
} from '@/brand/chargeIcons';
import { Chip } from '@/brand/controls';
import { IconMinus, IconPlusSm } from '@/brand/icons';
import { Sheet, cx, clickOnKey } from '@/brand/ui';
import { Breakdown, lineLabel } from '@/charge/start';
import { itemCount, totals, usd, type CartLine } from '@/charge/model';
import { PickRow } from '@/payouts/views';
import type { ReaderInfo } from '@/reader';

/**
 * Paying by card — New Charge reference, section 5.
 *
 * The charge as the cart review draws it on the left; on the right, the reader and what it is
 * doing. Waiting is the one live thing on the screen, so it carries the pulsing dot. The reader is
 * driven through Stripe Terminal once Capacitor and the backend's card work land; until then the
 * states are drawn from the reference scenario.
 */

export type ReaderState = 'ready' | 'reading' | 'declined' | 'approved';

/** The left cell: the card charge, its lines and what makes up the total. */
export function CardChargeCell({ lines, amountCents }: { lines: CartLine[]; amountCents: number }) {
  const t = lines.length ? totals(lines) : null;
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">This charge</p>
          <span className="c-det">{t ? 'Built from items' : 'From the ticket'}</span>
        </div>
      </div>
      <div className="c-cmain c-ci-sum">
        <div className="c-ci-hero">
          <p className="c-label">Card charge</p>
          <p className="c-f">{usd(amountCents)}</p>
          {t && <p className="c-det">{itemCount(t.count)} &middot; tax included</p>}
        </div>
        {t && (
          <>
            <div className="c-ci-lns">
              {lines.map((l) => (
                <div key={l.key} className="c-kv">
                  <span>{lineLabel(l)}</span>
                  <span className="c-v">{usd(l.qty * l.unitCents)}</span>
                </div>
              ))}
            </div>
            <Breakdown t={t} />
          </>
        )}
      </div>
      <div className="c-cfoot">
        <p className="c-det">{t ? 'Prices from Inventory · paid by card, not with Clear' : 'Paid by card, not with Clear'}</p>
      </div>
    </div>
  );
}

const STEPS = (state: ReaderState) => {
  const d = (i: number) => (state === 'reading' ? i < 1 : state === 'ready' ? false : i < 2);
  return [
    { t: 'Present card', det: 'Tap, insert or swipe' },
    { t: 'Reading', det: 'Keep it there' },
    state === 'declined' ? { t: 'Declined', det: 'Nothing taken' } : { t: 'Approved', det: 'Or declined' },
  ].map((s, i) => ({ ...s, done: d(i) }));
};

/** The reader's cell: ready, reading, declined or approved. */
export function ReaderCell({
  state,
  reader = 'Stripe Reader M2',
  amountCents,
  card = 'Visa ending 4242',
  at,
  receipt,
  onCancel,
  onOtherReader,
  onTryAnother,
  onOfferClear,
  onDone,
  onNew,
  error,
}: {
  state: ReaderState;
  /** The reader couldn't start: no connection, or cards aren't on for this shop yet. */
  error?: string | null;
  reader?: string;
  amountCents: number;
  card?: string;
  /** "4:41pm", when approved. */
  at?: string;
  /** The receipt groups, when approved. */
  receipt?: ReactNode;
  onCancel?: () => void;
  onOtherReader?: () => void;
  onTryAnother?: () => void;
  onOfferClear?: () => void;
  onDone?: () => void;
  onNew?: () => void;
}) {
  const steps = STEPS(state);
  const stuck = !!error && state === 'ready';
  const chip =
    stuck ? (
      <Chip tone="absent" dot>
        Not connected
      </Chip>
    ) : state === 'declined' ? (
      <Chip tone="absent" dot>
        Declined
      </Chip>
    ) : (
      <Chip tone="settled" dot>
        {state === 'approved' ? 'Approved' : 'Connected'}
      </Chip>
    );
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">{reader}</p>
          {chip}
        </div>
      </div>
      <div className="c-cmain c-cc-main">
        <div className={cx('c-cc-wait', state === 'declined' && 'c-no', state === 'approved' && 'c-ok')} aria-live="polite">
          {state === 'ready' && <IconReaderReady />}
          {state === 'reading' && <IconReaderReading />}
          {state === 'declined' && <IconReaderDeclined />}
          {state === 'approved' && <IconReaderApproved />}
          <p className="c-cc-h">
            {state === 'ready' && !stuck && <span className="c-cc-live" />}
            {stuck ? 'The reader isn’t ready' : { ready: 'Ready for the card', reading: 'Reading the card', declined: 'Declined', approved: 'Approved' }[state]}
          </p>
          <p className="c-det">
            {stuck && `${error} Nothing was taken.`}
            {state === 'ready' && !stuck && `Tap, insert or swipe on the reader. ${usd(amountCents)} is already on it.`}
            {state === 'reading' && 'Keep it on the reader. This takes a few seconds.'}
            {state === 'declined' && `${card}. The bank declined it and nothing was taken. Ask for another card.`}
            {state === 'approved' && `${card}${at ? ` · ${at}` : ''}`}
          </p>
          {state === 'reading' && (
            <div className="c-cc-prog">
              <i />
            </div>
          )}
        </div>
        {state === 'declined' && (
          <div className="c-cc-offer2">
            <div>
              <p className="c-t">Or let them pay over time</p>
              <p className="c-det">Pay {usd(amountCents)} over time with Clear, approved on their phone</p>
            </div>
            <button type="button" className="c-btn" onClick={onOfferClear}>
              Offer Clear
            </button>
          </div>
        )}
        {state === 'approved' && receipt}
        <div className={cx('c-mc-steps', state === 'approved' && 'c-done')} style={{ ['--n' as string]: 3 }}>
          {steps.map((s, i) => {
            const on = (state === 'ready' && i === 0) || (state === 'reading' && i === 1) || (state === 'declined' && i === 2);
            return (
              <div key={s.t} className={cx(state === 'approved' || s.done ? 'c-d' : on ? 'c-on' : '', on && state === 'declined' && 'c-no')} aria-current={on ? 'step' : undefined}>
                <p className="c-t">{s.t}</p>
                <p className="c-det">{s.det}</p>
              </div>
            );
          })}
        </div>
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          {state === 'ready' && (
            <>
              <span className="c-det">
                Nothing is taken until approved &middot;{' '}
                <button type="button" className="c-ci-link" onClick={onOtherReader}>
                  Use another reader
                </button>
              </span>
              <button type="button" className="c-btn" onClick={onCancel}>
                Cancel
              </button>
            </>
          )}
          {state === 'reading' && (
            <>
              <span className="c-det">{card.replace(/ ending \d+$/, '')}, contactless</span>
              <span className="c-det">Don&rsquo;t remove the card</span>
            </>
          )}
          {state === 'declined' && (
            <>
              <span className="c-det">The items are still held</span>
              <span className="c-pair" style={{ flexShrink: 0 }}>
                <button type="button" className="c-btn" onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" className="c-btn c-btn-primary" onClick={onTryAnother}>
                  Try another card
                </button>
              </span>
            </>
          )}
          {state === 'approved' && (
            <>
              <span className="c-det">Stock came off the shelf</span>
              <span className="c-pair" style={{ flexShrink: 0 }}>
                <button type="button" className="c-btn" onClick={onDone}>
                  Done
                </button>
                <button type="button" className="c-btn c-btn-primary" onClick={onNew}>
                  New charge
                </button>
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Receipts -----------------------------------------------------------------------------------

export type SendBy = 'text' | 'email' | 'none';

/** Sending and printing are two acts, so two groups. The text is picked when the number is known. */
export function ReceiptGroups({
  by,
  onBy,
  to,
  onChange,
  onPrint,
  icons = true,
  none,
}: {
  /** The card screen draws Text and Email with icons; the cash screen without. */
  icons?: boolean;
  /** Why None is picked: "No number for this customer". */
  none?: string;
  by: SendBy;
  onBy?: (b: SendBy) => void;
  /** "(909) 555-0177" */
  to?: string;
  onChange?: () => void;
  onPrint?: () => void;
}) {
  const seg = (k: SendBy, label: ReactNode) => (
    <b className={by === k ? 'c-on' : undefined} role="radio" onKeyDown={clickOnKey} aria-checked={by === k} tabIndex={0} onClick={() => onBy?.(k)}>
      {label}
    </b>
  );
  return (
    <div className="c-cc-rcpt2">
      <div className="c-grp">
        <p className="c-label">Send a receipt</p>
        <div className="c-cc-seg" role="radiogroup" aria-label="Send a receipt">
          {seg(
            'text',
            <>
              {icons && <IconReceiptText />}
              Text
            </>,
          )}
          {seg(
            'email',
            <>
              {icons && <IconReceiptEmail />}
              Email
            </>,
          )}
          {seg('none', 'None')}
        </div>
        <p className="c-det">
          {by === 'none' ? (none ?? 'No receipt sent') : to ? `To ${to}` : 'Asks where to send it'}
          {by !== 'none' && to && (
            <>
              {' '}
              &middot;{' '}
              <button type="button" className="c-ci-link" onClick={onChange}>
                Change
              </button>
            </>
          )}
        </p>
      </div>
      <div className="c-grp">
        <p className="c-label">On paper</p>
        <button type="button" className="c-btn c-cc-print" onClick={onPrint}>
          {icons && <IconPrint />}
          Print receipt
        </button>
        <p className="c-det">Counter printer</p>
      </div>
    </div>
  );
}

/** Sending opens a sheet only when there is something to enter: a number, or an address. */
export function SendReceiptSheet({
  shop,
  totalCents,
  card,
  date,
  link,
  initialBy = 'text',
  initialTo = '',
  onSend,
  onClose,
  inline,
}: {
  shop: string;
  totalCents: number;
  card: string;
  date: string;
  /** "useclear.org/r/8QK2" */
  link: string;
  initialBy?: 'text' | 'email';
  initialTo?: string;
  onSend?: (by: 'text' | 'email', to: string) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const [by, setBy] = useState<'text' | 'email'>(initialBy);
  const [to, setTo] = useState(initialTo);
  return (
    <Sheet
      inline={inline}
      className="c-cc-sheet"
      title="Send the receipt"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!to.trim()} onClick={() => onSend?.(by, to.trim())}>
          Send receipt
        </button>
      }
    >
      <div className="c-cc-seg c-wide" role="radiogroup" aria-label="Send by">
        <b className={by === 'text' ? 'c-on' : undefined} role="radio" onKeyDown={clickOnKey} aria-checked={by === 'text'} tabIndex={0} onClick={() => setBy('text')}>
          <IconReceiptText />
          Text
        </b>
        <b className={by === 'email' ? 'c-on' : undefined} role="radio" onKeyDown={clickOnKey} aria-checked={by === 'email'} tabIndex={0} onClick={() => setBy('email')}>
          <IconReceiptEmail />
          Email
        </b>
      </div>
      <p className="c-label c-cc-fl">{by === 'text' ? 'Their number' : 'Their email'}</p>
      <input
        className="c-field c-cc-in"
        aria-label={by === 'text' ? 'Their number' : 'Their email'}
        inputMode={by === 'text' ? 'tel' : 'email'}
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <p className="c-det" style={{ marginTop: 8 }}>
        {by === 'text'
          ? 'Used for this receipt only. It is not saved to a customer record.'
          : 'The receipt comes as the email itself, with every line and the tax.'}
      </p>
      {by === 'text' && (
        <>
          <p className="c-label c-cc-fl">What they get</p>
          <div className="c-cc-msg">
            Your receipt from <b>{shop}</b>: {usd(totalCents)} on {card}, {date}. View it at <span className="c-u">{link}</span>
          </div>
        </>
      )}
    </Sheet>
  );
}

export interface Slip {
  shop: string;
  address: string;
  /** "Sep 22, 4:41pm · Jen" */
  when: string;
  lines: CartLine[];
  taxCents: number;
  totalCents: number;
  /** "Visa ending 4242" / "Approved" */
  paid: [string, string];
}

/**
 * Printing shows the printer, how many copies, and the slip at its paper width. With no printer,
 * the sale is done anyway and the sheet offers to send instead.
 */
export function PrintReceiptSheet({
  slip,
  printer,
  initialCopies = 2,
  onPrint,
  onSendInstead,
  onRetry,
  onClose,
  inline,
}: {
  slip: Slip;
  printer: 'ready' | 'offline';
  initialCopies?: number;
  onPrint?: (copies: number) => void;
  onSendInstead?: () => void;
  onRetry?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const [copies, setCopies] = useState(initialCopies);
  const ready = printer === 'ready';
  return (
    <Sheet
      inline={inline}
      className={cx('c-cc-sheet', ready && 'c-tall')}
      title="Print receipt"
      closeSize="lg"
      onClose={onClose}
      foot={
        ready ? (
          <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={() => onPrint?.(copies)}>
            Print {copies} {copies === 1 ? 'copy' : 'copies'}
          </button>
        ) : (
          <div className="c-pair">
            <button type="button" className="c-btn" onClick={onSendInstead}>
              Send instead
            </button>
            <button type="button" className="c-btn c-btn-primary" onClick={onRetry}>
              Try again
            </button>
          </div>
        )
      }
    >
      <div className={cx('c-cc-printer', !ready && 'c-off')}>
        <span className="c-ic">
          <IconPrint />
        </span>
        <div>
          <p className="c-t">{ready ? 'Counter printer' : 'No printer found'}</p>
          <p className="c-det">{ready ? 'Receipt paper, 80mm' : 'Turn it on, or connect one in Settings, Devices'}</p>
        </div>
        {ready ? (
          <Chip tone="settled" dot>
            Ready
          </Chip>
        ) : (
          <Chip tone="absent" dot>
            Offline
          </Chip>
        )}
      </div>
      {ready ? (
        <>
          <div className="c-cc-copies">
            <div>
              <p className="c-t">Copies</p>
              <p className="c-det">One for them, one for the job folder</p>
            </div>
            <span className="c-ci-step">
              <button type="button" aria-label="Less" disabled={copies <= 1} onClick={() => setCopies((n) => n - 1)}>
                <IconMinus />
              </button>
              <b aria-live="polite">{copies}</b>
              <button type="button" aria-label="More" onClick={() => setCopies((n) => n + 1)}>
                <IconPlusSm />
              </button>
            </span>
          </div>
          <p className="c-label c-cc-fl">Preview</p>
          <div className="c-cc-slip">
            <p className="c-shop">{slip.shop}</p>
            <p className="c-det c-c">{slip.address}</p>
            <p className="c-det c-c">{slip.when}</p>
            {slip.lines.map((l) => (
              <div key={l.key} className="c-ln">
                <span>{lineLabel(l)}</span>
                <span>{usd(l.qty * l.unitCents)}</span>
              </div>
            ))}
            <div className="c-ln c-sm">
              <span>Sales tax 7.75%</span>
              <span>{usd(slip.taxCents)}</span>
            </div>
            <div className="c-ln c-tot">
              <span>Total</span>
              <span>{usd(slip.totalCents)}</span>
            </div>
            <div className="c-ln c-sm">
              <span>{slip.paid[0]}</span>
              <span>{slip.paid[1]}</span>
            </div>
            <p className="c-det c-c c-ft">Pay over time next visit with Clear</p>
          </div>
        </>
      ) : (
        <p className="c-det" style={{ marginTop: 'var(--s2)', lineHeight: 1.5 }}>
          The sale is done either way. You can send the receipt instead, or print it later from the charge in Charges.
        </p>
      )}
    </Sheet>
  );
}

// ---- Use another reader ---------------------------------------------------------------------------

/**
 * The readers this device can use, and which is connected. Not drawn in the reference; it takes
 * the picker rows of Payouts' "Where withdrawals go". A browser lists smart readers only; the
 * installed app adds the M2 and Tap to Pay.
 */
export function ReaderPickerSheet({
  readers,
  current,
  web,
  loading,
  error,
  onPick,
  onClose,
}: {
  readers: ReaderInfo[];
  current: string | null;
  /** In a browser: say where the M2 and Tap to Pay work. */
  web: boolean;
  loading?: boolean;
  error?: string | null;
  onPick: (r: ReaderInfo) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="Use another reader"
      onClose={onClose}
      foot={
        <p className="c-det">
          {error ?? (web ? 'In a browser, smart readers only. The M2 and Tap to Pay need the Clear app.' : 'Only the readers this device can use are listed.')}
        </p>
      }
    >
      <div className="c-rows">
        {loading && !readers.length && (
          <div>
            <div className="c-line" style={{ alignItems: 'center' }}>
              <span className="c-det">Looking for readers…</span>
            </div>
          </div>
        )}
        {!loading && !readers.length && (
          <div>
            <div className="c-line" style={{ alignItems: 'center' }}>
              <span className="c-det">No readers found. Check the reader is on and nearby.</span>
            </div>
          </div>
        )}
        {readers.map((r) => (
          <PickRow
            key={r.id}
            on={r.id === current}
            t={r.label}
            det={r.detail}
            onPick={() => onPick(r)}
            right={
              r.id === current ? (
                <Chip tone="settled" dot>
                  Connected
                </Chip>
              ) : null
            }
          />
        ))}
      </div>
    </Sheet>
  );
}
