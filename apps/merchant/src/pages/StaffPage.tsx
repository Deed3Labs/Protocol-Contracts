import { useContext, useEffect, useMemo, useState } from 'react';
import type { PersonHours } from '@clear/merchant-contracts';
import { useSearchParams } from 'react-router-dom';
import { canAddRole, type StaffRole } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { ResetPinSheet } from '@/auth/screens';
import { OneColumn, Slab, useDigitKeys } from '@/brand/ui';
import { api } from '@/data/apiClient';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { ordinal } from '@/home/model';
import { useShiftActions } from '@/shell/shiftActions';
import {
  BUSY_SATURDAY,
  COUNTER_VIEW,
  FIRST_THING,
  JEN_FRIDAY_SHORT,
  JEN_HOURS,
  JEN_THIS_WEEK,
  OWNER_VIEW,
  addWeeks,
  mondayOf,
  crewFromApi,
  hoursFromApi,
  hoursToApi,
  teamFromApi,
  weekFromApi,
  type Hours,
  type Mate,
} from '@/staff/model';
import {
  AddSomeoneSheet,
  CrewPanel,
  HoursSheet,
  LimitCell,
  LimitSheet,
  PersonSheet,
  RemoveSheet,
  RoleSheet,
  RolesCell,
  TeamCell,
  WaitingToStart,
  WeekPanel,
} from '@/staff/views';

/**
 * Staff — docs/merchant-reference/clear-merchant-staff.html.
 *
 * Three blocks, as on Home: who is on the counter now, a slot while someone added has not started,
 * then the week and the slab (the team, what each role can do, the refund limit).
 *
 * **A live shop** sees who is on shift, the week and the team from the API. An owner or manager
 * opens a person to end their shift, set their hours, reset their PIN (the one resetting confirms
 * with their own) or remove them. Who may: a manager, counter staff (and their own hours); an owner,
 * counter staff and managers; never an owner, never yourself. In development, `?preview=1&screen=<frame>`:
 * owner (the default), counter, first, busy, add, person, remove, hours, hours-week, day-hours,
 * hours-friday, limit; `&live=1` for the live path.
 */

type Open =
  | { k: 'add' }
  | { k: 'person'; m: Mate }
  | { k: 'remove'; m: Mate }
  | { k: 'reset'; m: Mate }
  | { k: 'role'; m: Mate }
  | { k: 'hours'; m: Mate; h: Hours; once?: boolean; day?: number; live?: PersonHours; weekOf?: string; weekLabel?: string }
  | { k: 'limit' }
  | null;

export default function StaffPage() {
  const [params] = useSearchParams();
  const { session } = useAuth();
  const one = useContext(OneColumn);
  const shift = useShiftActions();

  // `&live=1` keeps the preview's session but takes the live path, as New Charge does.
  const preview = import.meta.env.DEV && params.get('preview') === '1' && params.get('live') !== '1';
  const screen = preview ? (params.get('screen') ?? 'owner') : '';
  const role: StaffRole = screen === 'counter' ? 'counter' : (session?.staff.role ?? 'counter');
  const owner = role === 'owner';
  const manage = role === 'owner' || role === 'manager';

  const staff = useApi(() => (preview ? Promise.resolve(null) : api.staff()), [preview]);
  const limit = useApi(() => (preview || !owner ? Promise.resolve(null) : api.refundThreshold()), [preview, owner]);

  // A live shop: who is on now and the week, ticking so the tiles and "now" keep up.
  const merchant = useMerchantApi();
  const live = !preview && !!session;
  const shiftsNow = useApi(() => (live ? merchant.shifts() : Promise.resolve(null)), [live]);
  // The week shown: this one until the arrows move it (a Monday, YYYY-MM-DD).
  const [weekOf, setWeekOf] = useState<string | null>(null);
  // How far the arrows go: back to the week the shop joined; forward up to 12 weeks, while there's a
  // schedule to show (anyone's usual hours carry on; a one-off shows in its week).
  const profile = useApi(() => (live ? api.profile() : Promise.resolve(null)), [live]);
  const [thisMonday, setThisMonday] = useState<string | null>(null);
  const weekNow = useApi(() => (live ? merchant.staffWeek(weekOf ?? undefined) : Promise.resolve(null)), [live, weekOf]);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const liveWeek = useMemo(() => (weekNow.data && shiftsNow.data ? weekFromApi(weekNow.data, shiftsNow.data, new Date(tick)) : null), [weekNow.data, shiftsNow.data, tick]);
  // This week's Monday, from the first week shown (this one), for how far forward the arrows go.
  useEffect(() => {
    if (!thisMonday && liveWeek?.title === 'This week' && liveWeek.weekOf) setThisMonday(liveWeek.weekOf);
  }, [liveWeek, thisMonday]);

  const scene = preview ? (screen === 'counter' ? COUNTER_VIEW : OWNER_VIEW) : null;
  const liveCrew = shiftsNow.data && session ? crewFromApi(shiftsNow.data, session.staff.id, tick) : undefined;
  const crew = screen === 'first' ? FIRST_THING : screen === 'busy' ? BUSY_SATURDAY : (scene?.crew ?? liveCrew);
  const team = useMemo(
    () =>
      scene?.team ??
      (staff.data && session ? teamFromApi(staff.data, session.staff.id, shiftsNow.data ? { shifts: shiftsNow.data, week: weekNow.data, now: tick } : undefined) : []),
    [scene, staff.data, session, shiftsNow.data, weekNow.data, tick],
  );
  const limitCents = scene ? scene.limitCents : (limit.data?.limitCents ?? null);
  const maxCents = scene ? scene.maxCents : (limit.data?.maxCents ?? null);

  const jen = OWNER_VIEW.team[0];
  const initial = ((): Open => {
    switch (screen) {
      case 'add':
        return { k: 'add' };
      case 'person':
        return { k: 'person', m: jen };
      case 'remove':
        return { k: 'remove', m: jen };
      case 'hours':
        return { k: 'hours', m: jen, h: JEN_HOURS };
      case 'hours-week':
        return { k: 'hours', m: jen, h: JEN_THIS_WEEK, once: true };
      case 'day-hours':
        return { k: 'hours', m: jen, h: JEN_HOURS, day: 4 };
      case 'hours-friday':
        return { k: 'hours', m: jen, h: JEN_FRIDAY_SHORT };
      case 'limit':
        return { k: 'limit' };
      default:
        return null;
    }
  })();
  const [open, setOpen] = useState<Open>(initial);
  const close = () => setOpen(null);
  // The days the shop is closed can't be booked: dotted, and not selectable. The sheet says why.
  const shut = (scene?.week ?? liveWeek ?? OWNER_VIEW.week).days.map((d) => !d.open);
  const noHours = shut.every(Boolean);
  const hoursOf = (m: Mate): Hours => (m.id === 'jen' ? JEN_HOURS : { days: shut.map(() => false), start: 8, end: 16, own: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Someone's hours: the preview's, or, live, loaded before the sheet opens. */
  /**
   * Someone's hours, for the week the schedule is showing. From the day view, a person booked that
   * day opens on that day's times.
   */
  const openHours = (m: Mate, day?: number) => {
    if (!live) return setOpen({ k: 'hours', m, h: hoursOf(m) });
    setError(null);
    const weekOf = liveWeek?.weekOf;
    const title = liveWeek?.title ?? 'This week';
    const weekLabel = title === 'This week' ? undefined : title === 'Next week' ? 'next week' : `the week of ${liveWeek!.label.split(' – ')[0]}`;
    const bookedThatDay = day !== undefined && !!liveWeek?.booked[m.id]?.[day];
    merchant.staffHours(m.id, weekOf).then(
      (ph) => setOpen({ k: 'hours', m, h: hoursFromApi(ph.thisWeek ?? ph.next ?? ph.usual), once: !!ph.thisWeek, live: ph, weekOf, weekLabel, day: bookedThatDay ? day : undefined }),
      (e) => setError(errorSentence(e)),
    );
  };
  // An owner ends anyone's shift; a manager a counter shift's. Nobody ends the holder's from here.
  const mayEnd = (m: Mate) => live && m.on && !m.holds && (owner || (role === 'manager' && m.role === 'counter'));
  const endFor = (m: Mate) => {
    setError(null);
    merchant.endShift(m.id).then(
      () => (close(), shiftsNow.reload()),
      (e) => setError(errorSentence(e)),
    );
  };

  const waiting = manage ? team.find((m) => m.added && !m.on) : undefined;
  const onTap = (m: Mate) => setOpen({ k: 'person', m });
  /** The server's rule (routes/merchant.ts, staffTarget): who this viewer may reset or remove. */
  // A role: an owner changes anyone's but an owner's and their own; so can a manager, with the owner's approval.
  const mayChangeRole = (m: Mate) => live && manage && m.role !== 'owner' && m.id !== session?.staff.id;
  const ownerName = staff.data?.find((s) => s.role === 'owner')?.name ?? 'The owner';
  const mayChange = (m: Mate) => preview || (m.role !== 'owner' && m.id !== session?.staff.id && (owner || (role === 'manager' && m.role === 'counter')));

  // Resetting someone's PIN: the one resetting confirms with their own.
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const resetting = open?.k === 'reset' ? open.m : null;
  useDigitKeys(!!resetting && !busy, (d) => (setPinError(null), setPin((p) => (p.length >= 4 ? p : p + d))), () => setPin((p) => p.slice(0, -1)));

  const teamCell = <TeamCell team={team} manage={manage} onTap={onTap} onAdd={() => setOpen({ k: 'add' })} />;
  const roles = <RolesCell />;
  const limitCell = <LimitCell role={role} limitCents={limitCents} onChange={() => setOpen({ k: 'limit' })} />;

  return (
    <>
      {crew && (
        <CrewPanel
          crew={crew}
          manage={manage}
          onTap={(m) => setOpen({ k: 'person', m: team.find((t) => t.id === m.id) ?? m })}
          onStart={shift.changeShift}
          onChangeShift={shift.changeShift}
          onEndShift={shift.endShift}
        />
      )}
      {waiting && preview && <WaitingToStart m={waiting} />}
      {(scene || liveWeek) && (
        <WeekPanel
          key={liveWeek?.weekOf ?? 'preview'}
          week={scene?.week ?? liveWeek!}
          team={team}
          manage={manage}
          onSet={openHours}
          // From the week asked for, not the one on screen, so two quick presses move two weeks.
          canBack={!liveWeek ? undefined : !!liveWeek.weekOf && (!profile.data?.partnerSince || !/^\d{4}-\d{2}-\d{2}/.test(profile.data.partnerSince) || liveWeek.weekOf > mondayOf(profile.data.partnerSince.slice(0, 10)))}
          canForward={
            !liveWeek
              ? undefined
              : !!liveWeek.weekOf &&
            (!thisMonday || liveWeek.weekOf < addWeeks(thisMonday, 12)) &&
            (Object.values(weekNow.data?.usual ?? {}).some(Boolean) || Object.keys(weekNow.data?.booked ?? {}).length > 0)
          }
          onWeek={liveWeek?.weekOf ? (by) => setWeekOf((w) => addWeeks(w ?? liveWeek.weekOf!, by)) : undefined}
        />
      )}
      {error && !open && (
        <p className="c-det" role="alert" style={{ color: 'var(--absent)', margin: 'var(--s2) 0' }}>
          {error}
        </p>
      )}
      {one ? (
        <Slab>
          {teamCell}
          {roles}
          {limitCell}
        </Slab>
      ) : (
        <Slab>
          {teamCell}
          <div className="c-col">
            {roles}
            {limitCell}
          </div>
        </Slab>
      )}

      {open?.k === 'add' && (
        <AddSomeoneSheet
          canAddManager={owner && canAddRole(role, 'manager')}
          initialName={screen === 'add' ? 'Ana Ruiz' : ''}
          onAdd={
            preview
              ? () => undefined
              : async ({ name, role: r }) => {
                  // The PIN is set on the first shift, by the person themselves.
                  await api.addStaff({ name, role: r, secret: '' });
                  staff.reload();
                }
          }
          onClose={close}
        />
      )}
      {open?.k === 'person' && (
        <PersonSheet
          m={open.m}
          onHours={() => openHours(open.m)}
          onRole={mayChangeRole(open.m) ? () => setOpen({ k: 'role', m: open.m }) : undefined}
          onEndShift={mayEnd(open.m) ? () => endFor(open.m) : undefined}
          onResetPin={mayChange(open.m) ? () => (setPin(''), setPinError(null), setOpen({ k: 'reset', m: open.m })) : undefined}
          onRemove={mayChange(open.m) ? () => setOpen({ k: 'remove', m: open.m }) : undefined}
          onClose={close}
        />
      )}
      {open?.k === 'role' && (open.m.role === 'counter' || open.m.role === 'manager') && (
        <RoleSheet
          name={open.m.name}
          role={open.m.role}
          approver={owner ? (session?.staff.name ?? 'You') : ownerName}
          ownerApproves={!owner}
          onSave={async (next, pin) => {
            await api.changeRole(open.m.id, next, pin);
            staff.reload();
            close();
          }}
          onClose={close}
        />
      )}
      {open?.k === 'remove' && (
        <RemoveSheet
          m={open.m}
          onKeep={close}
          onRemove={
            preview
              ? close
              : async () => {
                  await api.removeStaff(open.m.id);
                  staff.reload();
                  close();
                }
          }
        />
      )}
      {resetting && (
        <ResetPinSheet
          name={resetting.name}
          approver={session?.staff.name ?? ''}
          approverRole={role}
          filled={pin.length}
          error={pinError}
          busy={busy}
          onDigit={(d) => (setPinError(null), setPin((p) => (p.length >= 4 ? p : p + d)))}
          onDelete={() => setPin((p) => p.slice(0, -1))}
          onCancel={close}
          onReset={async () => {
            if (preview) return close();
            setBusy(true);
            try {
              await api.resetPin(resetting.id, pin);
              staff.reload();
              close();
            } catch (e) {
              setPin('');
              setPinError(e instanceof Error ? e.message : 'That did not match.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {open?.k === 'hours' && (
        <HoursSheet
          name={open.m.name}
          shut={shut}
          daysNote={preview ? undefined : noHours ? 'No shop hours yet. Set them in Settings › Shop.' : shut.some(Boolean) ? 'Dotted days, the shop is closed. See Settings › Shop.' : undefined}
          initial={open.h}
          initialOnce={open.once}
          initialDay={open.day}
          editable={!!open.live}
          startsThisWeek={open.live ? !open.live.usual : undefined}
          weekLabel={open.weekLabel}
          backOn={open.live ? `Monday the ${ordinal(Number((open.weekLabel && open.weekOf ? addWeeks(open.weekOf, 1) : open.live.nextWeekOf).slice(8)))}` : undefined}
          busy={busy}
          error={open.live ? error : null}
          onSave={
            preview
              ? close
              : open.live
                ? (h, once) => {
                    setBusy(true);
                    setError(null);
                    merchant
                      .saveStaffHours(open.m.id, { hours: hoursToApi(h), once, ...(open.weekOf ? { weekOf: open.weekOf } : {}) })
                      .then(
                        () => (close(), weekNow.reload()),
                        (e) => setError(errorSentence(e)),
                      )
                      .finally(() => setBusy(false));
                  }
                : undefined
          }
          onClose={close}
        />
      )}
      {open?.k === 'limit' && owner && (
        <LimitSheet
          limitCents={limitCents ?? 0}
          maxCents={maxCents}
          onSave={
            preview
              ? () => undefined
              : async (cents) => {
                  await api.setRefundThreshold(cents);
                  limit.reload();
                }
          }
          onClose={close}
        />
      )}
    </>
  );
}
