import { PieChart, Activity, Wallet, Plus, Coins } from 'lucide-react';

interface MobileNavProps {
  onMenuOpen: () => void;
  onActionOpen: () => void;
}

export default function MobileNav({ onActionOpen }: MobileNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-[#0e0e0e]/90 backdrop-blur-xl border-t border-zinc-200 dark:border-zinc-800 pb-6 pt-2 z-50 md:hidden transition-all duration-300">
      <div className="flex justify-around items-end px-4">
        <button className="flex flex-col items-center gap-1 group w-14 pb-1">
          <div className="p-1 rounded-xl group-active:scale-95 transition-transform duration-200">
            <PieChart className="h-6 w-6 text-black dark:text-white transition-colors duration-300" strokeWidth={2} />
          </div>
          <span className="text-[10px] font-medium tracking-wide text-black dark:text-white transition-colors duration-300">Portfolio</span>
        </button>
        
        <button className="flex flex-col items-center gap-1 group w-14 pb-1">
          <div className="p-1 rounded-xl group-active:scale-95 transition-transform duration-200">
            <Activity className="h-6 w-6 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors duration-300" strokeWidth={2} />
          </div>
          <span className="text-[10px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors duration-300">Markets</span>
        </button>
        
        <div className="relative -top-7">
          <button 
            onClick={onActionOpen}
            className="flex items-center justify-center w-16 h-16 bg-black dark:bg-white rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.2)] dark:shadow-[0_4px_20px_rgba(255,255,255,0.2)] text-white dark:text-black hover:scale-105 active:scale-95 transition-all duration-300 border-4 border-white dark:border-[#0e0e0e]"
          >
            <Plus className="h-8 w-8" strokeWidth={2.5} />
          </button>
        </div>
        
        <button className="flex flex-col items-center gap-1 group w-14 pb-1">
          <div className="p-1 rounded-xl group-active:scale-95 transition-transform duration-200">
            <Wallet className="h-6 w-6 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors duration-300" strokeWidth={2} />
          </div>
          <span className="text-[10px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors duration-300">Borrow</span>
        </button>
        
        <button className="flex flex-col items-center gap-1 group w-14 pb-1">
          <div className="p-1 rounded-xl group-active:scale-95 transition-transform duration-200">
            <Coins className="h-6 w-6 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors duration-300" strokeWidth={2} />
          </div>
          <span className="text-[10px] font-medium tracking-wide text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors duration-300">Earn</span>
        </button>
      </div>
    </nav>
  );
}

