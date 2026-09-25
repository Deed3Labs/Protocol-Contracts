import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { OptionGroup as ApiOptionGroup, StockAdjustment } from '@clear/merchant-contracts';
import { seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { useLayout } from '@/lib/useBreakpoint';
import { FlowTop } from '@/shell/chrome';
import { PhoneBack } from '@/charge/phone';
import { CATALOG, type Item } from '@/charge/model';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { fromCatalog, GOODYEAR_ON_ORDER, INVENTORY, SHELF_AT_COST_CENTS, shelfAtCost, type InvItem } from '@/inventory/model';
import {
  AddGroupSheet,
  AddItemSheet,
  AdjustStockSheet,
  ArchiveSheet,
  EditItemSheet,
  ImportSheet,
  InventoryEmpty,
  InventoryList,
  InventorySummary,
  MarkReorderedSheet,
  OptionsPage,
  PriceCell,
  ReceiveSheet,
  StockCell,
  type NewGroup,
  type NewItem,
  type Show,
  type SortBy,
  type StockChange,
} from '@/inventory/views';
import { Slab } from '@/brand/ui';

/**
 * Inventory — docs/merchant-reference/clear-merchant-inventory.html.
 *
 * A live shop's items, stock, reorders and options come from the catalog API (MerchantApi), and
 * every sheet saves to it. Managers and owners change things; a counter shift sees the list.
 *
 * In development, `?preview=1&screen=<frame>` shows the reference scenario: list, menu-filter,
 * menu-sort, empty, and on an item (/inventory/goodyear) item, on-order, adjust, reorder, receive,
 * receive-short, edit, archive, options, add-group; on the list, add, add-service, import.
 * `?preview=1&live=1` runs the live page against the mock.
 */

type Sheet = 'add' | 'add-service' | 'import' | 'adjust' | 'reorder' | 'receive' | 'receive-short' | 'edit' | 'archive' | 'add-group' | null;

const SHEETS = new Set(['add', 'add-service', 'import', 'adjust', 'reorder', 'receive', 'receive-short', 'edit', 'archive', 'add-group']);

/** "Sat, Sep 26" (this year, or next if it's passed) → "2026-09-26"; anything else → null. */
function isoDay(text: string): string | null {
  const m = /([A-Z][a-z]{2})\s+(\d{1,2})/.exec(text);
  if (!m) return null;
  const now = new Date();
  let d = new Date(`${m[1]} ${m[2]}, ${now.getFullYear()} 12:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < now.getTime() - 86_400_000) d = new Date(`${m[1]} ${m[2]}, ${now.getFullYear() + 1} 12:00`);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An inventory item as New Charge shows it, for the options page's live preview. */
const asChargeItem = (i: InvItem): Item => ({
  id: i.id,
  name: i.name,
  detail: i.detail,
  category: i.category,
  thumb: i.kind === 'tire' ? 'tire' : i.kind === 'service' ? 'service' : 'part',
  priceCents: i.priceCents,
  tax: i.tax,
  ...(i.stock ? { stock: { free: Math.max(0, i.stock.shelf - i.stock.held), held: i.stock.held, low: i.stock.shelf <= i.stock.reorderAt } } : {}),
  ...(i.options ? { options: i.options } : {}),
});

export default function InventoryPage() {
  const navigate = useNavigate();
  const { id, sub } = useParams();
  const [params] = useSearchParams();
  const { session } = useAuth();
  const layout = useLayout();
  const phone = layout === 'phone';
  const role = session?.staff.role ?? 'counter';
  const owner = seesMoney(role);
  const me = session?.staff.name ?? '';

  const preview = import.meta.env.DEV && params.get('preview') === '1' && params.get('live') !== '1';
  const screen = preview ? (params.get('screen') ?? '') : '';
  const q = params.get('preview') === '1' ? `?preview=1${params.get('live') === '1' ? '&live=1' : ''}` : '';

  // ---- A live shop's catalogue ----------------------------------------------------------------------
  const api = useMerchantApi();
  const catalog = useApi(() => (preview ? Promise.resolve(null) : api.catalog()), [preview]);
  // Reorders and history are the managers' (a counter is refused them, which reads as none).
  const reorders = useApi(() => (preview || !owner ? Promise.resolve(null) : api.reorders()), [preview, owner]);
  const history = useApi(() => (preview || !owner || !id ? Promise.resolve(null) : api.stockHistory(id)), [preview, owner, id]);
  const liveItems = (catalog.data ?? []).map((c) => fromCatalog(c, reorders.data ?? [], c.id === id ? history.data : null));
  const items: InvItem[] = preview ? (screen !== 'empty' ? INVENTORY : []) : liveItems;

  const [show, setShow] = useState<Show>('all');
  const [sort, setSort] = useState<SortBy>('category');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<Sheet>(SHEETS.has(screen) ? (screen as Sheet) : null);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setSheet(null);
    setError(null);
  };

  const item = id ? (preview && (screen === 'on-order' || sheet === 'receive' || sheet === 'receive-short') ? GOODYEAR_ON_ORDER : items.find((i) => i.id === id)) : undefined;

  /** A sheet's save: the preview just closes; a live shop saves, re-reads, and closes (or says why not). */
  function save<A extends unknown[]>(fn: (...a: A) => Promise<unknown>): ((...a: A) => void) | undefined {
    if (preview) return () => close();
    if (!owner) return undefined;
    return (...a: A) => {
      setError(null);
      fn(...a)
        .then(() => {
          catalog.reload();
          reorders.reload();
          history.reload();
          setSheet(null);
        })
        .catch((e: unknown) => setError(errorSentence(e)));
    };
  }

  const onAdd = save(async (n: NewItem) => {
    const created = await api.createItem({ name: n.name, detail: n.detail, category: n.category, priceCents: n.priceCents, costCents: n.costCents, taxKind: n.tax, stockTracked: !n.service, reorderAt: n.reorderAt });
    if (n.shelf) await api.adjustStock({ itemId: created.id, kind: 'receive', quantity: n.shelf, reason: 'Opening stock' });
  });
  const onAdjust = save(async (c: StockChange) => {
    if (!item) return;
    if (c.why !== 'counted' && c.n <= 0) return;
    const adj: StockAdjustment =
      c.why === 'received' ? { itemId: item.id, kind: 'receive', quantity: c.n, reason: null } : c.why === 'counted' ? { itemId: item.id, kind: 'count', found: c.n, reason: null } : { itemId: item.id, kind: 'damage', quantity: c.n, reason: null };
    await api.adjustStock(adj);
  });
  const openReorder = item ? (reorders.data ?? []).find((r) => r.itemId === item.id && (r.status === 'open' || r.status === 'partly_received')) : undefined;
  const onReorder = save(async (o: { n: number; from: string; when: string }) => {
    if (!item) return;
    await api.markReordered({ itemId: item.id, quantity: o.n, supplier: o.from.trim() || null, expectedOn: isoDay(o.when) });
  });
  const onReceive = save(async (n: number) => {
    if (!openReorder) throw Object.assign(new Error('There’s no open order for this item to receive against. Use Adjust stock instead.'), { status: 409 });
    await api.receiveReorder(openReorder.id, { quantity: n });
  });
  const onEdit = save(async (p: Partial<InvItem>) => {
    if (!item) return;
    await api.updateItem(item.id, {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.detail !== undefined ? { detail: p.detail || null } : {}),
      ...(p.priceCents !== undefined ? { priceCents: p.priceCents } : {}),
      ...(p.tax !== undefined ? { taxKind: p.tax } : {}),
      ...(p.category !== undefined ? { category: p.category } : {}),
      ...(p.costCents !== undefined ? { costCents: p.costCents } : {}),
      ...(p.stock ? { reorderAt: p.stock.reorderAt } : {}),
    });
  });
  const onArchive = save(async () => {
    if (!item) return;
    await api.archiveItem(item.id);
    navigate(`/inventory${q}`);
  });
  const onAddGroup = save(async (g: NewGroup) => {
    if (!item) return;
    const current = catalog.data?.find((c) => c.id === item.id)?.optionGroups ?? [];
    const keep: Omit<ApiOptionGroup, 'id'>[] = current.map(({ id: _id, ...rest }) => rest);
    await api.saveOptionGroups(item.id, [...keep, { name: g.name, rule: g.rule, required: g.required, position: current.length, options: g.choices.map((c, i) => ({ id: `new-${i}`, name: c.name, deltaCents: c.deltaCents, position: i })) }]);
  });

  const sheets = (
    <>
      {error && sheet && (
        <p className="c-det c-iv-error" role="alert" style={{ position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 60, color: 'var(--absent)', background: 'var(--paper)', padding: 'var(--s2)', border: '1px solid var(--absent)' }}>
          {error}
        </p>
      )}
      {sheet === 'add' && <AddItemSheet onClose={close} onAdd={onAdd} initial={screen === 'add' ? { name: 'Pirelli Scorpion AS Plus 3', detail: '235/65R17', price: '$176.00', shelf: '8', reorder: '4' } : undefined} />}
      {sheet === 'add-service' && <AddItemSheet initialType="service" onClose={close} onAdd={onAdd} initial={preview ? { name: 'Tire rotation', price: '$35.00' } : undefined} />}
      {sheet === 'import' && (
        <ImportSheet
          file="stock-sept.csv"
          rows={42}
          columns={5}
          map={[
            ['Item', 'Name'],
            ['Size', 'Size or detail'],
            ['Retail', 'Price'],
            ['Cost', 'You pay'],
            ['Qty', 'On the shelf'],
          ]}
          matches={3}
          // A spreadsheet import has no endpoint yet: items are added one at a time.
          onImport={preview ? close : undefined}
          onClose={close}
        />
      )}
      {item && sheet === 'adjust' && <AdjustStockSheet i={item} onSave={onAdjust} onClose={close} />}
      {item && sheet === 'reorder' && <MarkReorderedSheet i={item} onSave={onReorder} onClose={close} {...(preview ? {} : { initialFrom: '', initialWhen: '' })} />}
      {item && (sheet === 'receive' || sheet === 'receive-short') && (
        <ReceiveSheet
          i={item}
          initialN={sheet === 'receive-short' ? 6 : undefined}
          {...(preview ? {} : { ordered: openReorder ? `Ordered${openReorder.supplier ? ` from ${openReorder.supplier}` : ''}` : 'No open order' })}
          onSave={onReceive}
          onClose={close}
        />
      )}
      {item && sheet === 'edit' && <EditItemSheet i={item} initialPrice={screen === 'edit' ? '$168.00' : undefined} onSave={onEdit} onClose={close} onOptions={() => navigate(`/inventory/${item.id}/options${q}`)} />}
      {item && sheet === 'archive' && <ArchiveSheet i={item} sold={preview ? '11 since August' : ''} onKeep={close} onArchive={onArchive} />}
      {sheet === 'add-group' && (
        <AddGroupSheet
          initialName={screen === 'add-group' ? 'Extras' : ''}
          initialChoices={
            screen === 'add-group'
              ? [
                  { name: 'Old tire disposal', price: '+$3.00' },
                  { name: 'Nitrogen fill', price: '+$5.00' },
                ]
              : []
          }
          onSave={onAddGroup}
          onClose={close}
        />
      )}
    </>
  );

  // ---- An item's options ------------------------------------------------------------------------
  if (item && sub === 'options') {
    return (
      <div className="c-app c-mc-tablet c-mc-page" style={{ height: 'auto', minHeight: '100dvh' }}>
        <FlowTop back title={`${item.name} · options`} onExit={() => navigate(`/inventory/${item.id}${q}`)} onShift={me} />
        <OptionsPage i={item} asItem={preview ? CATALOG.find((c) => c.id === 'michelin')! : asChargeItem(item)} onAddGroup={owner || preview ? () => setSheet('add-group') : undefined} />
        {sheets}
      </div>
    );
  }

  // ---- An item ------------------------------------------------------------------------------------
  if (id) {
    if (!item) {
      // Still loading, or gone (archived elsewhere): back to the list once we know.
      if (!preview && catalog.loading) return null;
      navigate(`/inventory${q}`, { replace: true });
      return null;
    }
    const title = item.detail ? `${item.name} · ${item.detail.split(' · ')[0]}` : item.name;
    const body = (
      <Slab>
        {item.stock && (
          <StockCell
            i={item}
            canChange={owner}
            onAdjust={() => setSheet('adjust')}
            onReorder={() => setSheet('reorder')}
            onReceive={() => setSheet('receive')}
          />
        )}
        <PriceCell
          i={item}
          owner={owner}
          onEdit={() => setSheet('edit')}
          onOptions={() => navigate(`/inventory/${item.id}/options${q}`)}
          onAddToCharge={() => navigate(`/new?items=1${q ? `&${q.slice(1)}` : ''}`)}
        />
      </Slab>
    );
    return phone ? (
      // On a phone the shell stays, with a back row above the item.
      <>
        <PhoneBack back title={item.name} onExit={() => navigate(`/inventory${q}`)} />
        {body}
        {sheets}
      </>
    ) : (
      <div className="c-app c-mc-tablet c-mc-page">
        <FlowTop back title={title} onExit={() => navigate(`/inventory${q}`)} onShift={me} />
        {body}
        {sheets}
      </div>
    );
  }

  // ---- The list -----------------------------------------------------------------------------------
  if (!preview && catalog.error && !catalog.data) {
    return (
      <p className="c-det" role="alert" style={{ padding: 'var(--s3) 0' }}>
        {catalog.error}
      </p>
    );
  }
  if (!preview && catalog.loading && !catalog.data) return null;
  if (!items.length) {
    return (
      <>
        <InventoryEmpty onAdd={owner || preview ? () => setSheet('add') : undefined} onImport={() => setSheet('import')} />
        {sheets}
      </>
    );
  }
  return (
    <>
      <InventorySummary items={items} atCostCents={preview ? SHELF_AT_COST_CENTS : shelfAtCost(items)} owner={owner} />
      <InventoryList
        items={items}
        owner={owner}
        phone={phone}
        show={show}
        onShow={setShow}
        sort={sort}
        onSort={setSort}
        category={category}
        onCategory={setCategory}
        search={search}
        onSearch={setSearch}
        onOpen={(i) => navigate(`/inventory/${i.id}${q}`)}
        onAdd={owner || preview ? () => setSheet('add') : undefined}
        onImport={() => setSheet('import')}
        menuOpen={screen === 'menu-filter' ? 'filter' : screen === 'menu-sort' ? 'sort' : undefined}
      />
      {sheets}
    </>
  );
}
