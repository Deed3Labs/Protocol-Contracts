import { cn } from '@/lib/utils';
import SidebarNav from './SidebarNav';

/**
 * Persistent desktop sidebar (lg+), collapsible between a labeled panel (w-64) and an
 * icon-only rail (w-[76px]). Fixed-position so the main content scrolls independently.
 * Hidden on mobile, where the SideMenu drawer renders the same SidebarNav.
 */
export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 hidden border-r border-border bg-background transition-[width] duration-200 lg:block',
        collapsed ? 'w-[76px]' : 'w-64',
      )}
    >
      <SidebarNav collapsed={collapsed} />
    </aside>
  );
}
