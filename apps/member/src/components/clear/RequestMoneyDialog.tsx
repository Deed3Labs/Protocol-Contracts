import { useEffect, useState } from 'react';
import Modal from './Modal';
import Keypad from './Keypad';
import ContactRows from './ContactRows';
import { TypedAmount } from './SendMoneyDialog';
import { Btn } from './brand/anatomy';
import { SwapIcon } from './brand/icons';
import { applyKey } from '@/lib/amountEntry';
import { money } from '@clear/domain';
import { contactHandle, searchContacts, type Contact } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const PRESETS = [20, 50, 120];

/**
 * Request — the Send modal with the legs reversed: from them, to you. The clearest way to show that
 * nothing moves until the other person acts, which the closing line says outright. It is a request,
 * not a charge.
 *
 * Opened without a recipient it starts on the picker — who before how much.
 */
export default function RequestMoneyDialog({
  contact,
  contacts = [],
  open,
  onOpenChange,
  onRequest,
}: {
  /** Preselected recipient; omit to pick one first. */
  contact?: Contact;
  contacts?: Contact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequest?: (contact: Contact, amount: number, note: string) => void;
}) {
  const [picked, setPicked] = useState<Contact | null>(contact ?? null);
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('120');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setPicked(contact ?? null);
    setQuery('');
    setTyped('120');
    setNote('');
  }, [open, contact]);

  const amount = Number(typed) || 0;

  if (!picked) {
    const matched = query.trim() ? searchContacts(contacts, query) : contacts;
    return (
      <Modal open={open} onOpenChange={onOpenChange} title="Request" description="Choose who to request money from.">
        <div className="c-searchrow mb-s2">
          <input
            className="c-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, phone, or @handle"
            aria-label="Search people to request from"
          />
        </div>
        <ContactRows
          contacts={matched}
          onSelect={setPicked}
          emptyMessage="No one matching. Try a phone number or @handle."
        />
      </Modal>
    );
  }

  const footer = (
    <>
      <div className="c-conseq">
        <div className="c-earn">
          <span>They see</span>
          <span>A request, not a charge</span>
        </div>
        <div>
          <span>Expires</span>
          <span>In 7 days</span>
        </div>
        <div>
          <span>You are told</span>
          <span>When they pay or decline</span>
        </div>
        <div className="c-limit">
          <span>Nothing moves until they approve</span>
          <span>Always</span>
        </div>
      </div>
      <Btn primary lg className="mt-s2" disabled={amount <= 0} onClick={() => onRequest?.(picked, amount, note)}>
        Request {money(amount, { cents: true })}
      </Btn>
    </>
  );

  const pad = <Keypad onKey={(key) => setTyped((current) => applyKey(current, key))} />;
  const noteField = (
    <input
      className="c-field mt-s2 w-full"
      value={note}
      onChange={(e) => setNote(e.target.value)}
      placeholder="Add a note so they know what it is for."
      aria-label="What the request is for"
    />
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Request"
      description={`Request money from ${picked.name}`}
      onBack={contact ? undefined : () => setPicked(null)}
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
            {/* The keypad is the input; Custom clears the figure so it is ready to type into. */}
            <Btn className={cn('c-chip-q', amount > 0 && !PRESETS.includes(amount) && 'c-on')} onClick={() => setTyped('')}>
              Custom
            </Btn>
          </div>
          <div className="c-route">
            <div className="c-leg">
              <p className="c-label">From</p>
              <p className="c-nm">{picked.name}</p>
              <p className="c-bal">{contactHandle(picked)}</p>
            </div>
            <div className="c-leg">
              <p className="c-label">To</p>
              <p className="c-nm">You</p>
              <p className="c-bal">Ready to allocate</p>
            </div>
            <span aria-hidden className="c-swap">
              <SwapIcon className="text-ink-70" />
            </span>
          </div>
          <div className="sm:hidden">
            {pad}
            {noteField}
          </div>
          <div className="hidden sm:block">{noteField}</div>
        </div>
        <div className="hidden sm:block">{pad}</div>
      </div>
    </Modal>
  );
}
