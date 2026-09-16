import { useRef, useState } from 'react';
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
}

/** How far the body slides: the two actions, 78px each. */
const REVEAL = 156;

/**
 * A row that slides to show what can be done to it.
 *
 * It slides rather than shrinks: the body keeps its full width so nothing reflows into a narrow
 * column, and the actions sit over its right end at full row height. A pointer gets the same two on
 * hover, which is the CSS in clear-components; this handles the drag.
 */
function SwipeRow({
  notification,
  onRead,
  onClear,
}: {
  notification: HeaderNotification;
  onRead?: () => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  const offset = open ? -REVEAL + Math.max(0, drag) : Math.max(-REVEAL, Math.min(0, drag));

  return (
    <div className={cn('c-swiped', open && 'c-open')}>
      <div
        className="c-sbody"
        style={drag !== 0 ? { transform: `translateX(${offset}px)`, transition: 'none' } : undefined}
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
          if (drag < -REVEAL / 3) setOpen(true);
          else if (drag > REVEAL / 3) setOpen(false);
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
      <div className="c-sacts">
        {notification.unread && (
          <button type="button" className="c-sact c-read" onClick={onRead}>
            Read
          </button>
        )}
        <button type="button" className="c-sact c-clear" onClick={onClear}>
          Clear
        </button>
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
}: {
  notifications: HeaderNotification[];
  onMarkAllRead?: () => void;
  onClearAll?: () => void;
  onRead?: (id: string) => void;
  onClear?: (id: string) => void;
  onOpenInbox: () => void;
}) {
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
      <CMain>
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
