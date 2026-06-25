import SidebarNav from './SidebarNav';

/**
 * Mobile slide-in drawer (hamburger-triggered). Renders the exact same SidebarNav as
 * the desktop Sidebar so the two menus are identical; adds a close button and closes
 * on navigation.
 */
export default function SideMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex lg:hidden">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="animate-slide-in-left relative h-full w-[284px] border-r border-border bg-background shadow-2xl">
        <SidebarNav onNavigate={onClose} onClose={onClose} />
      </div>
    </div>
  );
}
