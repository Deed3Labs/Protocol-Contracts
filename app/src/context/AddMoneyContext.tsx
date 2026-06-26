import { createContext, useContext, useState, type ReactNode } from 'react';
import AddMoneyModal from '@/components/app-ui/AddMoneyModal';

interface AddMoneyValue {
  open: () => void;
}
const AddMoneyCtx = createContext<AddMoneyValue | null>(null);

/** Open the Add-money modal from anywhere inside the shell (top bar, tab bar, quick actions). */
export function useAddMoney(): AddMoneyValue {
  return useContext(AddMoneyCtx) ?? { open: () => {} };
}

export function AddMoneyProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <AddMoneyCtx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <AddMoneyModal open={open} onOpenChange={setOpen} />
    </AddMoneyCtx.Provider>
  );
}
