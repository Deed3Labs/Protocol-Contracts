import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { Bell, ArrowDownLeft, Receipt, Sparkles, CreditCard, Trash2, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Notif {
  id: string;
  icon: LucideIcon;
  tint: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}
const NOTIFS0: Notif[] = [
  { id: '1', icon: ArrowDownLeft, tint: 'bg-positive/10 text-positive', title: 'Money received', body: '+$349.00 from Macellyn Annya', time: '2h', unread: true },
  { id: '2', icon: Sparkles, tint: 'bg-info/10 text-info', title: '1:1 match applied', body: '+$520 added to your Clear Deed', time: '5h', unread: true },
  { id: '3', icon: Receipt, tint: 'bg-negative/10 text-negative', title: 'Rent due soon', body: '$1,850 due in 3 days', time: '1d', unread: false },
  { id: '4', icon: CreditCard, tint: 'bg-secondary text-foreground', title: 'Card payment posted', body: '$320.00 · Card', time: '2d', unread: false },
];

interface Thread {
  id: string;
  avatar: string;
  name: string;
  preview: string;
  time: string;
  unread: boolean;
}
const THREADS0: Thread[] = [
  { id: 't1', avatar: 'AS', name: 'Ahmad Sulaiman', preview: 'Thanks, got the transfer 🙏', time: '1h', unread: true },
  { id: 't2', avatar: 'CS', name: 'Clear Support', preview: 'Your dispute was resolved — $134 refunded.', time: '3h', unread: true },
  { id: 't3', avatar: 'MA', name: 'Maple Apartments', preview: 'June rent receipt attached.', time: '1d', unread: false },
];

/** Swipe-left-to-delete row (Apple-style): a red delete bg is revealed as the row drags left. */
function SwipeRow({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  return (
    <motion.div layout exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }} className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-end bg-negative pr-5">
        <Trash2 className="h-4 w-4 text-white" />
      </div>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.9, right: 0.04 }}
        onDragEnd={(_e, info: PanInfo) => {
          if (info.offset.x < -72) onDelete();
        }}
        className="relative cursor-grab touch-pan-y bg-popover active:cursor-grabbing"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/**
 * Top-bar bell popover: tabbed Notifications + Messages (XMTP), swipe-to-delete rows.
 *
 * Opening a thread / "Open inbox" calls `onOpenConversation(conversationId?)`, wired in
 * TopBar to the redesign-native MessagesModal (useMessages().openMessages). That modal is
 * mock-backed for now and ready to swap onto the existing XMTP logic (useXMTP). SEAM: to
 * use the legacy modal instead, pass `useGlobalModals().openXmtpModal` here.
 */
export default function NotificationsMenu({ onOpenConversation }: { onOpenConversation?: (conversationId?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'notifications' | 'messages'>('notifications');
  const [notifs, setNotifs] = useState(NOTIFS0);
  const [threads, setThreads] = useState(THREADS0);
  const openConversation = (id?: string) => {
    setOpen(false);
    onOpenConversation?.(id);
  };

  const unreadN = notifs.filter((n) => n.unread).length;
  const unreadM = threads.filter((t) => t.unread).length;
  const totalUnread = unreadN + unreadM;

  const Tab = ({ id, label, count }: { id: 'notifications' | 'messages'; label: string; count: number }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn('relative flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors', tab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
    >
      {label}
      {count > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{count}</span>}
      {tab === id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-foreground" />}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground transition-colors hover:bg-muted"
        >
          <Bell className="h-[18px] w-[18px]" />
          {totalUnread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground ring-2 ring-background">
              {totalUnread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex border-b border-border">
          <Tab id="notifications" label="Notifications" count={unreadN} />
          <Tab id="messages" label="Messages" count={unreadM} />
        </div>

        {tab === 'notifications' ? (
          <>
            <div className="max-h-80 overflow-y-auto">
              <AnimatePresence initial={false}>
                {notifs.map((n) => {
                  const Icon = n.icon;
                  return (
                    <SwipeRow key={n.id} onDelete={() => setNotifs((xs) => xs.filter((x) => x.id !== n.id))}>
                      <div className={cn('flex gap-3 border-b border-border px-4 py-3', n.unread && 'bg-secondary/30')}>
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', n.tint)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-foreground">{n.title}</span>
                            {n.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{n.body}</div>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{n.time}</span>
                      </div>
                    </SwipeRow>
                  );
                })}
              </AnimatePresence>
              {notifs.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">You're all caught up.</div>}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs">
              <button
                type="button"
                disabled={unreadN === 0}
                onClick={() => setNotifs((xs) => xs.map((x) => ({ ...x, unread: false })))}
                className="font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                Mark all read
              </button>
              <button type="button" className="font-medium text-muted-foreground transition-colors hover:text-foreground">
                See all
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="max-h-80 overflow-y-auto">
              <AnimatePresence initial={false}>
                {threads.map((t) => (
                  <SwipeRow key={t.id} onDelete={() => setThreads((xs) => xs.filter((x) => x.id !== t.id))}>
                    <button type="button" onClick={() => openConversation(t.id)} className="flex w-full gap-3 border-b border-border px-4 py-3 text-left">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                        {t.avatar}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                          {t.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{t.preview}</div>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{t.time}</span>
                    </button>
                  </SwipeRow>
                ))}
              </AnimatePresence>
              {threads.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">No messages yet.</div>}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> End-to-end encrypted · XMTP
              </span>
              <button type="button" onClick={() => openConversation()} className="font-medium transition-colors hover:text-foreground">
                Open inbox
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
