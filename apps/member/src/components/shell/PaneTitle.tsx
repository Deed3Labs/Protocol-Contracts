import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/*
 * A page that titles its own header.
 *
 * The chrome names a page from its address, which is right for every page whose name is fixed. A
 * thread's is not: /inbox/maria is "Maria C." to the member and nothing to the router. The page sets
 * it, the header reads it, and it clears when the page leaves.
 */
const Ctx = createContext<{ title?: string; setTitle: (title?: string) => void }>({ setTitle: () => {} });

export function PaneTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | undefined>(undefined);
  return <Ctx.Provider value={{ title, setTitle }}>{children}</Ctx.Provider>;
}

/** What the header should call this page, or undefined to let the address name it. */
export function usePaneTitle(): string | undefined {
  return useContext(Ctx).title;
}

export function useSetPaneTitle(title?: string) {
  const { setTitle } = useContext(Ctx);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(undefined);
  }, [setTitle, title]);
}
