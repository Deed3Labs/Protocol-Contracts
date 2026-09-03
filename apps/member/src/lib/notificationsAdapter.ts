import type { ApiNotification } from '@/utils/apiClient';
import type { Alert } from './clearModel';

/**
 * The backend's notification kinds, mapped to the app's own colour language.
 *
 * Anything about credit takes the boost colour, because that's what the credit
 * bar and the "you're using credit" state already use; anything that added to
 * savings takes the asset green. Everything else is neutral — a colour per kind
 * would turn the list into a paint chart and stop meaning anything.
 */
const TONE: Record<string, Alert['tone']> = {
  credit: 'boost',
  due: 'boost',
  request: 'boost',
  milestone: 'asset',
  received: 'asset',
};

/** "8:14 AM" today, "Nov 6" before that — the same shortening the list header uses. */
function when(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Today / This week / Earlier — the grouping the Inbox renders under. */
function groupFor(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  if (date.toDateString() === now.toDateString()) return 'Today';
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  return days <= 7 ? 'This week' : 'Earlier';
}

/**
 * Where a notification takes you when it carries an action. Only kinds with a
 * single obvious destination get one — an action button that lands somewhere
 * unrelated is worse than no button.
 */
const DESTINATION: Record<string, { label: string; to: string }> = {
  due: { label: 'View cycle', to: '/' },
  request: { label: 'Open Send', to: '/send' },
  received: { label: 'View activity', to: '/activity' },
  milestone: { label: 'View savings', to: '/savings' },
  kyc: { label: 'Finish verification', to: '/settings' },
};

/** Backend notifications → the Inbox's alert rows. */
export function toAlerts(notifications: ApiNotification[], now = new Date()): Alert[] {
  return notifications.map((n) => ({
    id: n.id,
    title: n.title,
    detail: n.body,
    time: when(n.createdAt, now),
    group: groupFor(n.createdAt, now),
    tone: TONE[n.kind] ?? 'muted',
    read: n.read,
    action: DESTINATION[n.kind],
  }));
}
