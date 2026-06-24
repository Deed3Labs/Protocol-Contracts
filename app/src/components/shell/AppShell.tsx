import { Outlet } from 'react-router-dom';
import TabBar from './TabBar';
import SideNav from './SideNav';

/**
 * Responsive app shell.
 * - Desktop (lg+): left SideNav + a wide, centered content area.
 * - Mobile: single column with the floating bottom TabBar.
 */
export default function AppShell() {
  return (
    <div className="min-h-[100dvh] bg-background lg:flex">
      <SideNav />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-[540px] px-5 pb-28 pt-[max(env(safe-area-inset-top),1.25rem)] lg:max-w-6xl lg:px-8 lg:pb-14 lg:pt-10">
          <Outlet />
        </main>
      </div>
      <TabBar />
    </div>
  );
}
