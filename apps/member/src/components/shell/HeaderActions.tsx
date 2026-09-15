import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ProfileMenu from './ProfileMenu';
import MemberAvatar from '@/components/clear/MemberAvatar';
import Surface from '@/components/clear/brand/Surface';
import { CFoot, CHead, CMain, Line, Rows } from '@/components/clear/brand/anatomy';
import { BellIcon, ChevronIcon } from '@/components/clear/brand/icons';
import { useIsDesktop } from '@/lib/useIsDesktop';
import type { MemberProfile } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** One row in the notifications panel, already formatted. */
export interface HeaderNotification {
  id: string;
  title: string;
  detail: string;
  /** "9:41 AM", "Yesterday", "2 days ago". */
  time: string;
  unread: boolean;
}

/**
 * Notifications — the guide's `.sheet.notif`.
 *
 * Unread rows are set in 600 and carry the unread dot; read rows drop both. Messages are not here:
 * the footer says where they live and is the way through to them.
 */
function NotificationsPanel({
  notifications,
  onMarkAllRead,
  onOpenInbox,
}: {
  notifications: HeaderNotification[];
  onMarkAllRead?: () => void;
  onOpenInbox: () => void;
}) {
  return (
    <>
      <CHead>
        <Line className="items-center!">
          <span className="c-mtitle">Notifications</span>
          {notifications.some((n) => n.unread) && (
            <button type="button" className="c-det" onClick={onMarkAllRead}>
              Mark all read
            </button>
          )}
        </Line>
      </CHead>
      <CMain>
        {notifications.length === 0 ? (
          <p className="c-det">Nothing new.</p>
        ) : (
          <Rows>
            {notifications.map((n) => (
              <div key={n.id}>
                <Line className="items-start!">
                  <div className="min-w-0">
                    <p className={cn('text-sec', n.unread && 'font-semibold')}>{n.title}</p>
                    <p className="c-det mt-[3px]">{n.detail}</p>
                  </div>
                  <span className="c-det flex shrink-0 items-center gap-[7px]">
                    {n.time}
                    {n.unread && (
                      <span
                        aria-label="Unread"
                        className="block h-[7px] w-[7px] rounded-full bg-live shadow-[0_0_6px_1px_color-mix(in_srgb,var(--live)_55%,transparent)]"
                      />
                    )}
                  </span>
                </Line>
              </div>
            ))}
          </Rows>
        )}
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">Messages live in the Inbox</span>
          <button type="button" className="c-det flex items-center gap-1" onClick={onOpenInbox}>
            Open Inbox
            <ChevronIcon />
          </button>
        </Line>
      </CFoot>
    </>
  );
}

/**
 * The bell and the avatar — the corner of every page, desktop and mobile.
 *
 * Both open a surface rather than navigating: the bell a notifications panel whose footer leads to
 * the Inbox, the avatar the profile menu. The unread mark is the guide's dot with its glow and no
 * ping, because mail waiting is a state, not an event — and no count, for the same reason.
 */
export default function HeaderActions({
  profile,
  unread = 0,
  notifications = [],
  onMarkAllRead,
  accelerationActive,
  onAcceleration,
  onSignOut,
}: {
  profile: MemberProfile;
  unread?: number;
  notifications?: HeaderNotification[];
  onMarkAllRead?: () => void;
  accelerationActive?: boolean;
  onAcceleration?: () => void;
  onSignOut?: () => void;
}) {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <div className="c-tbicons">
      <Surface
        open={notifOpen}
        onOpenChange={setNotifOpen}
        width={340}
        label="Notifications"
        trigger={(open) => (
          <button
            type="button"
            className="c-iconbtn"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            onClick={open}
          >
            <BellIcon />
            {unread > 0 && <span className="c-unread" />}
          </button>
        )}
      >
        <NotificationsPanel
          notifications={notifications}
          onMarkAllRead={onMarkAllRead}
          onOpenInbox={() => {
            setNotifOpen(false);
            navigate('/inbox');
          }}
        />
      </Surface>

      <ProfileMenu
        profile={profile}
        accelerationActive={accelerationActive}
        onAcceleration={onAcceleration}
        onSignOut={onSignOut}
        trigger={(open) => (
          <button
            type="button"
            aria-label="Account"
            onClick={open}
            className={cn('c-avatarbtn', !isDesktop && 'c-sm')}
          >
            <MemberAvatar profile={profile} className="h-full w-full bg-transparent text-inherit" />
          </button>
        )}
      />
    </div>
  );
}
