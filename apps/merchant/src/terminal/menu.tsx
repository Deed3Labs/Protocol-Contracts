import { useState } from 'react';
import type { CatalogItem } from '@clear/merchant-contracts';
import { Sheet } from '@/brand/ui';
import { Btn, Cell, FootLine, Main, R2, Rows, Tg } from '@/settings/views';

/**
 * Inventory › On the menu (terminal reference, section 10). The menu is Inventory, so the only new
 * thing is what shows: each item gets one switch, and the categories an order. The phone page's
 * menu and a Point's showcase both read from here. Off still sells at the counter.
 */

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** "Tacos · $4.50 · 140 sold this week"; an item off the menu says why in its own detail ("weekends only"). */
const det = (i: CatalogItem, sold?: number) => [i.category, usd(i.priceCents), sold ? `${sold} sold this week` : null, i.onMenu === false && i.detail ? i.detail : null].filter(Boolean).join(' · ');

export function OnTheMenuCell({
  items,
  sold = {},
  canEdit,
  onToggle,
  onOrder,
}: {
  items: CatalogItem[];
  sold?: Record<string, number>;
  canEdit: boolean;
  onToggle: (item: CatalogItem, on: boolean) => void;
  onOrder: () => void;
}) {
  return (
    <Cell
      label="On the menu"
      det="What phones and Points show"
      foot={
        <FootLine det="Off here still sells at the counter. It just isn’t on the menu.">
          <Btn onClick={onOrder} disabled={!canEdit}>
            Category order
          </Btn>
        </FootLine>
      }
    >
      <Main>
        <Rows>
          {items.map((i) => (
            <R2 key={i.id} t={i.name} det={det(i, sold[i.id])} end={<Tg on={i.onMenu !== false} label={`${i.name} on the menu`} onChange={canEdit ? (on) => onToggle(i, on) : undefined} />} />
          ))}
        </Rows>
      </Main>
    </Cell>
  );
}

/** Category order: the menu's groups, top to bottom (not drawn: rows that move up and down). */
export function CategoryOrderSheet({ categories, busy, onSave, onClose }: { categories: string[]; busy?: boolean; onSave: (names: string[]) => void; onClose: () => void }) {
  const [names, setNames] = useState(categories);
  const move = (i: number, by: -1 | 1) =>
    setNames((n) => {
      const j = i + by;
      if (j < 0 || j >= n.length) return n;
      const out = [...n];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet"
      title="Category order"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">Phones and Points show them in this order.</p>
          <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => onSave(names)}>
            Save the order
          </button>
        </div>
      }
    >
      <Rows>
        {names.map((n, i) => (
          <R2
            key={n}
            t={n}
            det={i === 0 ? 'First' : `${i + 1} of ${names.length}`}
            end={
              <span className="c-pair">
                <button type="button" className="c-btn c-sm" aria-label={`Move ${n} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </button>
                <button type="button" className="c-btn c-sm" aria-label={`Move ${n} down`} disabled={i === names.length - 1} onClick={() => move(i, 1)}>
                  Down
                </button>
              </span>
            }
          />
        ))}
      </Rows>
    </Sheet>
  );
}
