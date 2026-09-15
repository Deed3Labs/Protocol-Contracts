import { useRef, useState } from 'react';
import { Btn, CFoot, CHead, CMain, Cell, Line, SecHead } from '../brand/anatomy';
import CardFace from './CardFace';
import { cn } from '@/lib/utils';

const STEPS = ['Card arrived', 'Enter the last four digits', 'Set a PIN', 'Add to your phone'];

/**
 * Activation is a screen, not a nag. The face shows frozen until it is activated, which is true,
 * and the steps say what is left.
 *
 * Four digits, not a text field: one box per digit with a caret on the live one, because a card
 * number is entered in a known shape. A real input sits over the boxes so the phone's number pad and
 * paste both work.
 */
export default function ActivateCard({
  cardholder,
  expiry,
  network,
  last4,
  busy,
  notice,
  onActivate,
}: {
  cardholder: string;
  expiry: string;
  network: string;
  /** What the digits must match. Unknown before a card exists, when any four are accepted. */
  last4?: string;
  busy?: boolean;
  notice?: string | null;
  onActivate?: () => void;
}) {
  const [digits, setDigits] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const complete = digits.length === 4;
  const mismatch = complete && Boolean(last4) && digits !== last4;
  const current = 1;

  return (
    <div className="lg:mx-auto lg:max-w-[420px]">
      <div className="mb-s3">
        <CardFace variant="physical" frozen last4={last4 ?? ''} cardholder={cardholder} expiry={expiry} network={network} />
      </div>
      <div className="c-slab c-one">
        <Cell>
          <CHead>
            <SecHead label="Activate your card">
              <span className="c-det">
                {current} of {STEPS.length}
              </span>
            </SecHead>
          </CHead>
          <CMain>
            <div className="c-rail">
              {STEPS.map((step, i) => (
                <div
                  key={step}
                  className={cn(
                    'c-mstone',
                    i < current && 'c-done',
                    i === current && 'c-now',
                    i > current && 'c-later',
                    i === STEPS.length - 1 && 'c-last',
                  )}
                >
                  <span className="c-mdot" />
                  <Line>
                    <span className="text-sec">{step}</span>
                    {i < current && <span className="c-det c-pos">Done</span>}
                    {i === current && <span className="c-det text-live">Now</span>}
                  </Line>
                </div>
              ))}
            </div>
          </CMain>
          <CFoot>
            <label htmlFor="activate-last4" className="c-label mb-s1 block">
              Last four digits
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
            {mismatch && <p className="c-det c-errline mt-s1">Those are not the last four digits on your card.</p>}
            <Btn primary lg className="mt-s2" disabled={!complete || mismatch || busy} onClick={onActivate}>
              {busy ? 'Activating' : 'Activate'}
            </Btn>
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
