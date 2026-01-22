export default function MarketRatesWidget() {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-1">
        <div className="p-4">
          <h2 className="text-base font-medium text-black dark:text-white mb-4">Current Rates</h2>
          <div className="space-y-3">
             <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-500">Base Rate</span>
                <span className="text-black dark:text-white">4.50%</span>
             </div>
             <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-500">Spread</span>
                <span className="text-black dark:text-white">+1.50%</span>
             </div>
             <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-2" />
             <div className="flex justify-between items-center text-sm font-medium">
                <span className="text-black dark:text-white">Your Effective Rate</span>
                <span className="text-blue-600">6.00%</span>
             </div>
          </div>
        </div>
    </div>
  );
}
