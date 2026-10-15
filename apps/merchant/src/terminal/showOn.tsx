import { useState } from 'react';
import type { Device, TableView } from '@clear/merchant-contracts';
import { Chip } from '@/brand/controls';
import { Sheet } from '@/brand/ui';
import { Rows } from '@/settings/views';

/**
 * Show it on (terminal reference, section 7): where the customer sees the charge. The counter Point
 * by default; a table's Point when the order is a table's; or just this tablet. Choosing a Point puts
 * the total and the code on it, and the card and cash buttons still work here. Saved on the tablet
 * for the next sale until it's changed.
 */

type Point = Extract<Device, { kind: 'point' }>;
const KEY = 'clear.merchant.showOn';
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** The Point picked last on this tablet, or the counter's. `null` is just this tablet. */
export function useShowOn(points: Point[]): [string | null, (id: string | null) => void] {
  const counter = points.find((p) => p.settings.placement === 'counter')?.id ?? null;
  const [picked, setPicked] = useState<string | null | undefined>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === null ? undefined : v === '' ? null : v;
    } catch {
      return undefined;
    }
  });
  const value = picked === undefined || (picked && !points.some((p) => p.id === picked)) ? counter : picked;
  const set = (id: string | null) => {
    setPicked(id);
    try {
      localStorage.setItem(KEY, id ?? '');
    } catch {
      // Private windows: it's this sale's choice only.
    }
  };
  return [value, set];
}

/** The checkout row: "Show on · Counter". */
export function ShowOnRow({ name, onChange }: { name: string; onChange: () => void }) {
  return (
    <div className="c-r">
      <span className="c-k">Show on</span>
      <button type="button" className="c-ci-link" onClick={onChange}>
        {name}
      </button>
    </div>
  );
}

export function ShowOnSheet({
  points,
  tables,
  value,
  tabItems = {},
  onPick,
  onClose,
}: {
  points: Point[];
  tables: TableView[];
  value: string | null;
  /** Items on each table's tab, by table id: "Its tab: 3 items, $48.20". */
  tabItems?: Record<string, number>;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const shown = points.filter((p) => p.settings.placement !== 'door');
  const det = (p: Point) => {
    if (p.settings.placement === 'counter') return `${p.model === 'point_large' ? 'Point Large' : 'Point'} · the default`;
    const t = tables.find((x) => x.id === p.settings.tableId);
    if (!t || t.status === 'free') return 'Free';
    if (t.tabCents === null) return 'Seated';
    return tabItems[t.id] !== undefined ? tabDet(tabItems[t.id]!, t.tabCents) : `Its tab: ${usd(t.tabCents)}`;
  };
  const row = (id: string | null, t: string, d: string) => (
    <div key={id ?? 'tablet'}>
      <div className="c-r2" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onPick(id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(id)}>
        <div>
          <p className="c-t">{t}</p>
          <p className="c-det">{d}</p>
        </div>
        <span className="c-end">{value === id && <Chip tone="settled">Showing</Chip>}</span>
      </div>
    </div>
  );
  return (
    <Sheet className="c-st-sheet c-tm-sheet c-w420" title="Show it on" onClose={onClose} foot={<p className="c-det">Saved for the next sale until you change it.</p>}>
      <Rows link>
        {shown.map((p) => row(p.id, p.name, det(p)))}
        {row(null, 'Just this tablet', 'Nothing on a Point')}
      </Rows>
    </Sheet>
  );
}

/** "Its tab: 3 items, $48.20", from the tab's order when it's known. */
export const tabDet = (items: number, cents: number) => `Its tab: ${items} item${items === 1 ? '' : 's'}, ${usd(cents)}`;
