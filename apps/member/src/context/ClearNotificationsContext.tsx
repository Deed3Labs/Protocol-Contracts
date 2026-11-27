import { createContext, useContext, type ReactNode } from 'react';
import { useNotificationsState } from '@/hooks/useNotifications';

/*
 * One notification state for the whole app.
 *
 * `useNotificationsState` was called directly by three surfaces — the bell menu, the inbox page and
 * the shell's badge. A hook is not shared state: each got its own rows, its own optimistic
 * `readIds` ref, and its own WebSocket. Marking a row read in the bell updated the bell, while the
 * badge kept showing the old count until its own 20-second poll came round. That is why marking a
 * notification read appeared not to take, and why doing it twice "worked" — the second click
 * landed on whichever copy you were looking at.
 *
 * It was also most of the seven sockets one tab was opening against the server.
 *
 * So the hook is called exactly once, here, and everything else reads this context. Same public
 * API, so call sites did not change.
 */
type NotificationsValue = ReturnType<typeof useNotificationsState>;

const ClearNotificationsContext = createContext<NotificationsValue | null>(null);

export function ClearNotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotificationsState();
  return <ClearNotificationsContext.Provider value={value}>{children}</ClearNotificationsContext.Provider>;
}

/**
 * The app's notifications: rows, unread count, and the read/dismiss actions.
 *
 * Throws outside the provider rather than quietly handing back an empty second copy — a silent
 * fallback here would reproduce exactly the bug this context exists to fix.
 */
export function useNotifications(): NotificationsValue {
  const value = useContext(ClearNotificationsContext);
  if (!value) throw new Error('useNotifications must be used within a ClearNotificationsProvider');
  return value;
}
