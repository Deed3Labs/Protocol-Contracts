import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete } from 'lucide-react';
import { dollars, fromCents, toCents } from '@clear/domain';
import { Columns } from '@/shell/AppShell';
import { Cap, Card, Inset, PrimaryButton, Row } from '@/shell/ui';
import { api } from '@/data/apiClient';

/**
 * The refund threshold — reference section 08.
 *
 * **The owner sets this, not Clear.** It is their money and their staffing: a shop with one
 * trusted manager wants it high, a shop with weekend cover it does not know well wants it at zero.
 * So the range runs from nothing to the approval cap and Clear has no opinion in between.
 *
 * **Changing it requires signing in, never the owner code.** Otherwise a writer raises the ceiling
 * with the code and then spends under it — the code can never raise its own limit. That rule is
 * enforced server-side by `requireOwner`; the route guard here only keeps the screen out of a
 * counter writer's reach.
 *
 * **"Off" is a first-class option, not a zero.** A shop that wants every refund to wait for the
 * owner should be able to say so in one tap, rather than typing a number that means nothing.
 *
 * The summary states BOTH sides of the line — what the code clears and what it does not. A
 * threshold that only says its own value leaves the owner to work out the consequence, which is
 * the part they actually care about.
 */

const PRESETS = [
  { cents: 0, label: 'Off' },
  { cents: 25_000, label: '$250' },
  { cents: 50_000, label: '$500' },
  { cents: 100_000, label: '$1,000' },
] as const;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

/** The typed amount, kept as the string the owner is building rather than a number. */
function press(entry: string, key: string): string {
  if (key === 'del') return entry.slice(0, -1);
  if (key === '.') return entry.includes('.') ? entry : `${entry || '0'}.`;
  const [, cents] = entry.split('.');
  // Two decimal places and no more: a third keystroke should do nothing rather than silently
  // shifting the amount by a factor of ten.
  if (cents !== undefined && cents.length >= 2) return entry;
  if (!entry.includes('.') && entry.replace('.', '').length >= 7) return entry;
  return entry + key;
}

export default function RefundThresholdPage() {
  const navigate = useNavigate();
  const [entry, setEntry] = useState('');
  const [maxCents, setMaxCents] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .refundThreshold()
      .then(({ limitCents, maxCents: max }) => {
        setEntry(limitCents === 0 ? '' : String(fromCents(limitCents)));
        setMaxCents(max);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const cents = entry ? toCents(Number(entry) || 0) : 0;
  const overCap = maxCents !== null && maxCents > 0 && cents > maxCents;

  // The dollars and the cents are sized differently, so the figure reads as an amount at a glance
  // rather than as a number to be parsed.
  const [whole, frac] = entry.includes('.') ? entry.split('.') : [entry, ''];
  const shownWhole = whole === '' ? '0' : Number(whole).toLocaleString('en-US');
  const shownFrac = entry.includes('.') ? frac.padEnd(2, '0').slice(0, 2) : '00';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.setRefundThreshold(cents);
      navigate('/staff');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Columns
      action={
        <>
          <h1 className="m-0 mb-[3px] text-[20px] font-semibold tracking-[-0.3px]">
            Refunds with your code
          </h1>
          <p className="m-0 mb-[18px] text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
            Counter staff can clear refunds up to
          </p>

          <p className="m-0 mb-[3px] tabular-nums">
            <span className="text-[40px] font-medium tracking-[-1px]">
              ${shownWhole}
            </span>
            <span className="text-[22px] text-[var(--clear-text-muted)]">.{shownFrac}</span>
          </p>
          <p className="m-0 mb-[18px] text-[11.5px] text-[var(--clear-text-muted)]">
            Above this, only from your phone
          </p>

          {/* "Off" sits with the amounts rather than as a separate switch: it is one of the four
              answers an owner actually gives, and the commonest of them. */}
          <div className="mb-3 grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setEntry(p.cents === 0 ? '' : String(fromCents(p.cents)))}
                className={`rounded-[10px] border-[0.5px] py-2.5 text-[12.5px] ${
                  cents === p.cents
                    ? 'border-[var(--clear-text-primary)] bg-[var(--clear-surface-1)]'
                    : 'border-[var(--clear-border)] bg-[var(--clear-surface-1)] text-[var(--clear-text-secondary)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setEntry((e) => press(e, k))}
                aria-label={k === 'del' ? 'Delete' : k}
                className="flex items-center justify-center rounded-[11px] bg-[var(--clear-surface-1)] py-[15px] text-[20px]"
              >
                {k === 'del' ? <Delete size={19} aria-hidden /> : k}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="m-0 mb-2 text-center text-[13px]">
              {error}
            </p>
          )}

          <PrimaryButton
            disabled={!loaded || busy || overCap}
            onClick={save}
            className="!py-[13px] !text-[14px]"
          >
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
      context={
        <>
          {/* Both sides of the line. A threshold that states only its own value leaves the owner
              to infer what it costs them, which is the part they are deciding about. */}
          <Cap>What this means</Cap>
          <Card rows className="mb-3.5">
            {cents === 0 ? (
              <Row title="Every refund" meta="Your phone only" />
            ) : (
              <>
                <Row title={`Under ${dollars(fromCents(cents))}`} meta="Your code, at the counter" />
                <Row title={`${dollars(fromCents(cents))} and above`} meta="Your phone only" />
              </>
            )}
          </Card>

          <Inset className="!px-4 !py-[15px]">
            <p className="m-0 text-[12.5px] leading-[1.65] text-[var(--clear-text-secondary)]">
              {/* The ceiling is the approval cap: an owner cannot authorise more by code than the
                  shop can charge in one transaction, so one number governs both directions. */}
              {maxCents === null
                ? 'Could not confirm your approval cap just now, so this cannot be raised until it loads.'
                : `Highest you can set ${dollars(fromCents(maxCents))}`}
            </p>
            {overCap && (
              <p className="m-0 mt-2 text-[12.5px] leading-[1.65]">
                The most you can clear by code is your approval cap.
              </p>
            )}
            <p className="m-0 mt-2.5 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
              Set it to zero and every refund waits for your phone.
            </p>
          </Inset>
        </>
      }
    />
  );
}
