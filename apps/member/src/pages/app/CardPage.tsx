import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Btn, CBar, CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from '@/components/clear/brand/anatomy';
import { ChevronIcon, PlusIcon, SortIcon } from '@/components/clear/brand/icons';
import MenuButton from '@/components/clear/brand/MenuButton';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import CardFace from '@/components/clear/card/CardFace';
import CardStack from '@/components/clear/card/CardStack';
import NewCardDialog, { type CardKind, type NewCardResult } from '@/components/clear/card/NewCardDialog';
import SpendsFrom from '@/components/clear/card/SpendsFrom';
import PhysicalCardState from '@/components/clear/card/PhysicalCardState';
import NoPhysicalCard from '@/components/clear/card/NoPhysicalCard';
import SetPinDialog from '@/components/clear/card/SetPinDialog';
import AdjustLimitsDialog from '@/components/clear/card/AdjustLimitsDialog';
import ReplaceCardDialog from '@/components/clear/card/ReplaceCardDialog';
import CardControlsCard from '@/components/clear/CardControlsCard';
import CardDetailsDialog from '@/components/clear/CardDetailsDialog';
import TransactionDetailDialog from '@/components/clear/TransactionDetailDialog';
import { TIER_TEXT_CLASS } from '@/components/clear/ClearCreditCard';
import { CARD_DAY_ONE } from '@/data/clearPlaceholder';
import { money, signedMoney } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { CARD_DAILY_CEILING, sourceTag, type ActivityRow, type CardData, REVERSED_ROW } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

type Sort = 'newest' | 'oldest' | 'largest';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'largest', label: 'Largest' },
];

/** The source tag's colour: the tier that paid, or nothing for cash. */
const tagClass = (row: ActivityRow) => (row.paidFromTier && row.paidFromTier !== 'boost' ? TIER_TEXT_CLASS[row.paidFromTier] : undefined);

/**
 * Card — the same shape as Savings and Earn.
 *
 * Hero: what this card spent, the key line (which card, its last four, its state) and the page's
 * actions, Freeze and Details. Then the slab: the card itself, boxed with its selector as a control
 * bar; the controls with the limits as their footer; Spends from, the waterfall, full width; and the
 * growing list, Transactions, full width at the bottom.
 *
 * The transactions here are card-only, which is what separates this page from Activity. Before the
 * card is activated the page is the activation screen.
 */
export default function CardPage({
  data = CARD_DAY_ONE,
  onActivate,
  onToggleFreeze,
  busy = false,
  notice = null,
  onAddCard,
  onActivateCard,
  activateError = null,
  onSetPin,
  pinSession,
  onTrack,
  newCard = null,
  onNewCardDone,
  addError = null,
  address = null,
  onRevealDetails,
}: {
  data?: CardData;
  /** Issues the card. Absent in the preview harness, where the page stands alone. */
  onActivate?: () => void;
  onToggleFreeze?: (frozen: boolean, cardId?: string) => void;
  busy?: boolean;
  /** Why the last action did not do what it looked like it would. Absent when nothing went wrong. */
  notice?: string | null;
  /** Makes the card. The sheet asks which kind and what to call it; the container issues it. */
  onAddCard?: (kind: CardKind, label: string) => void;
  /** Activating the card that came in the post; the digits are checked against it. */
  onActivateCard?: (cardId: string, lastFour: string) => void;
  activateError?: string | null;
  /** Opens the issuer's PIN field. Absent where there is no session to open it with. */
  onSetPin?: (cardId: string) => void;
  pinSession?: { session: string; environment: 'sandbox' | 'production' };
  /** Follows the shipment, where the post gave us something to follow. */
  onTrack?: (tracking: string) => void;
  /** The card that was just made, which turns the sheet into its last step. */
  newCard?: NewCardResult | null;
  /** Cleared when the sheet closes, so the next New card starts at the first step. */
  onNewCardDone?: () => void;
  addError?: string | null;
  /** Where a physical card would be posted, from Personal information. */
  address?: { name: string; lines: string } | null;
  /**
   * Gets whatever the issuer will give us for this card: a session for the modern embed, or the
   * old whole-page URL. Absent in the preview harness.
   */
  onRevealDetails?: (
    cardId?: string,
  ) => Promise<{ session?: { session: string; environment: 'sandbox' | 'production' }; url?: string } | undefined>;
}) {
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const wallet = data.cards?.length
    ? data.cards
    : [{ id: 'card', variant: data.variant, last4: data.last4, frozen: data.frozen, where: '' }];
  const [activeId, setActiveId] = useState(wallet[0].id);
  const active = wallet.find((c) => c.id === activeId) ?? wallet[0];

  // Freeze moves immediately so the card reads as responsive, but the server decides: when its answer
  // lands the override is dropped and the card follows it.
  const [frozenOverride, setFrozenOverride] = useState<Record<string, boolean>>({});
  useEffect(() => setFrozenOverride({}), [data.cards, data.frozen]);
  const frozen = frozenOverride[active.id] ?? active.frozen;

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | undefined>(undefined);
  const [embedSession, setEmbedSession] = useState<{ session: string; environment: 'sandbox' | 'production' } | undefined>(undefined);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  /*
   * Which kind the chooser is on.
   *
   * It follows the selected card, but it is not the same thing: a member with no physical card can
   * still choose Physical, and what they get is the state that says they could order one — rather
   * than a chooser that quietly hides the half of the product they do not have yet.
   */
  const [chosenKind, setChosenKind] = useState<'physical' | 'virtual'>(wallet[0].variant);
  const [limits, setLimits] = useState({ perTransaction: data.perTransactionLimit, perDay: data.perDayLimit });
  const [sort, setSort] = useState<Sort>('newest');
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  useSetMobileAction({ label: 'Pay', icon: PlusIcon, onSelect: () => navigate('/scan') });

  /*
   * A card still on its way is a state of that card, not of the page.
   *
   * The controls, the limits and the transactions all belong to a card that can be spent on, so a
   * physical card that has been ordered or posted takes the whole screen until it is live. Day one
   * — nothing at all — is the other end of the same idea: there is nothing to control yet.
   */
  if (!data.activated) {
    return <NoPhysicalCard dayOne busy={busy} notice={notice} onOrder={onActivate} />;
  }

  if (active.stage && active.stage !== 'live') {
    return (
      <PhysicalCardState
        stage={active.stage}
        cardholder={data.cardholder}
        expiry={data.expiry}
        network={data.network}
        last4={active.last4}
        orderedAt={active.orderedAt}
        postedAt={active.postedAt}
        arrivesAbout={active.arrivesAbout}
        tracking={active.tracking}
        busy={busy}
        notice={notice}
        error={activateError}
        onActivate={(lastFour) => onActivateCard?.(active.id, lastFour)}
        onSetPin={onSetPin ? () => setPinOpen(true) : undefined}
        onTrack={onTrack ? () => onTrack(active.tracking ?? '') : undefined}
      />
    );
  }



  const variantLabel = active.variant === 'virtual' ? 'Virtual' : 'Physical';
  const creditLimit = (data.tiers ?? []).filter((t) => t.added).reduce((sum, t) => sum + t.limit, 0);

  const openDetails = async () => {
    setDetailsOpen(true);
    // Both of these are short-lived. Anything still in hand is from a previous open and would
    // render as "Embed request expired" before the fresh one arrives.
    setEmbedUrl(undefined);
    setEmbedSession(undefined);
    if (!onRevealDetails) return;
    setLoadingDetails(true);
    try {
      const got = await onRevealDetails(active.id);
      setEmbedSession(got?.session);
      setEmbedUrl(got?.url);
    } finally {
      setLoadingDetails(false);
    }
  };

  const toggleFreeze = () => {
    const next = !frozen;
    setFrozenOverride((prev) => ({ ...prev, [active.id]: next }));
    onToggleFreeze?.(next, active.id);
  };

  // ---- Hero ---------------------------------------------------------------------------------------

  const actions = (
    <div className="c-pair">
      <Btn primary={frozen} disabled={busy} onClick={toggleFreeze}>
        {frozen ? 'Unfreeze' : 'Freeze'}
      </Btn>
      <Btn onClick={openDetails}>Details</Btn>
    </div>
  );

  const hero = (
    <div>
      <p className="c-label mb-s1">Spent on this card</p>
      <p className="c-fig text-hero-m leading-[1.05] lg:text-hero">{money(data.periodTotal, { cents: true })}</p>
      <p className="c-keyline">
        {variantLabel} <strong>{data.network}</strong>
        {active.last4 && (
          <>
            <span className="c-sep">&middot;</span>ends <strong>{active.last4}</strong>
          </>
        )}
        <span className="c-sep">&middot;</span>
        {frozen ? <span className="c-muted">Frozen</span> : <span className="c-t-sav">Active</span>}
      </p>
    </div>
  );

  // ---- Slab ---------------------------------------------------------------------------------------

  /*
   * Physical and virtual are two wallets, not two ends of one.
   *
   * The chooser used to jump to the first card of a kind and leave the rest of the stack behind it,
   * so swiping ran through both kinds and the chip stopped describing what was in front of you. It
   * filters now: the stack holds the kind you picked, and the marker counts that kind.
   */
  const variants = ['physical', 'virtual'] as const;
  const kind = wallet.filter((c) => c.variant === chosenKind);
  /*
   * The stack, read from the card you are on: the selected one in front, then the rest of its kind
   * in order after it, wrapping round. One behind is the whole depth — the marker underneath is
   * what says how many there are.
   */
  const order = kind.map((_, i) => kind[(kind.indexOf(active) + i) % kind.length]);
  const cardCell = (
    <Cell>
      <CHead>
        <SecHead label={wallet.length === 1 ? 'Your card' : 'Your cards'}>
          {/* The count describes the stack under it, which is one kind of card, and the chooser
              beside it says which. A total over a filtered stack would not match its own marker. */}
          <span className="c-det">
            {kind.length} {kind.length === 1 ? 'card' : 'cards'}
          </span>
        </SecHead>
      </CHead>
      <CBar>
        <div className="c-cardsel">
          <div className="c-qc c-split">
            {variants.map((variant) => {
              const first = wallet.find((c) => c.variant === variant);
              const on = chosenKind === variant;
              return (
                <Btn
                  key={variant}
                  className={cn('c-chip-q', on && 'c-on')}
                  aria-pressed={on}
                  onClick={() => {
                    setChosenKind(variant);
                    if (first) setActiveId(first.id);
                  }}
                >
                  {variant === 'physical' ? 'Physical' : 'Virtual'}
                </Btn>
              );
            })}
          </div>
          {onAddCard && (
            <Btn className="c-linkish" disabled={busy} onClick={() => setAddOpen(true)}>
              New card
            </Btn>
          )}
        </div>
      </CBar>
      <CMain>
        {kind.length === 0 ? (
          // Picking a kind you do not hold is how a member finds out they could: a state, not an
          // empty stack, and it says what the plastic would add over what they already have.
          <>
            <p className="text-sec">No physical card</p>
            <p className="c-det mt-[3px]">
              Your virtual cards already spend from the same limit. A physical one adds tap, chip and
              ATMs, and is posted to the address on your account.
            </p>
            {onAddCard && (
              <Btn className="mt-s2" disabled={busy} onClick={() => setAddOpen(true)}>
                Order a card
              </Btn>
            )}
          </>
        ) : (
        <CardStack
          count={kind.length}
          index={kind.indexOf(active)}
          onIndexChange={(i) => setActiveId(kind[i].id)}
        >
          {order.map((card) => (
            <CardFace
              key={card.id}
              variant={card.variant}
              frozen={card.id === active.id ? frozen : (frozenOverride[card.id] ?? card.frozen)}
              last4={card.last4}
              cardholder={data.cardholder}
              expiry={data.expiry}
              network={data.network}
              meta={card.variant === 'virtual' ? `Virtual${card.where ? ` · ${card.where}` : ' · online'}` : undefined}
            />
          ))}
        </CardStack>
        )}
        {notice && (
          <p role="status" className="c-det mt-s2">
            {notice}
          </p>
        )}
      </CMain>
    </Cell>
  );

  const controls = (
    <CardControlsCard
      controls={data.controls}
      perTransactionLimit={limits.perTransaction}
      perDayLimit={limits.perDay}
      onAdjustLimits={() => setLimitsOpen(true)}
    />
  );

  const spends = <SpendsFrom cash={data.cardCash} tiers={data.tiers ?? []} desktop={desktop} />;

  const rows = [...data.transactions].sort((a, b) =>
    sort === 'largest' ? Math.abs(b.amount) - Math.abs(a.amount) : 0,
  );
  if (sort === 'oldest') rows.reverse();
  const shown = rows.slice(0, desktop ? 6 : 4);
  const period = data.period || 'This month';

  const transactions = (
    <Cell full>
      <CHead>
        <SecHead label="Transactions">
          <p className="c-fig c-fig-sec">{money(data.periodTotal, { cents: true })}</p>
        </SecHead>
      </CHead>
      {data.transactions.length > 0 && (
        <CBar>
          <div className="c-listctl">
            <MenuButton label={period} options={[{ id: 'period', label: period }]} value="period" onChange={() => {}} />
            <MenuButton
              label={SORTS.find((s) => s.id === sort)!.label}
              icon={<SortIcon />}
              options={SORTS}
              value={sort}
              onChange={setSort}
              align="end"
            />
          </div>
        </CBar>
      )}
      <CMain>
        {data.transactions.length === 0 ? (
          <>
            <p className="text-sec">{frozen ? 'Frozen, so nothing new will land' : 'Ready when you are'}</p>
            <p className="c-det mt-[3px]">
              {frozen
                ? 'Unfreeze the card and purchases start appearing here again. Anything already spent stays where it was.'
                : 'Tap or paste your card anywhere and the purchase lands here within seconds, split by what paid for it.'}
            </p>
          </>
        ) : (
          <Rows>
            {shown.map((row) => {
              const tag = sourceTag(row);
              /*
               * A voided charge keeps its figure and says what became of it.
               *
               * Struck rather than removed: the member remembers the charge, and a row that is not
               * there is a row they cannot reconcile. The funding tag gives way to 'Reversed'
               * because no tier is paying for it any more — saying 'Credit' beside money that came
               * back would be the one wrong thing on the line.
               */
              const amount = (
                <span
                  className={cn(
                    'c-fig c-fig-row',
                    row.amount > 0 && 'c-pos',
                    row.reversed && REVERSED_ROW.amount,
                    desktop && 'text-right',
                  )}
                >
                  {signedMoney(row.amount)}
                </span>
              );
              const label = row.reversed ? REVERSED_ROW.label : tag.label;
              const labelClass = row.reversed ? REVERSED_ROW.text : tagClass(row);
              return (
                <button key={row.id} type="button" onClick={() => setSelected(row)} className="block w-full text-left">
                  {desktop ? (
                    <div className="grid grid-cols-[1fr_150px_110px] items-center">
                      <span className={cn('text-sec', row.reversed && REVERSED_ROW.text)}>{row.name}</span>
                      <span className={cn('c-det', labelClass)}>{label}</span>
                      {amount}
                    </div>
                  ) : (
                    <Line>
                      <div>
                        <p className={cn('text-sec', row.reversed && REVERSED_ROW.text)}>{row.name}</p>
                        <p className={cn('c-det', labelClass)}>{label}</p>
                      </div>
                      {amount}
                    </Line>
                  )}
                </button>
              );
            })}
          </Rows>
        )}
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">
            {shown.length} of {data.periodCount ?? data.transactions.length} this month
          </span>
          <Link to="/activity" className="c-det inline-flex! items-center gap-1 hover:text-ink">
            See all in Activity
            <ChevronIcon />
          </Link>
        </Line>
      </CFoot>
    </Cell>
  );

  return (
    <>
      {desktop ? (
        <div className="mb-s3 grid grid-cols-[minmax(0,1fr)_300px] items-end gap-s4">
          {hero}
          {actions}
        </div>
      ) : (
        <>
          <div className="mb-s2">{hero}</div>
          <div className="mb-s3">{actions}</div>
        </>
      )}

      <div className={cn('c-slab', !desktop && 'c-one')}>
        {cardCell}
        {controls}
        {spends}
        {transactions}
      </div>

      <CardDetailsDialog
        pan={onRevealDetails ? '' : data.pan}
        expiry={data.expiry}
        cvc={data.cvc}
        embedUrl={embedUrl}
        embedSession={embedSession}
        loading={loadingDetails}
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          // The URL is short-lived and single-use: dropped the moment the details close.
          if (!open) {
            setEmbedUrl(undefined);
            setEmbedSession(undefined);
          }
        }}
        onReplace={() => {
          setDetailsOpen(false);
          setEmbedUrl(undefined);
          setEmbedSession(undefined);
          setReplaceOpen(true);
        }}
      />
      <AdjustLimitsDialog
        perTransaction={limits.perTransaction}
        perDay={limits.perDay}
        creditLimit={creditLimit}
        ceiling={CARD_DAILY_CEILING}
        open={limitsOpen}
        onOpenChange={setLimitsOpen}
        onSave={(next) => {
          setLimits(next);
          setLimitsOpen(false);
        }}
      />
      <ReplaceCardDialog open={replaceOpen} onOpenChange={setReplaceOpen} onReplace={() => setReplaceOpen(false)} />
      <SetPinDialog
        open={pinOpen}
        onOpenChange={(o) => {
          setPinOpen(o);
          if (o) onSetPin?.(active.id);
        }}
        session={pinSession}
      />
      <NewCardDialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          // The outcome belongs to the sheet that was open: closing it is what ends that card's
          // story, so the next New card starts at the decision again.
          if (!o) onNewCardDone?.();
        }}
        cardholder={data.cardholder}
        expiry={data.expiry}
        network={data.network}
        address={address}
        cardsHeld={wallet.length}
        busy={busy}
        error={addError}
        result={newCard}
        onCreate={onAddCard}
        onChangeAddress={() => navigate('/settings/account')}
        onSeeDetails={() => {
          setAddOpen(false);
          onNewCardDone?.();
          void openDetails();
        }}
      />
      {selected && (
        <TransactionDetailDialog row={selected} open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} />
      )}
    </>
  );
}
