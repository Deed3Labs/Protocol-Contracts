import { createContext, useContext, useState, type ReactNode } from 'react';
import AddMoneyModal from '@/components/app-ui/AddMoneyModal';
import WithdrawModal from '@/components/app-ui/WithdrawModal';
import SendModal from '@/components/app-ui/SendModal';
import RequestModal from '@/components/app-ui/RequestModal';
import TransferModal from '@/components/app-ui/TransferModal';

interface MoneyActionsValue {
  openAddMoney: () => void;
  openWithdraw: () => void;
  openSend: () => void;
  openRequest: () => void;
  openTransfer: () => void;
}
const Ctx = createContext<MoneyActionsValue | null>(null);

/** Open the Add-money / Withdraw / Send / Request / Transfer flows from anywhere in the shell. */
export function useMoneyActions(): MoneyActionsValue {
  return (
    useContext(Ctx) ?? {
      openAddMoney: () => {},
      openWithdraw: () => {},
      openSend: () => {},
      openRequest: () => {},
      openTransfer: () => {},
    }
  );
}

export function MoneyActionsProvider({ children }: { children: ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  return (
    <Ctx.Provider
      value={{
        openAddMoney: () => setAddOpen(true),
        openWithdraw: () => setWithdrawOpen(true),
        openSend: () => setSendOpen(true),
        openRequest: () => setRequestOpen(true),
        openTransfer: () => setTransferOpen(true),
      }}
    >
      {children}
      <AddMoneyModal open={addOpen} onOpenChange={setAddOpen} />
      <WithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} />
      <SendModal open={sendOpen} onOpenChange={setSendOpen} />
      <RequestModal open={requestOpen} onOpenChange={setRequestOpen} />
      <TransferModal open={transferOpen} onOpenChange={setTransferOpen} />
    </Ctx.Provider>
  );
}
