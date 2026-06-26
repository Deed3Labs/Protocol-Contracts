import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import MessagesModal from '@/components/app-ui/MessagesModal';

interface MessagesCtx {
  /** Open the messages modal. Pass a conversation id to jump straight into that thread. */
  openMessages: (conversationId?: string) => void;
}

const Ctx = createContext<MessagesCtx>({ openMessages: () => {} });
export const useMessages = () => useContext(Ctx);

export function MessagesProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialId, setInitialId] = useState<string | undefined>(undefined);

  const openMessages = useCallback((conversationId?: string) => {
    setInitialId(conversationId);
    setOpen(true);
  }, []);

  return (
    <Ctx.Provider value={{ openMessages }}>
      {children}
      <MessagesModal open={open} onOpenChange={setOpen} initialId={initialId} />
    </Ctx.Provider>
  );
}
