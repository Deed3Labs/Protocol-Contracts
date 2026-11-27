import { useRef, useState } from 'react';
import { Btn, CFoot, CHead, CMain, Cell, Chip, Line, SecHead } from '../brand/anatomy';
import CardFace from './CardFace';
import type { CardStage } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** The shipment, in order. Each one carries the date it happened, or nothing. */
const STEPS = ['Ordered', 'Posted', 'Delivered', 'Activated'] as const;

/**
 * Where the physical card has got to.
 *
 * A shipment rather than a checklist. The old screen was four setup tasks with step one always
 * showing done — it asserted a card had arrived, because nothing told it otherwise. This keys off
 * what the issuer actually reports: ordered and activated are the card's own state, posted is the
 * one event it sends, and **delivered is nobody's fact** — no carrier tells the issuer, so the rail
 * never claims it. Entering the last four is what stands in for it, which is also why those digits
 * are checked against the card that was posted.
 *
 * A virtual card never sees this. It is live the moment it exists, and showing it a shipment it
 * will never have would be inventing a wait.
 */
export default function PhysicalCardState({
  stage,
  cardholder,
  expiry,
  network,
  last4,
  orderedAt,
  postedAt,
  arrivesAbout,
  tracking,
  busy,
  notice,
  error,
  onActivate,
  onSetPin,
  onTrack,
}: {
  stage: Exclude<CardStage, 'live'>;
  cardholder: string;
  expiry: string;
  network: string;
  /** What the digits are checked against. */
  last4?: string;
  orderedAt?: string;
  postedAt?: string;
  arrivesAbout?: string;
  tracking?: string;
  busy?: boolean;
  notice?: string | null;
  error?: string | null;
  onActivate?: (lastFour: string) => void;
  onSetPin?: () => void;
  onTrack?: () => void;
}) {
  const [digits, setDigits] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const complete = digits.length === 4;
  const mismatch = complete && Boolean(last4) && digits !== last4;

  /*
   * Posting is the last thing anybody can prove, so it is the last step the rail marks done. The
   * step after it is where the member is, whatever a carrier's estimate says.
   */
  const reached = stage === 'ordered' ? 0 : 1;
  const heroState = stage === 'ordered' ? 'Ordered' : 'Posted';
  const heroLine =
    stage === 'ordered'
      ? orderedAt
        ? `Placed ${orderedAt}. We will tell you when it ships.`
        : 'We will tell you when it ships.'
      : [postedAt && `Left us ${postedAt}.`, arrivesAbout && `Arrives around ${arrivesAbout}.`]
          .filter(Boolean)
          .join(' ') || 'On its way to you.';

  return (
    <div className="lg:mx-auto lg:max-w-[420px]">
      <div className="mb-s3">
        <p className="c-label">Physical card</p>
        <p className="c-fig text-hero-m mt-[6px] leading-[1.05] lg:text-hero">{heroState}</p>
        <p className="c-det mt-[4px]">{heroLine}</p>
      </div>
      <div className="mb-s3">
        <CardFace
          variant="physical"
          frozen
          last4={last4 ?? ''}
          cardholder={cardholder}
          expiry={expiry}
          network={network}
          meta={stage === 'ordered' ? `Ordered ${orderedAt ?? ''}`.trim() : `Posted ${postedAt ?? ''}`.trim()}
        />
      </div>
      <div className="c-slab c-one">
        <Cell>
          <CHead>
            <SecHead label={stage === 'posted' && postedAt ? 'On its way' : 'On its way'}>
              <Chip tone="underway">{heroState}</Chip>
            </SecHead>
          </CHead>
          <CMain>
            <div className="c-rail">
              {STEPS.map((step, i) => {
                const when =
                  step === 'Ordered' ? orderedAt : step === 'Posted' ? postedAt : step === 'Delivered' ? arrivesAbout : undefined;
                return (
                  <div
                    key={step}
                    className={cn(
                      'c-mstone',
                      i <= reached && 'c-done',
                      i === reached + 1 && 'c-now',
                      i > reached + 1 && 'c-later',
                      i === STEPS.length - 1 && 'c-last',
                    )}
                  >
                    <span className="c-mdot" />
                    <Line>
                      <span className="text-sec">{step}</span>
                      {i <= reached && when && <span className="c-det c-pos">{when}</span>}
                      {i === reached + 1 && (
                        // An estimate is not a date something happened, so it says which it is.
                        <span className="c-det text-live">{step === 'Delivered' && when ? `About ${when}` : 'Now'}</span>
                      )}
                      {i > reached + 1 && when && <span className="c-det">{when}</span>}
                    </Line>
                  </div>
                );
              })}
            </div>

            {tracking && (
              <Line className="mt-s2 items-center! border-t border-ink-13 pt-s2">
                <div className="min-w-0">
                  <p className="text-sec">Tracking</p>
                  <p className="c-det c-mono mt-[3px] truncate">{tracking}</p>
                </div>
                <Btn onClick={onTrack}>Track</Btn>
              </Line>
            )}

            {/* The last four is only asked once the card can actually be in somebody's hand. */}
            {stage === 'posted' && (
              <div className="mt-s2 border-t border-ink-13 pt-s2">
                <label htmlFor="activate-last4" className="c-label mb-s1 block">
                  Last four digits on the card
                </label>
                <div className="relative" onClick={() => input.current?.focus()}>
                  <div className="c-pinbox" aria-hidden>
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className={cn(focused && i === digits.length && 'c-live', mismatch && 'border-absent!')}
                      >
                        {digits[i] ?? ''}
                      </span>
                    ))}
                  </div>
                  <input
                    ref={input}
                    id="activate-last4"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    value={digits}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="absolute inset-0 h-full w-full cursor-text opacity-0"
                  />
                </div>
                <p className="c-det mt-s1">Checked against the card we posted you.</p>
                {mismatch && (
                  <p className="c-det c-errline mt-s1">Those are not the last four digits on your card.</p>
                )}
                {error && <p className="c-det c-errline mt-s1">{error}</p>}
              </div>
            )}
          </CMain>
          <CFoot>
            {stage === 'posted' ? (
              <Btn
                primary
                lg
                disabled={!complete || mismatch || busy}
                onClick={() => onActivate?.(digits)}
              >
                {busy ? 'Activating' : 'Activate'}
              </Btn>
            ) : (
              <Line className="items-center!">
                <span className="c-det">We will tell you when it ships</span>
                {onSetPin && (
                  <button type="button" className="c-det hover:text-ink" onClick={onSetPin}>
                    Set a PIN
                  </button>
                )}
              </Line>
            )}
            {notice && (
              <p role="status" className="c-det mt-s1">
                {notice}
              </p>
            )}
          </CFoot>
        </Cell>
      </div>
    </div>
  );
}
