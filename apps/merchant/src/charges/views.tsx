import { useEffect, useState, type ReactNode } from 'react';
import {
  IconCaretDown,
  IconCard15,
  IconCash15,
  IconChevronSm,
  IconClear15,
  IconFilter,
  IconLock11,
  IconPrev,
  IconSort,
  IconSplit15,
  IconTick,
} from '@/brand/chargeIcons';
import { IconMinus, IconPlusSm } from '@/brand/icons';
import { clickOnKey, cx, initials, MenuButton, PinKeys, Sheet } from '@/brand/ui';
import { TickBox } from '@/brand/controls';
import { usd } from '@/home/model';
import {
  byMethod,
  PAGE,
  sections,
  shareLine,
  type ChargeRow,
  type ClearDetail,
  type Filters,
  type PayMethod,
  type RaisedToday,
  type RowState,
  type Sale,
  type SortBy,
  type When,
} from '@/charges/model';

/**
 * Charges' blocks — docs/merchant-reference/clear-merchant-charges.html, transcribed: Raised today
 * and How it was paid above the list, the list itself with its menus and pager, a charge opened,
 * and the refund, void and tip sheets.
 */

const press = (fn?: () => void) =>
  fn
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: fn,
        onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fn()),
      }
    : {};

// ---- Raised today, and how it was paid -----------------------------------------------------------

function KeyCell({ sw, k, cents, n }: { sw: string; k: string; cents: number; n: number }) {
  return n ? (
    <div className="">
      <span className={cx('c-sw', `c-${sw}`)} />
      <span className="c-k">{k}</span>
      <span className="c-v">{usd(cents)}</span>
      <span className="c-c">· {n}</span>
    </div>
  ) : (
    <div className="c-off">
      <span className={cx('c-sw', `c-${sw}`)} />
      <span className="c-k">{k}</span>
      <span className="c-v c-muted">—</span>
    </div>
  );
}

/** One bar for everything raised today, split by what happened to it. */
export function RaisedTodayPanel({ t, you }: { t: RaisedToday; you?: boolean }) {
  const bar: [string, number][] = [
    ['ok', t.ok.cents],
    ['wait', t.wait.cents],
    ['exp', t.exp.cents],
  ];
  return (
    <div className="c-panel c-sa">
      <div className="c-sa-top">
        <div className="c-sa-head">
          <p className="c-label">{you ? 'Raised by you' : 'Raised today'}</p>
          <p className="c-det">{shareLine(t)}</p>
        </div>
        <p className={cx('c-f', !t.totalCents && 'c-muted')}>{usd(t.totalCents)}</p>
        {t.totalCents ? (
          <div className="c-sa-bar">
            {bar.filter(([, c]) => c > 0).map(([k, c]) => (
              <i key={k} className={`c-${k}`} style={{ flexGrow: c / 100 }} />
            ))}
          </div>
        ) : (
          <div className="c-sa-bar c-empty" />
        )}
      </div>
      <div className="c-sa-key">
        <KeyCell sw="ok" k={t.paid ? 'Paid' : 'Approved'} cents={t.ok.cents} n={t.ok.n} />
        <KeyCell sw="wait" k="Waiting" cents={t.wait.cents} n={t.wait.n} />
        <KeyCell sw="exp" k="Expired" cents={t.exp.cents} n={t.exp.n} />
      </div>
    </div>
  );
}

const METHOD_COLOUR = { clear: 'var(--ink)', card: 'var(--land)', cash: '#A3AE95' } as const;
const METHOD_NAME = { clear: 'Clear', card: 'Card', cash: 'Cash' } as const;

/** What was paid today, one bar split by the way it was paid. */
export function HowPaidPanel({ rows, you }: { rows: ChargeRow[]; you?: boolean }) {
  const m = byMethod(rows);
  const keys = ['clear', 'card', 'cash'] as const;
  const n = keys.reduce((t, k) => t + m[k].n, 0);
  const cents = keys.reduce((t, k) => t + m[k].cents, 0);
  return (
    <div className="c-panel c-sa c-dn">
      <div className="c-sa-top">
        <div className="c-sa-head">
          <p className="c-label">{you ? 'How yours were paid' : 'How it was paid'}</p>
          <p className="c-det">
            {n} {n === 1 ? 'charge' : 'charges'}
          </p>
        </div>
        <p className={cx('c-f', !cents && 'c-muted')}>{usd(cents)}</p>
        <div className={cx('c-sa-bar c-dn-bar', !cents && 'c-empty')}>
          {keys
            .filter((k) => m[k].cents > 0)
            .map((k) => (
              <i key={k} style={{ flexGrow: m[k].cents / 100, background: METHOD_COLOUR[k] }} />
            ))}
        </div>
      </div>
      <div className="c-sa-key">
        {keys.map((k) => (
          <div key={k} className={m[k].n ? undefined : 'c-off'}>
            <span className="c-t">
              <span className="c-sw" style={{ background: METHOD_COLOUR[k] }} />
              <span className="c-k">{METHOD_NAME[k]}</span>
            </span>
            <span className="c-b">
              {m[k].n ? (
                <>
                  <span className="c-v">{usd(m[k].cents)}</span>
                  <span className="c-c">· {m[k].n}</span>
                </>
              ) : (
                <span className="c-v c-muted">—</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- The list ----------------------------------------------------------------------------------

const PM: Record<PayMethod, [string, () => ReactNode]> = {
  clear: ['Clear', IconClear15],
  card: ['Card', IconCard15],
  cash: ['Cash', IconCash15],
  split: ['Split', IconSplit15],
};

export function MethodBox({ method }: { method: PayMethod }) {
  const [label, Icon] = PM[method];
  return (
    <span className={cx('c-ch-pm', `c-${method}`)} title={label} aria-label={label} role="img">
      <Icon />
    </span>
  );
}

const CHIP: Record<RowState, [string, string]> = {
  waiting: ['c-underway', 'Waiting'],
  confirmed: ['c-settled', 'Confirmed'],
  paid: ['c-settled', 'Paid'],
  expired: ['c-absent', 'Expired'],
  refunded: ['c-neutral', 'Refunded'],
  refund: ['c-underway', 'Refund asked'],
  declined: ['c-absent', 'Declined'],
  cancelled: ['c-neutral', 'Cancelled'],
  voided: ['c-neutral', 'Voided'],
};

function RowView({ r, methods, onOpen }: { r: ChargeRow; methods: boolean; onOpen?: () => void }) {
  const [tone, label] = CHIP[r.state];
  const bits: ReactNode[] = [r.time, r.by];
  if (methods && r.state !== 'waiting' && r.pay) {
    bits.push(
      <span key="pm" className={cx('c-pm-t', `c-${r.method}`)}>
        {r.pay}
      </span>,
    );
    if (r.sold) bits.push(r.sold);
  }
  if (r.note) bits.push(r.note);
  if (r.tipCents)
    bits.push(
      <span key="tip" className="c-pm-tip">
        {usd(r.tipCents)} tip
      </span>,
    );
  return (
    <div {...press(onOpen)} style={onOpen ? { cursor: 'pointer' } : undefined}>
      <div className="c-line" style={{ alignItems: 'center' }}>
        <MethodBox method={r.method} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{r.name}</p>
          <p className="c-det" style={{ marginTop: 3 }}>
            {bits.map((b, i) => (
              <span key={i} style={{ display: 'contents' }}>
                {i > 0 && ' · '}
                {b}
              </span>
            ))}
          </p>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexShrink: 0 }}>
          <span className="c-fig c-fig-row c-ch-amt">{usd(r.amountCents)}</span>
          <span className={cx('c-chip', tone)}>{label}</span>
        </span>
      </div>
    </div>
  );
}

const WHEN_LABEL: Record<When, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  both: 'Today and yesterday',
  month: 'This month',
};
const SORT_LABEL: Record<SortBy, [string, string]> = {
  newest: ['Newest', 'Newest first'],
  oldest: ['Oldest', 'Oldest first'],
  largest: ['Largest', 'Largest first'],
  waiting: ['Waiting', 'Waiting first'],
};

/** An option in a menu (a sort), or a radio in a filter's group (`radio`). */
function Opt({ on, off, label, count, onPick, radio }: { on: boolean; off?: boolean; label: string; count?: number; onPick?: () => void; radio?: boolean }) {
  return (
    <div
      className={cx('c-ch-opt', on && 'c-on', off && 'c-off')}
      role={radio ? 'radio' : 'menuitemradio'}
      aria-checked={on}
      aria-disabled={off}
      tabIndex={off ? -1 : 0}
      onClick={off ? undefined : onPick}
      onKeyDown={off ? undefined : clickOnKey}
    >
      <span>{label}</span>
      {count !== undefined && <span className="c-det">{count}</span>}
      {off ? <IconLock11 /> : on ? <IconTick /> : <span />}
    </div>
  );
}

function Chips<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="c-ch-chips">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={cx('c-btn', value === v && 'c-on')} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The list: Waiting first, then one group a day, seven rows to a page. The filter says When on
 * its button; the sort says how. A counter shift sees today and yesterday, and a padlock on the
 * month.
 */
export function ChargesList({
  rows,
  all,
  filters,
  sort,
  owner,
  people,
  onFilters,
  onSort,
  onOpen,
  menuOpen,
}: {
  /** The rows the filters let through. */
  rows: ChargeRow[];
  /** Every row, for the menu's counts. */
  all: ChargeRow[];
  filters: Filters;
  sort: SortBy;
  /** An owner or a manager: the month, Refunded, Paid by and Raised by. */
  owner: boolean;
  people: string[];
  onFilters: (f: Filters) => void;
  onSort: (s: SortBy) => void;
  onOpen: (r: ChargeRow) => void;
  menuOpen?: 'filter' | 'sort';
}) {
  const [page, setPage] = useState(0);
  // Back to the first page when the filters or the sort change. Not by remounting: that would
  // close the filter menu on every chip.
  const shape = `${JSON.stringify(filters)}${sort}`;
  useEffect(() => setPage(0), [shape]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const methods = rows.some((r) => r.method !== 'clear' && r.day === 0);
  // Groups are counted over everything the filters let through, then cut to the page, so a group's
  // figure doesn't change with the page it is on.
  const from = page * PAGE;
  let at = 0;
  const groups = sections(rows, methods)
    .map((g) => {
      const start = at;
      at += g.rows.length;
      return { ...g, rows: g.rows.slice(Math.max(0, from - start), Math.max(0, from + PAGE - start)) };
    })
    .filter((g) => g.rows.length);
  const count = (w: When) =>
    all.filter((r) => (w === 'today' ? r.day === 0 : w === 'yesterday' ? r.day === 1 : w === 'both' ? r.day <= 1 : true)).length;
  const waitingN = all.filter((r) => r.state === 'waiting').length;
  const set = (p: Partial<Filters>) => onFilters({ ...filters, ...p });

  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Charges</p>
          <span className="c-ch-tools">
            <MenuButton
              defaultOpen={menuOpen === 'filter'}
              className="c-ch-menu"
              role="dialog"
              label="Filter charges"
              button={(_, toggle) => (
                <button type="button" className="c-ch-tool" onClick={toggle}>
                  <IconFilter />
                  <span>{WHEN_LABEL[filters.when]}</span>
                  <IconCaretDown />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="c-grp" role="radiogroup" aria-label="When">
                    <p className="c-label">When</p>
                    <Opt radio label="Today" count={count('today')} on={filters.when === 'today'} onPick={() => (set({ when: 'today' }), close())} />
                    <Opt radio label="Yesterday" count={count('yesterday')} on={filters.when === 'yesterday'} onPick={() => (set({ when: 'yesterday' }), close())} />
                    {owner ? (
                      <>
                        <Opt radio label="This month" count={count('month')} on={filters.when === 'month'} onPick={() => (set({ when: 'month' }), close())} />
                        <Opt radio label="Pick dates" on={false} />
                      </>
                    ) : (
                      <>
                        <Opt radio label="Today and yesterday" count={count('both')} on={filters.when === 'both'} onPick={() => (set({ when: 'both' }), close())} />
                        <Opt radio label="This month" on={false} off />
                      </>
                    )}
                  </div>
                  <div className="c-grp">
                    <p className="c-label">Status</p>
                    <Chips
                      value={filters.status}
                      onPick={(status) => set({ status })}
                      options={[
                        ['all', 'All'],
                        ['waiting', `Waiting · ${waitingN}`],
                        ['confirmed', 'Confirmed'],
                        ['expired', 'Expired'],
                        ...(owner ? ([['refunded', 'Refunded']] as [Filters['status'], string][]) : []),
                      ]}
                    />
                  </div>
                  {owner && (
                    <>
                      <div className="c-grp">
                        <p className="c-label">Paid by</p>
                        <Chips
                          value={filters.method}
                          onPick={(method) => set({ method })}
                          options={[
                            ['any', 'Any way'],
                            ['clear', 'Clear'],
                            ['card', 'Card'],
                            ['cash', 'Cash'],
                            ['split', 'Split'],
                          ]}
                        />
                      </div>
                      <div className="c-grp">
                        <p className="c-label">Raised by</p>
                        <Chips value={filters.by} onPick={(by) => set({ by })} options={[['anyone', 'Anyone'], ...people.map((p) => [p, p] as [string, string])]} />
                      </div>
                    </>
                  )}
                </>
              )}
            </MenuButton>
            <MenuButton
              defaultOpen={menuOpen === 'sort'}
              className="c-ch-menu"
              width={240}
              label="Sort charges"
              button={(_, toggle) => (
                <button type="button" className="c-ch-tool c-sort" aria-label={`Sort: ${SORT_LABEL[sort][1].toLowerCase()}`} onClick={toggle}>
                  <IconSort />
                  <span>{SORT_LABEL[sort][0]}</span>
                  <IconCaretDown />
                </button>
              )}
            >
              {(close) => (
                <div className="c-grp" role="group" aria-label="Sort by">
                  <p className="c-label">Sort by</p>
                  {(['newest', 'oldest', 'largest', 'waiting'] as SortBy[]).map((s) => (
                    <Opt key={s} label={SORT_LABEL[s][1]} on={sort === s} onPick={() => (onSort(s), close())} />
                  ))}
                </div>
              )}
            </MenuButton>
          </span>
        </div>
      </div>
      <div className="c-cmain c-ch-list">
        {groups.length === 0 && (
          <div className="c-ch-sec">
            <p className="c-label">No charges</p>
            <span className="c-det">—</span>
          </div>
        )}
        {groups.map((g) => (
          <GroupView key={g.key} g={g} methods={methods} onOpen={onOpen} />
        ))}
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">Expired charges stay listed, so you can follow them up.</span>
          {pages > 1 ? (
            <span className="c-ch-pager">
              <span className="c-det">
                {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}
              </span>
              <button type="button" className="c-ch-arrow" disabled={page === 0} aria-label="Newer" onClick={() => setPage(page - 1)}>
                <IconPrev />
              </button>
              <button type="button" className="c-ch-arrow" disabled={page >= pages - 1} aria-label="Older" onClick={() => setPage(page + 1)}>
                <IconChevronSm />
              </button>
            </span>
          ) : rows.length ? (
            <span className="c-det">All {rows.length} shown</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GroupView({ g, methods, onOpen }: { g: ReturnType<typeof sections>[number]; methods: boolean; onOpen: (r: ChargeRow) => void }) {
  return (
    <>
      <div className="c-ch-sec">
        <p className="c-label">{g.label}</p>
        <span className="c-det">
          {g.past ? (
            <>
              {usd(g.cents)}
              <span className="c-ph-x"> confirmed</span>
              {g.expired > 0 && ` · ${g.expired} expired`}
            </>
          ) : (
            <>
              {g.n} · {usd(g.cents)}
              {g.expired > 0 && ` · ${g.expired} expired`}
            </>
          )}
        </span>
      </div>
      <div className="c-rows">
        {g.rows.map((r) => (
          <RowView key={r.id} r={r} methods={methods} onOpen={() => onOpen(r)} />
        ))}
      </div>
    </>
  );
}

// ---- A charge, opened ----------------------------------------------------------------------------

function Kv({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div>
      <div className="c-kv">
        <span>{k}</span>
        <span className="c-v" style={strong ? { color: 'var(--ink)', fontWeight: 500 } : undefined}>
          {v}
        </span>
      </div>
    </div>
  );
}

function Head({ label, det }: { label: string; det: string }) {
  return (
    <div className="c-chead">
      <div className="c-sechead">
        <p className="c-label">{label}</p>
        <span className="c-det">{det}</span>
      </div>
    </div>
  );
}

/** The owner's money rows: what the shop receives, the fee, and when it is paid out. */
export function ShopGetsCell({ d }: { d: ClearDetail }) {
  return (
    <div className="c-cell">
      <Head label="What the shop gets" det="Owner" />
      <div className="c-cmain">
        <div className="c-rows">
          <Kv k="You receive" v={d.payoutCents === null ? '—' : usd(d.payoutCents)} />
          <Kv
            k={d.rate ? `Fee · ${d.rate}, ${d.paidNow ? 'paid now' : 'over time'}` : 'Fee'}
            v={d.feeCents === null ? '—' : usd(d.feeCents)}
          />
          <Kv k="Paid out" v={d.paidOut ?? '—'} />
        </div>
      </div>
      <div className="c-cfoot">
        <p className="c-det">The fee is shown on every charge, not only at the moment it is raised.</p>
      </div>
    </div>
  );
}

/** A counter shift's view of the same charge: no fee, no payout date. */
export function ThisChargeCell({ amountCents, raisedBy, status }: { amountCents: number; raisedBy: string; status: string }) {
  return (
    <div className="c-cell">
      <Head label="This charge" det="Counter" />
      <div className="c-cmain">
        <div className="c-rows">
          <Kv k="Amount" v={usd(amountCents)} />
          <Kv k="Raised by" v={raisedBy} />
          <Kv k="Status" v={status} />
        </div>
      </div>
      <div className="c-cfoot">
        <p className="c-det">The fee and the payout date are for an owner.</p>
      </div>
    </div>
  );
}

/** What the customer chose on their phone. Context, not an action. */
export function ChoseCell({ d, foot }: { d: ClearDetail | null; foot?: ReactNode }) {
  const n = d?.paidNow ? null : (d?.splitInto ?? null);
  return (
    <div className="c-cell">
      <Head label="What they chose" det="Their phone" />
      <div className="c-cmain">
        {d?.paidNow ? (
          <>
            <p style={{ margin: 0, fontSize: 'var(--t-body)', fontWeight: 500 }}>Paid now</p>
            <p className="c-det" style={{ marginTop: 4 }}>
              From their Clear cash. Nothing for them to clear later.
            </p>
          </>
        ) : n === null ? (
          <>
            <p style={{ margin: 0, fontSize: 'var(--t-body)', fontWeight: 500 }}>Not yet</p>
            <p className="c-det" style={{ marginTop: 4 }}>
              They choose how to pay when they approve it.
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 'var(--t-body)', fontWeight: 500 }}>{n === 1 ? 'Next cycle' : `${n} payments`}</p>
            {n > 1 && d?.perCycleCents != null && (
              <p className="c-det" style={{ marginTop: 4 }}>
                {usd(d.perCycleCents)} a cycle
              </p>
            )}
            {n > 1 && d?.cleared !== undefined && (
              <>
                <div className="c-segs c-mc-prog">
                  {Array.from({ length: n }, (_, i) => (
                    <div key={i} className={i < d.cleared! ? 'c-done' : undefined} />
                  ))}
                </div>
                <p className="c-segcap">
                  <span className="c-t-sav">{d.cleared} cleared</span>
                  <span className="c-sep">·</span>
                  {n - d.cleared} to go
                </p>
              </>
            )}
            <p className="c-det" style={{ marginTop: 'var(--s3)' }}>
              Context, not an action. How a customer is managing it is the shop’s only signal, and there is nothing here to do
              about it.
            </p>
          </>
        )}
      </div>
      {foot && <div className="c-cfoot">{foot}</div>}
    </div>
  );
}

function Small({ rows }: { rows: [string, string][] }) {
  return (
    <div className="c-ch-small">
      {rows.map(([k, v]) => (
        <div key={k} className="c-kv ">
          <span>{k}</span>
          <span className="c-v">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function SoldCell({ s }: { s: Sale }) {
  return (
    <div className="c-cell">
      <Head label="What was sold" det={s.when} />
      <div className="c-cmain c-ch-col">
        <div className="c-ch-hero">
          <p className="c-label">Total</p>
          <p className="c-f">{usd(s.totalCents)}</p>
          <p className="c-det">
            {s.count} items · tax included
          </p>
        </div>
        <div className="c-ch-lns">
          {s.lines.map((l) => (
            <div key={l.t} className="c-kv ">
              <span>{l.t}</span>
              <span className="c-v">{usd(l.cents)}</span>
            </div>
          ))}
        </div>
        <Small
          rows={[
            ['Parts and tires', usd(s.goodsCents)],
            ['Labour', usd(s.labourCents)],
            [s.taxLabel ?? 'Sales tax · 7.75% on parts', usd(s.taxCents)],
            ['Discount', '—'],
            ['Tip', s.tipCents ? usd(s.tipCents) : '—'],
          ]}
        />
      </div>
      <div className="c-cfoot">
        <p className="c-det">Stock came off the shelf when it was paid.</p>
      </div>
    </div>
  );
}

export function PaidHowCell({ s, onRefund, onVoid, onTip }: { s: Sale; onRefund?: () => void; onVoid?: () => void; onTip?: () => void }) {
  const n = s.legs.length;
  return (
    <div className="c-cell">
      <Head label="How it was paid" det={n === 1 ? '1 way' : `${n} ways`} />
      <div className="c-cmain c-ch-col">
        <div className="c-ch-legs">
          {s.legs.map((l) => (
            <div key={l.t} className="c-ch-leg">
              <MethodBox method={l.method} />
              <div>
                <p className="c-t">{l.t}</p>
                <p className="c-det">{l.det}</p>
              </div>
              <span className="c-v">{usd(l.cents)}</span>
              <span className="c-chip c-settled">Paid</span>
            </div>
          ))}
        </div>
        <Small rows={([['Receipt', s.receipt], ['Card part', s.settled]] as [string, string | undefined][]).filter((r): r is [string, string] => !!r[1])} />
        {s.refundOnly && (
          <div className="c-ch-bleed">
            <div>
              <p className="c-t">Refund only</p>
              <p className="c-det">
                {s.live ? 'A void is same-day, before a card on it is captured at close.' : 'A void is same-day, before the card batch settles. This one settled on Sunday.'}
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="c-cfoot">
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-det">{s.refundOnly ? 'A refund needs a manager' : 'A void needs a manager'}</span>
          <span className="c-ch-pair">
            {s.refundOnly ? (
              onRefund && (
                <button type="button" className="c-btn c-btn-primary" onClick={onRefund}>
                  Start a refund
                </button>
              )
            ) : (
              <>
                {s.live && onRefund && (
                  <button type="button" className="c-btn" onClick={onRefund}>
                    Refund part
                  </button>
                )}
                {onTip && (
                  <button type="button" className="c-btn" onClick={onTip}>
                    Adjust the tip
                  </button>
                )}
                {onVoid && (
                  <button type="button" className="c-btn c-btn-primary" onClick={onVoid}>
                    Void
                  </button>
                )}
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- A Clear refund: two people, three steps -----------------------------------------------------

export interface Person {
  name: string;
  role: string;
}

/** A first name, or a stand-in like "the owner" kept whole (the roster couldn't be read). */
const first = (n: string) => (/^the /.test(n) ? n : (n.split(/\s+/)[0] ?? n));
const First = (n: string) => first(n).replace(/^the /, 'The ');

function Who({ p }: { p: Person }) {
  return (
    <span className="c-mc-who2">
      <span className="c-avatarbtn c-sm">{initials(p.name)}</span>
      {first(p.name)} <span className="c-det">{p.role}</span>
    </span>
  );
}

const headWith = (title: string, right: ReactNode) => (
  <div className="c-line" style={{ alignItems: 'center' }}>
    <span className="c-mtitle">{title}</span>
    {right}
  </div>
);

export interface Quote {
  amountCents: number;
  memberCents: number;
  carryCents: number;
  clawbackCents: number;
  payoutAfterCents: number;
}

/** Step one: the writer's numbers — what the customer gets back, never the payout. */
export function RefundReviewSheet({
  customer,
  q,
  writer,
  owner,
  busy,
  error,
  onSend,
  onCancel,
}: {
  customer: string;
  q: Quote;
  writer: Person;
  owner: string;
  busy?: boolean;
  error?: string | null;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      label={`Refund ${usd(q.amountCents)} to ${customer}?`}
      onClose={onCancel}
      head={headWith(`Refund ${usd(q.amountCents)} to ${customer}?`, <Who p={writer} />)}
      foot={
        <>
          <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <p>
              {error ??
                `Nothing moves yet, and ${first(customer)} is told nothing. ${First(owner)} gets this on their phone, or types their code here.`}
            </p>
          </div>
          <div className="c-pair" style={{ marginTop: 'var(--s2)' }}>
            <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={onSend}>
              {busy ? 'Sending…' : 'Send to an owner'}
            </button>
            <button type="button" className="c-btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      }
    >
      <div className="c-rows">
        <Kv k="Their plan closes" v={usd(q.amountCents)} />
        <Kv k="They get back" v={usd(q.memberCents)} strong />
        <Kv k="Carry they already paid" v={`${usd(q.carryCents)} — kept`} />
      </div>
    </Sheet>
  );
}

/**
 * Step two: waiting on the owner. A manager's or the owner's PIN clears it at the till under the
 * shop's limit; above it only the owner, here or from their phone.
 */
export function RefundWaitingSheet({
  customer,
  amountCents,
  writer,
  owner,
  requestedAt,
  limitCents,
  managers,
  pin,
  onPin,
  codeCanClear,
  error,
  onWithdraw,
  onClose,
}: {
  customer: string;
  amountCents: number;
  writer: string;
  owner: string;
  requestedAt: string;
  limitCents: number | null;
  /** "Luis": who else can clear it with a PIN. */
  managers: string[];
  pin: string;
  onPin?: (pin: string) => void;
  codeCanClear: boolean;
  error?: string | null;
  onWithdraw: () => void;
  onClose: () => void;
}) {
  const o = first(owner);
  const limit = limitCents ? usd(limitCents) : null;
  return (
    <Sheet
      label={`Waiting on ${o}`}
      onClose={onClose}
      head={headWith(`Waiting on ${o}`, <span className="c-chip c-underway">Needs an owner</span>)}
      foot={
        <button type="button" className="c-btn c-btn-lg" onClick={onWithdraw}>
          Cancel the request
        </button>
      }
    >
      <p className="c-det">
        {first(writer)} requested a {usd(amountCents)} refund for {customer} at {requestedAt}.
      </p>
      <div className="c-rows" style={{ marginTop: 'var(--s3)' }}>
        <Kv k={`Sent to ${o}`} v="Delivered" />
        <Kv k={`${first(customer)} has been told`} v="Nothing, yet" />
      </div>
      {codeCanClear ? (
        <>
          <p className="c-label" style={{ margin: 'var(--s3) 0 6px' }}>
            {limit ? `Manager or owner PIN · under ${limit}` : 'Owner PIN'}
          </p>
          <div className={cx('c-pinbox', error && 'c-err')} style={{ position: 'relative' }}>
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className={i === pin.length ? 'c-live' : undefined}>
                {i < pin.length ? '•' : ''}
              </span>
            ))}
            <input
              inputMode="numeric"
              autoComplete="off"
              aria-label="Manager or owner PIN"
              maxLength={4}
              value={pin}
              onChange={(e) => onPin?.(e.target.value.replace(/\D/g, '').slice(0, 4))}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%' }}
            />
          </div>
          <p className="c-det" style={{ marginTop: 'var(--s1)' }}>
            {error ??
              (limit
                ? `Under ${limit} ${managers.length ? managers.join(' or ') : 'a manager'} can clear this with their PIN. Above it, only ${o} — here or from their phone.`
                : `Only ${o} can clear it — here or from their phone.`)}
          </p>
        </>
      ) : (
        <p className="c-det" style={{ marginTop: 'var(--s3)' }}>
          {o} has to approve this one from their own device.
        </p>
      )}
    </Sheet>
  );
}

/** Step three: the owner's numbers — what it does to their payout. */
export function RefundApproveSheet({
  customer,
  q,
  writer,
  approver,
  busy,
  error,
  onApprove,
  onDecline,
}: {
  customer: string;
  q: Quote;
  writer: string;
  approver: Person;
  busy?: boolean;
  error?: string | null;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <Sheet
      label="Approve this refund?"
      head={headWith('Approve this refund?', <Who p={approver} />)}
      foot={
        <>
          <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <p>{error ?? `Declining tells ${first(writer)}, not the customer.`}</p>
          </div>
          <div className="c-pair" style={{ marginTop: 'var(--s2)' }}>
            <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={onApprove}>
              {busy ? 'Approving…' : 'Approve refund'}
            </button>
            <button type="button" className="c-btn" disabled={busy} onClick={onDecline}>
              Decline
            </button>
          </div>
        </>
      }
    >
      <p className="c-det" style={{ marginBottom: 'var(--s2)' }}>
        {first(writer)} requested this for {customer}
        {customer.endsWith('.') ? '' : '.'}
      </p>
      <div className="c-rows">
        <Kv k="Refund" v={usd(q.amountCents)} />
        <Kv k="Off your next payout" v={usd(q.clawbackCents)} />
        <Kv k="Next payout becomes" v={usd(q.payoutAfterCents)} strong />
      </div>
    </Sheet>
  );
}

export function RefundedSheet({
  customer,
  q,
  asked,
  approved,
  onDone,
}: {
  customer: string;
  q: Quote;
  /** "Jen · 2:31pm" */
  asked: string;
  approved: string;
  onDone: () => void;
}) {
  const c = first(customer);
  return (
    <Sheet
      title={'\u00a0'}
      label="Refunded"
      onClose={onDone}
      foot={
        <>
          <p className="c-det" style={{ marginBottom: 'var(--s2)' }}>
            The record keeps both names. An owner reviewing the month needs to know who asked as well as who approved.
          </p>
          <button type="button" className="c-btn c-btn-lg" onClick={onDone}>
            Done
          </button>
        </>
      }
    >
      <p className="c-fig c-fig-sec">Refunded</p>
      <p className="c-det" style={{ marginTop: 4 }}>
        {c} has been told. Their plan is closed.
      </p>
      <div className="c-rows" style={{ marginTop: 'var(--s3)' }}>
        <Kv k="Refunded" v={usd(q.amountCents)} />
        <Kv k={`${c} gets back`} v={usd(q.memberCents)} />
        <Kv k="Asked by" v={asked} />
        <Kv k="Approved by" v={approved} />
      </div>
    </Sheet>
  );
}

export function RefundDeclinedSheet({ customer, decider, onDone }: { customer: string; decider: string; onDone: () => void }) {
  return (
    <Sheet
      title="Refund declined"
      onClose={onDone}
      foot={
        <button type="button" className="c-btn c-btn-lg" onClick={onDone}>
          Back to the charge
        </button>
      }
    >
      <p className="c-det">
        The charge stands and nothing has moved. {customer} has not been told anything. Speak to {first(decider)} before you speak
        to them.
      </p>
    </Sheet>
  );
}

// ---- Card and cash: refund, void, tip ------------------------------------------------------------

export interface ReturnLine {
  t: string;
  det: string;
  cents: number;
  /** Labour already done cannot come back. */
  labour?: boolean;
  stock?: boolean;
  /** How many were sold: above one, the sheet asks how many come back ("one of two tires"). */
  quantity?: number;
}

/** What comes back: a line, how many of it, whether it goes back on the shelf, and what it's worth. */
export interface Returned {
  index: number;
  quantity: number;
  backInStock: boolean;
  cents: number;
}

/** Goods come back, and the money goes back the way it came: the card first, then the drawer. */
export function GoodsRefundSheet({
  s,
  lines,
  onSend,
  onClose,
  busy,
  error,
}: {
  s: Sale;
  lines: ReturnLine[];
  onSend?: (returned: Returned[]) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [on, setOn] = useState(lines.map((l) => !l.labour));
  const [stock, setStock] = useState(lines.map((l) => !!l.stock));
  const [qty, setQty] = useState(lines.map((l) => l.quantity ?? 1));
  // A line's worth scales with how many come back, to the cent, with the whole line when all do.
  const worth = (l: ReturnLine, i: number) => (qty[i] === (l.quantity ?? 1) ? l.cents : Math.round((l.cents * qty[i]!) / (l.quantity ?? 1)));
  const total = lines.reduce((t, l, i) => t + (on[i] ? worth(l, i) : 0), 0);
  const returned = (): Returned[] =>
    lines.flatMap((l, i) => (on[i] && !l.labour ? [{ index: i, quantity: qty[i]!, backInStock: stock[i]!, cents: worth(l, i) }] : []));
  const card = s.legs.find((l) => l.method === 'card');
  const toCard = Math.min(total, card?.cents ?? 0);
  const toCash = total - toCard;
  const split = s.legs.map((l) => `${usd(l.cents)} ${l.method}`).join(', ');
  return (
    <Sheet
      className="c-ch-sheet c-wide"
      title="Start a refund"
      closeSize="lg"
      onClose={onClose}
      foot={
        <>
          <div className="c-ch-total">
            <span>Refund</span>
            <b>{usd(total)}</b>
          </div>
          {error && (
            <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: '0 0 var(--s1)' }}>
              {error}
            </p>
          )}
          <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ width: '100%' }} disabled={!total || !onSend || busy} onClick={() => onSend?.(returned())}>
            {busy ? 'Sending…' : 'Send to a manager'}
          </button>
        </>
      }
    >
      <p className="c-det" style={{ margin: '0 0 var(--s1)' }}>
        {s.name} · {s.when.split(' · ')[0]} · {usd(s.totalCents)} · {split}
      </p>
      <p className="c-label c-ch-fl">What is coming back</p>
      <div className="c-ch-rets">
        {lines.map((l, i) => (
          <div key={l.t} className={cx('c-ch-ret', on[i] && 'c-on')} aria-disabled={l.labour || undefined}>
            <TickBox kind="charge" on={on[i]} label={l.t} onChange={l.labour ? undefined : (v) => setOn(on.map((x, k) => (k === i ? v : x)))} />
            <div>
              <p className="c-t">{l.t}</p>
              <p className="c-det">{l.det}</p>
              {!l.labour && (l.quantity ?? 1) > 1 && on[i] && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span className="c-ci-step">
                    <button type="button" aria-label={`One fewer of ${l.t}`} disabled={qty[i]! <= 1} onClick={() => setQty(qty.map((x, k) => (k === i ? x - 1 : x)))}>
                      <IconMinus />
                    </button>
                    <b aria-live="polite">{qty[i]}</b>
                    <button type="button" aria-label={`One more of ${l.t}`} disabled={qty[i]! >= l.quantity!} onClick={() => setQty(qty.map((x, k) => (k === i ? x + 1 : x)))}>
                      <IconPlusSm />
                    </button>
                  </span>
                  <span className="c-det">of {l.quantity} coming back</span>
                </span>
              )}
              {!l.labour && (
                <label className="c-ch-stock" onClick={() => setStock(stock.map((x, k) => (k === i ? !x : x)))}>
                  <span className={cx('c-ch-toggle', stock[i] && 'c-on')} role="switch" aria-checked={stock[i]} aria-label="Back in stock" tabIndex={0} onKeyDown={clickOnKey} />
                  Back in stock
                </label>
              )}
            </div>
            <span className="c-v">{usd(on[i] ? worth(l, i) : l.cents)}</span>
          </div>
        ))}
      </div>
      <p className="c-label c-ch-fl">Where the money goes</p>
      <div className="c-ch-legs">
        {card && (
          <div className="c-ch-leg">
            <MethodBox method="card" />
            <div>
              <p className="c-t">Back to {card.t}</p>
              <p className="c-det">First: everything the card paid</p>
            </div>
            <span className="c-v">{usd(toCard)}</span>
            <span className="c-chip c-neutral">First</span>
          </div>
        )}
        {toCash > 0 && (
          <div className="c-ch-leg">
            <MethodBox method="cash" />
            <div>
              <p className="c-t">Cash from the drawer</p>
              <p className="c-det">Then the rest, counted at today’s close</p>
            </div>
            <span className="c-v">{usd(toCash)}</span>
            <span className="c-chip c-neutral">Then</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Four digits typed on the sheet itself: dots, then the keypad. */
function PinPad({ error, onDigit, onDelete }: { error?: string | null; onDigit: (d: string) => void; onDelete: () => void }) {
  return (
    <>
      {error && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
          {error}
        </p>
      )}
      <PinKeys onDigit={onDigit} onDelete={onDelete} />
    </>
  );
}

export function VoidSheet({
  s,
  by,
  manager,
  filled,
  onKeep,
  onVoid,
  onDigit,
  onDelete,
  error,
  busy,
}: {
  s: Sale;
  by: string;
  /** Whose PIN it asks for: "Luis", or "A manager" when anyone's will do. */
  manager: string;
  filled: number;
  onKeep: () => void;
  onVoid?: () => void;
  onDigit?: (d: string) => void;
  onDelete?: () => void;
  error?: string | null;
  busy?: boolean;
}) {
  const leg = s.legs[0]!;
  const card = s.legs.some((l) => l.method === 'card');
  const cash = s.legs.some((l) => l.method === 'cash');
  return (
    <Sheet
      className="c-ch-sheet "
      title="Void this charge?"
      closeSize="lg"
      onClose={onKeep}
      foot={
        <div className="c-ch-pair c-wide">
          <button type="button" className="c-btn c-btn-lg" onClick={onKeep}>
            Keep it
          </button>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={!onVoid || busy || (!!onDigit && filled < 4)} onClick={onVoid}>
            {busy ? 'Voiding…' : `Void ${usd(s.totalCents)}`}
          </button>
        </div>
      }
    >
      <div className="c-ch-was c-two c-top">
        <div>
          <p className="c-label">Charge</p>
          <p className="c-f">{usd(s.totalCents)}</p>
        </div>
        <div>
          <p className="c-label">Of it, tip</p>
          <p className="c-f">{s.tipCents ? usd(s.tipCents) : '—'}</p>
        </div>
      </div>
      <p className="c-det" style={{ marginTop: 12 }}>
        {s.name} · {leg.t} · {leg.det.split(' · ')[0]} · {by}
      </p>
      <div className="c-ch-list2">
        {card && (
          <div className="c-kv ">
            <span>The card</span>
            <span className="c-v">Never charged. They see nothing.</span>
          </div>
        )}
        {cash && (
          <div className="c-kv ">
            <span>The cash</span>
            <span className="c-v">Handed back from the drawer</span>
          </div>
        )}
        <div className="c-kv ">
          <span>The items</span>
          <span className="c-v">All {s.count} back in stock</span>
        </div>
        {s.tipCents > 0 && (
          <div className="c-kv ">
            <span>{by}’s tip</span>
            <span className="c-v">Goes with it</span>
          </div>
        )}
        <div className="c-kv ">
          <span>Fees</span>
          <span className="c-v">—</span>
        </div>
      </div>
      <p className="c-det" style={{ marginTop: 'var(--s2)', lineHeight: 1.5 }}>
        A void undoes the whole charge as if it never happened. It is only possible the same day, before the card batch settles
        tonight.
      </p>
      <div className="c-ch-pin">
        <span className="c-det">{/^A /.test(manager) ? `${manager}’s or the owner’s PIN` : `${manager}’s manager PIN`}</span>
        <span className="c-dots">
          {Array.from({ length: 4 }, (_, i) => (
            <i key={i} className={i < filled ? 'c-f' : undefined} />
          ))}
        </span>
      </div>
      {onDigit && <PinPad error={error} onDigit={onDigit} onDelete={() => onDelete?.()} />}
    </Sheet>
  );
}

/**
 * A refund a counter shift asked for, approved at the counter: a manager or the owner types their
 * PIN. Nothing moves until they do.
 */
export function ManagerPinSheet({
  title,
  body,
  filled,
  onCancel,
  onApprove,
  onDigit,
  onDelete,
  error,
  busy,
}: {
  title: string;
  body: ReactNode;
  filled: number;
  onCancel: () => void;
  onApprove: () => void;
  onDigit: (d: string) => void;
  onDelete: () => void;
  error?: string | null;
  busy?: boolean;
}) {
  return (
    <Sheet
      className="c-ch-sheet "
      title={title}
      closeSize="lg"
      onClose={onCancel}
      foot={
        <div className="c-ch-pair c-wide">
          <button type="button" className="c-btn c-btn-lg" onClick={onCancel}>
            Not now
          </button>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" disabled={busy || filled < 4} onClick={onApprove}>
            {busy ? 'Approving…' : 'Approve'}
          </button>
        </div>
      }
    >
      <div className="c-det" style={{ lineHeight: 1.5 }}>
        {body}
      </div>
      <div className="c-ch-pin">
        <span className="c-det">A manager’s or the owner’s PIN</span>
        <span className="c-dots">
          {Array.from({ length: 4 }, (_, i) => (
            <i key={i} className={i < filled ? 'c-f' : undefined} />
          ))}
        </span>
      </div>
      <PinPad error={error} onDigit={onDigit} onDelete={onDelete} />
    </Sheet>
  );
}

const TIPS = [1000, 1500, 2000];

export function TipSheet({
  s,
  by,
  initial,
  onSave,
  onClose,
  busy,
  error,
}: {
  s: Sale;
  by: string;
  initial: number;
  onSave?: (cents: number) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [tip, setTip] = useState(initial);
  const [other, setOther] = useState(!TIPS.includes(initial) && initial > 0);
  const leg = s.legs.find((l) => l.method === 'card') ?? s.legs[0]!;
  return (
    <Sheet
      className="c-ch-sheet "
      title="Adjust the tip"
      closeSize="lg"
      onClose={onClose}
      foot={
        <>
          <div className="c-ch-total">
            <span>New total</span>
            <b>{usd(s.totalCents - s.tipCents + tip)}</b>
          </div>
          {error && (
            <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: '0 0 var(--s1)' }}>
              {error}
            </p>
          )}
          <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ width: '100%' }} disabled={!onSave || busy} onClick={() => onSave?.(tip)}>
            {busy ? 'Saving…' : 'Save the tip'}
          </button>
        </>
      }
    >
      <p className="c-det" style={{ margin: '0 0 var(--s2)' }}>
        {s.name} · {leg.t} · {leg.det.split(' · ')[0]} · {by}
      </p>
      <div className="c-ch-was c-two">
        <div>
          <p className="c-label">On the card</p>
          <p className="c-f">{usd(s.tipCents)}</p>
        </div>
        <div className="c-ok">
          <p className="c-label">Change to</p>
          <p className="c-f">{usd(tip)}</p>
        </div>
      </div>
      <div className="c-ch-tipq">
        {TIPS.map((t) => (
          <button key={t} type="button" className={cx('c-btn', !other && tip === t && 'c-on')} onClick={() => (setOther(false), setTip(t))}>
            {usd(t)}
          </button>
        ))}
        <button type="button" className={cx('c-btn', other && 'c-on')} onClick={() => setOther(true)}>
          Other
        </button>
      </div>
      {other && (
        <label className="c-kv" style={{ marginTop: 'var(--s2)' }}>
          <span>Tip, in dollars</span>
          <input
            className="c-field"
            inputMode="decimal"
            aria-label="Tip, in dollars"
            style={{ width: 120, textAlign: 'right' }}
            defaultValue={(tip / 100).toFixed(2)}
            onChange={(e) => {
              const v = Math.round(parseFloat(e.target.value.replace(/[^0-9.]/g, '')) * 100);
              setTip(Number.isFinite(v) && v >= 0 ? v : 0);
            }}
          />
        </label>
      )}
      <p className="c-det" style={{ marginTop: 'var(--s2)', lineHeight: 1.5 }}>
        For a tip written on a printed slip. Tips can change until the day is closed; after that they are part of the day’s
        figures.
      </p>
    </Sheet>
  );
}

