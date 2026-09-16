import { useEffect, useState } from 'react';
import Modal from '@/components/clear/Modal';
import { Btn } from '@/components/clear/brand/anatomy';
import { EMPTY_ADDRESS, type MailingAddress } from '@/hooks/useMemberProfile';

/**
 * Home address.
 *
 * The one place the app holds it, because a second address quietly diverging from the identity
 * record is worse than one screen to change it in: ordering a physical card reads this rather than
 * asking again, and the sheet says so.
 *
 * Line 1, city, state and postcode are what a shipping label needs, so they are what Save waits for.
 */
export default function ChangeAddressDialog({
  current,
  open,
  onOpenChange,
  onSave,
  busy = false,
  error = null,
}: {
  current: MailingAddress;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (next: MailingAddress) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [next, setNext] = useState<MailingAddress>(current);

  useEffect(() => {
    if (open) setNext(current.line1 ? current : EMPTY_ADDRESS);
  }, [open, current]);

  const set = (patch: Partial<MailingAddress>) => setNext((prev) => ({ ...prev, ...patch }));
  const ready = Boolean(next.line1.trim() && next.city.trim() && next.state.trim() && next.postalCode.trim());

  const field = (label: string, key: keyof MailingAddress, placeholder: string, extra?: string) => (
    <label className={extra}>
      <span className="c-label mb-[6px] block">{label}</span>
      <input
        className="c-field w-full"
        value={next[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<MailingAddress>)}
        placeholder={placeholder}
        autoComplete={AUTOCOMPLETE[key]}
      />
    </label>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Home address"
      description="Where Clear posts anything it sends you."
      footer={
        <>
          {error && <p className="c-det c-errline mb-s1">{error}</p>}
          <Btn primary lg disabled={!ready || busy} onClick={() => onSave(next)}>
            {busy ? 'Saving…' : 'Save address'}
          </Btn>
          <p className="c-det mt-s1 text-center">
            Used to post your card. Clear never shows it to another member.
          </p>
        </>
      }
    >
      {field('Street address', 'line1', '1420 Orange St')}
      <div className="mt-s2">{field('Apartment or unit', 'line2', 'Optional')}</div>
      <div className="mt-s2 grid grid-cols-[minmax(0,1fr)_92px] gap-s1">
        {field('City', 'city', 'Redlands')}
        {field('State', 'state', 'CA')}
      </div>
      <div className="mt-s2">{field('ZIP', 'postalCode', '92374')}</div>
    </Modal>
  );
}

const AUTOCOMPLETE: Record<keyof MailingAddress, string> = {
  line1: 'address-line1',
  line2: 'address-line2',
  city: 'address-level2',
  state: 'address-level1',
  postalCode: 'postal-code',
};
