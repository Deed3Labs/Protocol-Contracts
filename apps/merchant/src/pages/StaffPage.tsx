import { useContext, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { canAddRole, type StaffRole } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { OneColumn, Slab } from '@/brand/ui';
import { api } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { useShiftActions } from '@/shell/shiftActions';
import {
  BUSY_SATURDAY,
  COUNTER_VIEW,
  FIRST_THING,
  JEN_FRIDAY_SHORT,
  JEN_HOURS,
  JEN_THIS_WEEK,
  OWNER_VIEW,
  teamFromApi,
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
 * **A live shop sees the team, the roles and the limit.** The API has the roster, each person's
 * charges this month and the refund limit, and it adds people. Shifts, hours, removing someone and
 * resetting a PIN have no backend yet (card-processing prompt, Phase 7), so the crew strip, the
 * week and the person sheet are the preview's. In development, `?preview=1&screen=<frame>`:
 * owner (the default), counter, first, busy, add, person, remove, hours, hours-week, day-hours,
 * hours-friday, limit; `&live=1` for the live path.
 */

type Open =
  | { k: 'add' }
  | { k: 'person'; m: Mate }
  | { k: 'remove'; m: Mate }
  | { k: 'hours'; m: Mate; h: Hours; once?: boolean; day?: number }
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

  const scene = preview ? (screen === 'counter' ? COUNTER_VIEW : OWNER_VIEW) : null;
  const crew = screen === 'first' ? FIRST_THING : screen === 'busy' ? BUSY_SATURDAY : scene?.crew;
  const team = useMemo(
    () => scene?.team ?? (staff.data && session ? teamFromApi(staff.data, session.staff.id) : []),
    [scene, staff.data, session],
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
  const shut = (scene ?? OWNER_VIEW).week.days.map((d) => !d.open);
  const hoursOf = (m: Mate): Hours => (m.id === 'jen' ? JEN_HOURS : { days: shut.map(() => false), start: 8, end: 16, own: {} });

  const waiting = manage ? team.find((m) => m.added && !m.on) : undefined;
  // Nothing about a person can be changed through the API yet, so a live team's rows do not open.
  const onTap = preview ? (m: Mate) => setOpen({ k: 'person', m }) : undefined;

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
      {scene && (
        <WeekPanel week={scene.week} team={team} manage={manage} onSet={(m) => setOpen({ k: 'hours', m, h: hoursOf(m) })} />
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
          onHours={() => setOpen({ k: 'hours', m: open.m, h: hoursOf(open.m) })}
          onResetPin={() => undefined}
          onRemove={() => setOpen({ k: 'remove', m: open.m })}
          onClose={close}
        />
      )}
      {open?.k === 'remove' && <RemoveSheet m={open.m} onKeep={close} onRemove={preview ? close : undefined} />}
      {open?.k === 'hours' && (
        <HoursSheet
          name={open.m.name}
          shut={shut}
          initial={open.h}
          initialOnce={open.once}
          initialDay={open.day}
          onSave={preview ? close : undefined}
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
