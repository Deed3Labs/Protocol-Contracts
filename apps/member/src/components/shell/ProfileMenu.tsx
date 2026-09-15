import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemePicker from '@/components/clear/ThemePicker';
import { THEME_PINNED } from '@/context/ThemeContext';
import MemberAvatar from '@/components/clear/MemberAvatar';
import Surface from '@/components/clear/brand/Surface';
import { Btn, CFoot, CHead, CMain, Line } from '@/components/clear/brand/anatomy';
import {
  BellIcon,
  ChevronIcon,
  HelpIcon,
  ShieldIcon,
  SignOutIcon,
  UserIcon,
} from '@/components/clear/brand/icons';
import type { MemberProfile } from '@/lib/clearModel';

const LINKS = [
  { label: 'Profile and membership', icon: UserIcon, to: '/settings' },
  { label: 'Security', icon: ShieldIcon, to: '/settings' },
  { label: 'Notifications', icon: BellIcon, to: '/settings' },
  { label: 'Help', icon: HelpIcon, to: '/settings' },
] as const;

/**
 * Everything about you that isn't a page — the guide's `.sheet.menu`.
 *
 * A dropdown off the avatar on desktop and a bottom sheet on mobile; the same component either way.
 * Header is who you are and the way into Settings; main holds appearance, acceleration and the links;
 * the footer is Sign out, on its own, muted.
 */
export default function ProfileMenu({
  profile,
  accelerationActive,
  onAcceleration,
  onSignOut,
  trigger,
}: {
  profile: MemberProfile;
  accelerationActive?: boolean;
  onAcceleration?: () => void;
  onSignOut?: () => void;
  /** The avatar button. Receives the opener — see Surface. */
  trigger: (open: () => void) => ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <Surface open={open} onOpenChange={setOpen} width={280} label="Account" trigger={trigger}>
      <CHead>
        <button type="button" onClick={() => go('/settings')} className="c-line w-full items-center! text-left">
          <span className="flex min-w-0 items-center gap-3">
            <span className="c-avatarbtn h-10! w-10! text-sec!">
              <MemberAvatar profile={profile} className="h-full w-full bg-transparent text-inherit" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sec font-semibold">{profile.name}</span>
              <span className="c-det mt-[3px] block truncate">
                {profile.handle} &middot; Member since {profile.memberSince}
              </span>
            </span>
          </span>
          <ChevronIcon size={14} strokeWidth={2} className="shrink-0 text-ink-50" />
        </button>
      </CHead>

      <CMain>
        {/* Pinned to light for the conversion; the picker returns with the dark-mode pass. While it's
            hidden, acceleration is the first thing in main, so it doesn't draw the rule that
            separates it from the picker. */}
        {!THEME_PINNED && (
          <>
            <p className="c-label">Appearance</p>
            <ThemePicker className="mt-s2" />
          </>
        )}
        <Line className={THEME_PINNED ? 'items-center!' : 'mt-s2 items-center! border-t border-ink-13 pt-s2'}>
          <div>
            <p className="text-sec">Acceleration</p>
            <p className="c-det mt-[3px]">{accelerationActive ? 'Active' : 'Not active'}</p>
          </div>
          <Btn
            className="h-[30px]! px-3! text-detail!"
            onClick={() => {
              setOpen(false);
              onAcceleration?.();
            }}
          >
            Explore
          </Btn>
        </Line>
        <div className="mt-s2 border-t border-ink-13 pt-s1">
          {LINKS.map((link) => (
            <button key={link.label} type="button" className="c-menurow" onClick={() => go(link.to)}>
              <span className="c-ic">
                <link.icon />
              </span>
              {link.label}
            </button>
          ))}
        </div>
      </CMain>

      <CFoot>
        <button
          type="button"
          className="c-menurow c-muted"
          onClick={() => {
            setOpen(false);
            onSignOut?.();
          }}
        >
          <span className="c-ic">
            <SignOutIcon />
          </span>
          Sign out
        </button>
      </CFoot>
    </Surface>
  );
}
