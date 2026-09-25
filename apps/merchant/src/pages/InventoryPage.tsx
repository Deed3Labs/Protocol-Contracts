import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { useLayout } from '@/lib/useBreakpoint';
import { FlowTop } from '@/shell/chrome';
import { PhoneBack } from '@/charge/phone';
import { CATALOG } from '@/charge/model';
import { GOODYEAR_ON_ORDER, INVENTORY, SHELF_AT_COST_CENTS, type InvItem } from '@/inventory/model';
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
  type Show,
  type SortBy,
} from '@/inventory/views';
import { Slab } from '@/brand/ui';

/**
 * Inventory — docs/merchant-reference/clear-merchant-inventory.html.
 *
 * **A live shop has no catalog yet**: there is no API for items or stock (card-processing prompt,
 * Phase 2), so a live shop sees the reference's empty state, which is true of it, and its sheets
 * open but cannot save. In development, `?preview=1&screen=<frame>` shows the reference scenario:
 * list, menu-filter, menu-sort, empty, and on an item (/inventory/goodyear) item, on-order,
 * adjust, reorder, receive, receive-short, edit, archive, options, add-group; on the list, add,
 * add-service, import.
 */

type Sheet = 'add' | 'add-service' | 'import' | 'adjust' | 'reorder' | 'receive' | 'receive-short' | 'edit' | 'archive' | 'add-group' | null;

const SHEETS = new Set(['add', 'add-service', 'import', 'adjust', 'reorder', 'receive', 'receive-short', 'edit', 'archive', 'add-group']);

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

  const preview = import.meta.env.DEV && params.get('preview') === '1';
  const screen = preview ? (params.get('screen') ?? '') : '';
  const items: InvItem[] = preview && screen !== 'empty' ? INVENTORY : [];

  const [show, setShow] = useState<Show>('all');
  const [sort, setSort] = useState<SortBy>('category');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<Sheet>(SHEETS.has(screen) ? (screen as Sheet) : null);
  const close = () => setSheet(null);
  // Saving needs the catalog API; a live shop's sheets open but their primary action waits for it.
  const save = preview ? close : undefined;
  const q = preview ? '?preview=1' : '';

  const item = id ? (screen === 'on-order' || sheet === 'receive' || sheet === 'receive-short' ? GOODYEAR_ON_ORDER : items.find((i) => i.id === id)) : undefined;

  const sheets = (
    <>
      {sheet === 'add' && <AddItemSheet onClose={close} onAdd={save} initial={screen === 'add' ? { name: 'Pirelli Scorpion AS Plus 3', detail: '235/65R17', price: '$176.00', shelf: '8', reorder: '4' } : undefined} />}
      {sheet === 'add-service' && <AddItemSheet initialType="service" onClose={close} onAdd={save} initial={{ name: 'Tire rotation', price: '$35.00' }} />}
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
          onImport={save}
          onClose={close}
        />
      )}
      {item && sheet === 'adjust' && <AdjustStockSheet i={item} onSave={save} onClose={close} />}
      {item && sheet === 'reorder' && <MarkReorderedSheet i={item} onSave={save} onClose={close} />}
      {item && (sheet === 'receive' || sheet === 'receive-short') && <ReceiveSheet i={item} initialN={sheet === 'receive-short' ? 6 : undefined} onSave={save} onClose={close} />}
      {item && sheet === 'edit' && <EditItemSheet i={item} initialPrice={screen === 'edit' ? '$168.00' : undefined} onSave={save} onClose={close} onOptions={() => navigate(`/inventory/${item.id}/options${q}`)} />}
      {item && sheet === 'archive' && <ArchiveSheet i={item} sold="11 since August" onKeep={close} onArchive={save} />}
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
          onSave={save}
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
        <OptionsPage i={item} asItem={CATALOG.find((c) => c.id === 'michelin')!} onAddGroup={() => setSheet('add-group')} />
        {sheets}
      </div>
    );
  }

  // ---- An item ------------------------------------------------------------------------------------
  if (id) {
    if (!item) {
      navigate(`/inventory${q}`, { replace: true });
      return null;
    }
    const title = `${item.name} · ${item.detail.split(' · ')[0]}`;
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
          onAddToCharge={() => navigate(`/new?items=1${preview ? '&preview=1' : ''}`)}
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
  if (!items.length) {
    return (
      <>
        <InventoryEmpty onAdd={() => setSheet('add')} onImport={() => setSheet('import')} />
        {sheets}
      </>
    );
  }
  return (
    <>
      <InventorySummary items={items} atCostCents={SHELF_AT_COST_CENTS} owner={owner} />
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
        onAdd={() => setSheet('add')}
        onImport={() => setSheet('import')}
        menuOpen={screen === 'menu-filter' ? 'filter' : screen === 'menu-sort' ? 'sort' : undefined}
      />
      {sheets}
    </>
  );
}
