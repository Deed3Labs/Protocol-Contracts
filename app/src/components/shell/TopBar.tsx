import { useLocation } from 'react-router-dom';
import { PanelLeft, Menu, Search, Plus, Bell, ChevronRight } from 'lucide-react';
import { useAddMoney } from '@/context/AddMoneyContext';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';

const TITLES: Record<string, string> = {
  '/': 'Accounts',
  '/pay': 'Pay',
  '/transactions': 'Transactions',
  '/settings': 'Settings',
};

/**
 * Sticky top bar inside the main column. Desktop: sidebar-collapse toggle +
 * breadcrumb + search + actions + profile. Mobile: hamburger (opens SideMenu) + logo.
 */
export default function TopBar({
  onToggleSidebar,
  onMenuOpen,
}: {
  onToggleSidebar: () => void;
  onMenuOpen: () => void;
}) {
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Accounts';
  const { open: openAddMoney } = useAddMoney();

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md">
      <div className="flex h-16 items-center gap-3 border-b border-border px-5 lg:px-8">
        {/* mobile: logo · divider · Menu pill — matches the old portfolio top nav */}
        <img src={ClearPathLogo} alt="Clear" className="h-9 w-9 shrink-0 rounded border border-border object-cover lg:hidden" />
        <div className="h-5 w-px shrink-0 bg-border lg:hidden" aria-hidden />
        <button
          type="button"
          onClick={onMenuOpen}
          aria-label="Open menu"
          className="flex items-center gap-2 rounded bg-secondary px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted lg:hidden"
        >
          <Menu className="h-4 w-4 shrink-0" /> Menu
        </button>

        {/* desktop: sidebar-collapse toggle */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:flex"
        >
          <PanelLeft className="h-[18px] w-[18px]" />
        </button>

        <div className="hidden items-center gap-1.5 text-sm text-muted-foreground lg:flex">
          <span>Home</span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{title}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="hidden items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary md:flex md:w-56 lg:w-64"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>

          <button
            type="button"
            onClick={openAddMoney}
            className="hidden items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-transform active:scale-[0.98] sm:flex"
          >
            <Plus className="h-4 w-4" /> Add money
          </button>

          <button
            type="button"
            aria-label="Notifications"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground transition-colors hover:bg-muted"
          >
            <Bell className="h-[18px] w-[18px]" />
          </button>

          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-sm font-medium text-secondary-foreground">
            SS
          </div>
        </div>
      </div>
    </header>
  );
}
