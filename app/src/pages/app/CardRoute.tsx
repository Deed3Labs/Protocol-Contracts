import { useCallback, useEffect, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    void getCards().then((cards) => {
      if (cancelled) return;
      // The newest card is the one on screen. Multiple cards are a later surface.
      setCard(cards[0] ?? null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activate = useCallback(async () => {
    setBusy(true);
    try {
      const created = await createCard('Clear card');
      if (created) setCard(created);
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleFreeze = useCallback(
    async (frozen: boolean) => {
      if (!card) return;
      setBusy(true);
      try {
        const updated = await setCardFrozen(card.token, frozen);
        // Only trust the server's answer. A freeze that failed must not leave the card looking
        // frozen — a member who thinks their card is dead and it is not is worse off than one who
        // can see it failed and tries again.
        if (updated) setCard(updated);
        else setCard({ ...card });
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

  return <CardPage data={data} onActivate={activate} onToggleFreeze={toggleFreeze} busy={busy} />;
}
