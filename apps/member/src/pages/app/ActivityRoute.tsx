import { useEffect, useState } from 'react';
import ActivityPage from './ActivityPage';
import { ACTIVITY_DAY_ONE } from '@/data/clearPlaceholder';
import { useClearTransactions } from '@/hooks/useClearTransactions';
import { toActivityRow } from '@/lib/activityMapping';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { useAppKitAccount } from '@/lib/walletCompat';
import { onChainStale } from '@/lib/chainStale';
import { keepLastGood } from '@/lib/keepLastGood';
import { categoriesFrom, cycleSpendFrom, merchantsFrom } from '@/lib/activityCycle';
import { oldestUnclaimed } from '@/lib/sendClaims';
import {
  getCardTransactions,
  getCredit,
  getSpendGroups,
  listSendTransfers,
  setSpendGroups,
  type CardTransaction,
  type CreditState,
} from '@/utils/apiClient';
import { merchantKey } from '@/lib/activityCycle';
import type { PendingClaim } from '@/lib/clearModel';

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
 * Live Activity — the member's real transactions, and what the cycle was made of.
 *
 * The hero and Where it went are derived rather than fetched: the credit line gives the cycle's
 * start and the carry, card authorizations give the cash-or-credit split and the merchant category,
 * and everything else that left the account — a send, a withdrawal — is cash by definition. Both
 * count every kind of movement, which is what this page consolidates, and both show zero when
 * nothing has moved rather than disappearing.
 *
 * Inside the co-op has no source yet: nothing records which payments stayed with members and
 * partners. The cell stands with an em dash rather than a figure assembled from what we do have.
 *
 * Change groups writes to the member's record rather than this page: a move is a rule about a
 * merchant, so it has to hold on every screen they open, not just this session.
 *
 * An empty list after loading is left empty rather than filled with placeholder rows. Activity is
 * the one page where nothing to show is a true and useful answer -- a new member has no history,
 * and inventing some would be the page lying about their account rather than merely decorating it.
 */
export default function ActivityRoute() {
  const { items, loading } = useClearTransactions();
  const member = useMemberProfile();
  const { address } = useAppKitAccount();
  const [credit, setCredit] = useState<CreditState | null>(null);
  const [cards, setCards] = useState<CardTransaction[]>([]);
  const [pendingClaim, setPendingClaim] = useState<PendingClaim | undefined>(undefined);
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [grouping, setGrouping] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getCardTransactions().then(({ value }) => {
      if (!cancelled) setCards(value ?? []);
    });
    void listSendTransfers().then((transfers) => {
      if (!cancelled) setPendingClaim(oldestUnclaimed(transfers));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The member's own grouping rules. They are read once and then kept in step optimistically: the
  // sheet has already shown the move, and the server's answer is the same move.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void getSpendGroups(address).then((saved) => {
      if (cancelled || !saved) return;
      setMoved(saved.groups);
      setGrouping(saved.grouping);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  // The cycle moves when the line does, so this re-reads on the same signal as Home and Card.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const read = () => {
      void getCredit(address).then((result) => {
        if (!cancelled) setCredit((prev) => keepLastGood(prev, result));
      });
    };
    read();
    const stopListening = onChainStale(read);
    return () => {
      cancelled = true;
      stopListening();
    };
  }, [address]);

  const cycleRow = credit?.complete ? credit.cycle : null;
  const startMs = cycleRow && cycleRow.issuedAt > 0 ? cycleRow.issuedAt * 1000 : 0;
  const daysLeft =
    cycleRow && cycleRow.expiration > 0
      ? Math.max(0, Math.ceil((cycleRow.expiration * 1000 - Date.now()) / 86_400_000))
      : 0;
  const cycleSpend = cycleSpendFrom(cards, items, {
    startMs,
    daysLeft,
    carryCost: (credit?.term?.carryOwedCents ?? 0) / 100,
  });
  const categories = categoriesFrom(cards, items, startMs);
  const merchants = merchantsFrom(cards, items, startMs);

  const data = loading
    ? ACTIVITY_DAY_ONE
    : {
        ...ACTIVITY_DAY_ONE,
        rows: items.map(toActivityRow),
        cycleSpend,
        categories,
        merchants,
        ...(pendingClaim ? { pendingClaim } : {}),
      };

  return (
    <ActivityPage
      data={data}
      email={member.email || undefined}
      moved={moved}
      grouping={grouping}
      onMoveMerchant={(merchant, group) => {
        setMoved((prev) => ({ ...prev, [merchantKey(merchant)]: group }));
        if (address) void setSpendGroups(address, { name: merchant, group });
      }}
      onGrouping={(on) => {
        setGrouping(on);
        if (address) void setSpendGroups(address, { grouping: on });
      }}
    />
  );
}
