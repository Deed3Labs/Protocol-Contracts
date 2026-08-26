import { useMemo } from 'react';
import InboxPage from './InboxPage';
import { useNotifications } from '@/context/ClearNotificationsContext';
import { INBOX } from '@/data/clearPlaceholder';
import { toAlerts } from '@/lib/notificationsAdapter';

/**
 * The live Inbox — the presentational page with the real notification feed
 * behind it.
 *
 * The wiring lives here rather than in InboxPage so the page stays mountable
 * without providers (the preview harness does exactly that). Messages are still
 * placeholder: the XMTP conversations in `context/XMTPContext` are the source to
 * map next, and `toThreads` is where that adapter goes.
 */
export default function InboxRoute() {
  const { notifications, markRead, markAllRead, dismiss } = useNotifications();
  const alerts = useMemo(() => toAlerts(notifications), [notifications]);

  return (
    <InboxPage
      data={{ ...INBOX, alerts }}
      onRead={markRead}
      onClear={dismiss}
      onMarkAllRead={markAllRead}
    />
  );
}
