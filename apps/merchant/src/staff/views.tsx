import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { StaffRole } from '@clear/domain';
import {
  IconAdd14,
  IconBackChevron,
  IconCalendar,
  IconChevronSm,
  IconClock,
  IconInfo,
  IconPickTick,
  IconPinLock,
  IconPrev,
  IconX14,
} from '@/brand/chargeIcons';
import { IconChevron, IconClose, IconLock } from '@/brand/icons';
import { cx, initials, Sheet, clickOnKey } from '@/brand/ui';
import { Keypad, typeAmount } from '@/charge/start';
import { usd } from '@/home/model';
import { roleLabel } from '@/shell/chrome';
import {
  clock,
  cover,
  coverLine,
  DAY_KEYS,
  dayName,
  daysLabel,
  gapLine,
  gridLines,
  hoursTotal,
  span,
  ticks,
  toHHMM,
  toHour,
  time,
  weekHours,
  type Hours,
  type Mate,
  type Seg,
  type Week,
} from '@/staff/model';

/**
 * Staff's blocks — docs/merchant-reference/clear-merchant-staff.html, transcribed: who is on the
 * counter now, the week, the team, the roles and the refund limit, and the sheets they open.
 */

const TONE: Record<StaffRole, string> = { counter: 'c-neutral', manager: 'c-underway', owner: 'c-settled' };
const RoleChip = ({ role }: { role: StaffRole }) => <span className={cx('c-chip', TONE[role])}>{roleLabel(role)}</span>;

const press = (fn?: () => void) =>
  fn
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: fn,
        onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fn()),
      }
    : {};

// ---- On the counter now -------------------------------------------------------------------------

function MateTile({ m, ro, onTap }: { m: Mate; ro?: boolean; onTap?: () => void }) {
  const n = m.hours ?? 0;
  const done = Math.floor(m.done ?? 0);
  const p = `${Math.round(((m.done ?? 0) - done) * 100)}%`;
  return (
    <div className={cx('c-mc-mate', m.holds && 'c-hold', ro && 'c-ro')} {...press(ro ? undefined : onTap)}>
      <span className="c-top">
        <span className="c-avatarbtn">{initials(m.name)}</span>
        <span className="c-nm">{m.name}</span>
        {m.holds && <span className="c-tag">Tablet</span>}
      </span>
      <span className="c-when">
        <span>
          Since <b>{m.since}</b>
        </span>
        {m.until ? (
          <span>
            Until <b>{m.until}</b>
          </span>
        ) : (
          <span>Not booked</span>
        )}
      </span>
      {n ? (
        <span className="c-hrs" style={{ '--n': n } as CSSProperties}>
          {Array.from({ length: n }, (_, i) =>
            i < done ? <span key={i} className="c-done" /> : i === done ? <span key={i} className="c-now" style={{ '--p': p } as CSSProperties} /> : <span key={i} />,
          )}
        </span>
      ) : (
        <span className="c-hrs c-none" />
      )}
    </div>
  );
}

/**
 * Everyone on shift, as one strip of tiles. Past three it scrolls sideways, and the arrows and
 * the marks appear (`over`), as the reference's script does it.
 */
export function CrewPanel({
  crew,
  manage,
  onTap,
  onStart,
  onChangeShift,
  onEndShift,
}: {
  crew: Mate[];
  /** An owner or a manager: every tile opens that person. */
  manage: boolean;
  onTap: (m: Mate) => void;
  onStart: () => void;
  onChangeShift: () => void;
  onEndShift: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [at, setAt] = useState(0);
  const [ends, setEnds] = useState({ start: true, end: true });

  const step = () => {
    const c = ref.current;
    if (!c) return 0;
    const people = c.querySelectorAll<HTMLElement>('.c-mc-mate:not(.c-mc-empty)');
    return people.length > 1 ? people[1].offsetLeft - people[0].offsetLeft : c.clientWidth;
  };

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const update = () => {
      setOver(c.scrollWidth > c.clientWidth + 2);
      const l = c.scrollLeft;
      const max = c.scrollWidth - c.clientWidth;
      const s = step();
      setAt(l >= max - 2 ? crew.length - 1 : s ? Math.round(l / s) : 0);
      setEnds({ start: l <= 2, end: l >= max - 2 });
    };
    update();
    c.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(c);
    return () => {
      c.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [crew.length]);

  // Glides to the next page of the crew, unless the device asks for less motion.
  const by = (dir: number) =>
    ref.current?.scrollBy({ left: dir * step(), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const others = crew.some((m) => !m.holds);
  const empties = Math.max(0, 3 - crew.length);

  return (
    <div className={cx('c-mc-crewpanel', over && 'c-over')}>
      <div className="c-mc-crewhead">
        <p className="c-label">On the counter now</p>
        <span className="c-r">
          <span className="c-chip c-settled">
            <span className="c-core" />
            {crew.length} on shift
          </span>
          <span className="c-mc-crewnav">
            <button type="button" className="c-mc-arrow c-prev" aria-label="Previous" disabled={ends.start} onClick={() => by(-1)}>
              <IconPrev />
            </button>
            <button type="button" className="c-mc-arrow c-next" aria-label="Next" disabled={ends.end} onClick={() => by(1)}>
              <IconChevronSm />
            </button>
          </span>
        </span>
      </div>
      <div className="c-mc-crew" ref={ref}>
        {crew.map((m) => (
          <MateTile key={m.id} m={m} ro={!manage && !m.holds} onTap={() => (manage ? onTap(m) : onChangeShift())} />
        ))}
        {Array.from({ length: empties }, (_, i) =>
          i === 0 ? (
            <div key="start" className="c-mc-mate c-mc-empty" {...press(onStart)}>
              <IconAdd14 />
              Start a shift
            </div>
          ) : (
            <div key={i} className="c-mc-mate c-mc-empty c-blank" aria-hidden="true" />
          ),
        )}
      </div>
      <div className="c-mc-crewfoot">
        <span className="c-det c-tip">
          {manage && others ? 'Tap anyone to end their shift or see their hours' : 'You have the tablet. Hand it over with your PIN.'}
        </span>
        <div className="c-mc-marks" aria-hidden="true">
          {crew.map((m, i) => (
            <i key={m.id} className={i === at ? 'c-on' : undefined} />
          ))}
        </div>
        <span className="c-pair">
          <button type="button" className="c-btn" onClick={onChangeShift}>
            Change shift
          </button>
          <button type="button" className="c-btn" onClick={onEndShift}>
            End my shift
          </button>
        </span>
      </div>
    </div>
  );
}

/** Someone added who has not started a shift yet: the slot retires itself when they do. */
export function WaitingToStart({ m, onRemind }: { m: Mate; onRemind?: () => void }) {
  return (
    <div className="c-mc-slot">
      <div className="c-panel">
        <div className="c-cmain">
          <div className="c-rows">
            <div>
              <div className="c-line" style={{ alignItems: 'center' }}>
                <div>
                  <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>{m.name} has not started a shift</p>
                  <p className="c-det" style={{ marginTop: 3 }}>
                    {m.added}
                    {!m.usual && ' · no hours yet'} · they set their PIN the first time they do
                  </p>
                </div>
                <button type="button" className="c-btn" onClick={onRemind}>
                  Remind them
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- This week ----------------------------------------------------------------------------------

const Track = ({ segs, className }: { segs: Seg[]; className?: string }) => (
  <span className={cx('c-trk', className)}>
    {segs.map((s, i) => (
      <i key={i} className={s.cls.split(' ').map((c) => (c ? `c-${c}` : '')).join(' ')} style={{ left: `${s.left.toFixed(1)}%`, width: `${s.width.toFixed(1)}%` }} />
    ))}
  </span>
);

/**
 * The week, one day at a time: the day buttons, then that day's rows against the shop's opening
 * hours. An owner or a manager also sees Cover, the gaps nobody is booked for.
 */
export function WeekPanel({ week, team, manage, onSet }: { week: Week; team: Mate[]; manage: boolean; onSet?: (m: Mate) => void }) {
  const [day, setDay] = useState(week.today);
  const total = Object.values(week.booked).reduce((t, d) => t + weekHours(d), 0);
  const gaps = gapLine(week);

  return (
    <div className="c-panel c-wk-panel">
      <div className="c-chead">
        <div className="c-wk-head">
          <p className="c-label">This week</p>
          <span className="c-r">
            <span className="c-det">{week.label}</span>
            <button type="button" className="c-mc-arrow" aria-label="Last week">
              <IconPrev />
            </button>
            <button type="button" className="c-mc-arrow" aria-label="Next week">
              <IconChevronSm />
            </button>
          </span>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-dv">
          <div className="c-dv-days">
            {week.days.map((d, i) => {
              const c = cover(week, i);
              return (
                <button
                  key={i}
                  type="button"
                  className={cx('c-btn', i === day && 'c-on', i === week.today && 'c-today', !d.open && 'c-shut')}
                  onClick={() => setDay(i)}
                >
                  <span className="c-dl">
                    <b className="c-s">{DAY_KEYS[i]}</b>
                    <b className="c-l">{d.short}</b>
                    <small>{d.date}</small>
                  </span>
                  <span className="c-oh">{d.open ? span(...d.open) : 'Closed'}</span>
                  {d.open ? <Track className="c-mini" segs={[...c.cov, ...c.gap]} /> : <span className="c-mini c-trk c-shut" />}
                </button>
              );
            })}
          </div>
          {week.days.map((d, i) => (
            <div key={i} className={cx('c-dv-day', i === day && 'c-on')}>
              <div className="c-dv-top">
                <p className="c-d">
                  {d.long} {d.date}
                  {i === week.today && ' · today'}
                </p>
                <p className="c-det">{d.open ? `Open ${span(...d.open)}` : 'Closed'}</p>
              </div>
              {d.open ? <DayBody week={week} day={i} team={team} manage={manage} onSet={onSet} /> : (
                <div className="c-dv-closed">
                  <p className="c-det">The shop is closed, so nobody is booked.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="c-cfoot">
        <div className="c-wk-foot">
          {manage ? (
            <>
              {gaps && (
                <span className="c-wk-gap c-det">
                  <span>{gaps}</span>
                </span>
              )}
              <span className="c-det c-tot">{total} hours booked this week</span>
            </>
          ) : (
            <span className="c-det">Only an owner or a manager changes hours.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DayBody({ week, day, team, manage, onSet }: { week: Week; day: number; team: Mate[]; manage: boolean; onSet?: (m: Mate) => void }) {
  const open = week.days[day].open!;
  const [a, b] = open;
  const len = b - a;
  const today = day === week.today;
  const f = today ? Math.round(((week.now - a) / len) * 1000) / 1000 : undefined;
  const tone = day < week.today ? 'past' : today ? 'now' : '';
  const total = Object.values(week.booked).reduce((t, d) => t + weekHours(d), 0);
  const c = coverLine(week, day);
  const segs = cover(week, day);

  return (
    <div className="c-dv-body">
      <div className="c-dv-axis">
        <span />
        <div className="c-dv-ticks">
          {ticks(open, f).map((t) => (
            <span key={t.left} className={t.mid ? 'c-mid' : ''} style={{ left: `${t.left.toFixed(1)}%` }}>
              {t.label}
            </span>
          ))}
        </div>
        <span className="c-wt c-h">Week</span>
      </div>
      <div className="c-dv-grid">
        {gridLines(open).map((l) => (
          <i key={l} style={{ left: `${l.toFixed(2)}%` }} />
        ))}
      </div>
      {team.map((m) => {
        const days = week.booked[m.id];
        const s = days?.[day];
        const from = today ? week.unbooked?.[m.id] : undefined;
        let det: ReactNode;
        let segsRow: Seg[] = [];
        let now = false;
        if (s) {
          det = span(...s);
          now = today;
          segsRow = [{ cls: tone, left: ((s[0] - a) / len) * 100, width: ((s[1] - s[0]) / len) * 100 }];
        } else if (from !== undefined) {
          det = `From ${clock(from, true)}`;
          segsRow = [{ cls: 'x', left: ((from - a) / len) * 100, width: ((b - from) / len) * 100 }];
        } else if (!days) {
          det = (
            <>
              No hours yet
              {manage && (
                <span className="c-lk">
                  {' · '}
                  <span className="c-wk-link" {...press(onSet ? () => onSet(m) : undefined)}>
                    Set
                  </span>
                </span>
              )}
            </>
          );
        } else det = 'Off';
        return (
          <div key={m.id} className="c-dv-row">
            <div className="c-who">
              <span className="c-avatarbtn c-sm">{initials(m.name)}</span>
              <div>
                <p className="c-nm">{m.name}</p>
                <p className={cx('c-det', now && 'c-now')}>{det}</p>
              </div>
            </div>
            <Track segs={segsRow} />
            <span className="c-wt">{days ? `${weekHours(days)}h` : '—'}</span>
          </div>
        );
      })}
      {manage && (
        <div className="c-dv-row c-cov">
          <div className="c-who">
            <span className="c-avsp" />
            <div>
              <p className="c-label">Cover</p>
              <p className={cx('c-det', `c-${c.cls}`)}>{c.t}</p>
            </div>
          </div>
          <Track segs={[...segs.cov, ...segs.gap]} />
          <span className="c-wt">{total}h</span>
        </div>
      )}
      {f !== undefined && (
        <span className="c-dv-now" style={{ '--f': f } as CSSProperties}>
          <b>{clock(week.now, true).replace(/[ap]m$/, '')}</b>
        </span>
      )}
    </div>
  );
}

// ---- The slab -----------------------------------------------------------------------------------

/** What the Now column says. */
function nowOf(m: Mate) {
  if (m.on) return m.until ? `On now, until ${m.until}` : 'On now';
  if (m.added && !m.usual) return 'No hours yet';
  return '—';
}

export function TeamCell({
  team,
  manage,
  onTap,
  onAdd,
}: {
  team: Mate[];
  /** An owner or a manager. A counter shift sees the team read-only, without the charge counts. */
  manage: boolean;
  /** Absent while there is nothing to change about a person (a live shop, until the API has it). */
  onTap?: (m: Mate) => void;
  onAdd?: () => void;
}) {
  const on = team.filter((m) => m.on).length;
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Team</p>
          <span className="c-det">
            {team.length} {team.length === 1 ? 'person' : 'people'} · {on} on now
          </span>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-tm">
          {team.map((m) => (
            <div key={m.id} className={cx('c-tm-row', manage && onTap ? 'c-p' : 'c-ro')} {...press(manage && onTap ? () => onTap(m) : undefined)}>
              <span className="c-av">
                <span className={cx('c-avatarbtn', m.added && 'c-new')}>{initials(m.name)}</span>
              </span>
              <span className="c-nm">
                {m.name}
                <RoleChip role={m.role} />
              </span>
              <span className={cx('c-now', m.on && 'c-on')}>{nowOf(m)}</span>
              <span className="c-det">
                {m.added ?? (manage ? `${m.chargesThisMonth ?? 0} charges this month` : (m.joined ?? '—'))}
              </span>
              {m.role === 'owner' ? (
                <span className="c-acc">
                  <IconPinLock />
                  Owner sign-in
                </span>
              ) : m.added ? (
                <span className="c-acc c-wait">PIN on first shift</span>
              ) : (
                <span className="c-acc">
                  <IconPinLock />
                  PIN
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="c-cfoot">
        {manage ? (
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-det">{onTap ? 'Tap someone to change their role, PIN or hours' : ''}</span>
            <button type="button" className="c-btn" onClick={onAdd}>
              Add someone
            </button>
          </div>
        ) : (
          <p className="c-det">Only an owner or a manager adds people.</p>
        )}
      </div>
    </div>
  );
}

export function RolesCell() {
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">What each role can do</p>
          <span className="c-det">Each adds to the last</span>
        </div>
      </div>
      <div className="c-cmain">
        <div className="c-mc-roles">
          <div>
            <span className="c-r">
              <RoleChip role="counter" />
            </span>
            <span className="c-can">Charge, take cash, up to 10% off.</span>
          </div>
          <div>
            <span className="c-r">
              <RoleChip role="manager" />
            </span>
            <span className="c-can">
              <span>
                <span className="c-plus">Plus</span> refunds, 25% off, staff, closing.
              </span>
            </span>
          </div>
          <div>
            <span className="c-r">
              <RoleChip role="owner" />
            </span>
            <span className="c-can">
              <span>
                <span className="c-plus">Plus</span> payouts, terms, limits, managers.
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="c-cfoot">
        <p className="c-det">Only an owner changes where money goes.</p>
      </div>
    </div>
  );
}

const limitText = (cents: number | null) => (cents === null ? '—' : cents === 0 ? 'Off' : usd(cents));

/** The one number an owner sets. Everyone else sees it, and who sets it. */
export function LimitCell({ role, limitCents, onChange }: { role: StaffRole; limitCents: number | null; onChange?: () => void }) {
  const owner = role === 'owner';
  return (
    <div className="c-cell">
      <div className="c-chead">
        <div className="c-sechead">
          <p className="c-label">Refund limit</p>
          <span className="c-det">{owner ? 'Every refund needs a PIN' : 'Set by the owner'}</span>
        </div>
      </div>
      <div className="c-cmain c-mc-limit">
        <div className="c-lim2">
          <div>
            <p className="c-t">A manager approves up to</p>
            <p className="c-det">
              {owner
                ? 'Above it, you approve with your PIN.'
                : role === 'manager'
                  ? 'Above it, the owner approves.'
                  : 'You can ask for a refund on any charge.'}
            </p>
          </div>
          <span className="c-fig c-fig-sec">{limitText(limitCents)}</span>
        </div>
      </div>
      <div className="c-cfoot">
        {owner ? (
          <div className="c-line" style={{ alignItems: 'center' }}>
            <span className="c-det">Set to Off and every refund waits for you</span>
            <button type="button" className="c-btn" onClick={onChange}>
              Change
            </button>
          </div>
        ) : (
          <p className="c-det" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconLock /> Only the owner changes this
          </p>
        )}
      </div>
    </div>
  );
}

// ---- Sheets -------------------------------------------------------------------------------------

function Pick({ on, title, det, onPick }: { on: boolean; title: string; det: string; onPick: () => void }) {
  return (
    <div>
      <div className="c-line" style={{ alignItems: 'flex-start', cursor: 'pointer' }} {...press(onPick)} aria-pressed={on}>
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
          <span className={cx('c-pick', on && 'c-on')} style={{ marginTop: 2 }}>
            {on && <IconPickTick />}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>{title}</span>
            <span className="c-det" style={{ display: 'block', marginTop: 3 }}>
              {det}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? '';

export function AddSomeoneSheet({
  canAddManager,
  initialName = '',
  onAdd,
  onClose,
}: {
  canAddManager: boolean;
  initialName?: string;
  /** Absent: the sheet opens, and adding waits for the API. */
  onAdd?: (p: { name: string; role: StaffRole }) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState<StaffRole>('counter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = name.trim().length > 1 && !!onAdd && !busy;
  return (
    <Sheet
      title="Add someone"
      onClose={onClose}
      foot={
        <>
          <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <p>{error ?? 'They choose their own four digits on their first shift. Nobody else ever types them, including you.'}</p>
          </div>
          <button
            type="button"
            className="c-btn c-btn-primary c-btn-lg"
            style={{ marginTop: 'var(--s2)' }}
            disabled={!ok}
            onClick={async () => {
              if (!onAdd) return;
              setBusy(true);
              setError(null);
              try {
                await onAdd({ name: name.trim(), role });
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That did not go through. Try again.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {first(name) ? `Add ${first(name)}` : 'Add someone'}
          </button>
        </>
      }
    >
      <p className="c-label" style={{ marginBottom: 6 }}>
        Their name
      </p>
      <input className="c-field" style={{ width: '100%' }} value={name} aria-label="Their name" onChange={(e) => setName(e.target.value)} />
      <p className="c-det" style={{ marginTop: 6 }}>
        However it should read on a charge.
      </p>
      <p className="c-label" style={{ margin: 'var(--s3) 0 6px' }}>
        What they are
      </p>
      <div className="c-rows">
        <Pick on={role === 'counter'} title="Counter" det="Raises charges. Cannot approve a refund." onPick={() => setRole('counter')} />
        {canAddManager && (
          <Pick
            on={role === 'manager'}
            title="Manager"
            det="Also approves refunds up to your limit, and adds counter staff."
            onPick={() => setRole('manager')}
          />
        )}
      </div>
    </Sheet>
  );
}

const CAN: Record<StaffRole, [string, string]> = {
  counter: ['c-neutral', 'Can charge'],
  manager: ['c-underway', 'Can approve'],
  owner: ['c-settled', 'Full access'],
};

function Kv({ k, v, onTap }: { k: string; v: ReactNode; onTap?: () => void }) {
  return (
    <div>
      <div className="c-kv" style={{ cursor: 'pointer' }} {...press(onTap)}>
        <span>{k}</span>
        <span className="c-v">
          {v}
          {onTap && <IconChevron />}
        </span>
      </div>
    </div>
  );
}

/**
 * A person: their role, PIN and hours, and the two things an owner or a manager does to them. Reset
 * and Remove show only when the viewer may do them (the server's rule: a manager for counter staff,
 * an owner for counter staff and managers; never an owner, never yourself).
 */
export function PersonSheet({
  m,
  onHours,
  onResetPin,
  onRemove,
  onEndShift,
  onClose,
}: {
  m: Mate;
  onHours?: () => void;
  onResetPin?: () => void;
  onRemove?: () => void;
  /** On shift, and not the one holding the tablet: an owner or manager can end it for them. */
  onEndShift?: () => void;
  onClose: () => void;
}) {
  const [tone, can] = CAN[m.role];
  const owner = m.role === 'owner';
  const pair = !owner && !!(onResetPin || onRemove);
  const end = onEndShift && (
    <button type="button" className="c-btn" style={{ width: '100%', marginBottom: pair ? 'var(--s1)' : 0 }} onClick={onEndShift}>
      End {first(m.name)}’s shift
    </button>
  );
  return (
    <Sheet
      title={m.name}
      onClose={onClose}
      foot={
        !pair ? (
          (end ?? undefined)
        ) : (
          <>
            {end}
            <div className="c-pair">
              {onResetPin && !m.added && (
                <button type="button" className="c-btn" onClick={onResetPin}>
                  Reset their PIN
                </button>
              )}
              {onRemove && (
                <button type="button" className="c-btn c-btn-danger" onClick={onRemove}>
                  Remove
                </button>
              )}
            </div>
          </>
        )
      }
    >
      <div className="c-line" style={{ alignItems: 'center', marginBottom: 'var(--s3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="c-avatarbtn" style={{ width: 40, height: 40, cursor: 'default' }}>
            {initials(m.name)}
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 'var(--t-body)', fontWeight: 500 }}>{m.name}</span>
            <span className="c-det" style={{ display: 'block', marginTop: 2 }}>
              {m.on ? `On shift since ${m.since}` : (m.added ?? 'Not on shift')}
            </span>
          </span>
        </span>
        <span className={cx('c-chip', tone)}>{can}</span>
      </div>
      <div className="c-rows">
        <Kv k="Role" v={roleLabel(m.role)} />
        <Kv k={owner ? 'Sign-in' : 'PIN'} v={owner ? 'Owner sign-in' : m.added ? 'On first shift' : 'Set'} onTap={owner || m.added ? undefined : onResetPin} />
        <Kv k="Hours" v={m.usual ?? 'No hours yet'} onTap={onHours} />
        <Kv k="Charges this month" v={m.chargesThisMonth ?? 0} />
        <Kv k="Last shift" v={m.lastShift ?? '—'} />
      </div>
    </Sheet>
  );
}

export function RemoveSheet({ m, onKeep, onRemove }: { m: Mate; onKeep: () => void; onRemove?: () => void }) {
  const f = first(m.name);
  return (
    <Sheet
      title={`Remove ${f}`}
      onClose={onKeep}
      foot={
        <>
          <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <p>
              The record keeps their name on every charge they raised. Removing someone from the tablet never rewrites
              what already happened.
            </p>
          </div>
          <div className="c-pair" style={{ marginTop: 'var(--s2)' }}>
            <button type="button" className="c-btn c-btn-primary" onClick={onKeep}>
              Keep them
            </button>
            <button type="button" className="c-btn c-btn-danger" disabled={!onRemove} onClick={onRemove}>
              Remove
            </button>
          </div>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-body)', fontWeight: 500 }}>Remove {f} from this tablet?</p>
      {m.on && (
        <p className="c-det" style={{ marginTop: 6 }}>
          {f} is on shift. Removing them ends it.
        </p>
      )}
      <div className="c-rows" style={{ marginTop: 'var(--s3)' }}>
        <div>
          <div className="c-kv">
            <span>Their PIN</span>
            <span className="c-v">Stops working now</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>Charges they raised</span>
            <span className="c-v">Keep their name</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>If they come back</span>
            <span className="c-v">Add them again, new PIN</span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function Days({ days, shut, onToggle }: { days: boolean[]; shut: boolean[]; onToggle: (i: number) => void }) {
  return (
    <div className="c-mc-days">
      {DAY_KEYS.map((d, i) => (
        <button
          key={d}
          type="button"
          className={cx('c-btn', days[i] && 'c-on', shut[i] && 'c-shut')}
          disabled={shut[i]}
          aria-pressed={days[i]}
          onClick={() => onToggle(i)}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

/** From and to. Given `onChange`, each is the device's own time picker. */
const Span = ({ from, to, onChange, label = '' }: { from: number; to: number; onChange?: (from: number, to: number) => void; label?: string }) =>
  onChange ? (
    <div className="c-mc-span">
      <input type="time" className="c-mc-time" aria-label={`${label}Starts`} value={toHHMM(from)} onChange={(e) => e.target.value && onChange(toHour(e.target.value), to)} />
      <span className="c-sep">–</span>
      <input type="time" className="c-mc-time" aria-label={`${label}Ends`} value={toHHMM(to)} onChange={(e) => e.target.value && onChange(from, toHour(e.target.value))} />
    </div>
  ) : (
    <div className="c-mc-span">
      <span className="c-mc-time">{time(from)}</span>
      <span className="c-sep">–</span>
      <span className="c-mc-time">{time(to)}</span>
    </div>
  );

const Callout = ({ children }: { children: ReactNode }) => (
  <div className="c-mc-callout" role="note">
    <IconInfo />
    <span>{children}</span>
  </div>
);

/**
 * Someone's hours: every week or this week only, which days, what hours, and any day with its
 * own. The totals above Save are what an owner checks first.
 */
export function HoursSheet({
  name,
  shut,
  daysNote,
  initial,
  initialOnce = false,
  initialDay,
  onSave,
  onClose,
  editable,
  startsThisWeek,
  backOn = 'Monday the 28th',
  busy,
  error,
}: {
  name: string;
  /** The shop's closed days, which cannot be picked. */
  shut: boolean[];
  /** Why some days can't be picked, or why they all can. */
  daysNote?: string;
  initial: Hours;
  initialOnce?: boolean;
  /** Open on the Different hours step for this day. */
  initialDay?: number;
  onSave?: (h: Hours, once: boolean) => void;
  onClose: () => void;
  /** A live shop: the times are pickers. */
  editable?: boolean;
  /** Someone with no usual hours yet: Every week starts now. */
  startsThisWeek?: boolean;
  /** When usual hours come back after "This week only": "Monday the 28th". */
  backOn?: string;
  busy?: boolean;
  error?: string | null;
}) {
  const [h, setH] = useState(initial);
  const [once, setOnce] = useState(initialOnce);
  const [own, setOwn] = useState<number | null>(initialDay ?? null);
  const f = first(name);

  if (own !== null) {
    return (
      <DayHours
        key={own}
        editable={editable}
        day={own}
        usual={[h.start, h.end]}
        hours={h.own[own] ?? [h.start, 12]}
        shut={shut}
        onPick={setOwn}
        onBack={() => setOwn(null)}
        onClose={onClose}
        onSet={(d, s) => {
          setH((x) => ({ ...x, days: x.days.map((on, i) => on || i === d), own: { ...x.own, [d]: s } }));
          setOwn(null);
        }}
      />
    );
  }

  const ownDays = Object.keys(h.own).map(Number);
  const rest = h.days.map((on, i) => on && !ownDays.includes(i));
  const n = h.days.filter(Boolean).length;
  const total = hoursTotal(h);
  const firstFree = h.days.findIndex((on, i) => !shut[i] && !ownDays.includes(i) && on);

  return (
    <Sheet
      className="c-mc-hsheet"
      title={`${f}’s hours`}
      onClose={onClose}
      foot={
        <>
          <div className="c-mc-totals">
            <div>
              <span className="c-ic">
                <IconCalendar />
              </span>
              <div style={{ minWidth: 0 }}>
                <p className="c-fig">
                  {n} {n === 1 ? 'day' : 'days'}
                </p>
                <p className="c-det">{daysLabel(h.days)}</p>
              </div>
            </div>
            <div>
              <span className="c-ic">
                <IconClock />
              </span>
              <div style={{ minWidth: 0 }}>
                <p className="c-fig">
                  {total} {total === 1 ? 'hour' : 'hours'}
                </p>
                <p className="c-det">{once ? 'one-off' : 'a week'}</p>
              </div>
            </div>
          </div>
          <Callout>{once ? `Their usual hours come back on ${backOn}.` : startsThisWeek ? 'Starts this week.' : 'Starts next week. This week stays as it is.'}</Callout>
          {error && (
            <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: 'var(--s2) 0 0' }}>
              {error}
            </p>
          )}
          <button
            type="button"
            className="c-btn c-btn-primary c-btn-lg"
            style={{ marginTop: 'var(--s2)' }}
            disabled={!onSave || busy}
            onClick={() => onSave?.(h, once)}
          >
            {busy ? 'Saving…' : once ? 'Save this week' : `Save ${f}’s hours`}
          </button>
        </>
      }
    >
      <div className="c-qc c-split" style={{ marginTop: 0 }}>
        <button type="button" className={cx('c-btn c-chip-q', !once && 'c-on')} onClick={() => setOnce(false)}>
          Every week
        </button>
        <button type="button" className={cx('c-btn c-chip-q', once && 'c-on')} onClick={() => setOnce(true)}>
          This week only
        </button>
      </div>
      <p className="c-label" style={{ margin: 'var(--s3) 0 var(--s1)' }}>
        Days
      </p>
      <Days days={h.days} shut={shut} onToggle={(i) => setH((x) => ({ ...x, days: x.days.map((on, k) => (k === i ? !on : on)) }))} />
      {daysNote && (
        <p className="c-det" style={{ margin: 'var(--s1) 0 0' }}>
          {daysNote}
        </p>
      )}
      {ownDays.length ? (
        <div className="c-mc-hourshead">
          <p className="c-label">Hours</p>
          <span className="c-det">{daysLabel(rest)}</span>
        </div>
      ) : (
        <p className="c-label" style={{ margin: 'var(--s3) 0 var(--s1)' }}>
          Hours
        </p>
      )}
      <Span from={h.start} to={h.end} onChange={editable ? (start, end) => setH((x) => ({ ...x, start, end })) : undefined} />
      {ownDays.length > 0 && (
        <div className="c-mc-own">
          {ownDays.map((d) => (
            <div key={d} style={{ cursor: 'pointer' }} onClick={() => setOwn(d)}>
              <button type="button" className="c-mc-open">
                {dayName(d)}
              </button>
              <span className="c-v">
                <span>
                  {time(h.own[d][0])} – {time(h.own[d][1])}
                </span>
                <span
                  className="c-rm"
                  role="button"
                  onKeyDown={clickOnKey}
                  tabIndex={0}
                  aria-label={`Remove ${dayName(d)}’s own hours`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setH((x) => {
                      const o = { ...x.own };
                      delete o[d];
                      return { ...x, own: o };
                    });
                  }}
                >
                  <IconX14 />
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      <span className="c-mc-addlink" {...press(() => setOwn(firstFree >= 0 ? firstFree : 0))}>
        <IconAdd14 />
        Different hours on another day
      </span>
    </Sheet>
  );
}

function DayHours({
  day,
  usual,
  hours: initialHours,
  shut,
  onPick,
  onBack,
  onClose,
  onSet,
  editable,
}: {
  editable?: boolean;
  day: number;
  usual: [number, number];
  hours: [number, number];
  shut: boolean[];
  onPick: (d: number) => void;
  onBack: () => void;
  onClose: () => void;
  onSet: (d: number, s: [number, number]) => void;
}) {
  const [hours, setHours] = useState(initialHours);
  return (
    <Sheet
      className="c-mc-hsheet"
      label="Different hours"
      onClose={onClose}
      head={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <span className="c-mc-back" {...press(onBack)}>
            <IconBackChevron />
            <span className="c-mtitle">Different hours</span>
          </span>
          <button type="button" className="c-mclose" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
      }
      foot={
        <>
          <Callout>
            Their other days stay {time(usual[0])} – {time(usual[1])}.
          </Callout>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" style={{ marginTop: 'var(--s2)' }} disabled={hours[1] <= hours[0]} onClick={() => onSet(day, hours)}>
            Set {dayName(day)}
          </button>
        </>
      }
    >
      <p className="c-label" style={{ margin: '0 0 var(--s1)' }}>
        Which day
      </p>
      <Days days={DAY_KEYS.map((_, i) => i === day)} shut={shut} onToggle={onPick} />
      <p className="c-label" style={{ margin: 'var(--s3) 0 var(--s1)' }}>
        Hours on {dayName(day)}
      </p>
      <Span from={hours[0]} to={hours[1]} label={`${dayName(day)} `} onChange={editable ? (a, b) => setHours([a, b]) : undefined} />
      <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
        Picking a day they do not work adds it.
      </p>
    </Sheet>
  );
}

const PRESETS = [0, 25000, 50000, 100000];

/** What a manager can approve: presets, or typed on the pad, up to the shop's cap. */
export function LimitSheet({
  limitCents,
  maxCents,
  onSave,
  onClose,
}: {
  limitCents: number;
  maxCents: number | null;
  onSave?: (cents: number) => Promise<void> | void;
  onClose: () => void;
}) {
  const [cents, setCents] = useState(limitCents);
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (typed !== null) setCents(Math.round(parseFloat(typed || '0') * 100));
  }, [typed]);
  const above = maxCents !== null && maxCents > 0 && cents > maxCents;

  return (
    <Sheet
      title="What a manager can approve"
      onClose={onClose}
      foot={
        <>
          <div className="c-footnote" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <p>
              {error ??
                (above
                  ? `The most you can set is ${usd(maxCents!)}.`
                  : 'Only you can change this, and only signed in. A PIN can never raise its own limit.')}
            </p>
          </div>
          <button
            type="button"
            className="c-btn c-btn-primary c-btn-lg"
            style={{ marginTop: 'var(--s2)' }}
            disabled={!onSave || above || busy}
            onClick={async () => {
              if (!onSave) return;
              setBusy(true);
              setError(null);
              try {
                await onSave(cents);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That did not save. Try again.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </button>
        </>
      }
    >
      <p className="c-det" style={{ marginBottom: 'var(--s2)' }}>
        A manager can approve refunds up to this. Above it, only you.
      </p>
      <div className="c-mc-presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={cx('c-btn', cents === p && 'c-chip-q c-on')}
            onClick={() => {
              setTyped(null);
              setCents(p);
            }}
          >
            {p === 0 ? 'Off' : usd(p).replace(/\.00$/, '')}
          </button>
        ))}
      </div>
      <div className="c-mc-amount" style={{ fontSize: 44, marginBottom: 'var(--s2)' }} aria-live="polite">
        {usd(cents)}
        <span className="c-caret" style={{ height: 36 }} />
      </div>
      <Keypad onKey={(k) => setTyped((t) => typeAmount(t ?? '', k))} />
      <div className="c-rows" style={{ marginTop: 'var(--s3)' }}>
        {cents > 0 && (
          <div>
            <div className="c-kv">
              <span>Under {usd(cents)}</span>
              <span className="c-v">A manager’s PIN</span>
            </div>
          </div>
        )}
        <div>
          <div className="c-kv">
            <span>{cents > 0 ? `${usd(cents)} and above` : 'Every refund'}</span>
            <span className="c-v">Your PIN, or your phone</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>Highest you can set</span>
            <span className="c-v">{maxCents ? usd(maxCents) : '—'}</span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
