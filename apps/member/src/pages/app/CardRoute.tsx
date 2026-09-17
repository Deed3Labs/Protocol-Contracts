import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { useTheme } from '@/context/ThemeContext';
import { useIdentity } from '@/context/IdentityContext';
import CardPage from './CardPage';
import { CARD_DAY_ONE } from '@/data/clearPlaceholder';
import { createCard, orderPhysicalCard, activateCard, getCards, setCardFrozen, getCredit, getCardTransactions, getCardEmbedUrl, getCardEmbedSession, getBankIdentity, type BankIdentity, type CardTransaction, type CreditState, type MemberCard } from '@/utils/apiClient';
import { categoryForMcc } from '@/lib/mccCategory';
import type { ActivityRow, CardStage } from '@/lib/clearModel';
import { onChainStale } from '@/lib/chainStale';
import { toCreditTiers, toLimitBacking } from '@/lib/creditMapping';
import { useAppKitAccount } from '@/lib/walletCompat';
import { keepLastGood } from '@/lib/keepLastGood';

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
 * Live Card — the first page whose controls are real.
 *
 * Cards are the one part of the Lithic integration that works without Financial Accounts, so
 * issuing, freezing and unfreezing genuinely happen here: the button talks to Lithic and the answer
 * comes back from Lithic. What is still placeholder is everything that needs a BALANCE — the
 * transactions list, the period total, the spend limits — because a card cannot settle until the
 * program has Financial Accounts enabled.
 *
 * So this page is deliberately half-live, and the halves are drawn along the line of what actually
 * works rather than what looks finished. The controls are real; the money is not there yet.
 */
/** A short date the way the rest of the app writes one: "Oct 26". */
const on = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : undefined;

/**
 * Where a card is, from what the issuer actually says.
 *
 * PENDING_FULFILLMENT is ordered and not yet sent to production; PENDING_ACTIVATION means it has
 * gone to be made and posted; OPEN is live. Posting itself is an event rather than a state, so a
 * card can be PENDING_ACTIVATION with no shipped date yet — it is still "ordered" to a member,
 * because nothing has left the building.
 *
 * A virtual card is live the moment it exists and never has any of this.
 */
function stageOf(card: MemberCard): CardStage {
  if (card.type !== 'PHYSICAL') return 'live';
  if (card.state === 'OPEN' || card.state === 'PAUSED') return 'live';
  return card.shippedAt ? 'posted' : 'ordered';
}

/** What a member is told to expect: an estimate, from the day it was posted. */
function arrivesAbout(shippedAt: string | null): string | undefined {
  if (!shippedAt) return undefined;
  const eta = new Date(shippedAt);
  eta.setDate(eta.getDate() + 6);
  return on(eta.toISOString());
}

export default function CardRoute() {
  const [cards, setCards] = useState<MemberCard[]>([]);
  const card = cards[0] ?? null;
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const identity = useIdentity();
  const { address } = useAppKitAccount();
  const member = useMemberProfile();
  const { theme } = useTheme();
  const [credit, setCredit] = useState<CreditState | null>(null);
  /** The card the New card sheet just made, so its last step can show what happened. */
  const [newCard, setNewCard] = useState<{ kind: 'virtual' | 'physical'; last4: string; label?: string } | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  /*
   * Where a physical card would be posted.
   *
   * The member's own address first — Personal information is the one place the app holds one, and
   * the sheet reads it rather than asking again, so a shipping address cannot quietly diverge from
   * what the identity record says. The linked bank's is the fallback for a member who has not
   * filled one in but whose bank knows it. Neither means the sheet says so and cannot order.
   */
  const [identityAddress, setIdentityAddress] = useState<BankIdentity['address']>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [pinSession, setPinSession] = useState<{ session: string; environment: 'sandbox' | 'production' } | undefined>(undefined);
  const [spend, setSpend] = useState<CardTransaction[] | null>(null);

  /*
   * What the card spent, from our own approved authorizations.
   *
   * The list was hardcoded to `[]` for every real card, so a member with a card saw "no card
   * spending yet" forever. Nothing needed fetching from Lithic: every approval already passes
   * through our Auth Stream handler, which writes the amount, the merchant and which tiers paid.
   */
  useEffect(() => {
    let cancelled = false;
    void getCardTransactions().then(({ value }) => {
      if (!cancelled) setSpend(value ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * The tiers behind "Spending from", read the same way Home reads them and re-read on the same
   * signal — a card's spending power moves the moment a deposit is pledged.
   */
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

  useEffect(() => {
    let cancelled = false;
    void getCards().then(({ value, error, unavailable }) => {
      if (cancelled) return;
      /*
       * A failed read is not an empty account.
       *
       * This page renders "no cards" as an **Activate card** button, and getCards used to answer
       * `[]` for both — so a member who has a card was invited to create one whenever the read
       * hiccuped. That is not a missing message, it is the page asserting something false about
       * their account, and it is the worse half of this bug.
       *
       * `loaded` therefore stays false on failure: the placeholder holds, and the notice explains.
       */
      if (error) {
        setNotice(
          unavailable
            ? "Cards aren't switched on yet. Nothing to do — we'll enable this for your account."
            : "Couldn't load your card just now. It hasn't changed — pull to refresh in a moment.",
        );
        return;
      }
      // The newest card is the one on the face; the rest sit behind it and in the list.
      setCards(value ?? []);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Activate, and say what happened either way.
   *
   * This used to be `if (created) setCard(created)` — so a failure was indistinguishable from not
   * having pressed the button. The server was answering 503 'Cards unavailable' the whole time and
   * the member saw a spinner stop and nothing change.
   *
   * The two failures read differently on purpose. Cards being switched off is not something a
   * member can retry, and telling them to try again would be sending them round a loop that cannot
   * end.
   */
  const activate = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { value: created, error, unavailable, needsSetup } = await createCard('Clear card');
      if (created) {
        setCards((prev) => [created, ...prev]);
        return;
      }
      /*
       * "Not provisioned" is now something the member can act on.
       *
       * It used to be a dead end, because there was no way to become provisioned. There is one now,
       * and this is the third entry point the design names — card activation, for a member who
       * saved first and never borrowed. Same modal as Settings; the closing screen differs because
       * the status differs, not because the caller does.
       */
      if (needsSetup && identity.status.actionable) {
        identity.openVerification();
        return;
      }
      setNotice(
        unavailable || needsSetup
          ? // An unset API key is not something a member can do anything about, and the difference
            // between that and an unbuilt step matters to us and not at all to them.
            "Card setup isn't finished for your account yet. Nothing to do here — we'll let you know when it's ready."
          : `That didn't go through. ${error ?? 'Please try again.'}`,
      );
    } finally {
      setBusy(false);
    }
  }, [identity]);

  // Read once, and only to fill the shipping review — a card cannot be posted to an address the
  // identity record has never seen.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void getBankIdentity(address).then((identityRecord) => {
      if (!cancelled) setIdentityAddress(identityRecord.address);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  /**
   * A new card, of the kind the sheet asked for.
   *
   * Virtual is issued now and the label is the member's own memo. Physical is posted, and its
   * shipping comes from the identity record rather than from the sheet.
   */
  /** What the shipping label would say: the member's own, then the bank's. */
  const shipping = useMemo(() => {
    const own = member.mailingAddress;
    if (own.line1) {
      return {
        address1: own.line1,
        address2: own.line2 || undefined,
        city: own.city,
        state: own.state,
        postalCode: own.postalCode,
      };
    }
    if (!identityAddress?.address1) return null;
    return {
      address1: identityAddress.address1,
      city: identityAddress.city ?? '',
      state: identityAddress.state ?? '',
      postalCode: identityAddress.postalCode ?? '',
    };
  }, [member.mailingAddress, identityAddress]);

  const addCard = useCallback(
    async (kind: 'virtual' | 'physical', label: string) => {
      setBusy(true);
      setAddError(null);
      try {
        if (kind === 'physical') {
          const parts = (member.legalName || member.name || '').trim().split(/\s+/);
          if (!shipping || parts.length < 2) {
            setAddError('We need your name and address on Personal information before a card can be posted.');
            return;
          }
          const { value: ordered, error } = await orderPhysicalCard(
            { firstName: parts[0], lastName: parts.slice(1).join(' '), ...shipping },
            label || undefined,
          );
          if (!ordered) {
            setAddError(error ?? "That didn't go through. Please try again.");
            return;
          }
          setCards((prev) => [...prev, ordered]);
          setNewCard({ kind: 'physical', last4: ordered.lastFour ?? '', label: label || undefined });
          return;
        }
        const { value: created, error } = await createCard(label || 'Clear card');
        if (!created) {
          setAddError(error ?? "That didn't go through. Please try again.");
          return;
        }
        setCards((prev) => [...prev, created]);
        setNewCard({ kind: 'virtual', last4: created.lastFour ?? '', label: label || undefined });
      } finally {
        setBusy(false);
      }
    },
    [shipping, member.legalName, member.name],
  );

  /**
   * The card that came in the post.
   *
   * The digits go to the server, which checks them against the card it posted: a member holding
   * the card is the only evidence of delivery anybody has, since no carrier tells the issuer.
   */
  const activatePosted = useCallback(
    async (cardId: string, lastFour: string) => {
      setBusy(true);
      setActivateError(null);
      try {
        const { value: updated, error } = await activateCard(cardId, lastFour);
        if (!updated) {
          setActivateError(error ?? "That didn't go through. Please try again.");
          return;
        }
        setCards((prev) => prev.map((c) => (c.token === updated.token ? updated : c)));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /*
   * Freeze the card the member is looking at, not the first one.
   *
   * This took `card` — always cards[0] — so on a wallet of three, swiping to the second and
   * pressing Freeze froze the first. The card on screen said frozen, a different card actually was,
   * and nothing on the page showed either fact correctly.
   */
  const toggleFreeze = useCallback(
    async (frozen: boolean, cardId?: string) => {
      const target = cards.find((c) => c.token === cardId) ?? card;
      if (!target) return;
      setBusy(true);
      try {
        const { value: updated, error, unavailable } = await setCardFrozen(target.token, frozen);
        /*
         * Only trust the server's answer. A freeze that failed must not leave the card looking
         * frozen — a member who believes their card is dead when it is not is worse off than one
         * who can see it failed and tries again.
         *
         * Which is exactly why the revert now comes with words. `setCard({ ...card })` sprang the
         * toggle back and said nothing, so the two possible readings — "it failed" and "I misclicked"
         * — looked identical, and the safer state was communicated as an accident.
         */
        if (updated) {
          setCards((prev) => prev.map((c) => (c.token === updated.token ? updated : c)));
          setNotice(null);
          return;
        }
        setCards((prev) => [...prev]);
        setNotice(
          unavailable
            ? "Cards aren't switched on yet, so there's nothing to freeze."
            : `Couldn't ${frozen ? 'freeze' : 'unfreeze'} your card. ${error ?? 'Please try again.'}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [card, cards],
  );


  /*
   * An authorization becomes a row.
   *
   * `paidFromLabel` comes from the draws the waterfall actually made, so the source shown beside a
   * purchase is the tier that paid it rather than a guess: one draw means one tier, several means
   * it crossed from cash into credit and the credit half is what a member needs to see.
   */
  const cardRows: ActivityRow[] = (spend ?? []).map((tx) => {
    const credited = tx.draws.filter((draw) => draw.source !== 'cash');
    return {
      id: tx.id,
      name: tx.name,
      date: new Date(tx.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      datetime: new Date(tx.at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      }),
      // The source IS the funding, which is what the row's chip reads — cash or the credit it
      // crossed into. Not 'card': every row on this page came from a card, so it would say nothing.
      source: credited.length === 0 ? 'cash' : 'credit',
      kind: 'spending',
      amount: -tx.amountCents / 100,
      category: categoryForMcc(tx.mcc),
      location: [tx.city, tx.state].filter(Boolean).join(', ') || undefined,
      paidFromLabel: credited.length === 0 ? 'Cash' : 'Credit',
      cardLast4: card?.lastFour ?? undefined,
    };
  });

  // Until the first load returns, show the placeholder rather than an un-activated card: flashing
  // "Activate card" at someone who already has one reads as their card having vanished.
  const data = !loaded
    ? CARD_DAY_ONE
    : {
        ...CARD_DAY_ONE,
        activated: Boolean(card),
        /*
         * The name embossed on the card is the member's, not the fixture's.
         *
         * It read 'Kai M' for everybody — the placeholder's display name. The verified legal name
         * first, because that is what an issuer prints and what a merchant checks; the display name
         * second, which is at least the member's own; and the placeholder only when there is no
         * member at all, which is the preview harness.
         */
        cardholder: member.legalName || member.name || CARD_DAY_ONE.cardholder,
        /*
         * Every card, for the stack and the list.
         *
         * "Where" is what distinguishes them in a list where the number is masked: a plastic card
         * is in a wallet, a virtual one lives in Apple Pay and online. That is the useful
         * difference, and it is more use than repeating the type twice.
         */
        cards: cards.map((c) => ({
          id: c.token,
          variant: (c.type === 'PHYSICAL' ? 'physical' : 'virtual') as 'physical' | 'virtual',
          last4: c.lastFour ?? '',
          frozen: c.frozen,
          where: c.type === 'PHYSICAL' ? 'In your wallet' : 'Apple Pay, online',
          stage: stageOf(c),
          orderedAt: on(c.createdAt),
          postedAt: on(c.shippedAt),
          arrivesAbout: arrivesAbout(c.shippedAt),
          tracking: c.trackingNumber ?? undefined,
        })),
        frozen: card?.frozen ?? false,
        last4: card?.lastFour ?? '',
        variant: (card?.type === 'PHYSICAL' ? 'physical' : 'virtual') as 'physical' | 'virtual',
        // Real once the card can settle. Showing placeholder spending against a real card would be
        // inventing transactions that never happened.
        ...(card
          ? {
              transactions: cardRows,
              // The total is the rows, not a separate figure that could disagree with them.
              periodTotal: cardRows.reduce((sum, row) => sum + (row.amount < 0 ? -row.amount : 0), 0),
            }
          : { transactions: CARD_DAY_ONE.transactions, periodTotal: CARD_DAY_ONE.periodTotal }),
        /*
         * The credit half of "Spending from", from the contracts.
         *
         * `cardCash` is left undefined on purpose: the card spends its float, and USDC on the
         * member's smart wallet cannot settle an authorization. Until a card balance is readable
         * the panel shows the credit tiers alone, which is true, rather than a spendable figure the
         * card could not honour.
         */
        ...(credit?.complete
          ? {
              tiers: toCreditTiers(credit.tiers),
              // The same breakdown Home links to, from the same rows — one surface, so the two
              // pages cannot describe the limit differently.
              backing: toLimitBacking(credit.tiers, CARD_DAY_ONE.backing ?? { assetBacked: [], unsecured: [] }),
              creditAfterCash: credit.tiers
                .filter((tier) => tier.active)
                .reduce((sum, tier) => sum + Math.max(0, tier.limitCents - tier.usedCents), 0) / 100,
            }
          : {}),
      };

  return (
    <CardPage
      data={data}
      onActivate={activate}
      onToggleFreeze={toggleFreeze}
      busy={busy}
      notice={notice}
      // Passing the handler is what makes New card appear at all, so it cannot render as a dead
      // control.
      onAddCard={(kind, label) => void addCard(kind, label)}
      onActivateCard={(cardId, lastFour) => void activatePosted(cardId, lastFour)}
      activateError={activateError}
      /*
       * The issuer's PIN field, fetched when the sheet opens. It is a different kind of session
       * from the one that shows the numbers, and just as short-lived.
       */
      onSetPin={(cardId) => {
        setPinSession(undefined);
        void getCardEmbedSession(cardId, 'pin').then((s) => setPinSession(s ?? undefined));
      }}
      pinSession={pinSession}
      onTrack={(tracking) => {
        // USPS is what Lithic posts with; a tracking number is worth nothing without somewhere to
        // put it, and this is the one place a member can.
        if (tracking) window.open(`https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking)}`, '_blank', 'noopener');
      }}
      newCard={newCard}
      onNewCardDone={() => {
        setNewCard(null);
        setAddError(null);
      }}
      addError={addError}
      address={
        shipping
          ? {
              name: member.legalName || member.name,
              lines: [shipping.address1, shipping.address2, shipping.city, shipping.state, shipping.postalCode]
                .filter(Boolean)
                .join(', '),
            }
          : null
      }
      /*
       * The issuer's short-lived details URL.
       *
       * Fetched on demand and handed straight to the card face, never held here: it is a live link
       * to a card number and a minute old is a minute too long. The PAN itself never enters this
       * app at all — Lithic renders it inside its own frame.
       */
      onRevealDetails={async (cardId) => {
        const token = cardId ?? cards[0]?.token;
        if (!token) return undefined;
        /*
         * The session first, because it is the one that puts the numbers in our own rows. The old
         * whole-page URL is the fallback, and it is deprecated at Lithic — a program that cannot
         * mint a session still shows a member their card.
         */
        const session = await getCardEmbedSession(token);
        if (session) return { session };
        return { url: (await getCardEmbedUrl(token, theme)) ?? undefined };
      }}
    />
  );
}
