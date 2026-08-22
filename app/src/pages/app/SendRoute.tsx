import { useEffect, useState } from 'react';
import SendPage from './SendPage';
import { SEND_DAY_ONE } from '@/data/clearPlaceholder';
import { useContacts, type Contact as SavedContact } from '@/context/ContactsContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { listSendTransfers } from '@/utils/apiClient';
import type { Contact, PendingClaim } from '@/lib/clearModel';
import type { SendTransferSummary } from '@/types/send';

/*
 * Day-one, not in-use.
 *
 * The `*_IN_USE` datasets are the DESIGN PREVIEW's populated fixtures -- a fully furnished account
 * used to show what the page looks like with money in it. Falling back to them in the real app
 * meant a member with nothing, or one whose fetch had not landed, was shown somebody else's
 * balances rendered as their own. That is not a placeholder, it is a fabrication.
 *
 * `*_DAY_ONE` is the honest base: zeros, empty lists, and products in their locked or
 * not-yet-activated state. Real figures are spread over it as they arrive, so a member who does
 * have money still never watches it flash to zero -- each field only overrides once it has been
 * read.
 */

/**
 * Live Send — the member's own handle, their real contacts, and money still waiting to be claimed.
 *
 * Partners, the kept-in-network figure and the pay-from copy stay on placeholder: the first needs
 * a partner directory that does not exist yet, and the other two are cycle-level views that want
 * the credit route.
 */
export default function SendRoute() {
  const profile = useMemberProfile();
  const { contacts } = useContacts();
  const [pendingClaim, setPendingClaim] = useState<PendingClaim | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void listSendTransfers().then((transfers) => {
      if (!cancelled) setPendingClaim(oldestUnclaimed(transfers));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handle = profile.username ? `@${profile.username}` : profile.handle;

  const data = {
    ...SEND_DAY_ONE,
    ...(handle ? { handle } : {}),
    ...(profile.address
      ? { codeUrl: `${window.location.origin}/send?to=${profile.address}` }
      : {}),
    // An empty contact list is the truth for a new member, so it is shown as empty rather than
    // backfilled -- the page has its own empty state, and inventing people to send money to is
    // worse than having none.
    ...(profile.loading ? {} : { contacts: contacts.map(toSendContact) }),
    ...(pendingClaim ? { pendingClaim } : {}),
  };

  return <SendPage data={data} />;
}

/**
 * A saved contact as the Send page reads one.
 *
 * `pending` is the whole distinction the page cares about: a contact with a wallet can be paid
 * outright, and one without gets a claim link and an Invite action instead. That is decided by
 * whether Clear knows an address for them, which is exactly what the saved record holds.
 */
function toSendContact(contact: SavedContact): Contact {
  return {
    id: contact.id,
    name: contact.name,
    contactPoint: contact.email || contact.phone || undefined,
    initials: initialsOf(contact.name),
    role: 'member',
    pending: !contact.wallet,
  };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * The oldest send that is locked but not yet collected.
 *
 * Only one is surfaced, because the page shows one banner. Oldest rather than largest: it is the
 * one closest to expiring, and expiry is the thing the member would want to act on.
 */
function oldestUnclaimed(transfers: SendTransferSummary[]): PendingClaim | undefined {
  const waiting = transfers
    .filter((t) => t.status === 'LOCK_CONFIRMED' || t.status === 'CLAIM_STARTED')
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));

  const next = waiting[0];
  if (!next) return undefined;

  const msLeft = Date.parse(next.expiresAt) - Date.now();
  return {
    amount: Number(next.principalUsdc),
    // The recipient is deliberately not stored in the clear -- the server keeps a hash of the
    // hint, not the phone number -- so the banner names the send rather than the person.
    recipient: 'someone you sent to',
    sentOn: new Date(next.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    expiresInDays: Math.max(0, Math.ceil(msLeft / 86_400_000)),
  };
}
