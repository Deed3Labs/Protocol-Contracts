import { motion } from 'framer-motion';
import { RefreshCw, Calendar } from 'lucide-react';

export default function CreditCycleWidget() {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-5 dark:opacity-10 pointer-events-none">
           <RefreshCw className="w-24 h-24 text-black dark:text-white rotate-12" />
        </div>
        
        <div className="relative z-10">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-base font-medium text-black dark:text-white">Credit Cycle</h3>
                <span className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] px-2 py-1 rounded text-black dark:text-white font-medium uppercase tracking-wide">
                  Active
                </span>
            </div>

            <div className="flex items-center gap-6">
                <div className="relative w-20 h-20 shrink-0">
                   {/* SVG Ring */}
                   <svg className="w-full h-full -rotate-90">
                      <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-zinc-200 dark:text-zinc-800" />
                      <motion.circle 
                        initial={{ strokeDashoffset: 226 }}
                        animate={{ strokeDashoffset: 226 - (226 * 0.4) }} // 40% progress (12/30)
                        transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
                        cx="40" cy="40" r="36" 
                        stroke="currentColor" 
                        strokeWidth="6" 
                        fill="transparent" 
                        strokeDasharray="226" 
                        strokeLinecap="round" 
                        className="text-black dark:text-white" 
                      />
                   </svg>
                   <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-light text-black dark:text-white">12</span>
                      <span className="text-[9px] text-zinc-500 font-medium uppercase">Days</span>
                   </div>
                </div>

                <div className="flex-1 space-y-4">
                   <div>
                      <div className="flex justify-between text-xs mb-1.5">
                         <span className="text-zinc-500">Remaining</span>
                         <span className="text-black dark:text-white font-medium">18 Days</span>
                      </div>
                      <div className="h-1.5 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                         <motion.div 
                           initial={{ width: 0 }}
                           animate={{ width: "60%" }}
                           transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
                           className="h-full bg-black dark:bg-white rounded-full"
                         />
                      </div>
                   </div>
                   
                   <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Resets <span className="text-black dark:text-white font-medium">Dec 1</span></span>
                   </div>
                </div>
            </div>
        </div>
    </div>
  );
}
