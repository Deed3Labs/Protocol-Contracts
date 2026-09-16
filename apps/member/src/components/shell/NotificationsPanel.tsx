import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CFoot, CHead, CMain, Line, Rows } from '@/components/clear/brand/anatomy';
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

/** Each action is 78px, and a row reveals as many as it has. */
const ACTION_WIDTH = 78;

/**
 * A row that slides to show what can be done to it.
 *
 * The content moves with the swipe and the actions follow it in at full row height — the row carries
 * its own padding, so it slides its own ground and nothing shows through at the edges. Which actions
 * it has depends on the row: where it leads, if it leads anywhere; Read while it is unread; and
 * Clear, which is not destructive.
 *
 * A pointer gets the same set on hover, which is the CSS in clear-components; this handles the drag.
 */
function SwipeRow({
  notification,
  onRead,
  onClear,
  onAction,
}: {
  notification: HeaderNotification;
  onRead?: () => void;
  onClear?: () => void;
  onAction?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  const actions = [
    notification.action && { key: 'go', label: notification.action.label, onClick: onAction, kind: 'read' as const },
    notification.unread && { key: 'read', label: 'Read', onClick: onRead, kind: 'read' as const },
    { key: 'clear', label: 'Clear', onClick: onClear, kind: 'clear' as const },
  ].filter(Boolean) as { key: string; label: string; onClick?: () => void; kind: 'read' | 'clear' }[];

  const reveal = actions.length * ACTION_WIDTH;
  // How far open the row is right now: its resting state, moved by the finger.
  const shown = Math.min(reveal, Math.max(0, (open ? reveal : 0) - drag));
  const dragging = drag !== 0;

  return (
    <div className={cn('c-swiped', open && 'c-open')} style={{ ['--reveal' as string]: `${reveal}px` }}>
      <div
        className="c-sbody"
        style={dragging ? { transform: `translateX(${-shown}px)`, transition: 'none' } : undefined}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          start.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (start.current === null) return;
          setDrag(e.clientX - start.current);
        }}
        onPointerUp={() => {
          if (start.current === null) return;
          // A third of the way is far enough to mean it; less springs back.
          if (drag < -reveal / 3) setOpen(true);
          else if (drag > reveal / 3) setOpen(false);
          start.current = null;
          setDrag(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(0);
        }}
      >
        <Line className="items-start!">
          <div className="min-w-0">
            <p className={cn('text-sec', notification.unread && 'font-semibold')}>{notification.title}</p>
            <p className="c-det mt-[3px]">{notification.detail}</p>
          </div>
          <span className="c-det flex shrink-0 items-center gap-[7px]">
            {notification.time}
            {notification.unread && (
              <span
                aria-label="Unread"
                className="block h-[7px] w-[7px] rounded-full bg-live shadow-[0_0_6px_1px_color-mix(in_srgb,var(--live)_55%,transparent)]"
              />
            )}
          </span>
        </Line>
      </div>
      <div
        className="c-sacts"
        style={dragging ? { transform: `translateX(${reveal - shown}px)`, transition: 'none' } : undefined}
      >
        {actions.map((action) => (
          <button key={action.key} type="button" className={cn('c-sact', `c-${action.kind}`)} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
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
                notification={n}
                onRead={() => onRead?.(n.id)}
                onClear={() => onClear?.(n.id)}
                onAction={() => {
                  if (!n.action) return;
                  onRead?.(n.id);
                  onNavigate?.();
                  navigate(n.action.to);
                }}
              />
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
