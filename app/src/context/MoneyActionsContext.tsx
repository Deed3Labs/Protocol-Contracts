import { createContext, useContext, useState, type ReactNode } from 'react';
import AddMoneyModal from '@/components/app-ui/AddMoneyModal';
import WithdrawModal from '@/components/app-ui/WithdrawModal';

interface MoneyActionsValue {
  openAddMoney: () => void;
  openWithdraw: () => void;
}
const Ctx = createContext<MoneyActionsValue | null>(null);

/** Open the Add-money / Withdraw flows from anywhere in the shell (top bar, tab bar, quick actions). */
export function useMoneyActions(): MoneyActionsValue {
  return useContext(Ctx) ?? { openAddMoney: () => {}, openWithdraw: () => {} };
}

export function MoneyActionsProvider({ children }: { children: ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  return (
    <Ctx.Provider value={{ openAddMoney: () => setAddOpen(true), openWithdraw: () => setWithdrawOpen(true) }}>
      {children}
      <AddMoneyModal open={addOpen} onOpenChange={setAddOpen} />
      <WithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} />
    </Ctx.Provider>
  );
}
