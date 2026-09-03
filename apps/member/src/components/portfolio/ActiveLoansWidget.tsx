interface Loan {
  id: number;
  type: string;
  amount: number;
  rate: string;
  dueDate: string;
  status: string;
}

interface ActiveLoansWidgetProps {
  loans: Loan[];
}

export default function ActiveLoansWidget({ loans }: ActiveLoansWidgetProps) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <h2 className="text-base font-medium text-black dark:text-white">Active Loans</h2>
          <button className="text-xs text-blue-600 hover:text-blue-500">View All</button>
        </div>
        <div className="p-2">
          {loans.map((loan) => (
            <div key={loan.id} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-sm transition-colors cursor-pointer">
               <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium text-black dark:text-white">{loan.type}</span>
                  <span className="text-sm font-medium text-black dark:text-white">${loan.amount.toLocaleString()}</span>
               </div>
               <div className="flex justify-between text-xs text-zinc-500">
                  <span>Due {loan.dueDate}</span>
                  <span className="text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">{loan.status}</span>
               </div>
            </div>
          ))}
          {loans.length === 0 && (
            <div className="p-8 text-center text-zinc-500 text-sm">
              No active loans
            </div>
          )}
        </div>
    </div>
  );
}
