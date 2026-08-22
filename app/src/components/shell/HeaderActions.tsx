import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import ProfileMenu from './ProfileMenu';
import MemberAvatar from '@/components/clear/MemberAvatar';
import type { MemberProfile } from '@/lib/clearModel';

/**
 * The two things in the top-right of every page — design spec §1.
 *
 * The bell is a link to the Inbox, not a dropdown: a tray that empties itself is
 * how people miss the rebalance date. The count is capped at 9+ because past
 * that the number stops being information and starts being pressure.
 */
export default function HeaderActions({
  profile,
  unread = 0,
  accelerationActive,
  onAcceleration,
  onSignOut,
}: {
  profile: MemberProfile;
  unread?: number;
  accelerationActive?: boolean;
  onAcceleration?: () => void;
  onSignOut?: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Link
        to="/inbox"
        aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
        className="relative p-1 text-foreground-secondary transition-colors hover:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute right-0 top-0 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-tier-boost px-1 text-[9px] font-medium leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>

      <ProfileMenu
        profile={profile}
        accelerationActive={accelerationActive}
        onAcceleration={onAcceleration}
        onSignOut={onSignOut}
      >
        <button type="button" aria-label="Profile and settings" className="flex">
          <MemberAvatar profile={profile} className="h-7 w-7 rounded-full text-[10px] font-medium" />
        </button>
      </ProfileMenu>
    </div>
  );
}
