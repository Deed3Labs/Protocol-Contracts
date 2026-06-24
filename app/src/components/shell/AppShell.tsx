import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import SideMenu from './SideMenu';
import TabBar from './TabBar';

/**
 * App shell (modeled on the old portfolio layout, which scrolled correctly):
 * normal document/window scroll under a fixed TopNav, a hamburger SideMenu overlay,
 * and the floating TabBar on mobile. No sticky/flex sidebar in the scroll flow.
 */
export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <TopNav onMenuOpen={() => setMenuOpen(true)} />
      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="mx-auto w-full max-w-7xl px-5 pb-28 pt-20 lg:px-8 lg:pb-16 lg:pt-24">
        <Outlet />
      </main>

      <TabBar />
    </div>
  );
}
