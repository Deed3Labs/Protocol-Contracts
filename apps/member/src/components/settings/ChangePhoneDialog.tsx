import { useEffect, useState } from 'react';
import Modal from '@/components/clear/Modal';
import { Btn } from '@/components/clear/brand/anatomy';
import PinBox from '@/components/clear/auth/PinBox';

/**
 * Change phone number.
 *
 * The warning isn't boilerplate: with no password, the phone is the credential. Someone changing it
 * needs to know that before they type a number they can't receive on, not after — which is also why
 * the new number has to answer a code before it replaces the old one. The old one keeps working
 * until it does.
 *
 * Two steps in one sheet, the same six boxes signing in uses.
 */
export default function ChangePhoneDialog({
  current,
  open,
  onOpenChange,
  onSendCode,
  onVerify,
  /** 'sending' and 'verifying' are waits; 'code' is the second step. */
  stage = 'enter',
  busy = false,
  error = null,
}: {
  current: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendCode?: (phone: string) => void;
  onVerify?: (code: string) => void;
  stage?: 'enter' | 'code';
  busy?: boolean;
  error?: string | null;
}) {
  const [next, setNext] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!open) {
      setNext('');
      setCode('');
    }
  }, [open]);

  // Ten digits is a US number, eleven with the country code. Fewer is a typo, and sending a code to
  // a typo tells somebody their phone is broken.
  const digits = next.replace(/\D/g, '');
  const ready = digits.length >= 10;

  if (stage === 'code') {
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Change phone number"
        description={`Enter the code sent to ${next || 'your new number'}.`}
        footer={
          <>
            {error && <p className="c-det c-errline mb-s1">{error}</p>}
            <Btn primary lg disabled={code.length !== 6 || busy} onClick={() => onVerify?.(code)}>
              {busy ? 'Checking…' : 'Update number'}
            </Btn>
            <p className="c-det mt-s1 text-center">
              Your old number keeps working until this one answers.
            </p>
          </>
        }
      >
        <p className="c-det mb-s2">Sent to {next || 'your new number'}</p>
        <PinBox value={code} onChange={setCode} autoFocus label="Code sent to your new number" />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Change phone number"
      description="Enter a new number. We'll send a code to it before switching."
      footer={
        <>
          {error && <p className="c-det c-errline mb-s1">{error}</p>}
          <Btn primary lg disabled={!ready || busy} onClick={() => onSendCode?.(next)}>
            {busy ? 'Sending…' : 'Send code'}
          </Btn>
          <p className="c-det mt-s1 text-center">
            This is how you sign in. If you lose both your phone and your email, recovery takes
            several days.
          </p>
        </>
      }
    >
      <label className="block">
        <span className="c-label mb-[6px] block">Current</span>
        <input className="c-field w-full text-ink-50" value={current || '—'} readOnly />
      </label>
      <div className="mt-s2">
        <label className="block">
          <span className="c-label mb-[6px] block">New number</span>
          <input
            className="c-field w-full"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="(909) 555-0193"
            inputMode="tel"
            autoComplete="tel"
          />
        </label>
      </div>
      <p className="c-det mt-[6px]">We text a code to it before anything changes.</p>
    </Modal>
  );
}
