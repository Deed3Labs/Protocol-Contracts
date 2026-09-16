import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ProfileMenu from './ProfileMenu';
import MemberAvatar from '@/components/clear/MemberAvatar';
import Surface from '@/components/clear/brand/Surface';
import NotificationsPanel, { type HeaderNotification } from './NotificationsPanel';
import { BellIcon } from '@/components/clear/brand/icons';
import { useIsDesktop } from '@/lib/useIsDesktop';
import type { MemberProfile } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

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
  onClearAll,
  onRead,
  onClear,
  accelerationActive,
  onAcceleration,
  onSignOut,
}: {
  profile: MemberProfile;
  unread?: number;
  notifications?: HeaderNotification[];
  onMarkAllRead?: () => void;
  onClearAll?: () => void;
  onRead?: (id: string) => void;
  onClear?: (id: string) => void;
  accelerationActive?: boolean;
  onAcceleration?: () => void;
  onSignOut?: () => void;
}) {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);

  // The Inbox's footer points here, and this is how it asks: the panel lives in the header, so the
  // page cannot open it directly.
  useEffect(() => {
    const open = () => setNotifOpen(true);
    window.addEventListener('clear:open-notifications', open);
    return () => window.removeEventListener('clear:open-notifications', open);
  }, []);

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
          onClearAll={onClearAll}
          onRead={onRead}
          onClear={onClear}
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
          /*
           * On a phone the square the guide draws is the picture, not the target: the button around it
           * is 44px, pulled in by 6px on every side so it takes a 32px square's room and the bell stays
           * the guide's 8px away. The extra bleeds into that gap and the header's padding, where there
           * is nothing else to press. A pointer needs none of it.
           */
          <button
            type="button"
            aria-label="Account"
            onClick={open}
            className={cn(
              isDesktop ? 'c-avatarbtn' : 'flex h-11 w-11 shrink-0 items-center justify-center -m-[6px]',
            )}
          >
            {isDesktop ? (
              <MemberAvatar profile={profile} className="h-full w-full bg-transparent text-inherit" />
            ) : (
              <span className="c-avatarbtn">
                <MemberAvatar profile={profile} className="h-full w-full bg-transparent text-inherit" />
              </span>
            )}
          </button>
        )}
      />
    </div>
  );
}

export type { HeaderNotification };
