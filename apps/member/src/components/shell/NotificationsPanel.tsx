import { useNavigate } from 'react-router-dom';
import { CFoot, CHead, CMain, Line, Rows } from '@/components/clear/brand/anatomy';
import SwipeRow from '@/components/clear/brand/SwipeRow';
import { ChevronIcon } from '@/components/clear/brand/icons';
import { cn } from '@/lib/utils';

/** One row in the notifications panel, already formatted. */
export interface HeaderNotification {
  id: string;
  title: string;
  detail: string;
  /** "9:41 AM", "Yesterday", "2 days ago". */
  time: string;
  unread: boolean;
  /** Where this one leads, when it leads somewhere: a vote to the ballot, a shortfall to the cycle. */
  action?: { label: string; to: string };
}

/**
 * Notifications — the guide's `.sheet.notif`.
 *
 * Unread rows are set in 600 and carry the unread dot; read rows drop both. Mark all read and Clear
 * all sit in the header, separated by a hairline so they do not run together as one string — a
 * control bar for two text actions would be a whole rail for nothing.
 *
 * Clearing is not destructive: it empties this panel, and the closing line says where everything
 * that moved money still lives. Messages are not here either; the footer is the way to them.
 */
export default function NotificationsPanel({
  notifications,
  onMarkAllRead,
  onClearAll,
  onRead,
  onClear,
  onOpenInbox,
  onNavigate,
}: {
  notifications: HeaderNotification[];
  onMarkAllRead?: () => void;
  onClearAll?: () => void;
  onRead?: (id: string) => void;
  onClear?: (id: string) => void;
  onOpenInbox: () => void;
  /** Closes the panel on the way to wherever a row leads. */
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const anyUnread = notifications.some((n) => n.unread);

  return (
    <>
      <CHead>
        <Line className="items-center!">
          <span className="c-mtitle">Notifications</span>
          {notifications.length > 0 && (
            <span className="c-headacts c-det">
              {anyUnread && (
                <button type="button" onClick={onMarkAllRead}>
                  Mark all read
                </button>
              )}
              <button type="button" onClick={onClearAll}>
                Clear all
              </button>
            </span>
          )}
        </Line>
      </CHead>
      <CMain className={notifications.length > 0 ? 'c-flush' : undefined}>
        {notifications.length === 0 ? (
          <div className="py-s4 text-center">
            <p className="c-fig c-fig-sec">Nothing new</p>
            <p className="c-det mt-s1">
              Cleared notifications are gone from here. Everything that moved money is still in Activity.
            </p>
          </div>
        ) : (
          <Rows>
            {notifications.map((n) => (
              <SwipeRow
                key={n.id}
                actions={[
                  // Where it leads, if it leads anywhere; Read while it is unread; then Clear.
                  ...(n.action
                    ? [
                        {
                          key: 'go',
                          label: n.action.label,
                          onSelect: () => {
                            onRead?.(n.id);
                            onNavigate?.();
                            navigate(n.action!.to);
                          },
                        },
                      ]
                    : []),
                  ...(n.unread ? [{ key: 'read', label: 'Read', onSelect: () => onRead?.(n.id) }] : []),
                  { key: 'clear', label: 'Clear', tone: 'ink' as const, onSelect: () => onClear?.(n.id) },
                ]}
              >
                <Line className="items-start!">
                  <div className="min-w-0">
                    <p className={cn('text-sec', n.unread && 'font-semibold')}>{n.title}</p>
                    <p className="c-det mt-[3px]">{n.detail}</p>
                  </div>
                  <span className="c-det flex shrink-0 items-center gap-[7px]">
                    {n.time}
                    {n.unread && (
                      <span
                        aria-label="Unread"
                        className="block h-[7px] w-[7px] rounded-full bg-live shadow-[0_0_6px_1px_color-mix(in_srgb,var(--live)_55%,transparent)]"
                      />
                    )}
                  </span>
                </Line>
              </SwipeRow>
            ))}
          </Rows>
        )}
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">Messages live in the Inbox</span>
          <button type="button" className="c-det flex items-center gap-1" onClick={onOpenInbox}>
            Open Inbox
            <ChevronIcon />
          </button>
        </Line>
      </CFoot>
    </>
  );
}
