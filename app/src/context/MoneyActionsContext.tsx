import { createContext, useContext, useState, type ReactNode } from 'react';
import AddMoneyModal from '@/components/app-ui/AddMoneyModal';
import WithdrawModal from '@/components/app-ui/WithdrawModal';
import SendModal from '@/components/app-ui/SendModal';

interface MoneyActionsValue {
  openAddMoney: () => void;
  openWithdraw: () => void;
  openSend: () => void;
}
const Ctx = createContext<MoneyActionsValue | null>(null);

/** Open the Add-money / Withdraw / Send flows from anywhere in the shell (top bar, tab bar, quick actions). */
export function useMoneyActions(): MoneyActionsValue {
  return useContext(Ctx) ?? { openAddMoney: () => {}, openWithdraw: () => {}, openSend: () => {} };
}

export function MoneyActionsProvider({ children }: { children: ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  return (
    <Ctx.Provider
      value={{ openAddMoney: () => setAddOpen(true), openWithdraw: () => setWithdrawOpen(true), openSend: () => setSendOpen(true) }}
    >
      {children}
      <AddMoneyModal open={addOpen} onOpenChange={setAddOpen} />
      <WithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} />
      <SendModal open={sendOpen} onOpenChange={setSendOpen} />
    </Ctx.Provider>
  );
}
