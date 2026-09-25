import { Fragment, useState, type ReactNode } from 'react';
import {
  IconKeyDelete,
  IconPart,
  IconQuickSale,
  IconRemove,
  IconSearch,
  IconService,
  IconTire,
  IconViewList,
  IconViewTiles,
} from '@/brand/chargeIcons';
import { Segmented } from '@/brand/controls';
import { IconMinus, IconPlusSm } from '@/brand/icons';
import { Sheet, cx, Slab } from '@/brand/ui';
import { FlowTop } from '@/shell/chrome';
import {
  itemCount,
  missingGroup,
  totals,
  unitPrice,
  usd,
  type CartLine,
  type Item,
  type TaxKind,
  type Thumb,
  type Totals,
} from '@/charge/model';

/**
 * The start of a charge: an amount typed from the ticket, or items picked into a cart. Both land
 * at Checkout. Drawn from the New Charge reference, section 1.
 */

export type StartMode = 'amount' | 'items';

/** The flow header with the Amount / Items switch in the middle. */
export function StartTop({
  mode,
  onMode,
  onShift,
  onExit,
  title = 'New charge',
  onChangeShift,
}: {
  mode: StartMode;
  onMode?: (m: StartMode) => void;
  onShift: string;
  onExit?: () => void;
  title?: string;
  onChangeShift?: () => void;
}) {
  return (
    <FlowTop
      title={title}
      onExit={onExit}
      onShift={onShift}
      onChangeShift={onChangeShift}
      middle={
        <Segmented
          as="span"
          kind="mode"
          className="c-ci-top"
          label="Start with"
          value={mode}
          onChange={onMode}
          options={[
            { value: 'amount', label: 'Amount' },
            { value: 'items', label: 'Items' },
          ]}
        />
      }
    />
  );
}

// ---- An amount ----------------------------------------------------------------------------------

/** The reference's number pad: divs in a grid, the decimal point and backspace in ink-50. */
export function Keypad({ onKey, decimal = true }: { onKey: (k: string) => void; decimal?: boolean }) {
  const key = (k: string, label: ReactNode, fn?: boolean) => (
    <div
      key={k}
      className={fn ? 'c-fn' : ''}
      role="button"
      tabIndex={0}
      aria-label={k === 'del' ? 'Delete' : k}
      onClick={() => onKey(k)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onKey(k)}
    >
      {label}
    </div>
  );
  return (
    <div className="c-keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, d))}
      {decimal ? key('.', '.', true) : <div className="c-fn" aria-hidden="true" />}
      {key('0', '0')}
      {key('del', <IconKeyDelete />, true)}
    </div>
  );
}

/** Typing a dollar amount on the pad, held as the string typed. */
export function typeAmount(cur: string, k: string): string {
  if (k === 'del') return cur.slice(0, -1);
  if (k === '.' && cur.includes('.')) return cur;
  if (cur.includes('.') && cur.split('.')[1].length >= 2) return cur;
  if (cur.replace('.', '').length >= 7) return cur;
  return (cur + k).replace(/^0(?=\d)/, '');
}

export interface FeeTerms {
  /** Percent when paid now, and over time: 1.25, 2.0. Only for someone who sees money. */
  now: number;
  over?: number;
}

export function AmountView({
  cents,
  limitCents,
  fees,
  recordedAgainst,
  owner,
  onKey,
  onContinue,
}: {
  cents: number;
  limitCents: number | null;
  /** Someone who sees money, even before the shop's rate has loaded. */
  owner?: boolean;
  /** Present for owners and managers; a counter shift never sees the rate. */
  fees?: FeeTerms | null;
  /** "Jen R., this shift", for a counter shift. */
  recordedAgainst?: string;
  onKey: (k: string) => void;
  onContinue?: () => void;
}) {
  const quarter = Math.round(cents / 4);
  const feeOf = (pct: number) => Math.round((cents * pct) / 100);
  const pct = (p: number) => `${p % 1 ? p.toFixed(2).replace(/0$/, '') : p.toFixed(1)}%`;
  return (
    <Slab>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Amount</p>
            <span className="c-det">From the ticket</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-mc-amt2">
            <div>
              <div className="c-mc-amount" aria-live="polite">
                {usd(cents)}
                <span className="c-caret" />
              </div>
              {limitCents !== null && <p className="c-det c-lim">Up to {usd(limitCents)} a charge</p>}
            </div>
            <div className="c-mid c-mc-mini">
              <div className="c-line" style={{ alignItems: 'baseline' }}>
                <p className="c-label" style={{ margin: 0 }}>
                  What they will see
                </p>
                <span className="c-det">For example</span>
              </div>
              <div className="c-pairfig">
                <div>
                  <p className="c-f">{usd(quarter)}</p>
                  <p className="c-det">4 payments, every two weeks</p>
                </div>
                <div>
                  <p className="c-f">{usd(cents)}</p>
                  <p className="c-det">All at once</p>
                </div>
              </div>
              <p className="c-det" style={{ marginTop: 10 }}>
                They pick on their phone. You do not need to know which.
              </p>
            </div>
            <div className="c-rows c-mc-bleed">
              <div>
                <div className="c-kv">
                  <span>Customer approves</span>
                  <span className="c-v">{usd(cents)}</span>
                </div>
              </div>
              {fees ? (
                <>
                  <div>
                    <div className="c-kv">
                      <span>
                        Fee &middot; {pct(fees.now)} paid now{fees.over !== undefined ? `, ${pct(fees.over)} over time` : ''}
                      </span>
                      <span className="c-v">
                        &minus;{usd(feeOf(fees.now))}
                        {fees.over !== undefined && <> or &minus;{usd(feeOf(fees.over))}</>}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="c-kv c-grand">
                      <span>You receive</span>
                      <span className="c-v">
                        {usd(cents - feeOf(fees.now))}
                        {fees.over !== undefined && <> or {usd(cents - feeOf(fees.over))}</>}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                recordedAgainst && (
                  <div>
                    <div className="c-kv">
                      <span>Recorded against</span>
                      <span className="c-v">{recordedAgainst}</span>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
        <div className="c-cfoot">
          <p className="c-det">
            {fees || owner ? 'Paid on the 14th with the rest of the month’s charges.' : 'The fee and what the shop receives are for an owner.'}
          </p>
        </div>
      </div>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">This charge</p>
            <span className="c-det">Nothing else to enter</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-mc-pad">
            <Keypad onKey={onKey} />
            <button
              type="button"
              className="c-btn c-btn-primary c-btn-lg"
              disabled={cents <= 0 || (limitCents !== null && cents > limitCents)}
              onClick={onContinue}
            >
              Continue to checkout
            </button>
          </div>
        </div>
        <div className="c-cfoot">
          <p className="c-det">Next: discount, tip, and how they pay.</p>
        </div>
      </div>
    </Slab>
  );
}

// ---- Items --------------------------------------------------------------------------------------

export function Thumbnail({ kind }: { kind: Thumb }) {
  if (kind === 'food') return null;
  return kind === 'tire' ? <IconTire /> : kind === 'service' ? <IconService /> : <IconPart />;
}

/** In the cart: its count becomes a stepper, so what is chosen shows on both sides. */
export function LineStepper({
  qty,
  onChange,
  max,
}: {
  qty: number;
  onChange?: (n: number) => void;
  max?: number;
}) {
  return (
    <span className="c-ci-step">
      <button type="button" aria-label="Less" onClick={() => onChange?.(qty - 1)}>
        <IconMinus />
      </button>
      <b aria-live="polite">{qty}</b>
      <button type="button" aria-label="More" disabled={max !== undefined && qty >= max} onClick={() => onChange?.(qty + 1)}>
        <IconPlusSm />
      </button>
    </span>
  );
}

function StockLine({ stock }: { stock: NonNullable<Item['stock']> }) {
  if (stock.free <= 0)
    return (
      <span className="c-ci-st c-out">
        <i />
        Out of stock
      </span>
    );
  return (
    <span className={cx('c-ci-st', stock.low ? 'c-low' : 'c-ok')}>
      <i />
      {stock.low ? `${stock.free} free` : `${stock.free} in stock`}
    </span>
  );
}

export interface ItemsProps {
  catalog: Item[];
  view: 'list' | 'tiles';
  onView?: (v: 'list' | 'tiles') => void;
  /** Quantity in the cart, by item. */
  inCart: Record<string, number>;
  onAdd?: (item: Item) => void;
  onQty?: (item: Item, qty: number) => void;
  onQuickSale?: () => void;
  onOptions?: (item: Item) => void;
  /** Tiles: the category tab. */
  tab?: string;
  onTab?: (t: string) => void;
  search?: string;
  onSearch?: (s: string) => void;
  /** Hide the section's own head (the phone draws search above the list). */
  bare?: boolean;
  /** The shop's tile layout for All, by item id. */
  tileOrder?: string[];
}

function ViewSwitch({ view, onView }: { view: 'list' | 'tiles'; onView?: (v: 'list' | 'tiles') => void }) {
  return (
    <span className="c-iv-view" role="radiogroup" aria-label="Show items as">
      <b className={view === 'list' ? 'c-on' : undefined} role="radio" aria-checked={view === 'list'} aria-label="List" tabIndex={0} onClick={() => onView?.('list')}>
        <IconViewList />
      </b>
      <b className={view === 'tiles' ? 'c-on' : undefined} role="radio" aria-checked={view === 'tiles'} aria-label="Tiles" tabIndex={0} onClick={() => onView?.('tiles')}>
        <IconViewTiles />
      </b>
    </span>
  );
}

export function SearchItems({ value, onChange, style }: { value?: string; onChange?: (v: string) => void; style?: React.CSSProperties }) {
  return (
    <label className="c-ci-search" style={style}>
      <IconSearch />
      <input
        type="search"
        placeholder="Search items"
        aria-label="Search items"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        style={{ border: 0, background: 'transparent', font: 'inherit', color: 'var(--ink)', outline: 'none', width: 0, minWidth: 0, flex: 1, padding: 0 }}
      />
    </label>
  );
}

/** The item list as Inventory draws it, grouped, with quick sale first. */
export function ItemList({ catalog, inCart, onAdd, onQty, onQuickSale, onOptions, search }: ItemsProps) {
  const q = (search ?? '').trim().toLowerCase();
  const shown = q ? catalog.filter((i) => `${i.name} ${i.detail}`.toLowerCase().includes(q)) : catalog;
  const cats = [...new Set(shown.map((i) => i.category))];
  return (
    <div className="c-cmain c-ci-list">
      <div className="c-ci-row c-ci-quick">
        <span className="c-ci-th c-qk" aria-hidden="true">
          <IconQuickSale />
        </span>
        <div className="c-nm">
          <p className="c-t">Quick sale</p>
          <p className="c-det">Any amount, with a note</p>
        </div>
        <span className="c-ci-pr" />
        <button type="button" className="c-ci-add" aria-label="Add a quick sale" onClick={onQuickSale}>
          <IconPlusSm />
        </button>
      </div>
      {cats.map((cat) => {
        const items = shown.filter((i) => i.category === cat);
        return (
          // A fragment, not a wrapper: the reference's rules read the rows as the list's own children.
          <Fragment key={cat}>
            <div className="c-ci-sec">
              <p className="c-label">{cat}</p>
              <span className="c-det">{items.length}</span>
            </div>
            {items.map((it) => {
              const n = inCart[it.id] ?? 0;
              const out = it.stock !== undefined && it.stock.free <= 0;
              const bits: ReactNode[] = [it.detail];
              if (it.stock) bits.push(<StockLine key="s" stock={it.stock} />);
              if (it.options && !out)
                bits.push(
                  <button key="o" type="button" className="c-ci-opt" onClick={() => onOptions?.(it)}>
                    Options
                  </button>,
                );
              return (
                <div key={it.id} className={cx('c-ci-row', n > 0 && 'c-on', out && 'c-off')}>
                  <span className="c-ci-th" aria-hidden="true">
                    <Thumbnail kind={it.thumb} />
                  </span>
                  <div className="c-nm">
                    <p className="c-t">{it.name}</p>
                    <p className="c-det">
                      {bits.map((b, i) => (
                        <span key={i}>
                          {i > 0 && ' · '}
                          {b}
                        </span>
                      ))}
                    </p>
                  </div>
                  <span className="c-ci-pr">{usd(it.priceCents)}</span>
                  {out ? (
                    <span className="c-ci-na" aria-hidden="true" />
                  ) : n > 0 ? (
                    <LineStepper qty={n} max={it.stock?.free} onChange={(v) => onQty?.(it, v)} />
                  ) : (
                    <button
                      type="button"
                      className="c-ci-add"
                      aria-label={`Add ${it.name}`}
                      onClick={() => (it.options ? onOptions?.(it) : onAdd?.(it))}
                    >
                      <IconPlusSm />
                    </button>
                  )}
                </div>
              );
            })}
          </Fragment>
        );
      })}
    </div>
  );
}

/** The same items as a grid you can tap without reading. */
export function ItemTiles({ catalog, inCart, onAdd, onQuickSale, onOptions, tab = 'All', tileOrder }: ItemsProps) {
  // All shows the shop's own tile layout (set in Settings) when it has one; a category tab shows
  // that category. Out of stock never takes a tile.
  const inStock = (i: Item) => !(i.stock && i.stock.free <= 0);
  const shown =
    tab === 'All'
      ? tileOrder
        ? tileOrder.map((id) => catalog.find((i) => i.id === id)!).filter(Boolean)
        : catalog.filter(inStock)
      : catalog.filter((i) => i.category === tab && inStock(i));
  return (
    <div className="c-cmain">
      <div className="c-iv-tiles">
        <button type="button" className="c-iv-tile c-quick" onClick={onQuickSale}>
          <span className="c-ph c-ic" aria-hidden="true">
            <IconQuickSale />
          </span>
          <span className="c-nm">Quick sale</span>
          <span className="c-pr">Any amount</span>
        </button>
        {shown.map((it) => {
          const n = inCart[it.id] ?? 0;
          const food = it.thumb === 'food';
          return (
            <button
              key={it.id}
              type="button"
              className={cx('c-iv-tile', food && 'c-food', n > 0 && 'c-on')}
              aria-label={`${it.name}, ${usd(it.priceCents)}${n ? `, ${n} in cart` : ''}`}
              onClick={() => (it.options ? onOptions?.(it) : onAdd?.(it))}
            >
              {n > 0 && <span className="c-q">{n}</span>}
              <span className={cx('c-ph', !food && 'c-ic')} aria-hidden="true">
                <Thumbnail kind={it.thumb} />
              </span>
              <span className="c-nm">{it.short ?? it.name}</span>
              <span className="c-pr">
                {usd(it.priceCents)}
                {it.options && <span className="c-o">Options</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ItemsCell(p: ItemsProps & { tabs?: string[] }) {
  const tiles = p.view === 'tiles';
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          {tiles ? (
            <div className="c-iv-tabs" role="tablist">
              {(p.tabs ?? ['All', ...new Set(p.catalog.map((i) => i.category))]).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={(p.tab ?? 'All') === t} className={cx('c-btn', (p.tab ?? 'All') === t && 'c-on')} onClick={() => p.onTab?.(t)}>
                  {t}
                </button>
              ))}
            </div>
          ) : (
            <p className="c-label">Items</p>
          )}
          {tiles ? (
            <ViewSwitch view={p.view} onView={p.onView} />
          ) : (
            <span className="c-ci-tools">
              <SearchItems value={p.search} onChange={p.onSearch} />
              <ViewSwitch view={p.view} onView={p.onView} />
            </span>
          )}
        </div>
      </div>
      {tiles ? <ItemTiles {...p} /> : <ItemList {...p} />}
      <div className="c-cfoot">
        <p className="c-det">{tiles ? 'Tap to add one. Items with options ask first.' : 'Tap + to add. Tap a number to type it.'}</p>
      </div>
    </div>
  );
}

// ---- The cart -----------------------------------------------------------------------------------

const TAX_NAMES: Record<TaxKind, string> = {
  goods: 'Parts and tires',
  labour: 'Labour',
  food: 'Food and drinks',
  exempt: 'Exempt',
};

/** Parts, labour and tax, small, at the foot of a cart. `after` once a discount has come off. */
export function Breakdown({ t, after, className = 'c-ci-small' }: { t: Totals; after?: boolean; className?: string }) {
  const rows: [string, number][] = [];
  const suffix = after ? ', after discount' : '';
  if (t.goodsCents) rows.push([TAX_NAMES.goods + suffix, t.goodsCents]);
  if (t.labourCents) rows.push([TAX_NAMES.labour + suffix, t.labourCents]);
  if (t.foodCents) rows.push([TAX_NAMES.food + suffix, t.foodCents]);
  if (t.exemptCents) rows.push([TAX_NAMES.exempt + suffix, t.exemptCents]);
  const taxLabel = after
    ? 'Sales tax · on the discounted parts'
    : t.foodCents && !t.goodsCents
      ? 'Sales tax · prepared food 7.75%'
      : 'Sales tax · 7.75% on parts';
  return (
    <div className={className}>
      {rows.map(([k, v]) => (
        <div key={k} className="c-kv">
          <span>{k}</span>
          <span className="c-v">{usd(v)}</span>
        </div>
      ))}
      {t.taxCents > 0 && (
        <div className="c-kv">
          <span>{taxLabel}</span>
          <span className="c-v">{usd(t.taxCents)}</span>
        </div>
      )}
    </div>
  );
}

export const lineLabel = (l: CartLine) => `${l.qty} × ${l.name}${l.chosen ? ` · ${l.chosen}` : ''}`;

export function CartCell({
  lines,
  suggestion,
  onAddSuggestion,
  onEdit,
  onCheckout,
  heading = 'Cart',
  headingDet,
  heroLabel = 'Customer approves',
}: {
  lines: CartLine[];
  /** "Tires usually go with mount and balance": suggested once, with the count matched. */
  suggestion?: { t: string; det: string; action: string } | null;
  onAddSuggestion?: () => void;
  onEdit?: (l: CartLine) => void;
  onCheckout?: () => void;
  /** A food truck's "Order 47". */
  heading?: string;
  headingDet?: ReactNode;
  heroLabel?: string;
}) {
  const t = totals(lines);
  const empty = lines.length === 0;
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">{heading}</p>
          <span className="c-det">{headingDet ?? (empty ? 'Empty' : itemCount(t.count))}</span>
        </div>
      </div>
      <div className="c-cmain c-ci-sum">
        <div className="c-ci-hero">
          <p className="c-label">{heroLabel}</p>
          <p className={cx('c-f', empty && 'c-muted')}>{usd(t.totalCents)}</p>
          <p className="c-det">{empty ? 'Nothing in the cart yet' : `${itemCount(t.count)} · tax included`}</p>
        </div>
        {empty ? (
          <p className="c-det c-ci-emptyline">Tap + beside an item to add it. The lines and the total build here, tax and all.</p>
        ) : (
          <>
            <div className="c-ci-lns">
              {lines.map((l) => (
                <div key={l.key} className="c-kv">
                  <span>
                    {lineLabel(l)}{' '}
                    {l.hasOptions && (
                      <button type="button" className="c-ci-edit" onClick={() => onEdit?.(l)}>
                        Edit
                      </button>
                    )}
                  </span>
                  <span className="c-v">{usd(l.qty * l.unitCents)}</span>
                </div>
              ))}
            </div>
            {suggestion && (
              <div className="c-ci-sugline">
                <div>
                  <p className="c-t">{suggestion.t}</p>
                  <p className="c-det">{suggestion.det}</p>
                </div>
                <button type="button" className="c-btn" onClick={onAddSuggestion}>
                  {suggestion.action}
                </button>
              </div>
            )}
            <Breakdown t={t} />
          </>
        )}
      </div>
      <div className="c-cfoot">
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={empty} onClick={onCheckout}>
          {empty ? 'Checkout' : `Checkout · ${usd(t.totalCents)}`}
        </button>
      </div>
    </div>
  );
}

/** The cart's lines drawn large, as on the phone's cart and the not-enough-stock state. */
export function BigLines({
  lines,
  catalog,
  onQty,
  onRemove,
  capNote,
}: {
  lines: CartLine[];
  catalog: Item[];
  onQty?: (l: CartLine, n: number) => void;
  onRemove?: (l: CartLine) => void;
  /** Keyed by line: "Only 4 free. 2 more are held for Nina P.'s charge." */
  capNote?: Record<string, string>;
}) {
  return (
    <div className="c-ci-biglines">
      {lines.map((l) => {
        const it = catalog.find((i) => i.id === l.itemId);
        const cap = capNote?.[l.key];
        return (
          <div key={l.key} className="c-ci-line c-big">
            <span className="c-ci-th" aria-hidden="true">
              {it && <Thumbnail kind={it.thumb} />}
            </span>
            <div className="c-nm">
              <p className="c-t">{l.name}</p>
              <p className="c-det">
                {it?.detail ? `${it.detail} · ` : ''}
                {usd(l.unitCents)} each
              </p>
              {cap && (
                <p className="c-ci-cap">
                  <span className="c-dot" />
                  {cap}
                </p>
              )}
            </div>
            <LineStepper qty={l.qty} max={it?.stock?.free} onChange={(n) => onQty?.(l, n)} />
            <span className="c-v">{usd(l.qty * l.unitCents)}</span>
            <button type="button" className="c-ci-rm" aria-label={`Remove ${l.name}`} onClick={() => onRemove?.(l)}>
              <IconRemove />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---- Sheets -------------------------------------------------------------------------------------

/**
 * An item with options asks before it goes in the cart: the groups in the owner's order, what
 * each choice adds, and the price for the count chosen. A required group not yet picked turns the
 * button into what is missing.
 */
export function OptionsSheet({
  item,
  initial,
  initialQty = 1,
  onAdd,
  onClose,
  inline,
  showMissing,
}: {
  item: Item;
  initial?: Record<string, string[]>;
  initialQty?: number;
  onAdd?: (picked: Record<string, string[]>, qty: number) => void;
  onClose?: () => void;
  inline?: boolean;
  /** Draw the unpicked required group as an error, as the reference's second sheet does. */
  showMissing?: boolean;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>(initial ?? {});
  const [qty, setQty] = useState(initialQty);
  const missing = missingGroup(item, picked);
  const unit = unitPrice(item, picked);
  const toggle = (gid: string, cid: string, rule: 'one' | 'any') =>
    setPicked((p) => {
      const cur = p[gid] ?? [];
      if (rule === 'one') return { ...p, [gid]: [cid] };
      return { ...p, [gid]: cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid] };
    });
  const food = item.thumb === 'food';
  return (
    <Sheet
      inline={inline}
      className="c-cc-sheet c-iv-pick-sheet"
      label={item.name}
      onClose={onClose}
      head={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-iv-sh-item" style={{ border: 0, padding: 0 }}>
            <span className={cx('c-iv-th c-sm', food && 'c-food')} aria-hidden="true">
              <Thumbnail kind={item.thumb} />
            </span>
            <span>
              <span className="c-t">{item.name}</span>
              <span className="c-det" style={{ display: 'block' }}>
                {usd(item.priceCents)}
                {item.thumb === 'tire' ? ` a tire · ${item.detail}` : ''}
              </span>
            </span>
          </span>
          <button type="button" className="c-mclose" aria-label="Close" onClick={onClose}>
            <IconRemoveClose />
          </button>
        </div>
      }
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-iv-stepper">
            <button type="button" aria-label="Less" disabled={qty <= 1} onClick={() => setQty((n) => n - 1)}>
              <IconMinus />
            </button>
            <b aria-live="polite">{qty}</b>
            <button type="button" aria-label="More" disabled={item.stock !== undefined && qty >= item.stock.free} onClick={() => setQty((n) => n + 1)}>
              <IconPlusSm />
            </button>
          </span>
          <button
            type="button"
            className="c-btn c-btn-primary c-btn-lg"
            style={{ flex: 1, marginLeft: 'var(--s2)' }}
            disabled={!!missing}
            onClick={() => onAdd?.(picked, qty)}
          >
            {missing ? `Pick a ${missing.name.toLowerCase()}` : `Add ${qty} · ${usd(unit * qty)}`}
          </button>
        </div>
      }
    >
      {(item.options ?? []).map((g) => {
        const err = showMissing && missing?.id === g.id;
        return (
          <div key={g.id} className={cx('c-iv-pg', err && 'c-err')} role={g.rule === 'one' ? 'radiogroup' : 'group'} aria-label={g.name}>
            <div className="c-gh">
              <p className="c-label">{g.name}</p>
              {err ? (
                <span className="c-chip c-absent">Pick one</span>
              ) : g.required ? (
                <span className="c-chip c-underway">Required</span>
              ) : (
                <span className="c-det">Optional</span>
              )}
            </div>
            <p className="c-det">{err ? 'Pick one before adding' : g.rule === 'one' ? 'Pick one' : 'Pick any'}</p>
            {g.choices.map((c) => {
              const on = (picked[g.id] ?? []).includes(c.id);
              return (
                <div
                  key={c.id}
                  className="c-iv-opt"
                  role={g.rule === 'one' ? 'radio' : 'checkbox'}
                  aria-checked={on}
                  tabIndex={0}
                  onClick={() => toggle(g.id, c.id, g.rule)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(g.id, c.id, g.rule)}
                >
                  <span className={cx(g.rule === 'one' ? 'c-iv-radio' : 'c-iv-check', on && 'c-on')} />
                  <span className="c-n">{c.name}</span>
                  <span className="c-d">{c.deltaCents ? `+${usd(c.deltaCents)}` : ''}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </Sheet>
  );
}

function IconRemoveClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

const TAX_CHOICES: [TaxKind, string][] = [
  ['goods', 'Taxable goods'],
  ['labour', 'Labour, not taxed'],
  ['food', 'Prepared food'],
  ['exempt', 'Exempt'],
];

/** Always the first row: an amount, what it is for, and how it is taxed. On this charge only. */
export function QuickSaleSheet({
  initialAmount = '',
  initialNote = '',
  initialTax = 'goods',
  onAdd,
  onClose,
  inline,
}: {
  initialAmount?: string;
  initialNote?: string;
  initialTax?: TaxKind;
  onAdd?: (line: { cents: number; note: string; tax: TaxKind }) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const [amount, setAmount] = useState(initialAmount);
  const [note, setNote] = useState(initialNote);
  const [tax, setTax] = useState<TaxKind>(initialTax);
  const cents = Math.round(parseFloat(amount || '0') * 100);
  return (
    <Sheet
      inline={inline}
      title="Quick sale"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!cents || !note.trim()} onClick={() => onAdd?.({ cents, note: note.trim(), tax })}>
          Add {usd(cents)}
        </button>
      }
    >
      <div className="c-ck-qs">
        <p className="c-label">Amount</p>
        {/* Drawn as the reference draws it, the figure and its caret; the input sits invisibly over
            it so a tap brings up the keyboard. */}
        <div className="c-mc-amount c-iv-qamt" style={{ position: 'relative' }}>
          {usd(cents)}
          <span className="c-caret" />
          <input
            inputMode="decimal"
            aria-label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', border: 0 }}
          />
        </div>
      </div>
      <p className="c-label c-iv-fl">What it is for</p>
      <input className="c-field c-iv-in" aria-label="What it is for" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', color: 'var(--ink)' }} />
      <p className="c-label c-iv-fl">Sales tax</p>
      <div className="c-iv-reason" role="radiogroup" aria-label="Sales tax">
        {TAX_CHOICES.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={tax === k} className={cx('c-btn', tax === k && 'c-on')} onClick={() => setTax(k)}>
            {label}
          </button>
        ))}
      </div>
      <p className="c-det" style={{ marginTop: 'var(--s2)', lineHeight: 1.5 }}>
        It goes on this charge only. Nothing is added to Inventory, and there is no stock to count.
      </p>
    </Sheet>
  );
}
