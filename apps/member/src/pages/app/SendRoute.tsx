import { useEffect, useState } from 'react';
import SendPage from './SendPage';
import { useChargeHistory } from '@/hooks/useChargeHistory';
import { useChargePayments } from '@/hooks/useChargePayments';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { useCycleStart } from '@/hooks/useCycleStart';
import { networkSpend } from '@/lib/activityCycle';
import { useAppKitAccount } from '@/lib/walletCompat';
import { useClearBalances } from '@/hooks/useClearBalances';
import { SEND_DAY_ONE } from '@/data/clearPlaceholder';
import { useContacts, type Contact as SavedContact } from '@/context/ContactsContext';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { listSendTransfers } from '@/utils/apiClient';
import { oldestUnclaimed } from '@/lib/sendClaims';
import type { Contact, PendingClaim } from '@/lib/clearModel';

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
 * Kept in the network is this cycle's Clear partner spending (paid now and over time, from their
 * charges) and money sent to other members (from the chain). Partners and the pay-from copy stay on
 * placeholder: the first needs a partner directory that does not exist yet.
 */
export default function SendRoute() {
  const { address } = useAppKitAccount();
  // Shop charges, the page's last cell: the latest few, and the way to all of them.
  const charges = useChargeHistory(address);
  const chargePayments = useChargePayments(address);
  const { items, loading } = useClearTransactions();
  const startMs = useCycleStart(address);
  const data = useSendData();
  const network = networkSpend(
    items,
    { charges, paidNowTx: chargePayments.map((p) => p.txHash).filter((h): h is string => Boolean(h)) },
    startMs,
  );
  return (
    <SendPage
      data={loading && network.payments === 0 ? data : { ...data, keptInNetwork: network.kept, networkPayments: network.payments }}
      charges={charges}
    />
  );
}

/** The live Send data — shared with the full-screen code and the contacts list. */
export function useSendData() {
  const { cash, loading: balancesLoading } = useClearBalances();
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
    // Available is Ready to allocate. At partners has no source yet, so it stays at day one's zero.
    ...(balancesLoading ? {} : { available: cash }),
  };

  return data;
}

/**
 * A saved contact as the Send page reads one.
 *
 * `pending` is the whole distinction the page cares about: a contact with a wallet can be paid
 * outright, and one without gets a claim link and an Invite action instead. That is decided by
 * whether Clear knows an address for them, which is exactly what the saved record holds.
 */
export function toSendContact(contact: SavedContact): Contact {
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
