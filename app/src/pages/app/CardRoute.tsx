import { useCallback, useEffect, useState } from 'react';
import { useIdentity } from '@/context/IdentityContext';
import CardPage from './CardPage';
import { CARD_DAY_ONE } from '@/data/clearPlaceholder';
import { createCard, getCards, setCardFrozen, type MemberCard } from '@/utils/apiClient';

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
  const [card, setCard] = useState<MemberCard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const identity = useIdentity();

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
      // The newest card is the one on screen. Multiple cards are a later surface.
      setCard(value?.[0] ?? null);
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
        setCard(created);
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
          setCard(updated);
          setNotice(null);
          return;
        }
        setCard({ ...card });
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

  // Until the first load returns, show the placeholder rather than an un-activated card: flashing
  // "Activate card" at someone who already has one reads as their card having vanished.
  const data = !loaded
    ? CARD_DAY_ONE
    : {
        ...CARD_DAY_ONE,
        activated: Boolean(card),
        frozen: card?.frozen ?? false,
        last4: card?.lastFour ?? '',
        variant: (card?.type === 'PHYSICAL' ? 'physical' : 'virtual') as 'physical' | 'virtual',
        // Real once the card can settle. Showing placeholder spending against a real card would be
        // inventing transactions that never happened.
        transactions: card ? [] : CARD_DAY_ONE.transactions,
        periodTotal: card ? 0 : CARD_DAY_ONE.periodTotal,
      };

  return <CardPage data={data} onActivate={activate} onToggleFreeze={toggleFreeze} busy={busy} notice={notice} />;
}
