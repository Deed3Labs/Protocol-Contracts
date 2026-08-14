import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Modal from '@/components/clear/Modal';
import InfoBlock from '@/components/clear/InfoBlock';

/**
 * Change phone number.
 *
 * The warning isn't boilerplate: with no password, the phone is the credential.
 * Someone changing it needs to know that before they type a number they can't
 * receive on, not after.
 */
export default function ChangePhoneDialog({
  current,
  open,
  onOpenChange,
}: {
  current: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [next, setNext] = useState('');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Change phone number"
      description="Enter a new number. We'll send a code to it before switching."
    >
      <p className="mb-3.5 text-xs text-foreground-secondary">
        We&rsquo;ll text a code to the new number before switching.
      </p>

      <label className="mb-1.5 block text-xs text-foreground-secondary" htmlFor="current-phone">
        Current
      </label>
      <Input id="current-phone" value={current} readOnly className="mb-3 text-muted-foreground" />

      <label className="mb-1.5 block text-xs text-foreground-secondary" htmlFor="new-phone">
        New number
      </label>
      <Input
        id="new-phone"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="(909) 555-0193"
        className="mb-3.5"
      />

      <InfoBlock tone="neutral" className="mb-3.5 text-[11px]">
        This is how you sign in. If you lose access to both your phone and email, recovery takes
        several days.
      </InfoBlock>

      <Button size="xs" className="w-full" disabled={!next.trim()}>
        Send code
      </Button>
    </Modal>
  );
}
