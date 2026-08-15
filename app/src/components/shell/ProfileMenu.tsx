import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, User, Shield, Bell, CircleHelp, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import ThemePicker from '@/components/clear/ThemePicker';
import { useIsDesktop } from '@/lib/useIsDesktop';
import type { MemberProfile } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

const LINKS = [
  { label: 'Profile & membership', icon: User, to: '/settings' },
  { label: 'Security', icon: Shield, to: '/settings' },
  { label: 'Notifications', icon: Bell, to: '/settings' },
  { label: 'Help', icon: CircleHelp, to: '/settings' },
] as const;

/**
 * Everything about you that isn't a page — design spec §1.
 *
 * A dropdown off the avatar on desktop, a bottom sheet on mobile, because a
 * dropdown anchored to a 28px target in a phone's top-right corner is a menu you
 * open by accident and dismiss by accident.
 *
 * Theme sits at the top as a three-way control rather than a toggle: there are
 * three themes, and a toggle would hide one of them.
 */
export default function ProfileMenu({
  profile,
  accelerationActive,
  onAcceleration,
  onSignOut,
  children,
}: {
  profile: MemberProfile;
  accelerationActive?: boolean;
  onAcceleration?: () => void;
  onSignOut?: () => void;
  /** The trigger — the avatar in the header. */
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const body = (
    <>
      <button
        type="button"
        onClick={() => go('/settings')}
        className="mb-3.5 flex w-full items-center gap-3 border-b-[0.5px] border-border px-0.5 pb-3.5 text-left"
      >
        <span
          aria-hidden
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-tier-boost/10 text-sm text-tier-boost-fg"
        >
          {profile.initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{profile.name}</span>
          <span className="mt-[3px] block truncate text-xs text-muted-foreground">
            {profile.handle} · Member since {profile.memberSince}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      </button>

      <p className="mb-2 text-[11px] uppercase tracking-[0.2px] text-muted-foreground">
        Appearance
      </p>
      <ThemePicker className="mb-4" />

      <div className="mb-4 flex items-center justify-between gap-3 rounded-[11px] bg-secondary px-3 py-2.5">
        <div>
          <p className="text-[13px]">Acceleration</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {accelerationActive ? 'Active' : 'Not active'}
          </p>
        </div>
        <Button
          variant="clear"
          size="xs"
          onClick={() => {
            setOpen(false);
            onAcceleration?.();
          }}
        >
          Explore
        </Button>
      </div>

      <div className="text-[13px]">
        {LINKS.map((link) => (
          <button
            key={link.label}
            type="button"
            onClick={() => go(link.to)}
            className="flex h-[38px] w-full items-center gap-3 text-left transition-colors hover:text-foreground"
          >
            <link.icon
              aria-hidden
              className="h-4 w-4 shrink-0 text-foreground-secondary"
              strokeWidth={1.75}
            />
            {link.label}
          </button>
        ))}
      </div>

      <div className="mt-2.5 border-t-[0.5px] border-border pt-1.5">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onSignOut?.();
          }}
          className="flex h-[38px] w-full items-center gap-3 text-left text-[13px] text-foreground-secondary transition-colors hover:text-foreground"
        >
          <LogOut aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={10}
          className={cn(
            'w-[280px] rounded-2xl border-[0.5px] border-border bg-card p-3.5',
            'shadow-[0_8px_32px_rgb(0_0_0/0.12)]',
          )}
        >
          {body}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{children}</span>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="px-5 pb-8 pt-5">{body}</SheetContent>
      </Sheet>
    </>
  );
}
