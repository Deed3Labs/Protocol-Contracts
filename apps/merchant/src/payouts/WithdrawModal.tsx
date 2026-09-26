import { useState } from 'react';
import { formatCalendarDate, toCents } from '@clear/domain';
import { IconKeyDelete, IconRoute } from '@/brand/chargeIcons';
import { cx, Sheet, useDigitKeys, clickOnKey } from '@/brand/ui';
import { api, type PayoutPosition } from '@/data/apiClient';
import { usd } from '@/home/model';
import { PickRow } from '@/payouts/views';
import { type Destination, type Source, arrivalLabel, feeCents, feeLabel, routeLabel, steps } from '@/payouts/withdrawModel';

/**
 * Withdrawing — docs/merchant-reference/clear-merchant-payouts.html ("Withdrawing: from where, to
 * where"). The member app's move-money modal with its contents changed: the amount, the quick
 * chips, the two legs on one seam, the pad, the consequences.
 *
 * **It asks both legs, because both matter.** Owed money passes through the cash account and money
 * already there goes straight out, so "how much" is not a complete question on its own. Tapping a
 * leg opens its sheet; the Route line reports the hop so it never becomes a step to think about.
 *
 * **The cap changes with the source.** Owed money is capped by what the pool can free today;
 * cash-account money only by the balance. The amount line says which is in force rather than
 * letting a merchant find out by being refused.
 */

export type Stage = 'amount' | 'from' | 'to' | 'sending' | 'done';
type Outcome = Awaited<ReturnType<typeof api.requestWithdrawal>>;

function press(entry: string, key: string): string {
  if (key === 'del') return entry.slice(0, -1);
  if (key === '.') return entry.includes('.') ? entry : `${entry || '0'}.`;
  const [, cents] = entry.split('.');
  if (cents !== undefined && cents.length >= 2) return entry;
  if (!entry.includes('.') && entry.replace('.', '').length >= 7) return entry;
  return entry + key;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

export function WithdrawModal({
  position,
  bankName,
  initialSource,
  initialEntry = '',
  initialStage = 'amount',
  request = api.requestWithdrawal,
  bankAccountId = null,
  onClose,
  onDone,
}: {
  position: PayoutPosition;
  bankName: string | null;
  /** A live shop's linked bank (Plaid, then Bridge): offers same-day beside standard. */
  bankAccountId?: string | null;
  initialSource?: Source;
  initialEntry?: string;
  initialStage?: Stage;
  /** The preview passes its own; a live shop's goes to the API. */
  request?: typeof api.requestWithdrawal;
  onClose: () => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<Stage>(initialStage);
  const firstSource: Source = initialSource ?? ((position.releasedReadyCents ?? 0) > 0 ? 'owed' : 'cash');
  const [source, setSource] = useState<Source>(firstSource);
  const [destination, setDestination] = useState<Destination>(firstSource === 'cash' ? (bankName ? 'bank' : 'debit') : bankName ? 'bank' : 'cash');
  const [entry, setEntry] = useState(initialEntry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // To a linked bank: standard ACH (free, 1–3 days) or same-day (1%).
  const [speed, setSpeed] = useState<'standard' | 'same_day'>('standard');
  const sameDay = destination === 'bank' && !!bankAccountId && speed === 'same_day';

  const cap = source === 'cash' ? position.cashAccountCents : position.releasedReadyCents;
  const cents = entry ? toCents(Number(entry) || 0) : 0;
  const overCap = cap !== null && cents > cap;
  const fee = sameDay ? Math.ceil(cents / 100) : feeCents(destination, cents);
  const receives = Math.max(0, cents - fee);
  const bank = bankName ?? 'your bank';
  const to = destination === 'cash' ? 'your cash account' : destination === 'bank' ? bank : 'your card';

  const [whole, frac] = entry.includes('.') ? entry.split('.') : [entry, ''];
  const shownWhole = whole === '' ? '0' : Number(whole).toLocaleString('en-US');
  const shownFrac = entry.includes('.') ? frac.padEnd(2, '0').slice(0, 2) : '00';

  useDigitKeys(stage === 'amount', (d) => setEntry((e) => press(e, d)), () => setEntry((e) => press(e, 'del')));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setOutcome(await request({ amountCents: cents, source, destination, ...(destination === 'bank' && bankAccountId ? { bankAccountId, speed } : {}) }));
      setStage('sending');
      window.setTimeout(() => setStage('done'), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be requested just now.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Where is it coming from? ----------------------------------------------------------------
  if (stage === 'from')
    return (
      <Sheet
        title="Where is it coming from?"
        onClose={() => setStage('amount')}
        foot={<p className="c-det">Owed money is capped by what the pool can free today. Cash-account money is capped only by the balance.</p>}
      >
        <div className="c-rows">
          {(
            [
              ['owed', 'Owed to you', 'Passes through your cash account', position.releasedReadyCents, 'free today'],
              ['cash', 'Cash account', 'Goes straight out', position.cashAccountCents, 'all of it'],
            ] as const
          ).map(([k, t, det, c, note]) => (
            <PickRow
              key={k}
              on={source === k}
              t={t}
              det={det}
              disabled={(c ?? 0) <= 0}
              onPick={() => {
                setSource(k);
                if (k === 'cash' && destination === 'cash') setDestination(bankName ? 'bank' : 'debit');
                setEntry('');
                setStage('amount');
              }}
              right={
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span className="c-fig c-fig-row" style={{ display: 'block' }}>
                    {c === null ? '—' : usd(c)}
                  </span>
                  <span className="c-det" style={{ display: 'block', marginTop: 2 }}>
                    {c === null ? 'unknown' : note}
                  </span>
                </span>
              }
            />
          ))}
        </div>
      </Sheet>
    );

  // ---- Where does it end up? -------------------------------------------------------------------
  if (stage === 'to') {
    const options: [Destination | 'bank_same_day', string, string, string, string, boolean][] = [
      ...(source !== 'cash' ? ([['cash', 'Cash account', 'Spend at partners, no wait', 'Instant', 'no fee', true]] as [Destination, string, string, string, string, boolean][]) : []),
      ['bank', bankName ?? 'Bank account', bankName ? (bankAccountId ? 'Standard ACH' : 'Business checking') : 'Not set up yet', '1–3 days', 'no fee', !!bankName],
      ...(bankAccountId && bankName
        ? ([['bank_same_day', bankName, 'Same-day ACH', 'Today', `1%${cents ? ` · ${usd(Math.ceil(cents / 100))}` : ''}`, true]] as [Destination | 'bank_same_day', string, string, string, string, boolean][])
        : []),
      // No card on file and none invented: showing a card number we don't have would be a fabrication.
      ['debit', 'Debit card', 'Not set up yet', 'Minutes', `1.5%${cents ? ` · ${usd(feeCents('debit', cents))}` : ''}`, false],
    ];
    return (
      <Sheet
        title="Where does it end up?"
        onClose={() => setStage('amount')}
        foot={
          <p className="c-det">Cash account is on both lists, and that is right — it receives released money and sends money on. It drops off this list once it is the source.</p>
        }
      >
        <div className="c-rows">
          {options.map(([k, t, det, when, cost, ok]) => (
            <div
              key={k}
              role="button"
              onKeyDown={clickOnKey}
              tabIndex={ok ? 0 : -1}
              aria-disabled={!ok}
              aria-pressed={k === 'bank_same_day' ? sameDay : destination === k && !(k === 'bank' && sameDay)}
              style={ok ? { cursor: 'pointer' } : { opacity: 0.45 }}
              onClick={() => {
                if (!ok) return;
                setDestination(k === 'bank_same_day' ? 'bank' : k);
                setSpeed(k === 'bank_same_day' ? 'same_day' : 'standard');
                setStage('amount');
              }}
            >
              <div className="c-line" style={{ alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--t-sec)', fontWeight: (k === 'bank_same_day' ? sameDay : destination === k && !(k === 'bank' && sameDay)) ? 600 : undefined }}>{t}</p>
                  <p className="c-det" style={{ marginTop: 3 }}>
                    {det}
                  </p>
                </div>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>{when}</span>
                  <span className="c-det" style={{ display: 'block', marginTop: 2, color: k === 'debit' ? 'var(--absent)' : undefined }}>
                    {cost}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    );
  }

  // ---- Sending, then done --------------------------------------------------------------------------
  if (stage === 'sending') {
    const list = steps(source, destination, bank);
    return (
      <Sheet
        title={' '}
        label={`Sending ${usd(cents)}`}
        onClose={onClose}
        foot={
          <p className="c-det">
            {destination === 'cash'
              ? 'A few seconds to your cash account. You can close this.'
              : `A few seconds to your cash account, then ${destination === 'bank' ? '1–3 business days to the bank' : 'minutes to your card'}. You can close this.`}
          </p>
        }
      >
        <p className="c-fig c-fig-sec">Sending {usd(cents)}</p>
        <p className="c-det" style={{ marginTop: 4 }}>
          To {to}
        </p>
        <div className="c-rail" style={{ marginTop: 'var(--s3)' }}>
          {list.map((s, i) => (
            <div key={s} className={cx('c-mstone', i === 0 ? 'c-done' : i === 1 ? 'c-now' : 'c-later', i === list.length - 1 && 'c-last')}>
              <span className="c-mdot" />
              <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{s}</p>
            </div>
          ))}
        </div>
      </Sheet>
    );
  }

  if (stage === 'done') {
    const paid = outcome?.status === 'paid';
    const queued = outcome?.queued === true;
    const firstHop = outcome?.inCashAccount === true && !paid;
    const heading = paid ? 'Paid' : queued ? 'Queued' : firstHop ? 'In your cash account' : 'On its way';
    const arrives = paid ? 'In your account' : queued ? 'Within your payout terms' : firstHop ? `Released — ${arrivalLabel(destination)} to ${to}` : arrivalLabel(destination);
    const finish = () => {
      onDone();
      onClose();
    };
    const kv = (k: string, v: string) => (
      <div>
        <div className="c-kv">
          <span>{k}</span>
          <span className="c-v">{v}</span>
        </div>
      </div>
    );
    return (
      <Sheet
        title={' '}
        label={heading}
        onClose={finish}
        foot={
          <button type="button" className="c-btn c-btn-lg" onClick={finish}>
            Done
          </button>
        }
      >
        <p className="c-fig c-fig-sec">{heading}</p>
        <p className="c-det" style={{ marginTop: 4 }}>
          {usd(cents)} to {to}
        </p>
        <div className="c-rows" style={{ marginTop: 'var(--s3)' }}>
          {kv('Arrives', arrives)}
          {kv('Still owed to you', usd(Math.max(0, position.owedCents - (source === 'owed' ? cents : 0))))}
          {kv('Cash account', position.cashAccountCents === null ? '—' : usd(position.cashAccountCents - (source === 'cash' ? cents : 0)))}
          {position.nextPayoutOn && kv('Next payout', formatCalendarDate(position.nextPayoutOn))}
        </div>
        {queued && (
          <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
            Claims are paid in the order they were made. Yours is in the queue and is paid as the pool is funded, at the latest by the end of
            your terms.
          </p>
        )}
        {outcome?.bank?.note && (
          <p className="c-det" role="status" style={{ marginTop: 'var(--s2)' }}>
            {outcome.bank.note}
          </p>
        )}
        {outcome?.settlementNote && (
          <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
            {outcome.settlementNote}
          </p>
        )}
      </Sheet>
    );
  }

  // ---- The amount ----------------------------------------------------------------------------------
  const quick = [50_000, 100_000, cap ?? 0];
  const from =
    source === 'cash'
      ? { nm: 'Cash account', bal: position.cashAccountCents === null ? 'balance unknown' : `${usd(position.cashAccountCents)} all of it` }
      : { nm: 'Owed to you', bal: position.releasedReadyCents === null ? 'nothing free today' : `${usd(position.releasedReadyCents)} free` };
  const dest =
    destination === 'cash'
      ? { nm: 'Cash account', bal: 'Instant · no fee' }
      : destination === 'bank'
        ? { nm: bank, bal: sameDay ? 'Today · 1%' : '1–3 days · no fee' }
        : { nm: 'Debit card', bal: 'Minutes · 1.5%' };
  const note =
    error ??
    (overCap
      ? 'That is more than is available from there.'
      : (cap ?? 0) <= 0
        ? source === 'owed'
          ? 'Nothing is released early today. Change the source, or it arrives on your scheduled payout.'
          : 'Your cash account is empty. Change the source to what you are owed.'
        : source === 'owed'
          ? 'Owed money passes through your cash account. That hop is automatic.'
          : 'Cash-account money goes straight out.');

  return (
    <Sheet
      title="Withdraw"
      onClose={onClose}
      foot={
        <>
          <div className="c-conseq">
            <div className="c-earn">
              <span>Route</span>
              <span>{routeLabel(source, destination, bank)}</span>
            </div>
            <div>
              <span>Fee</span>
              <span>{sameDay ? `1% · ${usd(fee)}` : feeLabel(destination, cents)}</span>
            </div>
            <div>
              <span>Arrives</span>
              <span>{sameDay ? 'Today, by same-day ACH' : arrivalLabel(destination)}</span>
            </div>
            <div className="c-limit">
              <span>You receive</span>
              <span>{usd(receives)}</span>
            </div>
          </div>
          <button
            type="button"
            className="c-btn c-btn-primary c-btn-lg"
            style={{ marginTop: 'var(--s2)' }}
            disabled={busy || cents <= 0 || overCap || cap === null || cap <= 0}
            onClick={submit}
          >
            {busy ? 'Requesting…' : `Withdraw to ${destination === 'cash' ? 'cash account' : destination === 'bank' ? bank.split(' ')[0] : 'card'}`}
          </button>
          <p className="c-det" role={error || overCap ? 'alert' : undefined} style={{ marginTop: 'var(--s1)', textAlign: 'center' }}>
            {note}
          </p>
        </>
      }
    >
      <p className="c-label">Amount</p>
      <p className="c-bigamt">
        ${shownWhole}
        <span className="c-dec">.{shownFrac}</span>
      </p>
      <p className="c-det" style={{ marginTop: 6 }}>
        {cap === null
          ? source === 'cash'
            ? 'We cannot read your cash account just now'
            : 'Nothing is released early today — it arrives on your scheduled payout'
          : source === 'cash'
            ? `All of your cash account, ${usd(cap)}`
            : `All that is free today, of ${usd(position.owedCents)} owed`}
      </p>
      <div className="c-qc">
        {quick.map((c, i) => (
          <button
            key={i}
            type="button"
            className={cx('c-btn c-chip-q', cents > 0 && cents === c && 'c-on')}
            disabled={cap === null || c > cap || c <= 0}
            onClick={() => setEntry(String(c / 100))}
          >
            {i === 2 ? 'All free' : usd(c).replace(/\.00$/, '')}
          </button>
        ))}
      </div>
      <div className="c-route">
        <div className="c-leg" role="button" onKeyDown={clickOnKey} tabIndex={0} onClick={() => setStage('from')}>
          <p className="c-label">From</p>
          <p className="c-nm">{from.nm}</p>
          <p className="c-bal">{from.bal}</p>
        </div>
        <div className="c-leg" role="button" onKeyDown={clickOnKey} tabIndex={0} onClick={() => setStage('to')}>
          <p className="c-label">To</p>
          <p className="c-nm">{dest.nm}</p>
          <p className="c-bal">{dest.bal}</p>
        </div>
        <div className="c-swap" style={{ cursor: 'default' }}>
          <IconRoute />
        </div>
      </div>
      <div className="c-keypad">
        {KEYS.map((k) => (
          <div
            key={k}
            className={k === '.' || k === 'del' ? 'c-fn' : ''}
            role="button"
            onKeyDown={clickOnKey}
            tabIndex={0}
            aria-label={k === 'del' ? 'Delete' : k}
            onClick={() => setEntry((e) => press(e, k))}
          >
            {k === 'del' ? <IconKeyDelete /> : k}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export default WithdrawModal;
