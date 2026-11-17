import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import Modal from './Modal';
import { Btn, Rows } from './brand/anatomy';
import { CopyIcon, TickIcon } from './brand/icons';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_DETAILS_NOTE,
  ACCOUNT_DETAILS_TITLE,
  CLOSED,
  DIRECT_DEPOSIT_FORM_ACTION,
  MISSING,
  SET_UP_FACE_ID_ACTION,
  SIGN_IN_AGAIN_ACTION,
  accountDetailsReducer,
  accountNumberShown,
  bankDisclosure,
  copyText,
  obtainFullNumber,
  type AccountDetailsSource,
} from '@/lib/accountDetails';
import { downloadDirectDepositForm } from '@/lib/directDepositForm';
import { liveAccountDetails } from '@/utils/apiClient';

/** A small square button beside a value. */
const ICON_BTN = 'h-[30px]! w-[34px] p-0!';

/** Copy, then a tick for a moment. Copies whatever `value` resolves to, which may need Face ID first. */
function CopyButton({ label, value, disabled }: { label: string; value: () => string | Promise<string>; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <Btn
      className={ICON_BTN}
      disabled={disabled}
      aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      onClick={() => {
        void copyText(value()).then((ok) => {
          if (!ok) return;
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <TickIcon /> : <CopyIcon />}
    </Btn>
  );
}

/** One row: label on the left, the value and its copy button on the right. */
function DetailRow({
  label,
  value,
  mono,
  copy,
  children,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** What the copy button copies. Absent when there is nothing to copy. */
  copy?: () => string | Promise<string>;
  /** Extra controls before the copy button (the account number's Show). */
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="c-kv">
        <span className="shrink-0">{label}</span>
        <span className={cn('c-v min-w-0', mono && 'c-mono')}>
          <span className="truncate text-sec!">{value}</span>
          {children}
          {copy && <CopyButton label={label} value={copy} />}
        </span>
      </div>
    </div>
  );
}

/**
 * Spendable account details — behind Details on Spendable. Centred sheet on desktop, bottom sheet on
 * the phone (Modal does both).
 *
 * Read from Lithic, through the API, each time it opens. The account number rests as ····1234. Show,
 * copying it and the direct deposit form all need the full number, which takes re-authentication:
 * Face ID, or for a member without it a sign-in made minutes ago (lib/accountDetails'
 * obtainFullNumber, and the server's requireReauth behind it). Refused, the surface says why and
 * offers the way through: "Send me a code" (sign in again, as on the lock screen) or "Turn on Face
 * ID". Nothing here asks for a code or a PIN of its own. Once fetched the number is held in this surface's
 * state and nowhere else, and closing it drops it. No currency here: these are numbers to hand over,
 * not balances.
 */
export default function AccountDetailsDialog({
  open,
  onOpenChange,
  source = liveAccountDetails,
  onSignInAgain,
  onSetUpFaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The API in the app; fixtures in the preview harness. */
  source?: AccountDetailsSource;
  /** Sign out and send a code, so the next sign-in is fresh. Absent in the preview harness. */
  onSignInAgain?: () => void;
  /** Settings › Security, where Face ID is turned on. */
  onSetUpFaceId?: () => void;
}) {
  const [state, dispatch] = useReducer(accountDetailsReducer, CLOSED);
  const [forming, setForming] = useState(false);

  useEffect(() => {
    if (!open) {
      dispatch({ type: 'close' });
      return;
    }
    dispatch({ type: 'open' });
  }, [open]);

  // Fetch on open: the session number changes once per open.
  useEffect(() => {
    if (state.status !== 'loading') return;
    const asked = state.session;
    void source.readMasked().then((read) => dispatch({ type: 'loaded', session: asked, read }));
  }, [state.status, state.session, source]);

  const details = state.details;

  /**
   * The full number: held, or after Face ID. Kept for the rest of this open, never beyond it; the
   * answer carries the open it was asked in, so one that lands after a close is dropped.
   */
  const fullNumber = async (show: boolean): Promise<string> => {
    const asked = state.session;
    const read = await obtainFullNumber(state.fullNumber, source);
    if ('error' in read) {
      dispatch({ type: 'failed', session: asked, error: read.error, reauth: read.reauth });
      throw new Error(read.error);
    }
    dispatch({ type: 'revealed', session: asked, accountNumber: read.accountNumber, show });
    return read.accountNumber;
  };

  const toggleShown = () => {
    if (state.shown) dispatch({ type: 'hide' });
    else void fullNumber(true).catch(() => {});
  };

  const getForm = async () => {
    if (!details) return;
    setForming(true);
    try {
      const accountNumber = await fullNumber(false);
      await downloadDirectDepositForm({
        holderName: details.holderName,
        bankName: details.bankName,
        routingNumber: details.routingNumber,
        accountNumber,
        accountType: details.accountType,
      });
    } catch {
      // Declined or unavailable: `failed` already put the reason under the rows.
    } finally {
      setForming(false);
    }
  };

  const ready = state.status === 'ready' && details;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={ACCOUNT_DETAILS_TITLE}
      description="Your account and routing numbers, for direct deposit or a bank transfer."
      footer={
        ready ? (
          <>
            <Btn lg disabled={forming} onClick={() => void getForm()}>
              {forming ? 'Preparing form…' : DIRECT_DEPOSIT_FORM_ACTION}
            </Btn>
            <p className="c-det mt-s2 text-[11px]!">{bankDisclosure()}</p>
          </>
        ) : undefined
      }
    >
      {state.status === 'loading' || state.status === 'closed' ? (
        <p className="c-det">Getting your account details…</p>
      ) : state.status === 'error' ? (
        <>
          <p className="c-det c-errline">We could not load your account details just now.</p>
          <Btn className="mt-s2" onClick={() => dispatch({ type: 'open' })}>
            Try again
          </Btn>
        </>
      ) : state.status === 'unavailable' || !details ? (
        <p className="c-det">Your account and routing numbers are not ready yet. We will show them here as soon as they are.</p>
      ) : (
        <>
          <Rows>
            <DetailRow
              label="Account holder"
              value={details.holderName || MISSING}
              copy={details.holderName ? () => details.holderName! : undefined}
            />
            <DetailRow
              label="Bank"
              value={details.bankName || MISSING}
              copy={details.bankName ? () => details.bankName! : undefined}
            />
            <DetailRow label="Routing number" value={details.routingNumber} mono copy={() => details.routingNumber} />
            {/* Copy copies the full number, never the dots: Face ID first if it is not held yet. */}
            <DetailRow label="Account number" value={accountNumberShown(state)} mono copy={() => fullNumber(false)}>
              <Btn className="h-[30px]! px-[10px]!" aria-pressed={state.shown} onClick={toggleShown}>
                {state.shown ? 'Hide' : 'Show'}
              </Btn>
            </DetailRow>
            <DetailRow label="Account type" value={details.accountType} copy={() => details.accountType} />
          </Rows>
          {state.problem && <p className="c-det c-errline mt-s2">{state.problem}</p>}
          {state.reauth === 'sign_in' && onSignInAgain && (
            <Btn className="mt-s2" onClick={onSignInAgain}>
              {SIGN_IN_AGAIN_ACTION}
            </Btn>
          )}
          {state.reauth === 'set_up' && onSetUpFaceId && (
            <Btn className="mt-s2" onClick={onSetUpFaceId}>
              {SET_UP_FACE_ID_ACTION}
            </Btn>
          )}
          <p className="c-det mt-s3">{ACCOUNT_DETAILS_NOTE}</p>
        </>
      )}
    </Modal>
  );
}
