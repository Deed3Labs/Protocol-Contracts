import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Snowflake, Sun, Eye, EyeOff, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ClearCardFace from '@/components/clear/ClearCardFace';
import { CompositionBar, LegendRow } from '@/components/clear/CompositionBar';
import { totalsByCategory, CATEGORY_LABEL, type MerchantCategory } from '@/lib/mccCategory';
import CardControlsCard from '@/components/clear/CardControlsCard';
import LimitBreakdown from '@/components/clear/LimitBreakdown';
import TransactionRows from '@/components/clear/TransactionRows';
import TransactionDetailDialog from '@/components/clear/TransactionDetailDialog';
import { CARD_DAY_ONE } from '@/data/clearPlaceholder';
import { money } from '@clear/domain';
import type { ActivityRow, CardData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Card — design spec §9.
 *
 * The transactions here are card-only, which is what separates this page from
 * Activity: Activity shows everything that moved, this shows what the card did.
 *
 * Freeze holds UI state only. Nothing is issued yet, so there is no issuer call
 * to make — when card issuing goes live this is the seam that needs wiring, and
 * the control should go into a pending state until the issuer confirms.
 */
export default function CardPage({
  data = CARD_DAY_ONE,
  onActivate,
  onToggleFreeze,
  busy = false,
  notice = null,
  onAddToWallet,
  onAddCard,
  onRevealDetails,
}: {
  data?: CardData;
  /** Issues the card. Absent in the preview harness, where the page stands alone. */
  onActivate?: () => void;
  onToggleFreeze?: (frozen: boolean, cardId?: string) => void;
  busy?: boolean;
  /** Why the last action did not do what it looked like it would. Absent when nothing went wrong. */
  notice?: string | null;
  onAddToWallet?: () => void;
  onAddCard?: () => void;
  /** Fetches the issuer's short-lived card-details URL. Absent in the preview harness. */
  onRevealDetails?: (cardId?: string) => Promise<string | undefined>;
}) {
  const [frozen, setFrozen] = useState(data.frozen);

  /*
   * The reveal lives on the card, not in a dialog.
   *
   * The dialog rendered `card.pan`, which nothing ever fills for a real card — so it showed the
   * placeholder's number or nothing. A card number belongs on the card, and the countdown goes in
   * the type tag, which already reads as status: no new element appears and the card never jumps.
   */
  const [revealSeconds, setRevealSeconds] = useState(0);
  const [embedUrl, setEmbedUrl] = useState<string | undefined>(undefined);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const dragStart = useRef<number | null>(null);
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const card = { ...data, frozen };

  useEffect(() => {
    if (revealSeconds <= 0) return;
    const id = setTimeout(() => setRevealSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [revealSeconds]);

  // The URL is short-lived and single-use, so it is dropped the moment the reveal ends rather than
  // kept for a second look: a live link to a card number is not a thing to leave lying in state.
  useEffect(() => {
    if (revealSeconds === 0) setEmbedUrl(undefined);
  }, [revealSeconds]);

  // Follow the server once it answers. The toggle below moves immediately so the card reads as
  // responsive, but the server is what decides — and if the freeze failed, the card must not go on
  // claiming it is frozen when the network still says otherwise.
  useEffect(() => {
    setFrozen(data.frozen);
  }, [data.frozen]);

  /*
   * Two cards stack rather than sitting in a row.
   *
   * The one behind is scaled and darkened — a wallet, not a gallery — and it makes the swipe
   * affordance obvious without a hint. It also hides its number: only the front card exposes a PAN,
   * which is both the honest reading of a wallet and one less thing on screen in a coffee shop.
   */
  const wallet = card.cards?.length ? card.cards : [];
  const active = wallet[activeIndex] ?? wallet[0];
  const faceCard = active
    ? { ...card, variant: active.variant, last4: active.last4, frozen: active.frozen }
    : card;

  const activeFrozen = active?.frozen ?? frozen;

  /*
   * A wallet, not a gallery.
   *
   * Up to three cards, each behind the last at a slight angle. The angles are the point: perfectly
   * stacked rectangles read as one thick card, and it was not obvious there was anything behind the
   * front one — the card behind showed as a blank sliver, which looked like a rendering fault
   * rather than a second card.
   *
   * Three is the cap because a fourth adds nothing a member can act on: they can already see there
   * is more than one and the pager says how many. Alternating angles rather than fanning one way,
   * so a wallet of three does not lean over.
   */
  /*
   * The cards behind peek ABOVE the front one, not below it.
   *
   * Offset downward they showed their bottom edge — which on this design carries nothing, so a
   * second card read as a blank purple sliver and looked like a rendering fault. Their top edge is
   * where the mark and the type tag are, and those are what make it obvious a second card is there
   * at all.
   */
  const DEPTH = [
    { rotate: 0, y: 0, scale: 1, brightness: 1 },
    { rotate: -3.4, y: -14, scale: 0.955, brightness: 0.9 },
    { rotate: 2.6, y: -25, scale: 0.915, brightness: 0.82 },
  ];

  const behindCards = wallet
    .map((c, i) => ({ c, depth: (i - activeIndex + wallet.length) % wallet.length }))
    .filter((entry) => entry.depth > 0 && entry.depth < DEPTH.length)
    // Deepest first, so the DOM order is the stacking order and no z-index is needed.
    .sort((a, b) => b.depth - a.depth);

  const stack = (
    // Padded for the cards leaning out above; without it they clip against whatever is over them.
    <div className="relative pt-7">
      {behindCards.map(({ c, depth }) => {
        const d = DEPTH[depth];
        return (
          <div
            key={c.id}
            aria-hidden
            className="absolute inset-x-0 top-7"
            style={{
              transform: `translateY(${d.y}px) scale(${d.scale}) rotate(${d.rotate}deg)`,
              filter: `brightness(${d.brightness}) saturate(.92)`,
              transition: 'transform .45s cubic-bezier(.2,.8,.2,1), filter .45s',
            }}
          >
            {/*
              * The cards behind show their face but not their number — the honest reading of a
              * wallet, and one less thing on screen in a coffee shop. They are not blank: the mark
              * and the type tag are what make it obvious a second card is there at all.
              */}
            <ClearCardFace behind card={{ ...card, variant: c.variant, frozen: c.frozen, last4: c.last4 }} />
          </div>
        );
      })}
      <div
        className="relative touch-pan-y"
        style={{
          // Rotates as it moves, the way a card being pulled off a stack does. Purely a drag
          // affordance: at rest both are zero and the transition takes over.
          transform: `translateX(${dragX}px) rotate(${dragX / 26}deg)`,
          transition: dragging ? 'none' : 'transform .45s cubic-bezier(.2,.8,.2,1)',
        }}
        onPointerDown={(e) => {
          if (wallet.length < 2 || revealSeconds > 0) return;
          dragStart.current = e.clientX;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragStart.current === null) return;
          setDragX(e.clientX - dragStart.current);
        }}
        onPointerUp={() => {
          const moved = dragX;
          dragStart.current = null;
          setDragging(false);
          setDragX(0);
          // A quarter of a card is far enough to mean it; less is a tap that wandered.
          if (Math.abs(moved) > 70) {
            setActiveIndex((i) => (moved < 0 ? (i + 1) % wallet.length : (i - 1 + wallet.length) % wallet.length));
          }
        }}
        onPointerCancel={() => {
          dragStart.current = null;
          setDragging(false);
          setDragX(0);
        }}
      >
        <ClearCardFace
          card={faceCard}
          revealNumber={revealSeconds > 0}
          hidesInSeconds={revealSeconds > 0 ? revealSeconds : undefined}
          embedUrl={embedUrl}
        />
      </div>

    </div>
  );

  /*
   * The pager: a line for where you are, dots for where you are not.
   *
   * Only drawn when there is more than one card. A pager under a single card is an affordance for
   * something that cannot happen, and a member would try it.
   */
  const pager = wallet.length > 1 && (
    <div className="my-3 flex justify-center gap-[5px]">
      {wallet.map((c, i) => (
        <button
          key={c.id}
          type="button"
          aria-label={`Show ${c.variant} card ending ${c.last4}`}
          aria-current={i === activeIndex}
          onClick={() => setActiveIndex(i)}
          className={cn(
            'h-[5px] rounded-full transition-all',
            i === activeIndex ? 'w-[17px] bg-foreground' : 'w-[5px] bg-border-strong',
          )}
        />
      ))}
    </div>
  );

  /*
   * Three tiles, which are the only controls on the page — so they should not look like the
   * readouts around them. Freeze stays neutral, because it is the one that undoes something and
   * should not read as a suggestion.
   */
  const tiles = card.activated && (
    <div className="mb-4 grid grid-cols-3 gap-[7px]">
      {[
        {
          key: 'details',
          label: revealSeconds > 0 ? 'Hide' : 'Show details',
          icon: revealSeconds > 0 ? EyeOff : Eye,
          tinted: true,
          // Never disabled: without an issuer URL the reveal still shows what the card knows, and
          // the preview harness has no handler at all. A dead-looking primary control is worse
          // than one that reveals a masked number.
          soon: false,
          onClick: async () => {
            if (revealSeconds > 0) {
              setRevealSeconds(0);
              return;
            }
            const url = await onRevealDetails?.(active?.id);
            if (url) setEmbedUrl(url);
            // Revealed either way: without an issuer URL the placeholder number shows, which is
            // what the preview harness is for. A real card with no URL reveals nothing and says so
            // by staying masked.
            setRevealSeconds(30);
          },
        },
        {
          key: 'freeze',
          label: activeFrozen ? 'Unfreeze' : 'Freeze',
          icon: activeFrozen ? Sun : Snowflake,
          tinted: false,
          onClick: () => {
            const next = !activeFrozen;
            setFrozen(next);
            // The card on screen, not the first one in the wallet.
            onToggleFreeze?.(next, active?.id);
          },
        },
        /*
         * Apple Wallet provisioning is not built — it needs a push-provisioning payload from the
         * issuer, which is its own piece of work. Shown disabled rather than hidden: the member
         * should know the card can go in their wallet, and a button that looks live and does
         * nothing is the failure this page had twice already.
         */
        { key: 'wallet', label: 'Wallet', icon: CreditCard, tinted: true, onClick: onAddToWallet, soon: !onAddToWallet },
      ].map((tile) => (
        <button
          key={tile.key}
          type="button"
          disabled={busy || tile.soon}
          title={tile.soon ? 'Coming soon' : undefined}
          onClick={tile.onClick}
          className={cn(
            'rounded-xl border border-border px-2 py-3.5 text-center transition-colors disabled:opacity-60',
            // Freeze is transparent, not filled: it is the one control that undoes something, and a
            // filled button reads as the thing to press.
            tile.tinted ? 'bg-tier-boost/10 text-tier-boost-fg' : 'bg-transparent text-foreground',
          )}
        >
          <tile.icon className="mx-auto h-[17px] w-[17px]" strokeWidth={1.7} />
          <p className="mt-1.5 text-[11.5px]">{tile.label}</p>
        </button>
      ))}
    </div>
  );

  /** The list, where the masked numbers are told apart by where each card lives. */
  const cardList = wallet.length > 0 && (
    <>
      <p className="mb-2 text-[10px] uppercase tracking-[.5px] text-muted-foreground">Your cards</p>
      <div className="rounded-xl border border-border px-4">
        {wallet.map((c, i) => (
          <div
            key={c.id}
            className={cn(
              'flex items-center justify-between py-3',
              i < wallet.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-[13.5px] capitalize">
                {c.variant} · ••••{c.last4}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{c.where}</p>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10.5px]',
                c.frozen
                  ? 'border-border text-muted-foreground'
                  : 'border-tier-savings/40 bg-tier-savings/10 text-tier-savings-fg',
              )}
            >
              {c.frozen ? 'Frozen' : 'Active'}
            </span>
          </div>
        ))}
      </div>
    </>
  );

  const activate = !card.activated && (
    <div className="space-y-2">
      <Button variant="clear" size="xs" className="w-full" disabled={busy} onClick={onActivate}>
        {busy ? 'Activating…' : 'Activate card'}
      </Button>
      {/* Sits under the button that failed, not in a toast — the member is looking here. */}
      {notice && (
        <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );


  /*
   * Spending from — what a tap will draw on.
   *
   * This was rows of text; it is one figure, one bar and a short legend. The bar runs cheapest to
   * dearest left to right and cash owns the deepest colour, so the order the waterfall spends in is
   * the order it reads in.
   *
   * Each line carries its price rather than its mechanics — "free", "0.65%", "1.5%" — which is four
   * words where there were two sentences. A tier the member has not added shows hollow and says
   * Off: it stays on the list because it is something they can turn on, not because it is
   * spendable.
   */
  const cardCash = data.cardCash;
  const spendingFrom = data.tiers && data.tiers.length > 0 && (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[.5px] text-muted-foreground">Spending from</span>

      </div>
      <p className="mb-0.5 text-[11px] text-muted-foreground">{cardCash != null ? 'Spendable' : 'Credit available'}</p>
      <p className="m-0 text-[30px] font-medium tracking-[-.9px]">
        {money(cardCash != null ? cardCash : (data.creditAfterCash ?? 0))}
      </p>
      {cardCash != null && (data.creditAfterCash ?? 0) > 0 && (
        <p className="mb-3 mt-1.5 text-xs text-muted-foreground">then {money(data.creditAfterCash ?? 0)} of credit</p>
      )}
      <CompositionBar
        className="mb-1"
        segments={[
          // No cash segment when there is no readable card balance: an absent bar beats a wrong one.
          ...(cardCash != null ? [{ value: cardCash, color: 'rgb(var(--tier-cash))', label: 'Cash' }] : []),
          ...data.tiers.filter((t) => t.added).map((t) => ({
            value: Math.max(0, t.limit - t.used),
            color: `rgb(var(--tier-${t.key}))`,
            label: t.shortLabel ?? t.label,
          })),
        ]}
      />
      <div>
        {cardCash != null && <LegendRow color="rgb(var(--tier-cash))" label="Cash" value={money(cardCash)} />}
        {data.tiers.map((tier) => (
          <LegendRow
            key={tier.key}
            color={`rgb(var(--tier-${tier.key}))`}
            label={`${tier.shortLabel ?? tier.label} · ${tier.rate}`}
            value={tier.added ? money(Math.max(0, tier.limit - tier.used)) : 'Off'}
            off={!tier.added}
          />
        ))}
      </div>
    </div>
  );


  /*
   * The same bar as Spending from, doing a different job.
   *
   * Above it splits what a member CAN spend; here what they DID. One visual idea reused rather than
   * two invented, and the second reads instantly because they learned it on the first.
   *
   * Only rendered when the rows carry a category. A card transaction gets one from the merchant
   * category code the network sent; nothing else does, and a bar assembled from rows without one
   * would be a picture of our ignorance.
   */
  const categorised = card.transactions.filter((row): row is typeof row & { category: MerchantCategory } =>
    row.category != null,
  );
  const categoryTotals = totalsByCategory(categorised);
  const categoryBar = categoryTotals.length > 1 && (
    <>
      <CompositionBar
        className="mb-2"
        segments={categoryTotals.map(({ category, total }) => ({
          value: total,
          color: `rgb(var(--cat-${category}))`,
          label: CATEGORY_LABEL[category],
        }))}
      />
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-foreground-secondary">
        {categoryTotals.map(({ category, total }) => (
          <span key={category} className="flex items-center gap-1.5">
            <i
              className="inline-block h-[7px] w-[7px] rounded-full"
              style={{ background: `rgb(var(--cat-${category}))` }}
            />
            {CATEGORY_LABEL[category]} {money(total)}
          </span>
        ))}
      </div>
    </>
  );

  const transactions = (
    <div className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[.5px] text-muted-foreground">On this card</span>
        {card.transactions.length > 0 && (
          <span className="flex items-baseline gap-3">
            <span className="text-[11.5px] text-muted-foreground">
              {card.transactions.length} {card.transactions.length === 1 ? 'purchase' : 'purchases'}
            </span>
            {/* Activity is the everything list; this panel is the card's slice of it. */}
            <Link to="/activity" className="text-[11.5px] text-tier-boost-fg underline">
              See all
            </Link>
          </span>
        )}
      </div>

      {card.transactions.length === 0 ? (
        /*
         * An empty state that says what to expect, not that there is nothing.
         *
         * "No card spending yet." is the truth and it is useless: it reads as a dead panel and
         * leaves a member wondering whether the page is broken, whether the card works, or whether
         * they are meant to do something. Each of the three states below answers exactly one
         * question, which is the one the member actually has at that moment.
         */
        <div className="py-2">
          <p className="text-[13px] text-foreground">
            {!card.activated
              ? 'Nothing here yet'
              : frozen
                ? 'Frozen, so nothing new will land'
                : 'Ready when you are'}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {!card.activated
              ? 'Activate your card and everything you buy with it shows up here — what you spent, where, and which part came from your own money.'
              : frozen
                ? 'Unfreeze the card and purchases start appearing here again. Anything already spent stays where it was.'
                : 'Tap or paste your card anywhere and the purchase lands here within seconds, split by what paid for it.'}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-0.5 text-[11px] text-muted-foreground">{card.period || 'This month'}</p>
          <p className="m-0 mb-3 text-[25px] font-medium tracking-[-.6px]">{money(card.periodTotal)}</p>
          {categoryBar}
          <TransactionRows showDate onSelect={setSelected} rows={card.transactions} emptyMessage="" />
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div>
          {/*
             * Mobile puts "Add a card" in the page header and drops the list below.
             *
             * The reference's reasoning, which holds: on a phone the swipe already tells you there
             * is more than one, so a second list of the same cards is a screen's worth of
             * repetition. The action is the part worth keeping, and the header is where it goes.
             */}
          {card.activated && onAddCard && (
            <div className="mb-2 flex items-baseline justify-between lg:hidden">
              <span className="text-[10px] uppercase tracking-[.5px] text-muted-foreground">Your cards</span>
              <button type="button" className="text-[11.5px] text-tier-boost-fg underline" onClick={onAddCard}>
                Add a card
              </button>
            </div>
          )}
          {stack}
          {pager}
          {/* One card: the pager is absent, so the tiles need the space back. */}
          <div className={wallet.length > 1 ? '' : 'mt-3.5'}>{tiles}</div>
          {activate}
          <div className="hidden lg:block">{cardList}</div>
          {card.activated && onAddCard && (
            <Button variant="clear" size="xs" className="mt-2.5 hidden w-full text-xs lg:block" onClick={onAddCard}>
              Add a virtual card
            </Button>
          )}
          {card.activated && <div className="mt-4"><CardControlsCard card={card} /></div>}
          {/* Mobile reads the card, its controls, then the two readouts. */}
          <div className="mt-4 flex flex-col gap-4 lg:hidden">
            {spendingFrom}
            {transactions}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground lg:hidden">
            Spends your cash first, then your credit line. No transfers needed.
          </p>
        </div>
        <div className="hidden lg:flex lg:flex-col lg:gap-4">
          {spendingFrom}
          {transactions}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Spends your cash first, then your credit line. No transfers needed.
          </p>
        </div>
      </div>

      {data.backing && (
        <LimitBreakdown backing={data.backing} open={breakdownOpen} onOpenChange={setBreakdownOpen} />
      )}
      {selected && (
        <TransactionDetailDialog
          row={selected}
          open={selected !== null}
          onOpenChange={(o) => !o && setSelected(null)}
        />
      )}
    </>
  );
}
