import { Fragment, useState, type ReactNode } from 'react';
import {
  IconBrake,
  IconCaretDown,
  IconDrag,
  IconFilter,
  IconPart,
  IconSearch,
  IconService,
  IconSort,
  IconTick,
  IconTire,
  IconUpload,
} from '@/brand/chargeIcons';
import { Chip, Stepper } from '@/brand/controls';
import { IconPlusSm } from '@/brand/icons';
import { SaPanel } from '@/brand/sa';
import { MenuButton, Sheet, Slab, cx } from '@/brand/ui';
import { OptionsSheet } from '@/charge/start';
import { usd, type Item, type TaxKind } from '@/charge/model';
import { TAX_LABEL, free, level, type InvItem, type ItemKind } from '@/inventory/model';

/**
 * Inventory — docs/merchant-reference/clear-merchant-inventory.html.
 *
 * The list: a summary counting items the way Charges counts money, then the items grouped by
 * category, each row the item, its stock and its price in fixed columns. An item opened: stock
 * and price, with the stock's own history. And one sheet for every reason stock moves by hand.
 */

/** "$176.00", "+$3.00", "176" → cents; blank → null. */
export function centsOf(text: string): number | null {
  const t = text.replace(/[^\d.]/g, '');
  if (!t) return null;
  const n = Math.round(parseFloat(t) * 100);
  return Number.isFinite(n) ? n : null;
}
const wholeOf = (text: string): number | null => (/^\s*\d+\s*$/.test(text) ? parseInt(text, 10) : null);

export function KindThumb({ kind }: { kind: ItemKind }) {
  return kind === 'tire' ? <IconTire /> : kind === 'brake' ? <IconBrake /> : kind === 'part' ? <IconPart /> : <IconService />;
}

export function StockLabel({ i }: { i: InvItem }) {
  const l = level(i);
  if (l === 'svc') return <span className="c-iv-st c-svc">Service</span>;
  const s = i.stock!;
  const text = l === 'out' ? 'Out of stock' : l === 'low' ? `${s.shelf} left` : `${s.shelf} in stock`;
  const note = s.onOrder ? `${s.onOrder} on order` : s.held ? `${s.held} held` : null;
  return (
    <span className={cx('c-iv-st', `c-${l}`)}>
      <i />
      {text}
      {note && <span className="c-h">{note}</span>}
    </span>
  );
}

// ---- The list -----------------------------------------------------------------------------------

export function InventorySummary({ items, atCostCents, owner }: { items: InvItem[]; atCostCents?: number; owner: boolean }) {
  const stocked = items.filter((i) => i.stock);
  const n = (l: string) => stocked.filter((i) => level(i) === l).length;
  return (
    <div className="c-mc-slot">
      <SaPanel
        className="c-iv-sum"
        label="Stocked items"
        det={owner && atCostCents !== undefined ? `${usd(atCostCents)} at cost` : 'Prices and stock only'}
        figure={stocked.length}
        unit="items"
        parts={[
          { key: 'ok', tone: 'ok', label: 'In stock', value: n('ok'), grow: n('ok') },
          { key: 'low', tone: 'low', label: 'Low', value: n('low'), grow: n('low') },
          { key: 'out', tone: 'out', label: 'Out', value: n('out'), grow: n('out') },
        ]}
      />
    </div>
  );
}

export type Show = 'all' | 'needs' | 'services' | 'archived';
export type SortBy = 'category' | 'name' | 'least' | 'best';

const SHOW: [Show, string][] = [
  ['all', 'All items'],
  ['needs', 'Needs stock'],
  ['services', 'Services only'],
  ['archived', 'Archived'],
];
const SORT: [SortBy, string][] = [
  ['category', 'Category'],
  ['name', 'Name'],
  ['least', 'Least in stock'],
  ['best', 'Best selling'],
];
const CATEGORIES = ['Tires', 'Brakes', 'Parts', 'Services'] as const;

export function InventoryList({
  items,
  owner,
  phone,
  show,
  onShow,
  sort,
  onSort,
  category,
  onCategory,
  search,
  onSearch,
  onOpen,
  onAdd,
  onImport,
  menuOpen,
}: {
  /** Dev preview: a menu drawn open. */
  menuOpen?: 'filter' | 'sort';
  items: InvItem[];
  owner: boolean;
  phone?: boolean;
  show: Show;
  onShow?: (s: Show) => void;
  sort: SortBy;
  onSort?: (s: SortBy) => void;
  category: string;
  onCategory?: (c: string) => void;
  search: string;
  onSearch?: (s: string) => void;
  onOpen?: (i: InvItem) => void;
  onAdd?: () => void;
  onImport?: () => void;
}) {
  const needs = (i: InvItem) => level(i) === 'low' || level(i) === 'out';
  const count = { all: items.length, needs: items.filter(needs).length, services: items.filter((i) => !i.stock).length, archived: 0 };
  const q = search.trim().toLowerCase();
  let shown = items.filter((i) => (show === 'needs' ? needs(i) : show === 'services' ? !i.stock : show === 'archived' ? false : true));
  if (category !== 'All') shown = shown.filter((i) => i.category === category);
  if (q) shown = shown.filter((i) => `${i.name} ${i.detail}`.toLowerCase().includes(q));
  if (sort === 'name') shown = [...shown].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'least') shown = [...shown].sort((a, b) => (a.stock?.shelf ?? Infinity) - (b.stock?.shelf ?? Infinity));
  const groups = sort === 'category' ? CATEGORIES.filter((c) => shown.some((i) => i.category === c)) : [null];

  const filterMenu = (
    <MenuButton
      defaultOpen={menuOpen === 'filter'}
      className="c-ch-menu"
      button={(_, toggle) =>
        phone ? (
          <button type="button" className="c-ch-tool" onClick={toggle}>
            <IconFilter />
            <span>{show === 'all' ? 'All' : SHOW.find((s) => s[0] === show)![1]}</span>
            <IconCaretDown />
          </button>
        ) : (
          <button type="button" className="c-ch-tool" onClick={toggle}>
            <IconFilter />
            <span>{SHOW.find((s) => s[0] === show)![1]}</span>
            <IconCaretDown />
          </button>
        )
      }
    >
      {(close) => (
        <>
          <div className="c-grp">
            <p className="c-label">Show</p>
            {SHOW.map(([k, label]) => (
              <div key={k} className={cx('c-ch-opt', show === k && 'c-on')} role="menuitemradio" aria-checked={show === k} tabIndex={0} onClick={() => (onShow?.(k), close())}>
                <span>{label}</span>
                <span className="c-det">{count[k]}</span>
                {show === k ? <IconTick /> : <span />}
              </div>
            ))}
          </div>
          <div className="c-grp">
            <p className="c-label">Category</p>
            <div className="c-ch-chips">
              {['All', ...CATEGORIES].map((c) => (
                <button key={c} type="button" className={cx('c-btn', category === c && 'c-on')} onClick={() => onCategory?.(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </MenuButton>
  );
  const sortMenu = (
    <MenuButton
      defaultOpen={menuOpen === 'sort'}
      className="c-ch-menu"
      width={240}
      button={(_, toggle) => (
        <button type="button" className="c-ch-tool c-sort" onClick={toggle}>
          <IconSort />
          <span>{SORT.find((s) => s[0] === sort)![1]}</span>
          <IconCaretDown />
        </button>
      )}
    >
      {(close) => (
        <div className="c-grp">
          <p className="c-label">Sort by</p>
          {SORT.map(([k, label]) => (
            <div key={k} className={cx('c-ch-opt', sort === k && 'c-on')} role="menuitemradio" aria-checked={sort === k} tabIndex={0} onClick={() => (onSort?.(k), close())}>
              <span>{label}</span>
              {sort === k ? <IconTick /> : <span />}
            </div>
          ))}
        </div>
      )}
    </MenuButton>
  );

  return (
    <Slab className="c-one">
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Items</p>
            <span className="c-ch-tools">
              {phone ? (
                <>
                  <button type="button" className="c-ch-tool c-icon" aria-label="Search">
                    <IconSearch />
                  </button>
                  {filterMenu}
                  {owner && (
                    <button type="button" className="c-ch-tool c-icon c-iv-addi" aria-label="Add item" onClick={onAdd}>
                      <IconPlusSm />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <label className="c-iv-search">
                    <IconSearch />
                    <input
                      type="search"
                      placeholder="Search items"
                      aria-label="Search items"
                      value={search}
                      onChange={(e) => onSearch?.(e.target.value)}
                      style={{ border: 0, background: 'transparent', font: 'inherit', color: 'var(--ink)', outline: 'none', width: 0, minWidth: 0, flex: 1, padding: 0 }}
                    />
                  </label>
                  {filterMenu}
                  {sortMenu}
                  {owner && (
                    <button type="button" className="c-btn c-btn-primary c-iv-add" onClick={onAdd}>
                      <IconPlusSm />
                      <span>Add item</span>
                    </button>
                  )}
                </>
              )}
            </span>
          </div>
        </div>
        <div className="c-cmain c-ch-list">
          {groups.map((g) => {
            const rows = g ? shown.filter((i) => i.category === g) : shown;
            const need = rows.filter(needs).length;
            return (
              <Fragment key={g ?? 'all'}>
                {g && (
                  <div className="c-ch-sec">
                    <p className="c-label">{g}</p>
                    <span className="c-det">
                      {rows.length}
                      {g === 'Services' ? (
                        <> &middot; no stock kept</>
                      ) : need ? (
                        <>
                          {' '}
                          &middot; <span className="c-warn">{need} need stock</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                )}
                <div className="c-iv-rows">
                  {rows.map((i) => (
                    <div key={i.id} className="c-iv-row c-p" role="button" tabIndex={0} onClick={() => onOpen?.(i)} onKeyDown={(e) => e.key === 'Enter' && onOpen?.(i)}>
                      <span className="c-iv-th" aria-hidden="true">
                        <KindThumb kind={i.kind} />
                      </span>
                      <div className="c-nm">
                        <p className="c-t">{i.name}</p>
                        <p className="c-det">{i.detail}</p>
                      </div>
                      <StockLabel i={i} />
                      <span className="c-iv-price">{usd(i.priceCents)}</span>
                    </div>
                  ))}
                </div>
              </Fragment>
            );
          })}
        </div>
        {!phone && (
          <div className="c-cfoot">
            <div className="c-line" style={{ alignItems: 'center' }}>
              {owner ? (
                <>
                  <span className="c-det">Stock comes off when a charge is approved, not when it is raised.</span>
                  <button type="button" className="c-iv-link" onClick={onImport}>
                    Import a spreadsheet
                  </button>
                </>
              ) : (
                <span className="c-det">Only an owner or a manager changes prices and stock.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Slab>
  );
}

/** Before the first item: what the page is for, and two ways in. */
export function InventoryEmpty({ onAdd, onImport }: { onAdd?: () => void; onImport?: () => void }) {
  return (
    <Slab className="c-one">
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Items</p>
            <span className="c-det">{'—'}</span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-iv-empty">
            <p className="c-t">Add what you sell, and the counter can charge from it</p>
            <p className="c-det">
              Tires, parts and services with their prices. Stock is optional: keep it for anything you want to know when to reorder.
            </p>
            <div className="c-iv-ways">
              <div>
                <p className="c-label">One at a time</p>
                <p className="c-det">Name, price, and how many are on the shelf.</p>
                <button type="button" className="c-btn c-btn-primary" onClick={onAdd}>
                  Add an item
                </button>
              </div>
              <div>
                <p className="c-label">From a spreadsheet</p>
                <p className="c-det">A CSV from your supplier or your old system.</p>
                <button type="button" className="c-btn" onClick={onImport}>
                  Import a spreadsheet
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="c-cfoot">
          <p className="c-det">Until then, charges are typed as an amount, as they are now.</p>
        </div>
      </div>
    </Slab>
  );
}

/** On Home, for owners and managers: what has dropped under its reorder line. */
export function RunningLowPanel({ items, onReordered, onInventory }: { items: InvItem[]; onReordered?: (i: InvItem) => void; onInventory?: () => void }) {
  return (
    <div className="c-panel c-rl">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Running low</p>
          <Chip tone="underway">{items.length} items</Chip>
        </div>
      </div>
      <div className="c-cmain">
        {items.map((i) => (
          <div key={i.id} className="c-rl-row">
            <span className="c-iv-th" aria-hidden="true">
              <KindThumb kind={i.kind} />
            </span>
            <div className="c-nm">
              <p className="c-t">{i.name}</p>
              <p className="c-det">
                <span className="c-iv-st c-low" style={{ display: 'inline-flex' }}>
                  <i />
                  {i.stock!.shelf} left
                </span>{' '}
                &middot; {i.stock!.held ? `${i.stock!.held} held, reorder at ${i.stock!.reorderAt}` : `reorder at ${i.stock!.reorderAt}`}
              </p>
            </div>
            <button type="button" className="c-btn" onClick={() => onReordered?.(i)}>
              Mark reordered
            </button>
          </div>
        ))}
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">Only an owner or a manager sees this</span>
          <button type="button" className="c-iv-link" onClick={onInventory}>
            Inventory &rsaquo;
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- An item ------------------------------------------------------------------------------------

/** Held hatched, free solid, what is on order dashed beyond it, and the reorder line. */
function StockTrack({ i }: { i: InvItem }) {
  const s = i.stock!;
  const max = Math.max(16, s.shelf + (s.onOrder ?? 0), s.reorderAt * 2);
  const pct = (n: number) => `${((n / max) * 100).toFixed(1)}%`;
  return (
    <div className="c-iv-level">
      <div className="c-tr">
        {s.held > 0 && <i className="c-held" style={{ width: pct(s.held) }} />}
        <i className="c-free" style={{ width: pct(free(i)) }} />
        {s.onOrder ? <i className="c-order" style={{ left: pct(s.shelf), width: pct(s.onOrder) }} /> : null}
        <span className="c-mk" style={{ left: pct(s.reorderAt) }}>
          <b>Reorder at {s.reorderAt}</b>
        </span>
      </div>
      <div className="c-ax">
        <span>0</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

export function StockCell({
  i,
  canChange,
  onAdjust,
  onReorder,
  onReceive,
}: {
  i: InvItem;
  canChange: boolean;
  onAdjust?: () => void;
  onReorder?: () => void;
  onReceive?: () => void;
}) {
  const s = i.stock!;
  const l = level(i);
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Stock</p>
          {s.onOrder ? (
            <Chip tone="neutral">On order</Chip>
          ) : l === 'low' ? (
            <Chip tone="underway">Low</Chip>
          ) : l === 'out' ? (
            <Chip tone="absent">Out</Chip>
          ) : (
            <Chip tone="settled">In stock</Chip>
          )}
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-iv-big">
          <p className="c-f">{s.shelf}</p>
          <p className="c-det">
            on the shelf
            {s.onOrder ? (
              <>
                {s.held > 0 && (
                  <>
                    {' '}
                    &middot; <b>{s.held} held</b>, so {free(i)} free
                  </>
                )}{' '}
                &middot; <b className="c-oo">{s.onOrder} on order</b>
                {s.due ? `, due ${s.due}` : ''}
              </>
            ) : (
              s.held > 0 && (
                <>
                  {' '}
                  &middot; <b>{s.held} held</b> for a waiting charge, so {free(i)} free
                </>
              )
            )}
          </p>
        </div>
        <StockTrack i={i} />
        <p className="c-label" style={{ margin: 'var(--s3) 0 4px' }}>
          Recent
        </p>
        <div className="c-iv-hist">
          {(i.history ?? []).map((h, n) => (
            <div key={n} className="c-iv-h">
              <div>
                <p className="c-t">{h.when}</p>
                <p className="c-det">{h.what}</p>
              </div>
              <span className={cx('c-q', h.tone && `c-${h.tone}`)}>{h.q}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          {canChange ? (
            <>
              <span className="c-det">Every change is kept.</span>
              <span className="c-pair" style={{ flexShrink: 0 }}>
                {s.onOrder ? (
                  <>
                    <button type="button" className="c-btn" onClick={onAdjust}>
                      Adjust stock
                    </button>
                    <button type="button" className="c-btn c-btn-primary" onClick={onReceive}>
                      Receive {s.onOrder}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="c-btn" onClick={onReorder}>
                      Mark reordered
                    </button>
                    <button type="button" className="c-btn c-btn-primary" onClick={onAdjust}>
                      Adjust stock
                    </button>
                  </>
                )}
              </span>
            </>
          ) : (
            <span className="c-det">Stock changes need an owner or a manager.</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function PriceCell({
  i,
  owner,
  onEdit,
  onOptions,
  onAddToCharge,
}: {
  i: InvItem;
  owner: boolean;
  onEdit?: () => void;
  onOptions?: () => void;
  onAddToCharge?: () => void;
}) {
  const margin = i.costCents !== undefined ? i.priceCents - i.costCents : null;
  const facts: [string, ReactNode][] = owner
    ? [
        ...(i.costCents !== undefined ? ([['You pay', usd(i.costCents)]] as [string, ReactNode][]) : []),
        ...(margin !== null ? ([['Margin', `${usd(margin)} · ${Math.round((margin / i.priceCents) * 100)}%`]] as [string, ReactNode][]) : []),
        ...(i.soldThisMonth ? ([['Sold with Clear, September', `${i.soldThisMonth.n} · ${usd(i.soldThisMonth.cents)}`]] as [string, ReactNode][]) : []),
        ['Size and type', i.detail],
        ['Sales tax', `${TAX_LABEL[i.tax]}${i.tax === 'goods' ? ' · 7.75%' : ''}`],
      ]
    : [
        ['Size and type', i.detail],
        ['Sales tax', `${TAX_LABEL[i.tax]}${i.tax === 'goods' ? ' · 7.75%' : ''}`],
        ...(i.goesWith ? ([['Goes well with', i.goesWith]] as [string, ReactNode][]) : []),
      ];
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Price</p>
          <span className="c-det">{i.per ?? 'Each'}</span>
        </div>
      </div>
      <div className="c-cmain c-iv-pc">
        <div className="c-iv-pricehead">
          <span className="c-iv-th c-lg" aria-hidden="true">
            <KindThumb kind={i.kind} />
          </span>
          <div className="c-iv-price-big">
            <p className="c-f">{usd(i.priceCents)}</p>
            <p className="c-det">What the counter charges</p>
          </div>
        </div>
        <div className="c-rows c-iv-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <div className="c-kv">
                <span>{k}</span>
                <span className="c-v">{v}</span>
              </div>
            </div>
          ))}
        </div>
        {i.options?.length ? (
          <div className="c-iv-optstrip">
            <div>
              <p className="c-label">Options</p>
              <p className="c-t">{i.options.map((g) => g.name).join(' · ')}</p>
              <p className="c-det">{owner ? 'Asked at the counter when it goes in a cart' : 'Asked when it goes in a cart'}</p>
            </div>
            {owner && (
              <button type="button" className="c-iv-link" onClick={onOptions}>
                Edit options
              </button>
            )}
          </div>
        ) : null}
      </div>
      <div className="c-cfoot">
        {owner ? (
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-det">New prices don&rsquo;t touch past charges.</span>
            <button type="button" className="c-btn" onClick={onEdit}>
              Edit item
            </button>
          </div>
        ) : (
          <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={onAddToCharge}>
            Add to a charge
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Stock sheets -------------------------------------------------------------------------------

function ItemHead({ i, det }: { i: InvItem; det: string }) {
  return (
    <div className="c-iv-sh-item">
      <span className="c-iv-th c-sm" aria-hidden="true">
        <KindThumb kind={i.kind} />
      </span>
      <div>
        <p className="c-t">{i.name}</p>
        <p className="c-det">{det}</p>
      </div>
    </div>
  );
}

const sizeOf = (i: InvItem) => i.detail.split(' · ')[0];

/**
 * One sheet for every reason stock moves by hand. The reason is chosen first, because it decides
 * whether the stepper adds, sets or takes away.
 */
export interface StockChange {
  why: 'received' | 'counted' | 'damaged';
  /** How many came in, were found, or were damaged. */
  n: number;
  /** What the shelf holds after. */
  after: number;
}

export function AdjustStockSheet({ i, onSave, onClose, inline }: { i: InvItem; onSave?: (change: StockChange) => void; onClose?: () => void; inline?: boolean }) {
  const s = i.stock!;
  const [why, setWhy] = useState<'received' | 'counted' | 'damaged'>('received');
  const [n, setN] = useState(why === 'received' ? 8 : s.shelf);
  const after = why === 'received' ? s.shelf + n : why === 'counted' ? n : Math.max(0, s.shelf - n);
  const above = after - s.reorderAt;
  const q = { received: ['How many came in', 'Added to what is on the shelf'], counted: ['How many are there', 'Replaces the count on the shelf'], damaged: ['How many are damaged', 'Taken off the shelf'] }[why];
  return (
    <Sheet
      inline={inline}
      title="Adjust stock"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!onSave} onClick={() => onSave?.({ why, n, after })}>
          Save &middot; {after} on the shelf
        </button>
      }
    >
      <ItemHead i={i} det={`${sizeOf(i)} · ${s.shelf} on the shelf`} />
      <p className="c-label c-iv-fl">Why</p>
      <div className="c-iv-reason" role="radiogroup" aria-label="Why">
        {(['received', 'counted', 'damaged'] as const).map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={why === w}
            className={cx('c-btn', why === w && 'c-on')}
            onClick={() => {
              setWhy(w);
              setN(w === 'counted' ? s.shelf : w === 'received' ? 8 : 1);
            }}
          >
            {w[0].toUpperCase() + w.slice(1)}
          </button>
        ))}
      </div>
      <div className="c-iv-adj">
        <div>
          <p className="c-t">{q[0]}</p>
          <p className="c-det">{q[1]}</p>
        </div>
        <Stepper value={n} onChange={setN} min={0} />
      </div>
      <div className="c-iv-was">
        <div>
          <p className="c-label">Now</p>
          <p className="c-f">{s.shelf}</p>
        </div>
        <div>
          <p className="c-label">After</p>
          <p className={cx('c-f', after > s.reorderAt && 'c-ok')}>{after}</p>
        </div>
      </div>
      <div className="c-rows">
        <div>
          <div className="c-kv">
            <span>Reorder line</span>
            <span className="c-v">
              {s.reorderAt} &middot; {above > 0 ? (s.shelf <= s.reorderAt ? `back above it by ${above}` : `above it by ${above}`) : above === 0 ? 'at it' : `below it by ${-above}`}
            </span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>Held for waiting charges</span>
            <span className="c-v">{s.held ? `${s.held}, unchanged` : '—'}</span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** How many are coming, from whom and when. It only notes the order; the shelf does not change. */
export function MarkReorderedSheet({
  i,
  initialN = 8,
  initialFrom = 'Western Tire Supply',
  initialWhen = 'Sat, Sep 26',
  onSave,
  onClose,
  inline,
}: {
  i: InvItem;
  initialN?: number;
  initialFrom?: string;
  initialWhen?: string;
  onSave?: (o: { n: number; from: string; when: string }) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const s = i.stock!;
  const [n, setN] = useState(initialN);
  const [from, setFrom] = useState(initialFrom);
  const [when, setWhen] = useState(initialWhen);
  return (
    <Sheet
      inline={inline}
      title="Mark reordered"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!onSave} onClick={() => onSave?.({ n, from, when })}>
          Save &middot; {n} on order
        </button>
      }
    >
      <ItemHead i={i} det={`${sizeOf(i)} · ${s.shelf} on the shelf, reorder at ${s.reorderAt}`} />
      <div className="c-iv-adj">
        <div>
          <p className="c-t">How many are coming</p>
          <p className="c-det">Enough to get back above {s.reorderAt}, with room</p>
        </div>
        <Stepper value={n} onChange={setN} min={1} />
      </div>
      <div className="c-iv-two" style={{ marginTop: 4 }}>
        <div>
          <p className="c-label c-iv-fl">From</p>
          <input className="c-field c-iv-in" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <p className="c-label c-iv-fl">Expected</p>
          <input className="c-field c-iv-in" aria-label="Expected" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
      </div>
      <p className="c-det" style={{ marginTop: 'var(--s2)', lineHeight: 1.5 }}>
        This only notes the order. Stock changes when the tires are received, so the shelf count stays true until they arrive.
      </p>
    </Sheet>
  );
}

/** Receiving opens with the ordered count. If fewer arrive, the rest stays on order. */
export function ReceiveSheet({
  i,
  initialN,
  ordered = 'Ordered Sep 23 from Western Tire Supply',
  onSave,
  onClose,
  inline,
}: {
  i: InvItem;
  initialN?: number;
  ordered?: string;
  onSave?: (n: number) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const s = i.stock!;
  const due = s.onOrder ?? 0;
  const [n, setN] = useState(initialN ?? due);
  const after = s.shelf + n;
  const short = due - n;
  return (
    <Sheet
      inline={inline}
      title="Receive the order"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!onSave} onClick={() => onSave?.(n)}>
          Receive {n} &middot; {after} on the shelf
        </button>
      }
    >
      <ItemHead i={i} det={ordered} />
      <div className="c-iv-adj">
        <div>
          <p className="c-t">How many arrived</p>
          <p className="c-det">{due} were ordered</p>
        </div>
        <Stepper value={n} onChange={setN} min={0} max={due} />
      </div>
      <div className="c-iv-was">
        <div>
          <p className="c-label">Now</p>
          <p className="c-f">{s.shelf}</p>
        </div>
        <div>
          <p className="c-label">After</p>
          <p className="c-f c-ok">{after}</p>
        </div>
      </div>
      <div className="c-rows">
        {short <= 0 && (
          <div>
            <div className="c-kv">
              <span>Reorder line</span>
              <span className="c-v">
                {s.reorderAt} &middot; back above it by {after - s.reorderAt}
              </span>
            </div>
          </div>
        )}
        <div>
          <div className="c-kv">
            <span>Still on order</span>
            <span className="c-v">{short > 0 ? `${short} · kept open` : '—'}</span>
          </div>
        </div>
      </div>
      {short > 0 && (
        <div className="c-iv-flag">
          <span className="c-dot" />
          <p className="c-det">Short by {short}. They stay on order until they arrive or you cancel them.</p>
        </div>
      )}
    </Sheet>
  );
}

// ---- Items, added and edited --------------------------------------------------------------------

const TAX_ORDER: TaxKind[] = ['goods', 'labour', 'food', 'exempt'];

function TaxChoice({ value, onChange }: { value: TaxKind; onChange: (t: TaxKind) => void }) {
  return (
    <div className="c-iv-reason" role="radiogroup" aria-label="Sales tax">
      {TAX_ORDER.map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} className={cx('c-btn', value === t && 'c-on')} onClick={() => onChange(t)}>
          {TAX_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

const Field = ({ label, value, onChange, className, placeholder }: { label: string; value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) => (
  <>
    <p className="c-label c-iv-fl">{label}</p>
    <input className={cx('c-field c-iv-in', className)} aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  </>
);

/**
 * Edit item: the same fields as Add item. A price change says who it affects before it is saved:
 * new charges get the new price, a charge already waiting keeps its own.
 */
export function EditItemSheet({
  i,
  initialPrice,
  waitingFor = 'Nina',
  onSave,
  onClose,
  onOptions,
  inline,
}: {
  i: InvItem;
  initialPrice?: string;
  /** Whose waiting charge holds the old price. */
  waitingFor?: string;
  onSave?: (patch: Partial<InvItem>) => void;
  onClose?: () => void;
  onOptions?: () => void;
  inline?: boolean;
}) {
  const [name, setName] = useState(i.name);
  const [detail, setDetail] = useState(i.detail);
  const [price, setPrice] = useState(initialPrice ?? usd(i.priceCents));
  const [cost, setCost] = useState(i.costCents !== undefined ? usd(i.costCents) : '');
  const [reorder, setReorder] = useState(String(i.stock?.reorderAt ?? ''));
  const [cat, setCat] = useState<string>(i.category);
  const [tax, setTax] = useState<TaxKind>(i.tax);
  const cents = Math.round(parseFloat(price.replace(/[^\d.]/g, '') || '0') * 100);
  const changed = cents !== i.priceCents;
  return (
    <Sheet
      inline={inline}
      title="Edit item"
      closeSize="lg"
      onClose={onClose}
      foot={
        <div className="c-pair">
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="c-btn c-btn-primary" disabled={!onSave} onClick={() => onSave?.({ name, detail, priceCents: cents, tax, category: cat as InvItem['category'], costCents: centsOf(cost) ?? undefined, stock: i.stock ? { ...i.stock, reorderAt: wholeOf(reorder) ?? i.stock.reorderAt } : undefined })}>
            Save changes
          </button>
        </div>
      }
    >
      <div className="c-iv-sh-item">
        <span className="c-iv-th c-sm" aria-hidden="true">
          <KindThumb kind={i.kind} />
        </span>
        <div>
          <p className="c-t">{i.name}</p>
          <p className="c-det">
            {i.category} &middot; {i.stock ? 'stock kept' : 'no stock kept'}
          </p>
        </div>
        <button type="button" className="c-iv-link" style={{ marginLeft: 'auto' }}>
          Change photo
        </button>
      </div>
      <Field label="Name" value={name} onChange={setName} />
      <Field label="Size or detail" value={detail} onChange={setDetail} />
      <div className="c-iv-two">
        <div>
          <Field label="Price" value={price} onChange={setPrice} className={changed ? 'c-iv-changed' : undefined} />
        </div>
        <div>
          <Field label="You pay" value={cost} onChange={setCost} placeholder="Optional" />
        </div>
      </div>
      <div className="c-iv-two">
        <div>
          <Field label="Reorder at" value={reorder} onChange={setReorder} />
        </div>
        <div>
          <Field label="Category" value={cat} onChange={setCat} />
        </div>
      </div>
      <p className="c-label c-iv-fl">Sales tax</p>
      <TaxChoice value={tax} onChange={setTax} />
      {i.options?.length ? (
        <div className="c-iv-optrow">
          <span>Options</span>
          <span className="c-v">
            {i.options.map((g) => (g.name === 'Road hazard warranty' ? 'Road hazard' : g.name.toLowerCase())).join(', ')}{' '}
            <button type="button" className="c-iv-link" onClick={onOptions}>
              Edit
            </button>
          </span>
        </div>
      ) : null}
      {changed && (
        <div className="c-iv-flag">
          <span className="c-dot" />
          <p className="c-det">
            Price goes from {usd(i.priceCents)} to {usd(cents)} on new charges.
            {i.stock?.held ? ` ${waitingFor}’s waiting charge keeps ${usd(i.priceCents)}.` : ''}
          </p>
        </div>
      )}
    </Sheet>
  );
}

/** Goods or a service first: it decides the rest of the form. */
/** A new item, as the Add item sheet collects it. */
export interface NewItem {
  service: boolean;
  name: string;
  detail: string | null;
  priceCents: number;
  costCents: number | null;
  /** On the shelf now; null for a service. */
  shelf: number | null;
  reorderAt: number | null;
  category: string;
  tax: TaxKind;
}

export function AddItemSheet({
  initialType = 'goods',
  initial,
  onAdd,
  onClose,
  inline,
}: {
  initialType?: 'goods' | 'service';
  initial?: Partial<Record<'name' | 'detail' | 'price' | 'cost' | 'shelf' | 'reorder' | 'per', string>>;
  onAdd?: (item: NewItem) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const [type, setType] = useState<'goods' | 'service'>(initialType);
  const [f, setF] = useState({ name: '', detail: '', price: '', cost: '', shelf: '', reorder: '', per: 'Per visit', ...initial });
  const [cat, setCat] = useState('Tires');
  const [tax, setTax] = useState<TaxKind>(initialType === 'service' ? 'labour' : 'goods');
  const set = (k: keyof typeof f) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));
  return (
    <Sheet
      inline={inline}
      title="Add item"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!onAdd || !f.name.trim() || !f.price.trim()} onClick={() =>
            onAdd?.({
              service: type === 'service',
              name: f.name.trim(),
              detail: type === 'service' ? f.per.trim() || null : f.detail.trim() || null,
              priceCents: centsOf(f.price) ?? 0,
              costCents: type === 'service' ? null : centsOf(f.cost),
              shelf: type === 'service' ? null : wholeOf(f.shelf),
              reorderAt: type === 'service' ? null : wholeOf(f.reorder),
              category: type === 'service' ? 'Services' : cat === '+ New' ? 'Other' : cat,
              tax,
            })
          }>
          Add to inventory
        </button>
      }
    >
      <div className="c-iv-type" role="radiogroup" aria-label="Goods or a service">
        {(['goods', 'service'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            className={cx('c-btn', type === t && 'c-on')}
            onClick={() => {
              setType(t);
              setTax(t === 'service' ? 'labour' : 'goods');
            }}
          >
            {t === 'goods' ? 'Goods' : 'Service'}
          </button>
        ))}
      </div>
      <Field label="Name" value={f.name} onChange={set('name')} />
      {type === 'goods' ? (
        <>
          <Field label="Size or detail" value={f.detail} onChange={set('detail')} />
          <div className="c-iv-two">
            <div>
              <Field label="Price" value={f.price} onChange={set('price')} />
            </div>
            <div>
              <Field label="You pay" value={f.cost} onChange={set('cost')} placeholder="Optional" className={f.cost ? undefined : 'c-muted'} />
            </div>
          </div>
          <div className="c-iv-two">
            <div>
              <Field label="On the shelf" value={f.shelf} onChange={set('shelf')} />
            </div>
            <div>
              <Field label="Reorder at" value={f.reorder} onChange={set('reorder')} />
            </div>
          </div>
          <p className="c-label c-iv-fl">Category</p>
          <div className="c-iv-reason" role="radiogroup" aria-label="Category">
            {['Tires', 'Brakes', 'Parts', '+ New'].map((c) => (
              <button key={c} type="button" role="radio" aria-checked={cat === c} className={cx('c-btn', cat === c && 'c-on')} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
          <p className="c-label c-iv-fl">Sales tax</p>
          <TaxChoice value={tax} onChange={setTax} />
        </>
      ) : (
        <>
          <div className="c-iv-two">
            <div>
              <Field label="Price" value={f.price} onChange={set('price')} />
            </div>
            <div>
              <Field label="Charged" value={f.per} onChange={set('per')} />
            </div>
          </div>
          <p className="c-label c-iv-fl">Sales tax</p>
          <TaxChoice value={tax} onChange={setTax} />
          <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
            Services keep no stock, and labour is not taxed. They sit in Services and can be added to any charge.
          </p>
        </>
      )}
    </Sheet>
  );
}

/** A whole catalogue from a spreadsheet, the columns matched to fields before anything is saved. */
export function ImportSheet({
  file,
  rows,
  columns,
  map,
  matches,
  onImport,
  onClose,
  inline,
}: {
  file: string;
  rows: number;
  columns: number;
  map: [string, string][];
  matches: number;
  onImport?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  return (
    <Sheet
      inline={inline}
      title="Import a spreadsheet"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!onImport} onClick={onImport}>
          Import {rows} items
        </button>
      }
    >
      <div className="c-iv-drop">
        <IconUpload />
        <p style={{ margin: '6px 0 0', fontSize: 'var(--t-sec)' }}>{file}</p>
        <p className="c-det">
          {rows} rows &middot; {columns} columns
        </p>
      </div>
      <p className="c-label" style={{ margin: 'var(--s2) 0 6px' }}>
        How the columns map
      </p>
      <div className="c-rows">
        {map.map(([from, to]) => (
          <div key={from}>
            <div className="c-kv">
              <span>{from}</span>
              <span className="c-v">{to}</span>
            </div>
          </div>
        ))}
      </div>
      {matches > 0 && (
        <div className="c-iv-flag">
          <span className="c-dot" />
          <p className="c-det">{matches} rows match items you have. Their stock is added to, not replaced.</p>
        </div>
      )}
    </Sheet>
  );
}

/** Archived, not deleted, once it has been sold: every past charge still says what it was for. */
export function ArchiveSheet({ i, sold, onKeep, onArchive, inline }: { i: InvItem; sold: string; onKeep?: () => void; onArchive?: () => void; inline?: boolean }) {
  const n = parseInt(sold, 10);
  return (
    <Sheet
      inline={inline}
      title="Archive this item?"
      closeSize="lg"
      onClose={onKeep}
      foot={
        <div className="c-pair">
          <button type="button" className="c-btn c-btn-primary" onClick={onKeep}>
            Keep it
          </button>
          <button type="button" className="c-btn" onClick={onArchive}>
            Archive
          </button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>
        {i.name} &middot; {sizeOf(i)}
      </p>
      <div className="c-rows" style={{ marginTop: 'var(--s2)' }}>
        <div>
          <div className="c-kv">
            <span>On the shelf</span>
            <span className="c-v">{i.stock?.shelf ?? 0}</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>Sold with Clear</span>
            <span className="c-v">{sold}</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>After archiving</span>
            <span className="c-v">Hidden from the counter</span>
          </div>
        </div>
      </div>
      <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
        It is archived rather than deleted, because {n} charges name it. You can bring it back when winter stock arrives.
      </p>
    </Sheet>
  );
}

// ---- Options ------------------------------------------------------------------------------------

/**
 * The item's option groups as the owner edits them, in the order the counter sees them; beside
 * it, the counter's own sheet drawn live.
 */
export function OptionsPage({
  i,
  asItem,
  onAddGroup,
}: {
  i: InvItem;
  /** The item as New Charge sees it, for the live preview. */
  asItem: Item;
  onAddGroup?: () => void;
}) {
  const groups = i.options ?? [];
  const per = i.kind === 'tire' ? ' a tire' : '';
  return (
    <Slab>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Options</p>
            <span className="c-det">{groups.length} groups</span>
          </div>
        </div>
        <div className="c-cmain">
          {groups.map((g) => (
            <div key={g.id} className="c-iv-grp">
              <div className="c-gh">
                <span className="c-drag" aria-label="Drag to reorder">
                  <IconDrag />
                </span>
                <div>
                  <p className="c-t">{g.name}</p>
                  <p className="c-det">{g.rule === 'one' ? 'Pick one' : 'Pick any'}</p>
                </div>
                {g.required ? <Chip tone="underway">Required</Chip> : <Chip tone="neutral">Optional</Chip>}
              </div>
              <div className="c-go">
                {g.choices.map((c, n) => (
                  <div key={c.id} className="c-iv-opt">
                    <span className={cx(g.rule === 'one' ? 'c-iv-radio' : 'c-iv-check', g.rule === 'one' && n === 0 && 'c-on')} />
                    <span className="c-n">{c.name}</span>
                    <span className="c-d">{c.deltaCents ? `+${usd(c.deltaCents)}${per}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="c-cfoot">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-det">Drag to change the order the counter sees</span>
            <button type="button" className="c-btn" onClick={onAddGroup}>
              Add a group
            </button>
          </div>
        </div>
      </div>
      <div className="c-cell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">At the counter</p>
            <span className="c-det">Preview</span>
          </div>
        </div>
        <div className="c-cmain c-iv-preview">
          <OptionsSheet inline item={asItem} initial={{ warranty: ['3y'], extras: ['disposal'] }} initialQty={4} />
        </div>
        <div className="c-cfoot">
          <p className="c-det">Options add to the price of each tire, and are taxed with it.</p>
        </div>
      </div>
    </Slab>
  );
}

/** Name, must pick or can skip, one or any, and the choices with what each adds. */
/** A new option group, as the sheet collects it. */
export interface NewGroup {
  name: string;
  required: boolean;
  rule: 'one' | 'any';
  choices: { name: string; deltaCents: number }[];
}

export function AddGroupSheet({
  initialName = '',
  initialRequired = false,
  initialRule = 'any',
  initialChoices = [],
  onSave,
  onClose,
  inline,
}: {
  initialName?: string;
  initialRequired?: boolean;
  initialRule?: 'one' | 'any';
  initialChoices?: { name: string; price: string }[];
  onSave?: (g: NewGroup) => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [required, setRequired] = useState(initialRequired);
  const [rule, setRule] = useState<'one' | 'any'>(initialRule);
  const [choices, setChoices] = useState(initialChoices.length ? initialChoices : [{ name: '', price: '' }]);
  const seg = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" role="radio" aria-checked={on} className={cx('c-btn', on && 'c-on')} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <Sheet
      inline={inline}
      title="Add an option group"
      closeSize="lg"
      onClose={onClose}
      foot={
        <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!name.trim()} onClick={() => onSave?.({ name: name.trim(), required, rule, choices: choices.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), deltaCents: centsOf(c.price) ?? 0 })) })}>
          Save group
        </button>
      }
    >
      <p className="c-label c-iv-fl" style={{ marginTop: 0 }}>
        Name
      </p>
      <input className="c-field c-iv-in" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="c-iv-two" style={{ marginTop: 4 }}>
        <div>
          <p className="c-label c-iv-fl">The customer</p>
          <div className="c-iv-type" role="radiogroup" aria-label="The customer">
            {seg(required, 'Must pick', () => setRequired(true))}
            {seg(!required, 'Can skip', () => setRequired(false))}
          </div>
        </div>
        <div>
          <p className="c-label c-iv-fl">How many</p>
          <div className="c-iv-type" role="radiogroup" aria-label="How many">
            {seg(rule === 'one', 'One', () => setRule('one'))}
            {seg(rule === 'any', 'Any', () => setRule('any'))}
          </div>
        </div>
      </div>
      <p className="c-label c-iv-fl">Choices</p>
      <div className="c-iv-choices">
        {choices.map((c, n) => (
          <div key={n} className="c-r">
            <input className="c-field c-iv-in" aria-label={`Choice ${n + 1}`} value={c.name} onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === n ? { ...x, name: e.target.value } : x)))} />
            <input
              className="c-field c-iv-in c-pr"
              aria-label={`Choice ${n + 1} adds`}
              value={c.price}
              onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === n ? { ...x, price: e.target.value } : x)))}
            />
          </div>
        ))}
        <button type="button" className="c-iv-link" onClick={() => setChoices((cs) => [...cs, { name: '', price: '' }])}>
          + Add a choice
        </button>
      </div>
      <p className="c-det" style={{ marginTop: 'var(--s2)', lineHeight: 1.5 }}>
        A choice can be free. Price changes are per item, so four tires with disposal add $12.00.
      </p>
    </Sheet>
  );
}
