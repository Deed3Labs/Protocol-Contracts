import { motion } from 'framer-motion';

interface UtilizationWidgetProps {
  utilization: number;
  usedPower: number;
  totalLimit: number;
}

export default function UtilizationWidget({ utilization, usedPower, totalLimit }: UtilizationWidgetProps) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-6">
       <div className="flex justify-between text-sm mb-2">
          <span className="text-zinc-500">Utilization</span>
          <span className="text-black dark:text-white font-medium">{utilization.toFixed(1)}%</span>
       </div>
       <div className="h-3 w-full bg-zinc-200 dark:bg-zinc-800 rounded overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${utilization}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="h-full bg-blue-600 rounded"
          />
       </div>
       <div className="flex justify-between text-xs text-zinc-500 mt-2">
          <span>${usedPower.toLocaleString()} used</span>
          <span>${totalLimit.toLocaleString()} total limit</span>
       </div>
    </div>
  );
}
