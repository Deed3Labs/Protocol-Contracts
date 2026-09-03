import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from './Card';
import Modal from './Modal';

/**
 * Add a contact.
 *
 * The status card is the point of the surface: you're allowed to save someone
 * who isn't a member, and what happens when you pay them is different. Saying so
 * here — before the contact exists — is the only place it doesn't come as a
 * surprise later.
 */
export default function AddContactDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');

  // A handle only exists if they're already a member; anything else is someone
  // you'd have to invite.
  const isMember = identifier.trim().startsWith('@');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add a contact"
      description="Save someone by name and a phone number, email or Clear handle."
    >
      <label className="mb-1.5 block text-xs text-foreground-secondary" htmlFor="contact-name">
        Name
      </label>
      <Input
        id="contact-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Marcus Tate"
        className="mb-3"
      />

      <label className="mb-1.5 block text-xs text-foreground-secondary" htmlFor="contact-id">
        Phone, email, or @handle
      </label>
      <Input
        id="contact-id"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        placeholder="(909) 555-0177"
        className="mb-3.5"
      />

      <Card className="mb-3.5 px-3.5 py-3">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span className="text-xs text-foreground-secondary">Status</span>
          <span className="text-xs">{isMember ? 'Member' : 'Not a member yet'}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {isMember
            ? 'Payments to them arrive instantly, with no fee.'
            : "You can still send them money — they'll get a link and have 14 days to claim it."}
        </p>
      </Card>

      <Button size="xs" className="w-full" disabled={!name.trim() || !identifier.trim()}>
        Save contact
      </Button>
    </Modal>
  );
}
