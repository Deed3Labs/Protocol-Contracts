import { useState, type ComponentType, type SVGProps } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Wallet, LifeBuoy, LogOut, type LucideIcon } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useTheme } from '@/context/ThemeContext';
import { useLinkedWallets } from '@/context/LinkedWalletsContext';
import { useLogout } from '@/hooks/useLogout';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { SunIcon, DuskIcon, MoonIcon } from '@/components/app-ui/ThemeIcons';
import { cn } from '@/lib/utils';

const THEMES: { id: 'light' | 'dusk' | 'dark'; icon: ComponentType<SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: 'light', icon: SunIcon, label: 'Light' },
  { id: 'dusk', icon: DuskIcon, label: 'Dusk' },
  { id: 'dark', icon: MoonIcon, label: 'Dark' },
];

function Item({ icon: Icon, label, onClick, danger }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-secondary',
        danger ? 'text-negative' : 'text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4', !danger && 'text-muted-foreground')} /> {label}
    </button>
  );
}

/** Top-bar account popover: identity, quick links, appearance, sign out. */
export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { openManager } = useLinkedWallets();
  const logout = useLogout();
  const { name, handle, initials, avatarUrl } = useMemberProfile();
  const go = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-secondary text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted"
        >
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 p-2">
        <div className="flex items-center gap-3 px-2 py-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary text-sm font-medium text-secondary-foreground">
            {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{handle}</div>
          </div>
        </div>

        <div className="my-1 h-px bg-border" />
        <Item icon={Settings} label="Settings" onClick={go(() => navigate('/settings'))} />
        <Item icon={Wallet} label="Linked wallets" onClick={go(openManager)} />
        <Item icon={LifeBuoy} label="Help & support" onClick={go(() => {})} />

        <div className="my-1 h-px bg-border" />
        <div className="px-2 py-1.5">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Appearance</div>
          <div className="flex rounded-lg border border-border bg-secondary p-0.5">
            {THEMES.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-label={label}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-xs font-medium transition-all',
                  theme === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="my-1 h-px bg-border" />
        <Item icon={LogOut} label="Sign out" onClick={go(logout)} danger />
      </PopoverContent>
    </Popover>
  );
}
