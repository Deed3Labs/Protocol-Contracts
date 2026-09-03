import { useState } from 'react';
import { ArrowRight, Check, ChevronLeft, Delete, X } from 'lucide-react';
import { dollars, formatCalendarDate, fromCents, toCents } from '@clear/domain';
import { Button, Cap, PrimaryButton } from '@/shell/ui';
import { api, type PayoutPosition } from '@/data/apiClient';
import {
  type Destination,
  type Source,
  arrivalLabel,
  feeCents,
  feeLabel,
  routeLabel,
  steps,
} from '@/payouts/withdrawModel';

/**
 * Withdrawing — reference section 07b.
 *
 * **The modal asks both legs, because both matter.** Owed money must pass through the cash account
 * and money already there goes straight out, so "how much" is not a complete question on its own.
 * Tapping either leg opens the picker; the Route line reports which hop is happening so it never
 * becomes a step the merchant has to think about.
 *
 * **The constraint changes with the source.** Owed money is capped by what the pool can free
 * today; cash-account money is capped only by the balance. The amount line says which cap is in
 * force rather than making a merchant discover it by being refused.
 *
 * On mobile it slides up from the bottom with a grab handle, matching every other modal in this
 * app and the member app — one motion, one dismissal gesture, learned once.
 */

type Stage = 'amount' | 'picker' | 'sending' | 'done';

/** Digits with at most two decimals, held as the string the owner is building. */
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
  onClose,
  onDone,
}: {
  position: PayoutPosition;
  /** Null when no payout account is set up — the bank leg then says so rather than inventing one. */
  bankName: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<Stage>('amount');
  // Start wherever the money actually is. A shop with nothing released today should not open on a
  // source that can only refuse them.
  const initialSource: Source = (position.releasedReadyCents ?? 0) > 0 ? 'owed' : 'cash';
  const [source, setSource] = useState<Source>(initialSource);
  const [destination, setDestination] = useState<Destination>(
    /**
     * Never the same on both legs.
     *
     * The picker already drops cash from the destinations once it is the source, but the OPENING
     * state was chosen independently — so a shop with an empty cash account and no bank on file
     * opened on cash → cash, the one combination the reference says cannot exist. Two correct
     * rules that never spoke to each other.
     */
    initialSource === 'cash' ? (bankName ? 'bank' : 'debit') : bankName ? 'bank' : 'cash',
  );
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cap = source === 'cash' ? position.cashAccountCents : position.releasedReadyCents;
  const cents = entry ? toCents(Number(entry) || 0) : 0;
  const overCap = cap !== null && cents > cap;
  const fee = feeCents(destination, cents);
  const receives = Math.max(0, cents - fee);
  const bank = bankName ?? 'your bank';

  const [whole, frac] = entry.includes('.') ? entry.split('.') : [entry, ''];
  const shownWhole = whole === '' ? '0' : Number(whole).toLocaleString('en-US');
  const shownFrac = entry.includes('.') ? frac.padEnd(2, '0').slice(0, 2) : '00';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.requestWithdrawal({ amountCents: cents, source, destination });
      setStage('sending');
      // The hops are visible here and only here. Long enough to read, then the outcome.
      window.setTimeout(() => setStage('done'), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be requested just now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 @[520px]:items-center">
      {/* Slides up from the bottom on a phone, centres on anything wider. Square top corners and a
          grab handle, matching the member app — see section 21. */}
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[16px] bg-[var(--clear-surface-2)] px-5 pb-6 pt-3 @[520px]:max-w-[400px] @[520px]:rounded-[16px]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--clear-border-strong)] @[520px]:hidden" />

        {stage === 'picker' ? (
          <Picker
            position={position}
            bankName={bankName}
            source={source}
            destination={destination}
            onSource={(s) => {
              setSource(s);
              // Cash to cash is not a movement, so it cannot remain selected once cash is the source.
              if (s === 'cash' && destination === 'cash') setDestination(bankName ? 'bank' : 'debit');
              setEntry('');
            }}
            onDestination={setDestination}
            onBack={() => setStage('amount')}
          />
        ) : stage === 'sending' ? (
          <Sending amount={cents} destination={destination} source={source} bank={bank} />
        ) : stage === 'done' ? (
          <Done
            amount={cents}
            destination={destination}
            bank={bank}
            position={position}
            onDone={() => {
              onDone();
              onClose();
            }}
          />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <p className="m-0 text-[16px] font-medium">Withdraw</p>
              <button type="button" onClick={onClose} aria-label="Close">
                <X size={18} className="text-[var(--clear-text-secondary)]" />
              </button>
            </div>

            <Cap>Amount</Cap>
            <p className="m-0 mb-[3px] tabular-nums">
              <span className="text-[36px] font-medium tracking-[-1px]">${shownWhole}</span>
              <span className="text-[20px] text-[var(--clear-text-muted)]">.{shownFrac}</span>
            </p>
            {/* The amount line says which cap is in force, rather than letting a merchant find out
                by being refused. */}
            <p className="m-0 mb-3 text-[11.5px] text-[var(--clear-text-muted)]">
              {cap === null
                ? source === 'cash'
                  ? 'We cannot read your cash account just now'
                  : 'Nothing is released early today — it arrives on your scheduled payout'
                : source === 'cash'
                  ? `All of your cash account, ${dollars(fromCents(cap))}`
                  : `All that is free today, of ${dollars(fromCents(position.owedCents))} owed`}
            </p>

            <div className="mb-3 grid grid-cols-3 gap-2">
              {[50_000, 100_000, cap ?? 0].map((c, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={cap === null || c > cap || c <= 0}
                  onClick={() => setEntry(String(fromCents(c)))}
                  className="rounded-[10px] border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-1)] py-2.5 text-[12.5px] text-[var(--clear-text-secondary)] disabled:opacity-40"
                >
                  {i === 2 ? 'All free' : dollars(fromCents(c))}
                </button>
              ))}
            </div>

            <Route
              source={source}
              destination={destination}
              position={position}
              bank={bank}
              onTap={() => setStage('picker')}
            />

            <div className="mb-3.5 grid grid-cols-3 gap-2">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEntry((e) => press(e, k))}
                  aria-label={k === 'del' ? 'Delete' : k}
                  className="flex items-center justify-center rounded-[11px] bg-[var(--clear-surface-1)] py-[13px] text-[19px]"
                >
                  {k === 'del' ? <Delete size={18} aria-hidden /> : k}
                </button>
              ))}
            </div>

            <div className="mb-3 rounded-[10px] border-[0.5px] border-[var(--clear-border)] px-[14px] py-3">
              <Line label="Route" value={routeLabel(source, destination, bank)} />
              <Line label="Fee" value={feeLabel(destination, cents)} />
              <Line label="Arrives" value={arrivalLabel(destination)} />
              <Line label="You receive" value={dollars(fromCents(receives))} strong />
            </div>

            {(error || overCap) && (
              <p role="alert" className="m-0 mb-2 text-center text-[12.5px] leading-[1.5]">
                {error ?? 'That is more than is available from there.'}
              </p>
            )}

            {(cap ?? 0) <= 0 && (
              <p className="m-0 mb-2 text-center text-[11.5px] leading-[1.55] text-[var(--clear-text-muted)]">
                {source === 'owed'
                  ? 'Nothing is released early today. Change the source, or it arrives on your scheduled payout.'
                  : 'Your cash account is empty. Change the source to what you are owed.'}
              </p>
            )}

            <PrimaryButton
              disabled={busy || cents <= 0 || overCap || cap === null || cap <= 0}
              onClick={submit}
              className="!py-[13px] !text-[14.5px]"
            >
              {busy
                ? 'Requesting…'
                : `Withdraw to ${destination === 'cash' ? 'cash account' : destination === 'bank' ? bank : 'card'}`}
            </PrimaryButton>
          </>
        )}
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[12.5px] leading-[2]">
      <span className="text-[var(--clear-text-secondary)]">{label}</span>
      <span className={strong ? 'font-medium tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}

/** The two legs. Tapping either opens the picker — the reference has both sides live. */
function Route({
  source,
  destination,
  position,
  bank,
  onTap,
}: {
  source: Source;
  destination: Destination;
  position: PayoutPosition;
  bank: string;
  onTap: () => void;
}) {
  const from =
    source === 'cash'
      ? { name: 'Cash account', sub: position.cashAccountCents === null ? 'balance unknown' : `${dollars(fromCents(position.cashAccountCents))} all of it` }
      : { name: 'Owed to you', sub: position.releasedReadyCents === null ? 'nothing free today' : `${dollars(fromCents(position.releasedReadyCents))} free` };
  const to =
    destination === 'cash'
      ? { name: 'Cash account', sub: 'Instant · no fee' }
      : destination === 'bank'
        ? { name: bank, sub: '1–3 days · no fee' }
        : { name: 'Debit card', sub: 'Minutes · 1.5%' };

  return (
    <div className="relative mb-3.5 grid grid-cols-2 items-stretch gap-1">
      <button type="button" onClick={onTap} className="min-w-0 rounded-l-[10px] rounded-r-[4px] bg-[var(--clear-surface-1)] py-[11px] pl-[13px] pr-[25px] text-left">
        <p className="m-0 mb-[5px] text-[9.5px] uppercase leading-none tracking-[0.4px] text-[var(--clear-text-muted)]">From</p>
        <p className="m-0 truncate text-[13px] leading-[1.3]">{from.name}</p>
        <p className="m-0 mt-0.5 truncate text-[11.5px] leading-[1.35] text-[var(--clear-text-muted)]">{from.sub}</p>
      </button>
      <button type="button" onClick={onTap} className="min-w-0 rounded-l-[4px] rounded-r-[10px] bg-[var(--clear-surface-1)] py-[11px] pl-[25px] pr-[13px] text-left">
        <p className="m-0 mb-[5px] text-[9.5px] uppercase leading-none tracking-[0.4px] text-[var(--clear-text-muted)]">To</p>
        <p className="m-0 truncate text-[13px] leading-[1.3]">{to.name}</p>
        <p className="m-0 mt-0.5 truncate text-[11.5px] leading-[1.35] text-[var(--clear-text-muted)]">{to.sub}</p>
      </button>
      <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[0.5px] border-[var(--clear-border)] bg-[var(--clear-surface-2)] shadow-[0_0_0_4px_var(--clear-surface-2)]">
        <ArrowRight size={13} className="text-[var(--clear-text-secondary)]" />
      </span>
    </div>
  );
}


/**
 * Both legs, one screen — reference section 07b.
 *
 * The cash account appears on both sides and that is correct: a destination when money is being
 * released, a source when it is being sent on. Cash to cash simply drops out of the second list
 * once cash is the source, rather than being offered and refused.
 */
function Picker({
  position,
  bankName,
  source,
  destination,
  onSource,
  onDestination,
  onBack,
}: {
  position: PayoutPosition;
  bankName: string | null;
  source: Source;
  destination: Destination;
  onSource: (s: Source) => void;
  onDestination: (d: Destination) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="mb-4 flex items-center gap-2.5">
        <button type="button" onClick={onBack} aria-label="Back">
          <ChevronLeft size={20} className="text-[var(--clear-text-secondary)]" />
        </button>
        <p className="m-0 text-[16px] font-medium">Where is it coming from?</p>
      </div>

      <div className="mb-5">
        <Option
          name="Owed to you"
          detail="Passes through your cash account"
          right={
            position.releasedReadyCents === null
              ? 'nothing free today'
              : `${dollars(fromCents(position.releasedReadyCents))} free today`
          }
          selected={source === 'owed'}
          disabled={(position.releasedReadyCents ?? 0) <= 0}
          onClick={() => onSource('owed')}
        />
        <Option
          name="Cash account"
          detail="Goes straight out"
          right={
            position.cashAccountCents === null
              ? 'balance unknown'
              : `${dollars(fromCents(position.cashAccountCents))} all of it`
          }
          selected={source === 'cash'}
          disabled={(position.cashAccountCents ?? 0) <= 0}
          onClick={() => onSource('cash')}
        />
      </div>

      <p className="m-0 mb-1 text-[16px] font-medium">Where does it end up?</p>
      <div className="mb-4">
        {/* Only when it is not already the source. Cash to cash is not a movement. */}
        {source !== 'cash' && (
          <Option
            name="Cash account"
            detail="Spend at partners, no wait"
            right="Instant · no fee"
            selected={destination === 'cash'}
            onClick={() => onDestination('cash')}
          />
        )}
        <Option
          name={bankName ?? 'Bank account'}
          detail={bankName ? 'Business checking' : 'Not set up yet'}
          right="1–3 days · no fee"
          selected={destination === 'bank'}
          disabled={!bankName}
          onClick={() => onDestination('bank')}
        />
        {/* No card on file and none invented. The reference shows a masked number; showing one we
            do not have would be the same fabrication as the old "On its way" screen. */}
        <Option
          name="Debit card"
          detail="Not set up yet"
          right="Minutes · 1.5%"
          selected={destination === 'debit'}
          disabled
          onClick={() => onDestination('debit')}
        />
      </div>

      <PrimaryButton onClick={onBack} className="!py-[13px] !text-[14.5px]">
        Done
      </PrimaryButton>
    </>
  );
}

function Option({
  name,
  detail,
  right,
  selected,
  disabled,
  onClick,
}: {
  name: string;
  detail: string;
  right: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 border-b-[0.5px] border-[var(--clear-border)] py-[13px] text-left last:border-b-0 disabled:opacity-45"
    >
      <span className="min-w-0">
        <span className="block text-[13.5px]">{name}</span>
        <span className="mt-0.5 block text-[11.5px] text-[var(--clear-text-muted)]">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span className="whitespace-nowrap text-right text-[12px] text-[var(--clear-text-secondary)]">
          {right}
        </span>
        <span
          className={`h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] ${
            selected
              ? 'border-[var(--clear-text-accent)] bg-[var(--clear-text-accent)]'
              : 'border-[var(--clear-border-strong)]'
          }`}
        >
          {selected && <span className="block h-full w-full scale-[0.45] rounded-full bg-[var(--clear-surface-2)]" />}
        </span>
      </span>
    </button>
  );
}

/**
 * Where the hops become visible, and the only place they need to be.
 *
 * Three steps when it starts as owed, two when it starts in the cash account — the shorter flow is
 * finished rather than truncated, so it shows two rather than three with one greyed out.
 */
function Sending({
  amount,
  source,
  destination,
  bank,
}: {
  amount: number;
  source: Source;
  destination: Destination;
  bank: string;
}) {
  const list = steps(source, destination, bank);
  return (
    <div className="py-2">
      <Cap>Sending {dollars(fromCents(amount))}</Cap>
      <p className="m-0 mb-4 text-[12.5px] text-[var(--clear-text-muted)]">
        To {destination === 'cash' ? 'your cash account' : destination === 'bank' ? bank : 'your card'}
      </p>
      <div className="mb-4">
        {list.map((step, i) => (
          <div key={step} className="flex items-center gap-2.5 py-2">
            <span
              className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${
                i === 0 ? 'bg-[var(--clear-text-accent)]' : 'border-[1.5px] border-[var(--clear-border-strong)]'
              }`}
            >
              {i === 0 && <Check size={11} strokeWidth={3} className="text-[var(--clear-surface-2)]" />}
            </span>
            <span className={`text-[13px] ${i === 0 ? '' : 'text-[var(--clear-text-muted)]'}`}>{step}</span>
          </div>
        ))}
      </div>
      <p className="m-0 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
        {destination === 'cash'
          ? 'A few seconds to your cash account. You can close this.'
          : `A few seconds to your cash account, then ${destination === 'bank' ? '1–3 business days to the bank' : 'minutes to your card'}. You can close this.`}
      </p>
    </div>
  );
}

/**
 * The done state reports BOTH balances.
 *
 * A merchant who has just moved money from one pot wants to see where both stand, and the
 * remaining owed figure is the next question either way.
 */
function Done({
  amount,
  destination,
  bank,
  position,
  onDone,
}: {
  amount: number;
  destination: Destination;
  bank: string;
  position: PayoutPosition;
  onDone: () => void;
}) {
  return (
    <div className="py-2">
      <Cap>On its way</Cap>
      <p className="m-0 mb-[3px] text-[24px] font-medium tabular-nums">
        {dollars(fromCents(amount))}
      </p>
      <p className="m-0 mb-4 text-[12.5px] text-[var(--clear-text-muted)]">
        to {destination === 'cash' ? 'your cash account' : destination === 'bank' ? bank : 'your card'}
      </p>
      <div className="mb-4 rounded-[10px] border-[0.5px] border-[var(--clear-border)] px-3.5 py-3">
        <Line label="Arrives" value={arrivalLabel(destination)} />
        <Line
          label="Still owed to you"
          value={dollars(fromCents(Math.max(0, position.owedCents - amount)))}
        />
        <Line
          label="Cash account"
          value={position.cashAccountCents === null ? '—' : dollars(fromCents(position.cashAccountCents))}
        />
        {position.nextPayoutOn && (
          <Line label="Next payout" value={formatCalendarDate(position.nextPayoutOn)} />
        )}
      </div>
      <Button onClick={onDone} className="w-full">
        Done
      </Button>
    </div>
  );
}

export default WithdrawModal;
