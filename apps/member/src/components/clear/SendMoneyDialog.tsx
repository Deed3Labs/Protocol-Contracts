import { useEffect, useState } from 'react';
import Modal from './Modal';
import Keypad from './Keypad';
import { Btn } from './brand/anatomy';
import { SwapIcon } from './brand/icons';
import { applyKey } from '@/lib/amountEntry';
import { money } from '@clear/domain';
import { contactHandle, type Contact } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const PRESETS = [20, 40, 100];

/** The big figure, from the typed string, so "12." still shows its point on the way to "12.5". */
export function TypedAmount({ typed }: { typed: string }) {
  const [whole, cents = ''] = typed.split('.');
  return (
    <p className="c-bigamt">
      ${Number(whole || 0).toLocaleString('en-US')}
      <span className="c-dec">.{cents.padEnd(2, '0').slice(0, 2)}</span>
    </p>
  );
}

/**
 * Send — to a member or to someone who is not one yet.
 *
 * The same modal with different consequences. For a member it is a transfer: no fee, instant, and
 * it is kept in the network. For someone who has not joined, escrow is stated here, while deciding,
 * not in a confirmation afterwards: held up to 14 days, returned in full if nobody claims it, and
 * they get a text.
 *
 * Swapping the route turns it into a request to the same person.
 */
export default function SendMoneyDialog({
  contact,
  available,
  open,
  onOpenChange,
  onSend,
  onSwap,
}: {
  contact: Contact;
  /** Ready to allocate — the From leg, the All chip and the cap. */
  available: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend?: (amount: number) => void;
  onSwap?: () => void;
}) {
  const [typed, setTyped] = useState('40');

  useEffect(() => {
    if (open) setTyped('40');
  }, [open]);

  const amount = Number(typed) || 0;
  const pending = contact.pending === true;
  const over = amount > available;
  const firstName = contact.name.split(' ')[0];

  const footer = (
    <>
      <div className="c-conseq">
        {pending ? (
          <>
            <div className="c-earn">
              <span>Held until claimed</span>
              <span>Up to 14 days</span>
            </div>
            <div>
              <span>If nobody claims it</span>
              <span>Returned to you in full</span>
            </div>
            <div>
              <span>They get</span>
              <span>A text with a link</span>
            </div>
            <div className="c-limit c-down">
              <span>Leaves your account</span>
              <span>−{money(amount, { cents: true })}</span>
            </div>
          </>
        ) : (
          <>
            <div className="c-earn">
              <span>Fee</span>
              <span>None, ever</span>
            </div>
            <div>
              <span>Arrives</span>
              <span>Instantly</span>
            </div>
            <div>
              <span>Ready to allocate after</span>
              <span>{money(Math.max(0, available - amount), { cents: true })}</span>
            </div>
            <div className="c-limit">
              <span>Kept in the network</span>
              <span>+{money(amount, { cents: true })}</span>
            </div>
          </>
        )}
      </div>
      {over && (
        <p className="c-det mt-s2">{money(amount - available, { cents: true })} more than is in Ready to allocate.</p>
      )}
      <Btn primary lg className="mt-s2" disabled={amount <= 0 || over} onClick={() => onSend?.(amount)}>
        Send {money(amount, { cents: true })}
      </Btn>
      {!pending && (
        <p className="c-det mt-s1 text-center">Members get it instantly. Anyone else has 14 days to claim it.</p>
      )}
    </>
  );

  const pad = <Keypad onKey={(key) => setTyped((current) => applyKey(current, key))} />;
  const note = pending && (
    <p className="c-det mt-s2">{firstName} is not a member yet, so this is held until they claim it.</p>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Send"
      description={`Send money to ${contact.name}`}
      className="sm:w-[640px] sm:max-w-[640px]"
      footer={footer}
    >
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_216px] sm:items-start sm:gap-s3">
        <div>
          <p className="c-label">Amount</p>
          <TypedAmount typed={typed} />
          <div className="c-qc">
            {PRESETS.map((preset) => (
              <Btn
                key={preset}
                className={cn('c-chip-q', amount === preset && 'c-on')}
                aria-pressed={amount === preset}
                onClick={() => setTyped(String(preset))}
              >
                {money(preset)}
              </Btn>
            ))}
            <Btn
              className={cn('c-chip-q', available > 0 && !PRESETS.includes(amount) && amount === available && 'c-on')}
              disabled={available <= 0}
              onClick={() => setTyped(String(available))}
            >
              All
            </Btn>
          </div>
          <div className="c-route">
            <div className="c-leg">
              <p className="c-label">From</p>
              <p className="c-nm">Ready to allocate</p>
              <p className="c-bal">{money(available, { cents: true })} free</p>
            </div>
            <div className="c-leg">
              <p className="c-label">To</p>
              <p className="c-nm">{contact.name}</p>
              <p className="c-bal">{contactHandle(contact)}</p>
            </div>
            <button type="button" aria-label="Request from them instead" className="c-swap" onClick={onSwap}>
              <SwapIcon className="text-ink-70" />
            </button>
          </div>
          <div className="sm:hidden">
            {pad}
            {note}
          </div>
          <div className="hidden sm:block">{note}</div>
        </div>
        <div className="hidden sm:block">{pad}</div>
      </div>
    </Modal>
  );
}
