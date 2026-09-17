import { useState } from 'react';
import Modal from './Modal';
import EmbeddedCardDetails from './card/EmbeddedCardDetails';
import { Btn, Line, Rows } from './brand/anatomy';
import { RowBtn, RowChevron } from '@/components/settings/SettingsKit';

/**
 * Card details — number, expiry and security code behind a deliberate tap, hidden again on close.
 *
 * Three sources, and on a live card the numbers never enter this app in any of them.
 *
 * A session is the good one: the issuer's SDK mounts one small frame per value inside our own rows,
 * so the sheet is the app's and only the digits are theirs. A program that cannot mint one falls
 * back to the issuer's whole card page in a single frame, styled at a distance. The preview harness
 * has placeholder digits, which render as the reference's copyable rows.
 *
 * Replace this card is reached from here: it is about this card, and Details is where a member
 * already is when they are looking at it.
 */
export default function CardDetailsDialog({
  pan,
  expiry,
  cvc,
  embedUrl,
  embedSession,
  loading,
  open,
  onOpenChange,
  onReplace,
}: {
  pan: string;
  expiry: string;
  cvc: string;
  /** The issuer's whole card page, for a program that cannot mint a session. */
  embedUrl?: string;
  /** A session for the modern embed: one small frame per value, inside our own rows. */
  embedSession?: { session: string; environment: 'sandbox' | 'production' };
  /** Waiting on the issuer's URL. */
  loading?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace?: () => void;
}) {
  // A session that fails to mount falls back to the issuer's page rather than an empty sheet.
  const [mountFailed, setMountFailed] = useState(false);
  /*
   * The sheet has one action, and while there are numbers to reveal, revealing is it.
   *
   * A second button among the rows read as part of the list it sat under; the footer is where every
   * other sheet in the app keeps what it does. Closing stays on the header's cross.
   */
  const [reveal, setReveal] = useState<{ shown: boolean; busy: boolean; toggle: () => void } | null>(null);
  const copy = (value: string) => navigator.clipboard?.writeText(value.replace(/\s/g, '')).catch(() => {});
  const field = (label: string, value: string) => (
    <div>
      <Line className="items-center!">
        <div className="min-w-0">
          <p className="c-label">{label}</p>
          <p className="c-mono mt-[4px] text-sec!">{value}</p>
        </div>
        <RowBtn onClick={() => copy(value)} aria-label={`Copy ${label.toLowerCase()}`}>
          Copy
        </RowBtn>
      </Line>
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Card details"
      description="Your card number, expiry and security code. Hidden again when you close this."
      footer={
        <>
          <div className="c-footnote mt-0! border-t-0! pt-0!">
            <p>Hidden again when you close this. Clear never shows these to anyone else.</p>
          </div>
          {reveal ? (
            <Btn lg className="mt-s2" disabled={reveal.busy} onClick={reveal.toggle}>
              {reveal.busy ? 'One moment…' : reveal.shown ? 'Hide the numbers' : 'Show the numbers'}
            </Btn>
          ) : (
            <Btn lg className="mt-s2" onClick={() => onOpenChange(false)}>
              Hide details
            </Btn>
          )}
        </>
      }
    >
      {embedSession && !mountFailed ? (
        <EmbeddedCardDetails
          session={embedSession.session}
          environment={embedSession.environment}
          onFailed={() => setMountFailed(true)}
          onControls={setReveal}
        />
      ) : embedUrl ? (
        <iframe title="Card details" src={embedUrl} className="block h-[180px] w-full border-0" />
      ) : pan ? (
        <Rows>
          {field('Card number', pan)}
          {field('Expires', expiry)}
          {field('Security code', cvc)}
        </Rows>
      ) : (
        <p className="c-det">{loading ? 'Getting your card details.' : 'Your card details are not available right now.'}</p>
      )}
      {onReplace && (
        <button type="button" onClick={onReplace} className="c-line mt-s2 w-full items-center! border-t border-ink-13 pt-s2 text-left">
          <span className="text-sec">Replace this card</span>
          <RowChevron />
        </button>
      )}
    </Modal>
  );
}
