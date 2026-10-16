import { useState, type ReactNode } from 'react';
import type { Order, PickupOrder, TableRequest, TableView, Waitlist, WaitlistParty } from '@clear/merchant-contracts';
import { Chip } from '@/brand/controls';
import { cx, Sheet, Slab } from '@/brand/ui';
import { R2, Rows, Tg } from '@/settings/views';
import { money } from './drawings';

/**
 * Tables (terminal reference, sections 8, 8b, 9 and 13b): the floor and the wait list side by side,
 * because the door and the floor are the same job at dinner; a table's tab; seating a party; Order
 * ready for counter service; and Calls and bills from the Pay case.
 */

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const mins = (from: string, now: number) => Math.max(0, Math.round((now - Date.parse(from)) / 60_000));
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);
const IDLE: Record<string, string> = { number: 'its number', menu: 'Menu', showcase: 'Showcase', pay: 'Pay here', waitlist: 'the wait list' };

// ---- The floor ------------------------------------------------------------------------------------------

/** One tile: its number, how long it has been seated, its tab, and its Point's state. */
export function Tile({ t, now, onTap }: { t: TableView; now: number; onTap?: () => void }) {
  const since =
    t.status === 'free'
      ? 'Free'
      : t.status === 'held'
        ? `Held ${mins(t.hold!.seatedAt, now)} min`
        : t.status === 'paid' && t.paidAt
          ? `Paid ${mins(t.paidAt, now)} min ago`
          : `Seated ${t.seatedAt ? mins(t.seatedAt, now) : 0} min`;
  const line =
    t.status === 'free'
      ? t.point
        ? `Point shows ${t.point.showing.kind === 'idle' ? IDLE[t.point.showing.mode] : 'its screen'}`
        : 'No Point'
      : t.status === 'held'
        ? `Held for ${t.hold!.partyName}`
        : { seated: 'Seated', ordering: 'Ordering', bill_sent: 'Bill sent', paid: 'Paid' }[t.status];
  const amount = t.status === 'free' || t.status === 'held' ? '—' : usd(t.tabCents ?? 0);
  return (
    <div
      className={cx(
        'c-tm-tile',
        t.status === 'free' && 'c-free',
        t.status === 'held' && 'c-held',
        t.status === 'bill_sent' && 'c-bill',
        t.status === 'paid' && 'c-paid',
        t.request?.state === 'open' && 'c-call',
      )}
      role={onTap ? 'button' : undefined}
      tabIndex={onTap ? 0 : undefined}
      aria-label={onTap ? `Table ${t.number}` : undefined}
      onClick={onTap}
      onKeyDown={(e) => onTap && (e.key === 'Enter' || e.key === ' ') && onTap()}
      style={onTap ? { cursor: 'pointer' } : undefined}
    >
      <div className="c-tm-tt">
        <b>{t.label ?? t.number}</b>
        <span className="c-det">{since}</span>
      </div>
      <p className="c-tm-tamt">{amount}</p>
      <p className="c-det">{t.request?.state === 'open' ? (t.request.kind === 'call' ? 'Called' : 'Asked for the bill') : line}</p>
    </div>
  );
}

/** "Lee is next: 4, and only 14 seats four." */
export function nextLine(w: Waitlist, tables: TableView[]): string | null {
  const next = w.parties.find((p) => p.state === 'waiting' || p.state === 'notified');
  if (!next) return null;
  const fit = tables.filter((t) => t.status === 'free' && t.seats >= next.size).map((t) => t.label ?? String(t.number));
  const seats = fit.length === 1 ? 'seats' : 'seat';
  const which =
    fit.length === 0
      ? `and no free table seats ${word(next.size)} yet`
      : fit.length === 1
        ? `and only ${fit[0]} ${seats} ${word(next.size)}`
        : `and ${fit.slice(0, -1).join(', ')} and ${fit[fit.length - 1]} ${seats} ${word(next.size)}`;
  return `${next.name} is next: ${next.size}, ${which}.`;
}

export function FloorView({
  tables,
  waitlist,
  now,
  onTable,
  onEdit,
  onAddParty,
  onSeat,
  onParty,
  strip,
}: {
  tables: TableView[];
  waitlist: Waitlist;
  now: number;
  onTable: (t: TableView) => void;
  onEdit?: () => void;
  onAddParty: () => void;
  onSeat: (p: WaitlistParty) => void;
  onParty?: (p: WaitlistParty) => void;
  /** Calls and bills, above the floor when there are any. */
  strip?: ReactNode;
}) {
  const seated = tables.filter((t) => t.status !== 'free' && t.status !== 'held').length;
  const waiting = waitlist.parties.filter((p) => p.state === 'waiting' || p.state === 'notified');
  const next = waiting[0] ?? null;
  const tableOf = (p: WaitlistParty) => tables.find((t) => t.id === p.tableId);
  return (
    <>
      {strip}
      <Slab>
        <div className="c-cell">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">Floor</p>
              <span className="c-det">
                {tables.length} tables · {seated} seated
              </span>
            </div>
          </div>
          <div className="c-cmain">
            <div className="c-tm-tiles">
              {tables.map((t) => (
                <Tile key={t.id} t={t} now={now} onTap={() => onTable(t)} />
              ))}
            </div>
          </div>
          <div className="c-cfoot">
            <div className="c-line" style={{ alignItems: 'center' }}>
              <p className="c-det">Tap a table for its tab.</p>
              {onEdit && (
                <button type="button" className="c-btn" onClick={onEdit}>
                  Edit tables
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="c-cell">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">Wait list</p>
              <span className="c-det">{waiting.length ? `${waiting.length} waiting · about ${waitlist.quotedMinutes} min` : 'Nobody waiting'}</span>
            </div>
          </div>
          <div className="c-cmain">
            <div className="c-rows">
              {waitlist.parties.map((p) => (
                <div key={p.id}>
                  <div className="c-kv" role={onParty ? 'button' : undefined} tabIndex={onParty ? 0 : undefined} onClick={() => onParty?.(p)} style={onParty ? { cursor: 'pointer' } : undefined}>
                    <span>
                      {p.state === 'seated' ? <b>{p.name}</b> : p.name} · {p.size}
                    </span>
                    <span className={cx('c-v', p.state === 'seated' && 'c-ink')}>
                      {p.state === 'seated' ? `Seated at ${tableOf(p)?.label ?? tableOf(p)?.number ?? '—'}` : p.state === 'notified' ? 'Almost ready' : `${p.quotedMinutes} min`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="c-cfoot">
            <div className="c-line" style={{ alignItems: 'center' }}>
              <p className="c-det">{nextLine(waitlist, tables) ?? 'Add a party when someone’s waiting.'}</p>
              <span className="c-pair">
                <button type="button" className="c-btn" onClick={onAddParty}>
                  Add a party
                </button>
                {next && (
                  <button type="button" className="c-btn c-btn-primary" onClick={() => onSeat(next)}>
                    Seat {next.name}
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
      </Slab>
    </>
  );
}

// ---- A table's tab --------------------------------------------------------------------------------------

export function TabSheet({
  t,
  order,
  now,
  onAddItems,
  onPay,
  onSeat,
  onClear,
  onClose,
}: {
  t: TableView;
  order: Order | null;
  now: number;
  onAddItems: () => void;
  onPay: () => void;
  onSeat?: () => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const title =
    t.status === 'free'
      ? `Table ${t.number} · free`
      : t.status === 'held'
        ? `Table ${t.number} · held for ${t.hold!.partyName}`
        : `Table ${t.number} · seated ${t.seatedAt ? mins(t.seatedAt, now) : 0} min`;
  const lines = order?.lines ?? [];
  const sent = t.billSentAt ? `Bill sent to its Point ${clock(t.billSentAt)}` : t.status === 'paid' ? 'Paid' : lines.length ? 'Not sent yet' : 'Nothing on the tab yet';
  return (
    <>
      <Sheet
        className="c-st-sheet c-tm-sheet c-w460"
        title={title}
        onClose={onClose}
        foot={
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">{sent}</p>
            <span className="c-pair">
              {t.status === 'free' && onSeat ? (
                <button type="button" className="c-btn c-btn-primary" onClick={onSeat}>
                  Seat a walk-in
                </button>
              ) : t.status === 'held' && onSeat ? (
                <button type="button" className="c-btn" onClick={onSeat}>
                  They’ve sat down
                </button>
              ) : t.status === 'paid' && onClear ? (
                <button type="button" className="c-btn c-btn-primary" onClick={onClear}>
                  Clear the table
                </button>
              ) : null}
              {t.status !== 'free' && t.status !== 'paid' && (
                <>
                  <button type="button" className="c-btn" onClick={onAddItems}>
                    Add items
                  </button>
                  <button type="button" className="c-btn c-btn-primary" disabled={!lines.length} onClick={onPay}>
                    Take payment
                  </button>
                </>
              )}
            </span>
          </div>
        }
      >
        <div className="c-rows">
          {lines.map((l) => (
            <div key={l.id}>
              <div className="c-kv">
                <span>
                  {l.quantity} · {l.name}
                </span>
                <span className="c-v c-ink">{money(l.lineCents)}</span>
              </div>
            </div>
          ))}
          {order && (
            <div>
              <div className="c-kv">
                <span>Tax</span>
                <span className="c-v">{money(order.taxCents)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="c-ck-change" style={{ marginTop: 'var(--s2)' }}>
          <span>Tab</span>
          <b>{usd(order?.totalCents ?? 0)}</b>
        </div>
      </Sheet>
    </>
  );
}

// ---- 8b · Seat a party ---------------------------------------------------------------------------------

/** Free tables that seat the party, smallest fit first, then the rest. */
export function seatOrder(tables: TableView[], size: number): TableView[] {
  const free = tables.filter((t) => t.status === 'free');
  const fit = free.filter((t) => t.seats >= size).sort((a, b) => a.seats - b.seats || a.number - b.number);
  const rest = free.filter((t) => t.seats < size).sort((a, b) => a.number - b.number);
  return [...fit, ...rest];
}

export function SeatSheet({
  party,
  tables,
  now,
  busy,
  error,
  initialTable,
  onSeat,
  onClose,
}: {
  party: WaitlistParty;
  tables: TableView[];
  now: number;
  busy?: boolean;
  error?: string | null;
  initialTable?: string;
  onSeat: (input: { tableId: string; showName: boolean; text: boolean }) => void;
  onClose: () => void;
}) {
  const options = seatOrder(tables, party.size);
  const [tableId, setTableId] = useState<string | null>(initialTable ?? options.find((t) => t.seats >= party.size)?.id ?? null);
  const [showName, setShowName] = useState(true);
  const [text, setText] = useState(!!party.phone && party.textConsent);
  const table = tables.find((t) => t.id === tableId) ?? null;
  const waited = mins(party.joinedAt, now);
  const message = table ? `Your table is ready: ${table.label ?? table.number}${table.area ? `, ${table.area}` : ''}` : '';
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet"
      title={`Seat ${party.name} · party of ${party.size}`}
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">
            Waited {waited} minute{waited === 1 ? '' : 's'} · from the wait list
          </p>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || !table} onClick={() => table && onSeat({ tableId: table.id, showName, text: text && !!party.phone })}>
            {table ? `Seat at ${table.label ?? table.number}` : 'Pick a table'}
          </button>
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Table
      </p>
      <div className="c-st-chips">
        {options.map((t) => (
          <button key={t.id} type="button" className={cx('c-btn', t.id === tableId && 'c-on')} aria-pressed={t.id === tableId} onClick={() => setTableId(t.id)}>
            {t.label ?? t.number} · seats {t.seats}
          </button>
        ))}
        {options.length === 0 && <p className="c-det">No table is free yet.</p>}
      </div>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <R2 t="Show their name on the Point" det="First name only. Off, it says Reserved" end={<Tg on={showName} label="Show their name on the Point" onChange={setShowName} />} />
        {party.phone ? (
          <R2 t="Text them" det={`${party.phone} · ${message}`} end={<Tg on={text} label="Text them" onChange={setText} />} />
        ) : (
          <R2 off t="Text them" det="They didn’t leave a number" end={<Tg on={false} label="Text them" />} />
        )}
      </Rows>
      {error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}



/** Add a party, at the door (not drawn: the join page's fields, on a sheet). */
export function AddPartySheet({
  busy,
  error,
  onAdd,
  onClose,
}: {
  busy?: boolean;
  error?: string | null;
  onAdd: (p: { name: string; size: number; phone: string | null; textConsent: boolean }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(2);
  const [phone, setPhone] = useState('');
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet"
      title="Add a party"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">{phone ? 'They’ll get a text when their table is ready.' : 'No number: call their name.'}</p>
          <button
            type="button"
            className="c-btn c-btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => onAdd({ name: name.trim(), size, phone: phone.trim() || null, textConsent: !!phone.trim() })}
          >
            Add to the list
          </button>
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Name
      </p>
      <input className="c-field c-st-in" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <p className="c-label c-st-fl">How many</p>
      <div className="c-st-chips">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} type="button" className={cx('c-btn', size === n && 'c-on')} aria-pressed={size === n} onClick={() => setSize(n)}>
            {n === 6 ? '6+' : n}
          </button>
        ))}
      </div>
      <p className="c-label c-st-fl">Text them at</p>
      <input className="c-field c-st-in" inputMode="tel" aria-label="Text them at" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** Edit tables: the floor's numbers and seats (not drawn: a sheet like Edit hours). */
export function EditTablesSheet({
  tables,
  busy,
  error,
  onSave,
  onClose,
}: {
  tables: TableView[];
  busy?: boolean;
  error?: string | null;
  onSave: (rows: { id?: string; number: number; label: string | null; area: string | null; seats: number }[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() => tables.map((t) => ({ id: t.id as string | undefined, number: String(t.number), seats: String(t.seats), area: t.area ?? '' })));
  const patch = (i: number, p: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet"
      title="Edit tables"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className="c-btn"
            onClick={() => setRows((r) => [...r, { id: undefined, number: String(Math.max(0, ...r.map((x) => Number(x.number) || 0)) + 1), seats: '2', area: '' }])}
          >
            Add a table
          </button>
          <button
            type="button"
            className="c-btn c-btn-primary"
            disabled={busy}
            onClick={() =>
              onSave(rows.filter((r) => Number(r.number) > 0).map((r) => ({ id: r.id, number: Number(r.number), label: null, area: r.area.trim() || null, seats: Math.max(1, Number(r.seats) || 1) })))
            }
          >
            Save tables
          </button>
        </div>
      }
    >
      <div className="c-rows">
        {rows.map((r, i) => (
          <div key={i}>
            <div className="c-line" style={{ alignItems: 'center', gap: 'var(--s1)', padding: '6px 0' }}>
              <input
                className="c-field c-st-in"
                style={{ width: 64 }}
                inputMode="numeric"
                aria-label="Number"
                value={r.number}
                onChange={(e) => patch(i, { number: e.target.value.replace(/\D/g, '') })}
              />
              <input
                className="c-field c-st-in"
                style={{ width: 64 }}
                inputMode="numeric"
                aria-label="Seats"
                value={r.seats}
                onChange={(e) => patch(i, { seats: e.target.value.replace(/\D/g, '') })}
              />
              <input className="c-field c-st-in" style={{ flex: 1 }} aria-label="Where" placeholder="by the window" value={r.area} onChange={(e) => patch(i, { area: e.target.value })} />
              <button type="button" className="c-ci-link" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

// ---- 13b · Calls and bills ----------------------------------------------------------------------------

/** "Table 12 · Call · 1 min ago · ring light on · On my way". A strip on Home and Tables. */
export function CallsStrip({
  requests,
  tables,
  nameOf,
  now,
  onAnswer,
  sheet,
  onClose,
}: {
  requests: TableRequest[];
  tables: TableView[];
  nameOf: (staffId: string) => string;
  now: number;
  onAnswer: (id: string) => void;
  sheet?: boolean;
  onClose?: () => void;
}) {
  const num = (id: string) => tables.find((t) => t.id === id)?.number ?? '—';
  const rows = requests.map((r) => {
    const ago = mins(r.at, now);
    const when = ago < 1 ? 'Just now' : `${ago} min ago`;
    const t = `Table ${num(r.tableId)} · ${r.kind === 'call' ? 'Call' : 'Bill'}`;
    if (r.state === 'open')
      return (
        <R2
          key={r.id}
          t={t}
          det={`${when} · ${r.kind === 'call' ? 'ring light on' : 'they asked for the bill'}`}
          end={
            <button type="button" className="c-btn c-btn-primary" onClick={() => onAnswer(r.id)}>
              On my way
            </button>
          }
        />
      );
    if (r.state === 'bill_sent')
      return (
        <R2
          key={r.id}
          t={t}
          det={`${when} · sent to its Point${r.billCents !== null ? `, ${usd(r.billCents)}` : ''}`}
          end={
            <Chip tone="settled" dot>
              Bill sent
            </Chip>
          }
        />
      );
    return (
      <R2
        key={r.id}
        t={t}
        det={r.answeredBy ? `Answered by ${nameOf(r.answeredBy).split(' ')[0]}, ${r.answeredAt ? clock(r.answeredAt) : ''}` : 'Cancelled at the table'}
        end={<Chip tone="neutral">Answered</Chip>}
      />
    );
  });
  if (sheet)
    return (
      <Sheet className="c-st-sheet c-tm-sheet c-w460" title="Calls and bills" onClose={onClose}>
        <Rows>{rows}</Rows>
      </Sheet>
    );
  return (
    <div className="c-slab c-one">
      <div className="c-cell c-full">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Calls and bills</p>
            <span className="c-det">{requests.filter((r) => r.state === 'open').length || 'None'} waiting</span>
          </div>
        </div>
        <div className="c-cmain">
          <Rows>{rows}</Rows>
        </div>
      </div>
    </div>
  );
}

// ---- 9 · Order ready ------------------------------------------------------------------------------------

export function OrderReadyCell({ orders, onCall, onPickedUp }: { orders: PickupOrder[]; onCall: (orderId: string) => void; onPickedUp: (orderId: string) => void }) {
  return (
    <div className="c-slab c-one">
      <div className="c-cell c-full">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Waiting to be picked up</p>
            <span className="c-det">{orders.filter((o) => !o.pickedUpAt).length || '—'}</span>
          </div>
        </div>
        <div className="c-cmain">
          <Rows>
            {orders.map((o) => {
              const t = `Order ${o.number ?? '—'} · ${o.name ?? 'walk-in'}`;
              if (o.pickedUpAt) return <R2 key={o.orderId} t={t} det={`Picked up ${clock(o.pickedUpAt)}`} end={<Chip tone="settled">Done</Chip>} />;
              if (o.calledAt)
                return (
                  <R2
                    key={o.orderId}
                    t={t}
                    det={`Called ${clock(o.calledAt)} · on the Point`}
                    end={
                      <button type="button" className="c-btn" onClick={() => onPickedUp(o.orderId)}>
                        Picked up
                      </button>
                    }
                  />
                );
              return (
                <R2
                  key={o.orderId}
                  t={t}
                  det={`Paid ${clock(o.paidAt)} · ${o.itemCount} item${o.itemCount === 1 ? '' : 's'}${o.serviceType === 'to_go' ? ', to go' : o.serviceType === 'delivery' ? ', delivery' : ''}`}
                  end={
                    <button type="button" className="c-btn c-btn-primary" onClick={() => onCall(o.orderId)}>
                      Call it
                    </button>
                  }
                />
              );
            })}
          </Rows>
        </div>
      </div>
    </div>
  );
}
