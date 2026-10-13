import { createContext, useContext, useState, type ReactNode } from 'react';
import AddMoneyModal from '@/components/app-ui/AddMoneyModal';
import WithdrawModal from '@/components/app-ui/WithdrawModal';
import SendModal from '@/components/app-ui/SendModal';
import RequestModal from '@/components/app-ui/RequestModal';
import TransferModal from '@/components/app-ui/TransferModal';
import ConnectedAutoSave from '@/components/clear/ConnectedAutoSave';
import { useSavingsData } from '@/hooks/useSavingsData';

interface MoneyActionsValue {
  openAddMoney: () => void;
  openWithdraw: () => void;
  openSend: () => void;
  openRequest: () => void;
  openTransfer: () => void;
  openAutoSave: () => void;
}
const Ctx = createContext<MoneyActionsValue | null>(null);

/**
 * Auto-save from anywhere: the same dialog Savings opens, over the same figures. Mounted only once
 * somebody asks for it, so the reads behind it are not made on every page of the app.
 */
function AutoSaveAnywhere({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <ConnectedAutoSave data={useSavingsData()} open={open} onOpenChange={onOpenChange} />;
}

/** Open the Add-money / Withdraw / Send / Request / Transfer flows from anywhere in the shell. */
export function useMoneyActions(): MoneyActionsValue {
  return (
    useContext(Ctx) ?? {
      openAddMoney: () => {},
      openWithdraw: () => {},
      openSend: () => {},
      openRequest: () => {},
      openTransfer: () => {},
      openAutoSave: () => {},
    }
  );
}

export function MoneyActionsProvider({ children }: { children: ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [autoSaveOpen, setAutoSaveOpen] = useState(false);
  // Stays mounted after the first open, so closing animates like every other sheet.
  const [autoSaveMounted, setAutoSaveMounted] = useState(false);
  return (
    <Ctx.Provider
      value={{
        // KYC is gated inside each modal at the specific fiat/TradFi rail (bank/ACH via Bridge),
        // not at open — provider off-ramps/on-ramps (instant debit, card) KYC their own users and
        // on-chain moves need none. AddMoney, Withdraw and Transfer each gate their bank path.
        openAddMoney: () => setAddOpen(true),
        openWithdraw: () => setWithdrawOpen(true),
        openSend: () => setSendOpen(true),
        openRequest: () => setRequestOpen(true),
        openTransfer: () => setTransferOpen(true),
        openAutoSave: () => {
          setAutoSaveMounted(true);
          setAutoSaveOpen(true);
        },
      }}
    >
      {children}
      <AddMoneyModal open={addOpen} onOpenChange={setAddOpen} />
      <WithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} />
      <SendModal open={sendOpen} onOpenChange={setSendOpen} />
      <RequestModal open={requestOpen} onOpenChange={setRequestOpen} />
      <TransferModal open={transferOpen} onOpenChange={setTransferOpen} />
      {autoSaveMounted && <AutoSaveAnywhere open={autoSaveOpen} onOpenChange={setAutoSaveOpen} />}
    </Ctx.Provider>
  );
}
