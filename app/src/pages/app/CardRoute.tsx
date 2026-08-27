import { useCallback, useEffect, useState } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import CardPage from './CardPage';
import { CARD_DAY_ONE } from '@/data/clearPlaceholder';
import { createCard, getCards, setCardFrozen, getCredit, getCardTransactions, getCardEmbedUrl, type CardTransaction, type CreditState, type MemberCard } from '@/utils/apiClient';
import { categoryForMcc } from '@/lib/mccCategory';
import type { ActivityRow } from '@/lib/clearModel';
import { onChainStale } from '@/lib/chainStale';
import { toCreditTiers } from '@/lib/creditMapping';
import { useAppKitAccount } from '@/lib/walletCompat';

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
export default function CardRoute() {
  const [cards, setCards] = useState<MemberCard[]>([]);
  const card = cards[0] ?? null;
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const identity = useIdentity();
  const { address } = useAppKitAccount();
  const [credit, setCredit] = useState<CreditState | null>(null);
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
        if (!cancelled) setCredit(result);
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

  const toggleFreeze = useCallback(
    async (frozen: boolean) => {
      if (!card) return;
      setBusy(true);
      try {
        const { value: updated, error, unavailable } = await setCardFrozen(card.token, frozen);
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
    [card],
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
      // Same call as activation — issuing a second virtual card is issuing a card. Passing the
      // handler is what makes the button appear at all, so it cannot render as a dead control.
      onAddCard={activate}
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
        return (await getCardEmbedUrl(token)) ?? undefined;
      }}
    />
  );
}
