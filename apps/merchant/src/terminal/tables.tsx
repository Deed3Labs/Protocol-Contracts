import { useState } from 'react';
import type { Order, PickupOrder, PointState, Tender, TableRequest, TableView, Waitlist, WaitlistParty } from '@clear/merchant-contracts';
import { Chip } from '@/brand/controls';
import { cx, Sheet } from '@/brand/ui';
import { R2, Rows, Tg } from '@/settings/views';
import { money } from './drawings';

/**
 * Tables (terminal reference, sections 8–8d, Tables v2): the floor and the wait list side by side,
 * because the door and the floor are the same job at dinner; one sheet per table whose main button
 * is always the next step; Move; the wait list's own sheets; Edit tables; and, on a phone, the same
 * floor as a list grouped by what needs doing. Calls and bills and Order ready are below.
 */

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const mins = (from: string, now: number) => Math.max(0, Math.round((now - Date.parse(from)) / 60_000));
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);
const ago = (iso: string, now: number) => (mins(iso, now) < 1 ? 'Just now' : `${mins(iso, now)} min ago`);
const tableName = (t: TableView) => t.label ?? `Table ${t.number}`;

/** What a tile is doing, in one word: only it and its dot change colour (section 8). */
export type TileState = 'free' | 'ordered' | 'bill' | 'held' | 'seated' | 'paid' | 'calling';
export function tileState(t: TableView): TileState {
  if (t.request?.state === 'open') return 'calling';
  return ({ free: 'free', held: 'held', seated: 'seated', ordering: 'ordered', bill_sent: 'bill', paid: 'paid' } as const)[t.status];
}
const WORD: Record<TileState, string> = { free: 'Free', ordered: 'Ordered', bill: 'Bill sent', held: 'Held', seated: 'Seated', paid: 'Paid', calling: 'Calling' };

function Bell({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** "Ana, 2 · 2 min", "Reyes, 2 · 2 min ago", or a blank line for a free table. */
function meta(t: TableView, now: number): string {
  const who = t.party ? `${t.party.name ?? 'Walk-in'}, ${t.party.size}` : t.hold ? t.hold.partyName : '';
  if (t.status === 'free') return '';
  if (t.status === 'paid' && t.paidAt) return `${who} · ${ago(t.paidAt, now)}`;
  if (t.status === 'held' && t.hold) return `${who} · ${mins(t.hold.seatedAt, now)} min`;
  return `${who} · ${t.seatedAt ? mins(t.seatedAt, now) : 0} min`;
}

/** Its Point, and what it shows: "Its Point: the menu · 82%", because that is what the guests see (8b). */
export function pointLine(t: TableView, battery?: { percent: number; pluggedIn: boolean } | null): string {
  if (!t.point) return 'No Point';
  const s: PointState = t.point.showing;
  const what =
    s.kind === 'idle'
      ? ({ number: 'the number', menu: 'the menu', showcase: 'the showcase', pay: 'Pay here', waitlist: 'the wait list' } as const)[s.mode]
      : s.kind === 'held'
        ? s.partyName
          ? 'their name'
          : 'Reserved'
        : s.kind === 'bill'
          ? 'the bill'
          : s.kind === 'paid'
            ? 'thank you'
            : s.kind === 'called' || s.kind === 'bill_asked'
              ? 'its ring light'
              : s.kind === 'alert'
                ? 'Table ready'
                : 'the test screen';
  return `Its Point: ${what}${battery && !battery.pluggedIn ? ` · ${battery.percent}%` : ''}`;
}

// ---- 8 · The floor ----------------------------------------------------------------------------------

/** One tile, the same four things in the same places: number and tab (or seats), the word, who and how long. */
export function Tile({ t, now, onTap, onClear }: { t: TableView; now: number; onTap?: () => void; onClear?: () => void }) {
  const st = tileState(t);
  const tab = t.status !== 'free' && t.status !== 'held' && t.tabCents !== null && t.tabCents > 0;
  return (
    <div
      className={cx('c-tm-t', `c-${st}`)}
      role="button"
      tabIndex={0}
      aria-label={`${tableName(t)}, ${WORD[st]}`}
      onClick={onTap}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onTap?.()}
    >
      <div className="c-tm-th">
        <b>{t.label ?? t.number}</b>
        {tab ? <span className="c-tm-amt">{usd(t.tabCents!)}</span> : <span>{t.seats} seats</span>}
      </div>
      <div className="c-tm-tb">
        <p className="c-tm-ts">
          <span>
            {st === 'calling' ? <Bell /> : <i className="c-dot" />}
            {WORD[st]}
          </span>
          {st === 'paid' && onClear && (
            <button
              type="button"
              className="c-btn c-sm"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
            >
              Clear
            </button>
          )}
        </p>
        <p className="c-tm-meta">{meta(t, now) || ' '}</p>
      </div>
    </div>
  );
}

export interface AskItem {
  request: TableRequest;
  table: TableView | undefined;
}

/**
 * Asking: open Calls and bills, and bills sent that are still out. Calls before bills, longest
 * waiting first (section 8).
 */
export function askingItems(requests: TableRequest[], tables: TableView[]): AskItem[] {
  const tableOf = (id: string) => tables.find((t) => t.id === id);
  return requests
    .filter((r) => r.state === 'open' || (r.state === 'bill_sent' && tableOf(r.tableId)?.status === 'bill_sent'))
    .sort((a, b) => (a.state === 'open' && a.kind === 'call' ? 0 : 1) - (b.state === 'open' && b.kind === 'call' ? 0 : 1) || Date.parse(a.at) - Date.parse(b.at))
    .map((request) => ({ request, table: tableOf(request.tableId) }));
}

function AskRow({ item, now, onAnswer }: { item: AskItem; now: number; onAnswer: (id: string) => void }) {
  const r = item.request;
  const n = item.table ? tableName(item.table) : 'A table';
  return (
    <div className="c-tm-aski">
      <span className="c-tm-bell">
        <Bell size={18} />
      </span>
      <div>
        <p className="c-t">{r.kind === 'call' ? `${n} wants someone` : `${n} asked for the bill`}</p>
        <p className="c-det">{r.state === 'bill_sent' ? `Sent to its Point${r.billCents !== null ? ` · ${usd(r.billCents)}` : ''}` : `${r.kind === 'call' ? 'Call' : 'Bill'} · ${ago(r.at, now)}`}</p>
      </div>
      {r.state === 'bill_sent' ? (
        <Chip tone="underway" dot>
          Bill sent
        </Chip>
      ) : (
        <button type="button" className="c-btn c-sm c-btn-primary" onClick={() => onAnswer(r.id)}>
          On my way
        </button>
      )}
    </div>
  );
}

function Chevron({ back }: { back?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={back ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}

/** Two at a time; with more than two, arrows page through the rest and say how many are open. */
export function AskingCell({ items, now, onAnswer }: { items: AskItem[]; now: number; onAnswer: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / 2));
  const p = Math.min(page, pages - 1);
  const shown = items.slice(p * 2, p * 2 + 2);
  return (
    <div className="c-cell c-full c-tm-askcell">
      <div className="c-cmain c-tm-ask">
        <div className="c-tm-ask1">
          <div className="c-tm-askl">
            <p className="c-label">Asking</p>
            {items.length > 2 && (
              <div className="c-tm-pager">
                <button type="button" aria-label="Earlier" disabled={p === 0} onClick={() => setPage(p - 1)}>
                  <Chevron back />
                </button>
                <span>
                  {p * 2 + 1}–{p * 2 + shown.length} of {items.length}
                </span>
                <button type="button" aria-label="More" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
                  <Chevron />
                </button>
              </div>
            )}
          </div>
          {shown[0] && <AskRow item={shown[0]} now={now} onAnswer={onAnswer} />}
        </div>
        {shown[1] ? <AskRow item={shown[1]} now={now} onAnswer={onAnswer} /> : <div className="c-tm-aski" aria-hidden />}
      </div>
    </div>
  );
}

/** Areas from Edit tables, in the order tables first use them. With one area the switch is hidden. */
export const areasOf = (tables: TableView[]) => [...new Set(tables.map((t) => t.area).filter((a): a is string => !!a))];

/** "4 seated · 1 held · 2 free". */
export function floorCounts(tables: TableView[]): string {
  const seated = tables.filter((t) => t.status === 'seated' || t.status === 'ordering' || t.status === 'bill_sent').length;
  const held = tables.filter((t) => t.status === 'held').length;
  const free = tables.filter((t) => t.status === 'free').length;
  return `${seated} seated · ${held} held · ${free} free`;
}

/**
 * Whoever fits next: each waiting party in turn gets the smallest free table that seats them that an
 * earlier party hasn't been given ("Seat at 14"), or none ("Seat").
 */
export function seatAssignments(waiting: WaitlistParty[], tables: TableView[]): Map<string, TableView> {
  const taken = new Set<string>();
  const out = new Map<string, TableView>();
  for (const p of waiting) {
    const fit = seatOrder(tables, p.size).find((t) => t.seats >= p.size && !taken.has(t.id));
    if (fit) {
      taken.add(fit.id);
      out.set(p.id, fit);
    }
  }
  return out;
}

export const waitingOf = (w: Waitlist) => w.parties.filter((p) => p.state === 'waiting' || p.state === 'notified');

function WaitRow({ p, next, table, now, onOpen }: { p: WaitlistParty; next: boolean; table: TableView | undefined; now: number; onOpen: () => void }) {
  const waited = mins(p.joinedAt, now);
  return (
    <div className="c-tm-w" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <div>
        <p className="c-t">
          <b>{p.name}</b>
          {next && <Chip tone="live">Next</Chip>}
        </p>
        <p className="c-det">
          Party of {p.size} · waited {waited > p.quotedMinutes ? <span className="c-tm-over">{waited} min</span> : `${waited} min`} · told {p.quotedMinutes} min
        </p>
      </div>
      <button
        type="button"
        className="c-btn c-sm"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        {table ? `Seat at ${table.label ?? table.number}` : 'Seat'}
      </button>
    </div>
  );
}

export function WaitlistCell({ waitlist, tables, now, onParty, onAddParty, empty }: { waitlist: Waitlist; tables: TableView[]; now: number; onParty: (p: WaitlistParty, tableId?: string) => void; onAddParty: () => void; empty?: boolean }) {
  const waiting = waitingOf(waitlist);
  const fit = seatAssignments(waiting, tables);
  const nextId = waiting.find((p) => fit.has(p.id))?.id;
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Wait list</p>
          <span className="c-det">{waiting.length ? `${waiting.length} waiting · about ${waitlist.quotedMinutes} min` : 'Nobody waiting'}</span>
        </div>
      </div>
      <div className="c-cmain">
        {waiting.length ? (
          waiting.map((p) => <WaitRow key={p.id} p={p} next={p.id === nextId} table={fit.get(p.id)} now={now} onOpen={() => onParty(p, fit.get(p.id)?.id)} />)
        ) : (
          <p className="c-det">Parties you add, or who join from the door Point’s code, line up here.</p>
        )}
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">{empty ? 'Works without tables, too.' : `A party of 2 now waits about ${waitlist.quotedMinutes} min.`}</p>
          <button type="button" className={cx('c-btn', !empty && 'c-btn-primary')} onClick={onAddParty}>
            Add a party
          </button>
        </div>
      </div>
    </div>
  );
}

/** The floor at a glance (section 8): Asking along the top, tiles, and the wait list on the right. */
export function FloorView({
  tables,
  waitlist,
  requests,
  now,
  onTable,
  onClear,
  onAnswer,
  onEdit,
  onSetUp,
  onAddParty,
  onParty,
}: {
  tables: TableView[];
  waitlist: Waitlist;
  requests: TableRequest[];
  now: number;
  onTable: (t: TableView) => void;
  onClear: (t: TableView) => void;
  onAnswer: (requestId: string) => void;
  /** Owners and managers only. */
  onEdit?: () => void;
  onSetUp?: () => void;
  onAddParty: () => void;
  onParty: (p: WaitlistParty, tableId?: string) => void;
}) {
  const [area, setArea] = useState<string | null>(null);
  const areas = areasOf(tables);
  const shown = area ? tables.filter((t) => t.area === area) : tables;
  const asking = askingItems(requests, tables);
  if (!tables.length)
    return (
      <div className="c-slab">
        <div className="c-cell">
          <div className="c-chead">
            <div className="c-sechead">
              <p className="c-label">Floor</p>
              <span className="c-det">No tables</span>
            </div>
          </div>
          <div className="c-cmain">
            <div className="c-tm-empty">
              <p className="c-tm-eh">No tables yet</p>
              <p className="c-det">Make them once: how many, and how many each seats. Points you place at tables join them.</p>
              {onSetUp && (
                <button type="button" className="c-btn c-btn-primary" style={{ marginTop: 'var(--s2)' }} onClick={onSetUp}>
                  Set up tables
                </button>
              )}
            </div>
          </div>
        </div>
        <WaitlistCell waitlist={waitlist} tables={tables} now={now} onParty={onParty} onAddParty={onAddParty} empty />
      </div>
    );
  return (
    <div className="c-slab c-tm-tslab">
      {asking.length > 0 && <AskingCell items={asking} now={now} onAnswer={onAnswer} />}
      <div className="c-cell c-tm-floorcell">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Floor</p>
            <span className="c-tm-hr">
              {areas.length > 1 ? (
                <span className="c-tm-tabs" role="tablist" aria-label="Area">
                  {[null, ...areas].map((a) => (
                    <b key={a ?? 'all'} role="tab" tabIndex={0} aria-selected={area === a} className={area === a ? 'c-on' : undefined} onClick={() => setArea(a)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setArea(a)}>
                      {a ?? 'All'}
                    </b>
                  ))}
                </span>
              ) : (
                <span />
              )}
              <span className="c-det">{floorCounts(shown)}</span>
            </span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-tm-floor">
            {shown.map((t) => (
              <Tile key={t.id} t={t} now={now} onTap={() => onTable(t)} onClear={() => onClear(t)} />
            ))}
          </div>
        </div>
        <div className="c-cfoot">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">Tap a table to open it.</p>
            {onEdit && (
              <button type="button" className="c-btn" onClick={onEdit}>
                Edit tables
              </button>
            )}
          </div>
        </div>
      </div>
      <WaitlistCell waitlist={waitlist} tables={tables} now={now} onParty={onParty} onAddParty={onAddParty} />
    </div>
  );
}

// ---- 8d · Tables on a phone ---------------------------------------------------------------------------

const PHONE_GROUPS: { title: string; states: TileState[] }[] = [
  { title: 'Asking', states: ['calling'] },
  { title: 'Bill out', states: ['bill'] },
  { title: 'Seated', states: ['ordered', 'seated'] },
  { title: 'Held', states: ['held'] },
  { title: 'Paid', states: ['paid'] },
  { title: 'Free', states: ['free'] },
];

function phoneDet(t: TableView, now: number): string {
  const st = tileState(t);
  if (st === 'free') return `${t.seats} seats`;
  if (st === 'paid' && t.paidAt) return `${mins(t.paidAt, now) < 1 ? 'Just now' : `${mins(t.paidAt, now)} min ago`} · tap to clear`;
  if (st === 'held' && t.hold) return `${meta(t, now)} · ${t.hold.showName ? 'name on its Point' : 'Reserved on its Point'}`;
  if (st === 'calling' && t.request) {
    const who = t.party ? `${t.party.name ?? 'Walk-in'}, ${t.party.size}` : '';
    return `${who} · ${t.request.kind === 'call' ? 'wants someone' : 'wants the bill'} · ${mins(t.request.at, now)} min`;
  }
  return meta(t, now);
}

/** The phone's floor (section 8d): a list grouped by what needs doing, each row the tile's four facts. */
export function PhoneTables({ tables, waitlist, now, onTable, onParty, onAddParty }: { tables: TableView[]; waitlist: Waitlist; now: number; onTable: (t: TableView) => void; onParty: (p: WaitlistParty, tableId?: string) => void; onAddParty: () => void }) {
  const [tab, setTab] = useState<'floor' | 'wait'>('floor');
  const waiting = waitingOf(waitlist);
  return (
    <div className="c-tm-pbody c-tm-plist">
      <div className="c-tm-ptabs" role="tablist">
        <b role="tab" tabIndex={0} aria-selected={tab === 'floor'} className={tab === 'floor' ? 'c-on' : undefined} onClick={() => setTab('floor')}>
          Floor
        </b>
        <b role="tab" tabIndex={0} aria-selected={tab === 'wait'} className={tab === 'wait' ? 'c-on' : undefined} onClick={() => setTab('wait')}>
          Wait list · {waiting.length}
        </b>
      </div>
      {tab === 'floor' ? (
        PHONE_GROUPS.map((g) => {
          const rows = tables.filter((t) => g.states.includes(tileState(t)));
          if (!rows.length) return null;
          return (
            <div key={g.title}>
              <p className="c-tm-pg">{g.title}</p>
              {rows.map((t) => {
                const st = tileState(t);
                return (
                  <div key={t.id} className={cx('c-tm-pr', `c-${st}`)} role="button" tabIndex={0} onClick={() => onTable(t)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onTable(t)}>
                    <b className="c-n">{t.label ?? t.number}</b>
                    <div>
                      <p className="c-t">
                        {st === 'calling' ? <Bell /> : <i className="c-dot" />}
                        {WORD[st]}
                      </p>
                      <p className="c-det">{phoneDet(t, now)}</p>
                    </div>
                    <b className="c-a">{st === 'free' || st === 'held' ? '' : t.tabCents ? usd(t.tabCents) : '—'}</b>
                  </div>
                );
              })}
            </div>
          );
        })
      ) : (
        <WaitlistCell waitlist={waitlist} tables={tables} now={now} onParty={onParty} onAddParty={onAddParty} empty={!tables.length} />
      )}
    </div>
  );
}

// ---- 8b · A table, from seated to cleared --------------------------------------------------------------

/** Free tables that seat the party, smallest fit first, then the rest. */
export function seatOrder(tables: TableView[], size: number): TableView[] {
  const free = tables.filter((t) => t.status === 'free');
  const fit = free.filter((t) => t.seats >= size).sort((a, b) => a.seats - b.seats || a.number - b.number);
  const rest = free.filter((t) => t.seats < size).sort((a, b) => a.number - b.number);
  return [...fit, ...rest];
}

const SIZES = [1, 2, 3, 4, 5] as const;
function SizeSeg({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="c-tm-seg" role="radiogroup" aria-label={label}>
      {SIZES.map((n) => (
        <b key={n} role="radio" tabIndex={0} aria-checked={value === n || (n === 5 && value > 5)} className={value === n || (n === 5 && value > 5) ? 'c-on' : undefined} onClick={() => onChange(n)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onChange(n)}>
          {n === 5 ? '5+' : n}
        </b>
      ))}
    </div>
  );
}

function ErrorLine({ error }: { error?: string | null }) {
  return error ? (
    <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
      {error}
    </p>
  ) : null;
}

function Lines({ order }: { order: Order | null }) {
  if (!order) return null;
  return (
    <Rows>
      {order.lines.map((l) => (
        <div key={l.id}>
          <div className="c-kv">
            <span>
              {l.quantity} · {l.name}
            </span>
            <span className="c-v c-ink">{money(l.lineCents)}</span>
          </div>
        </div>
      ))}
      {order.lines.length > 0 && (
        <div>
          <div className="c-kv">
            <span>Tax</span>
            <span className="c-v">{money(order.taxCents)}</span>
          </div>
        </div>
      )}
    </Rows>
  );
}

const METHOD: Record<string, string> = { clear: 'Clear', card: 'Card', cash: 'Cash' };

export interface TableSheetActions {
  onClose: () => void;
  onSeatWalkIn: (input: { size: number; name: string | null }) => void;
  onSeatParty: (p: WaitlistParty) => void;
  onAddItems: () => void;
  onSendBill: () => void;
  onTakeBack: () => void;
  onMove: () => void;
  onPay: (method: 'clear' | 'card' | 'cash' | 'split') => void;
  onTakePayment: () => void;
  onClear: () => void;
  onAnswer: (requestId: string) => void;
}

/**
 * One sheet per table, its buttons following where the table is (section 8b): free seats, seated
 * adds items, a tab sends the bill, a bill out takes payment, paid clears. The primary button is
 * always the next step; the less common moves sit in the secondary row.
 */
export function TableSheet({
  t,
  order,
  tenders,
  waitlist,
  now,
  point,
  busy,
  error,
  a,
}: {
  t: TableView;
  order: Order | null;
  tenders: Tender[];
  waitlist: Waitlist;
  now: number;
  /** "Its Point: the menu · 82%". */
  point: string;
  busy?: boolean;
  error?: string | null;
  a: TableSheetActions;
}) {
  const st = tileState(t);
  const [size, setSize] = useState(Math.min(t.seats, 5));
  const [name, setName] = useState('');
  const who = t.party ? `${t.party.name ?? 'Walk-in'}, ${t.party.size}` : t.hold ? t.hold.partyName : '';
  const primary = (label: string, onClick: () => void) => (
    <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={onClick}>
      {label}
    </button>
  );

  if (st === 'free') {
    const fits = waitingOf(waitlist).filter((p) => p.size <= t.seats);
    return (
      <Sheet
        className="c-st-sheet c-tm-sheet c-w420"
        title={`${tableName(t)} · ${t.seats} seats`}
        onClose={a.onClose}
        foot={
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">{point}</p>
            {primary(`Seat ${size} here`, () => a.onSeatWalkIn({ size, name: name.trim() || null }))}
          </div>
        }
      >
        <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
          Walk-in
        </p>
        <SizeSeg value={size} onChange={setSize} label="How many" />
        <p className="c-label c-st-fl">Name</p>
        <input className="c-field c-st-in" aria-label="Name" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />
        {fits.length > 0 && (
          <>
            <p className="c-label c-st-fl">Or from the wait list</p>
            <Rows>
              {fits.map((p) => (
                <R2
                  key={p.id}
                  t={`${p.name} · ${p.size}`}
                  det={`Waited ${mins(p.joinedAt, now)} min`}
                  end={
                    <button type="button" className="c-btn c-sm" disabled={busy} onClick={() => a.onSeatParty(p)}>
                      Seat {p.name}
                    </button>
                  }
                />
              ))}
            </Rows>
          </>
        )}
        <ErrorLine error={error} />
      </Sheet>
    );
  }

  if (st === 'paid') {
    const paidBy = tenders.filter((x) => x.status !== 'declined' && x.status !== 'cancelled' && x.status !== 'pending');
    const last = paidBy[paidBy.length - 1];
    const tip = paidBy.reduce((s, x) => s + x.tipCents, 0);
    const how = last ? `${METHOD[last.method] ?? last.method}${last.method === 'clear' ? ', paid now' : ''}` : '';
    const left = t.clearsAt ? Math.max(1, Math.ceil((Date.parse(t.clearsAt) - now) / 60_000)) : null;
    return (
      <Sheet
        className="c-st-sheet c-tm-sheet c-w420"
        title={tableName(t)}
        onClose={a.onClose}
        foot={
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">Clearing puts its Point back to the number.</p>
            {primary('Clear the table', a.onClear)}
          </div>
        }
      >
        <div className="c-tm-sh">
          <span>{[`Paid ${t.paidAt ? ago(t.paidAt, now).replace('Just now', 'just now') : ''}`.trim(), how].filter(Boolean).join(' · ')}</span>
          <Chip tone="settled" dot>
            Paid
          </Chip>
        </div>
        <div className="c-ck-change c-paid">
          <span>Paid</span>
          <b>{usd(t.tabCents ?? order?.totalCents ?? 0)}</b>
        </div>
        {(last?.method === 'clear' || tip > 0) && (
          <Rows style={{ marginTop: 'var(--s2)' }}>
            {last?.method === 'clear' && <R2 t="Receipt" det="On their phone" end={<Chip tone="settled">Sent</Chip>} />}
            {tip > 0 && <R2 t="Tip" det={`${usd(tip)} on ${METHOD[last?.method ?? ''] ?? 'the bill'}`} end={null} />}
          </Rows>
        )}
        {left !== null && (
          <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
            Clears itself in {left} minute{left === 1 ? '' : 's'}. Its Point says thank you until then.
          </p>
        )}
        <ErrorLine error={error} />
      </Sheet>
    );
  }

  if (st === 'bill') {
    return (
      <Sheet
        className="c-st-sheet c-tm-sheet c-w460"
        title={tableName(t)}
        onClose={a.onClose}
        foot={
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">Card and cash open Checkout for this bill; Split is the split you know.</p>
          </div>
        }
      >
        <div className="c-tm-sh">
          <span>
            {who}
            {t.billSentAt ? ` · bill sent ${clock(t.billSentAt)}` : ''}
          </span>
          <Chip tone="underway" dot>
            Bill sent
          </Chip>
        </div>
        <div className="c-ck-change">
          <span>Bill</span>
          <b>{usd(t.tabCents ?? 0)}</b>
        </div>
        <div className="c-tm-waitpay">
          <p className="c-t">They can pay at the table</p>
          <p className="c-det">Scan or tap on {tableName(t)}’s Point. This sheet turns to Paid when they do.</p>
        </div>
        <p className="c-label c-st-fl">Or take it here</p>
        <div className="c-tm-pm">
          {(['clear', 'card', 'cash', 'split'] as const).map((m) => (
            <button key={m} type="button" className="c-btn" disabled={busy} onClick={() => a.onPay(m)}>
              {m === 'split' ? 'Split' : METHOD[m]}
            </button>
          ))}
        </div>
        <div className="c-tm-sec">
          <button type="button" className="c-btn c-sm" disabled={busy} onClick={a.onTakeBack}>
            Take the bill back
          </button>
          <span className="c-det">{point}</span>
        </div>
        <ErrorLine error={error} />
      </Sheet>
    );
  }

  // Seated, held, ordered, calling: the tab, and the next step.
  const lines = order?.lines.length ?? 0;
  const since = st === 'held' && t.hold ? `held ${mins(t.hold.seatedAt, now)} min` : `seated ${t.seatedAt ? mins(t.seatedAt, now) : 0} min`;
  const calling = st === 'calling' && t.request ? t.request : null;
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w440"
      title={tableName(t)}
      onClose={a.onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">{calling ? (calling.kind === 'call' ? 'They pressed Call on the table.' : 'They asked for the bill.') : 'Nothing is charged until payment.'}</p>
          {calling ? primary('On my way', () => a.onAnswer(calling.id)) : primary('Add items', a.onAddItems)}
        </div>
      }
    >
      <div className="c-tm-sh">
        <span>{calling ? `${who} · ${t.seatedAt ? mins(t.seatedAt, now) : 0} min` : `${who} · ${since}`}</span>
        <Chip tone={calling ? 'underway' : 'neutral'} dot={!!calling}>
          {WORD[st]}
        </Chip>
      </div>
      <Lines order={order} />
      {(lines > 0 || calling) && (
        <div className="c-ck-change" style={{ marginTop: 'var(--s2)' }}>
          <span>{t.billSentAt ? 'Bill' : 'Tab'}</span>
          <b>{usd(t.tabCents ?? order?.totalCents ?? 0)}</b>
        </div>
      )}
      <div className="c-tm-sec">
        {calling ? (
          <>
            <button type="button" className="c-btn c-sm" disabled={busy || !lines} onClick={a.onTakePayment}>
              Take payment
            </button>
            <button type="button" className="c-btn c-sm" disabled={busy} onClick={a.onAddItems}>
              Add items
            </button>
          </>
        ) : (
          <>
            <button type="button" className="c-btn c-sm" disabled={busy} onClick={a.onMove}>
              Move
            </button>
            {lines > 0 && (
              <button type="button" className="c-btn c-sm" disabled={busy || !t.point} onClick={a.onSendBill}>
                Send the bill
              </button>
            )}
          </>
        )}
        <span className="c-det">{point}</span>
      </div>
      <ErrorLine error={error} />
    </Sheet>
  );
}

/** Move (section 8b): free tables that seat them first; the tab, the bill if sent, and their name on the Point go. */
export function MoveSheet({ t, tables, busy, error, onMove, onClose }: { t: TableView; tables: TableView[]; busy?: boolean; error?: string | null; onMove: (toTableId: string) => void; onClose: () => void }) {
  const size = t.party?.size ?? (t.hold ? 2 : 2);
  const options = seatOrder(tables, size);
  const [to, setTo] = useState<string | null>(options[0]?.id ?? null);
  const dest = tables.find((x) => x.id === to);
  const who = t.party ? `${t.party.name ?? 'the walk-in'}, ${t.party.size}` : t.hold ? t.hold.partyName : 'them';
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w420"
      title={`Move ${who} from ${tableName(t)}`}
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">{tableName(t)} goes back to free.</p>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || !dest} onClick={() => dest && onMove(dest.id)}>
            {dest ? `Move to ${dest.label ?? dest.number}` : 'No table is free'}
          </button>
        </div>
      }
    >
      <p className="c-det" style={{ marginTop: 0, marginBottom: 'var(--s2)' }}>
        Free tables that seat {word(size)} first.
      </p>
      <div className="c-st-chips">
        {options.map((x) => (
          <button key={x.id} type="button" className={cx('c-btn', x.id === to && 'c-on')} aria-pressed={x.id === to} onClick={() => setTo(x.id)}>
            {x.label ?? x.number} · {x.seats} seats
          </button>
        ))}
      </div>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <R2 t="What moves" det="The tab, the bill if sent, and their name on the Point" end={null} />
      </Rows>
      <ErrorLine error={error} />
    </Sheet>
  );
}

// ---- Setting up and editing tables -----------------------------------------------------------------------

function Step({ value, onChange, min = 1, max = 99, small, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; small?: boolean; label: string }) {
  return (
    <div className={cx('c-tm-step', small && 'c-sm')} role="group" aria-label={label}>
      <b role="button" tabIndex={0} aria-label={`Fewer ${label.toLowerCase()}`} aria-disabled={value <= min} onClick={() => value > min && onChange(value - 1)}>
        −
      </b>
      <span aria-live="polite">{value}</span>
      <b role="button" tabIndex={0} aria-label={`More ${label.toLowerCase()}`} aria-disabled={value >= max} onClick={() => value < max && onChange(value + 1)}>
        +
      </b>
    </div>
  );
}

/** First time (section 8): how many tables, and how many each seats. Step 2 is Edit tables. */
export function SetUpTablesSheet({ busy, error, onMake, onClose }: { busy?: boolean; error?: string | null; onMake: (count: number, seats: number) => void; onClose: () => void }) {
  const [count, setCount] = useState(10);
  const [seats, setSeats] = useState(2);
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w420"
      title="Set up tables"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">Step 1 of 2</p>
          <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => onMake(count, seats)}>
            Make {count} tables
          </button>
        </div>
      }
    >
      <div className="c-tm-two">
        <div>
          <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
            How many tables
          </p>
          <Step value={count} onChange={setCount} label="Tables" />
        </div>
        <div>
          <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
            Seats at each
          </p>
          <Step value={seats} onChange={setSeats} max={40} label="Seats" />
        </div>
      </div>
      <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
        Numbered 1 to {count}. Change any of them on the next screen.
      </p>
      <ErrorLine error={error} />
    </Sheet>
  );
}

export interface EditRow {
  id?: string;
  number: number;
  seats: number;
  area: string | null;
  label: string | null;
  pointId: string | null;
}

/** A Point as Edit tables names it: "Point A7K2 · Pay case". */
export interface PointChoice {
  id: string;
  code: string;
  payCase: boolean;
}

/**
 * Edit tables (section 8): areas, then each table's seats, area and Point. Tapping an area moves the
 * table to the next one; Link picks a Point not at a table. Owners and managers.
 */
export function EditTablesSheet({ tables, points, busy, error, onSave, onClose }: { tables: TableView[]; points: PointChoice[]; busy?: boolean; error?: string | null; onSave: (rows: EditRow[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<EditRow[]>(() => tables.map((t) => ({ id: t.id, number: t.number, seats: t.seats, area: t.area, label: t.label, pointId: t.point?.id ?? null })));
  const [areas, setAreas] = useState<string[]>(() => areasOf(tables));
  const [adding, setAdding] = useState<string | null>(null);
  const [linking, setLinking] = useState<number | null>(null);
  const patch = (i: number, p: Partial<EditRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const nextArea = (a: string | null) => (areas.length ? areas[(areas.indexOf(a ?? '') + 1) % areas.length]! : null);
  const pointOf = (id: string | null) => points.find((p) => p.id === id);
  const free = points.filter((p) => !rows.some((r) => r.pointId === p.id));
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w520"
      title="Edit tables"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">Removing a table keeps its past tabs in Charges.</p>
          <span className="c-pair">
            <button
              type="button"
              className="c-btn"
              onClick={() => setRows((r) => [...r, { number: Math.max(0, ...r.map((x) => x.number)) + 1, seats: 2, area: areas[0] ?? null, label: null, pointId: null }])}
            >
              Add a table
            </button>
            <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => onSave(rows)}>
              Done
            </button>
          </span>
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Areas
      </p>
      <div className="c-st-chips">
        {areas.map((a) => (
          <button key={a} type="button" className="c-btn">
            {a}
          </button>
        ))}
        {adding === null ? (
          <button type="button" className="c-btn" onClick={() => setAdding('')}>
            + Add an area
          </button>
        ) : (
          <input
            className="c-field c-st-in"
            autoFocus
            aria-label="New area"
            style={{ width: 160 }}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && adding.trim()) {
                setAreas((x) => [...new Set([...x, adding.trim()])]);
                setAdding(null);
              }
              if (e.key === 'Escape') setAdding(null);
            }}
            onBlur={() => {
              if (adding.trim()) setAreas((x) => [...new Set([...x, adding.trim()])]);
              setAdding(null);
            }}
          />
        )}
      </div>
      <div className="c-tm-erh">
        <span>Table</span>
        <span>Seats</span>
        <span>Area</span>
        <span>Point</span>
      </div>
      {rows.map((r, i) => {
        const p = pointOf(r.pointId);
        return (
          <div key={r.id ?? `new-${i}`} className="c-tm-er">
            <b>{r.number}</b>
            <Step small value={r.seats} onChange={(n) => patch(i, { seats: n })} max={40} label="Seats" />
            <span className="c-tm-area" role="button" tabIndex={0} onClick={() => patch(i, { area: nextArea(r.area) })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && patch(i, { area: nextArea(r.area) })}>
              {r.area ?? '—'}
            </span>
            <span className="c-det">
              {p ? (
                <>
                  Point {p.code}
                  {p.payCase ? ' · Pay case' : ''} ·{' '}
                  <u role="button" tabIndex={0} onClick={() => patch(i, { pointId: null })}>
                    Unlink
                  </u>
                </>
              ) : (
                <>
                  No Point ·{' '}
                  <u role="button" tabIndex={0} onClick={() => setLinking(i)}>
                    Link
                  </u>
                </>
              )}
              {' · '}
              <u role="button" tabIndex={0} aria-label={`Remove table ${r.number}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                Remove
              </u>
            </span>
          </div>
        );
      })}
      {linking !== null && (
        <Rows style={{ marginTop: 'var(--s2)' }}>
          {free.length ? (
            free.map((p) => (
              <R2
                key={p.id}
                t={`Point ${p.code}`}
                det={p.payCase ? 'Pay case' : 'Not at a table'}
                end={
                  <button
                    type="button"
                    className="c-btn c-sm"
                    onClick={() => {
                      patch(linking, { pointId: p.id });
                      setLinking(null);
                    }}
                  >
                    Link to {rows[linking]?.number}
                  </button>
                }
              />
            ))
          ) : (
            <R2 t="Every Point is at a table" det="Add a Point in Settings › Devices" end={null} />
          )}
        </Rows>
      )}
      <ErrorLine error={error} />
    </Sheet>
  );
}

// ---- 8c · The wait list -----------------------------------------------------------------------------------

/** Add a party (section 8c): name, how many, a number to text if they want one, and the wait to tell them. */
export function AddPartySheet({
  estimate,
  ahead,
  texts,
  busy,
  error,
  onAdd,
  onClose,
}: {
  /** "About 15 min": the shop's estimate for them. */
  estimate: number;
  ahead: number;
  /** Settings › Counter › Text the wait list. */
  texts: boolean;
  busy?: boolean;
  error?: string | null;
  onAdd: (p: { name: string; size: number; phone: string | null; textConsent: boolean; quotedMinutes: number }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(2);
  const [phone, setPhone] = useState('');
  const [told, setTold] = useState(estimate);
  const choices = [...new Set([10, estimate, 20, 30])].sort((a, b) => a - b);
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w420"
      title="Add a party"
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">
            {ahead} ahead of them
          </p>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || !name.trim()} onClick={() => onAdd({ name: name.trim(), size, phone: phone.trim() || null, textConsent: texts && !!phone.trim(), quotedMinutes: told })}>
            {name.trim() ? `Add ${name.trim()}, ${size}` : 'Add a party'}
          </button>
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Name
      </p>
      <input className="c-field c-st-in" aria-label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <p className="c-label c-st-fl">How many</p>
      <SizeSeg value={size} onChange={setSize} label="How many" />
      {texts && (
        <>
          <p className="c-label c-st-fl">Text them at</p>
          <input className="c-field c-st-in" inputMode="tel" aria-label="Text them at" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </>
      )}
      <p className="c-label c-st-fl">Tell them</p>
      <div className="c-st-chips">
        {choices.map((m) => (
          <button key={m} type="button" className={cx('c-btn', told === m && 'c-on')} aria-pressed={told === m} onClick={() => setTold(m)}>
            {m === estimate ? `About ${m} min` : `${m} min`}
          </button>
        ))}
      </div>
      {texts && phone.trim() && (
        <p className="c-det" style={{ marginTop: 'var(--s1)' }}>
          They get one text now, one when it’s almost ready, one when it’s ready. Reply STOP ends them.
        </p>
      )}
      <ErrorLine error={error} />
    </Sheet>
  );
}

/**
 * A party (section 8c): Seat, with the tables that fit them first (and those that clear soon); their
 * name on the Point; the ready text; and Text: almost ready, No show and Remove under it.
 */
export function PartySheet({
  party,
  next,
  tables,
  now,
  texts,
  initialTable,
  busy,
  error,
  onSeat,
  onNotify,
  onNoShow,
  onRemove,
  onClose,
}: {
  party: WaitlistParty;
  next: boolean;
  tables: TableView[];
  now: number;
  texts: boolean;
  initialTable?: string;
  busy?: boolean;
  error?: string | null;
  onSeat: (input: { tableId: string; showName: boolean; text: boolean }) => void;
  onNotify: () => void;
  onNoShow: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const options = seatOrder(tables, party.size);
  const soon = tables.filter((t) => (t.status === 'paid' || t.status === 'bill_sent') && t.seats >= party.size);
  const [tableId, setTableId] = useState<string | null>(initialTable ?? options.find((t) => t.seats >= party.size)?.id ?? null);
  const [showName, setShowName] = useState(true);
  const canText = texts && !!party.phone && party.textConsent;
  const [text, setText] = useState(canText);
  const table = tables.find((t) => t.id === tableId) ?? null;
  const waited = mins(party.joinedAt, now);
  const message = table ? `Your table is ready: ${table.label ?? table.number}${table.area ? `, ${table.area}` : ''}` : 'Your table is ready';
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet c-w460"
      title={`${party.name} · ${party.size}`}
      onClose={onClose}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">{table ? `Seating ${text && canText ? 'texts them and lights' : 'lights'} ${tableName(table)}.` : 'No table fits them yet.'}</p>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || !table} onClick={() => table && onSeat({ tableId: table.id, showName, text: text && canText })}>
            {table ? `Seat at ${table.label ?? table.number}` : 'Seat'}
          </button>
        </div>
      }
    >
      <div className="c-tm-sh">
        <span>
          Party of {party.size} · waited {waited > party.quotedMinutes ? <span className="c-tm-over">{waited} min</span> : `${waited} min`} · told {party.quotedMinutes} min
        </span>
        {next && <Chip tone="neutral">Next</Chip>}
      </div>
      <p className="c-label c-st-fl">Seat at</p>
      <div className="c-st-chips">
        {options.map((t) => (
          <button key={t.id} type="button" className={cx('c-btn', t.id === tableId && 'c-on')} aria-pressed={t.id === tableId} onClick={() => setTableId(t.id)}>
            {t.label ?? t.number} · {t.seats} seats
          </button>
        ))}
        {soon.map((t) => (
          <button key={t.id} type="button" className="c-btn" disabled aria-disabled>
            {t.label ?? t.number} · {t.seats} seats, clears soon
          </button>
        ))}
        {options.length === 0 && soon.length === 0 && <p className="c-det">No table is free yet.</p>}
      </div>
      <Rows style={{ marginTop: 'var(--s2)' }}>
        <R2 t="Show their name on the Point" det="First name only. Off, it says Reserved" end={<Tg on={showName} label="Show their name on the Point" onChange={setShowName} />} />
        {canText ? (
          <R2 t="Text them" det={`${party.phone} · ${message}`} end={<Tg on={text} label="Text them" onChange={setText} />} />
        ) : (
          <R2 off t="Text them" det={!texts ? 'Texting the wait list is off in Settings › Counter' : 'They didn’t leave a number'} end={<Tg on={false} label="Text them" />} />
        )}
      </Rows>
      <div className="c-tm-sec">
        {canText && party.state === 'waiting' && (
          <button type="button" className="c-btn c-sm" disabled={busy} onClick={onNotify}>
            Text: almost ready
          </button>
        )}
        <button type="button" className="c-btn c-sm" disabled={busy} onClick={onNoShow}>
          No show
        </button>
        <button type="button" className="c-btn c-sm" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </div>
      <ErrorLine error={error} />
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
