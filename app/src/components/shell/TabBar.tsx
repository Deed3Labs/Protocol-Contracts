import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMoneyActions } from '@/context/MoneyActionsContext';
import { cn } from '@/lib/utils';
import { navItems, type NavItem } from './navItems';

// Reserve the widest label so the active tab — and therefore the whole pill — keeps a
// constant width as you switch pages, rather than resizing per active label.
const widestLabel = navItems.reduce((w, i) => (i.label.length > w.length ? i.label : w), '');

function Tab({ to, label, icon: Icon, end }: NavItem) {
  return (
    <NavLink to={to} end={end} aria-label={label}>
      {({ isActive }) => (
        <span
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2.5 transition-colors duration-300',
            isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
          {isActive && (
            <span className="grid text-[13px] font-medium">
              <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
                {widestLabel}
              </span>
              <span className="col-start-1 row-start-1 whitespace-nowrap text-center">{label}</span>
            </span>
          )}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Floating mobile footer (lg:hidden): the nav pill on the left, and a + button on the right that
 * pops up the money-movement actions (Add / Send / Request / Transfer) above it. Bottom offset is
 * in `.mobile-tabbar` (index.css), which lifts the bar in installed/PWA standalone mode.
 */
export default function TabBar() {
  const { openAddMoney, openSend, openRequest, openTransfer } = useMoneyActions();
  const [menuOpen, setMenuOpen] = useState(false);

  const actions: { label: string; onClick: () => void }[] = [
    { label: 'Add money', onClick: openAddMoney },
    { label: 'Send', onClick: openSend },
    { label: 'Request', onClick: openRequest },
    { label: 'Transfer', onClick: openTransfer },
  ];
  const run = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <>
      <AnimatePresence>
        {menuOpen && (
          <motion.button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-background/40 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      <div className="mobile-tabbar fixed inset-x-0 z-50 flex items-center justify-between px-4 lg:hidden">
        {/* Main nav — left */}
        <nav className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 p-1.5 shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-xl">
          {navItems.map((item) => (
            <Tab key={item.to} {...item} />
          ))}
        </nav>

        {/* + action menu — right */}
        <div className="relative flex flex-col items-end">
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                className="absolute bottom-full right-0 mb-3 flex flex-col items-end gap-2"
                initial="closed"
                animate="open"
                exit="closed"
                variants={{
                  open: { transition: { staggerChildren: 0.045 } },
                  closed: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
                }}
              >
                {actions.map((a) => (
                  <motion.button
                    key={a.label}
                    type="button"
                    onClick={run(a.onClick)}
                    variants={{ open: { opacity: 1, y: 0, scale: 1 }, closed: { opacity: 0, y: 14, scale: 0.9 } }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="whitespace-nowrap rounded-full border border-border/70 bg-background/90 px-6 py-2.5 text-sm font-medium text-foreground shadow-[0_8px_30px_rgb(0_0_0/0.18)] backdrop-blur-xl"
                  >
                    {a.label}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            aria-label={menuOpen ? 'Close money actions' : 'Money actions'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="relative z-50 flex items-center justify-center rounded-full bg-primary p-4 text-primary-foreground shadow-[0_8px_30px_rgb(0_0_0/0.18)] transition-transform active:scale-95"
          >
            <motion.span animate={{ rotate: menuOpen ? 45 : 0 }} transition={{ duration: 0.2 }}>
              <Plus className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            </motion.span>
          </button>
        </div>
      </div>
    </>
  );
}
