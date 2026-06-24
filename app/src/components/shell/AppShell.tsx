import { Outlet } from 'react-router-dom';
import TabBar from './TabBar';

/**
 * Redesigned app shell: a centered mobile-width column (iOS app feel) with the
 * bottom tab bar. Page content renders into the Outlet; pages own their headers.
 */
export default function AppShell() {
  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col bg-background md:border-x md:border-border">
      <main className="flex-1 px-5 pb-28 pt-[max(env(safe-area-inset-top),1.25rem)]">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
