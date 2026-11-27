import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Modal from './Modal';
import Avatar from './Avatar';
import InfoBlock from './InfoBlock';
import { CONTACT_ROLE_LABEL, searchContacts, type Contact } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Name a member who can vouch for you.
 *
 * There's no password on the account, so the recovery path is other people. The
 * accent note says what it costs to skip this, and the last line says what a
 * recovery contact can't do — the objection everyone has, answered before it's
 * raised rather than in a help article.
 *
 * Only members can be chosen: someone who isn't in the co-op has no identity for
 * the co-op to check against.
 */
export default function RecoveryContactsDialog({
  contacts,
  open,
  onOpenChange,
  onChoose,
}: {
  contacts: Contact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose?: (contact: Contact) => void;
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Contact | null>(null);

  const members = contacts.filter((c) => !c.pending);
  const matched = query.trim() ? searchContacts(members, query) : members;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Recovery contacts"
      description="Choose a member who can confirm your identity if you're locked out."
    >
      <p className="mb-3.5 text-xs text-foreground-secondary">
        If you lose access to your phone and email, a recovery contact can vouch for you.
      </p>

      <InfoBlock className="mb-3.5">
        Without one, recovery takes several days and requires re-verifying your identity.
      </InfoBlock>

      <p className="mb-2 text-xs text-foreground-secondary">Choose a member you trust</p>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search members"
        aria-label="Search members"
        className="mb-3 h-9 text-xs"
      />

      <div className="mb-3.5">
        {matched.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">No members match that search.</p>
        ) : (
          matched.map((contact, i) => (
            <button
              key={contact.id}
              type="button"
              aria-pressed={chosen?.id === contact.id}
              onClick={() => setChosen(contact)}
              className={cn(
                'flex w-full items-center gap-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary/60',
                i < matched.length - 1 && 'border-b-[0.5px] border-border',
                chosen?.id === contact.id && 'text-tier-boost-fg',
              )}
            >
              <Avatar id={contact.id} initials={contact.initials} />
              <span className="min-w-0">
                <span className="block truncate">{contact.name}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {CONTACT_ROLE_LABEL[contact.role]}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {chosen && (
        <Button size="xs" className="mb-3 w-full" onClick={() => onChoose?.(chosen)}>
          Ask {chosen.name} to be a recovery contact
        </Button>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        They can&rsquo;t see your balances or move your money — only confirm it&rsquo;s you.
      </p>
    </Modal>
  );
}
