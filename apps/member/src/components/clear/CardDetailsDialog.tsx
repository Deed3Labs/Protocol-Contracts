import Modal from './Modal';
import { Btn, Line, Rows } from './brand/anatomy';
import { RowBtn, RowChevron } from '@/components/settings/SettingsKit';

/**
 * Card details — number, expiry and security code behind a deliberate tap, hidden again on close.
 *
 * Two sources. On a live card the numbers never enter this app: the issuer renders them inside its
 * own frame from a short-lived URL, so there is nothing here to copy. The preview harness has
 * placeholder digits, which render as the reference's copyable rows.
 *
 * Replace this card is reached from here: it is about this card, and Details is where a member
 * already is when they are looking at it.
 */
export default function CardDetailsDialog({
  pan,
  expiry,
  cvc,
  embedUrl,
  loading,
  open,
  onOpenChange,
  onReplace,
}: {
  pan: string;
  expiry: string;
  cvc: string;
  /** The issuer's frame, for a live card. */
  embedUrl?: string;
  /** Waiting on the issuer's URL. */
  loading?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace?: () => void;
}) {
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
          <Btn lg className="mt-s2" onClick={() => onOpenChange(false)}>
            Hide details
          </Btn>
        </>
      }
    >
      {embedUrl ? (
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
