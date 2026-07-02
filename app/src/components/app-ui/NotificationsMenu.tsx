import { useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import {
  Bell, ArrowDownLeft, ArrowUpRight, Receipt, Sparkles, CreditCard, Clock, HandCoins, Trash2, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useNotifications } from '@/hooks/useNotifications';
import { useXMTP } from '@/context/XMTPContext';
import { IS_LIVE_APP } from '@/lib/clearNetwork';
import { cn } from '@/lib/utils';

// kind → icon + tint (matches the notification kinds emitted by the backend producers).
const KIND_STYLE: Record<string, { icon: LucideIcon; tint: string }> = {
  received: { icon: ArrowDownLeft, tint: 'bg-positive/10 text-positive' },
  sent: { icon: ArrowUpRight, tint: 'bg-secondary text-foreground' },
  card: { icon: CreditCard, tint: 'bg-secondary text-foreground' },
  pending: { icon: Clock, tint: 'bg-info/10 text-info' },
  credit: { icon: Sparkles, tint: 'bg-info/10 text-info' },
  milestone: { icon: Sparkles, tint: 'bg-info/10 text-info' },
  due: { icon: Receipt, tint: 'bg-negative/10 text-negative' },
  request: { icon: HandCoins, tint: 'bg-amber-500/10 text-amber-500' },
  kyc: { icon: ShieldCheck, tint: 'bg-info/10 text-info' },
  system: { icon: Bell, tint: 'bg-secondary text-foreground' },
};
const styleFor = (kind: string) => KIND_STYLE[kind] ?? KIND_STYLE.system;

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '#';

function loadConvNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem('xmtp_conversation_names') || '{}');
  } catch {
    return {};
  }
}

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
 * Top-bar bell popover: tabbed Notifications (persistent, backend-backed) + Messages (real XMTP
 * conversations). Opening a thread / "Open inbox" calls onOpenConversation, wired in TopBar to the
 * real XMTPMessaging modal.
 */
export default function NotificationsMenu({ onOpenConversation }: { onOpenConversation?: (conversationId?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'notifications' | 'messages'>('notifications');
  const { notifications, unreadCount, markRead, markAllRead, dismiss, sendTest } = useNotifications();
  const { conversations } = useXMTP();

  // Real XMTP conversations → threads (names from the conversation-name map we persist on message).
  const convNames = useMemo(() => (open ? loadConvNames() : {}), [open]);
  const threads = useMemo(
    () =>
      conversations.map((c) => {
        const name = convNames[c.id] || 'Conversation';
        return { id: c.id, name, avatar: initials(name) };
      }),
    [conversations, convNames],
  );

  const openConversation = (id?: string) => {
    setOpen(false);
    onOpenConversation?.(id);
  };

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
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground ring-2 ring-background">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex border-b border-border">
          <Tab id="notifications" label="Notifications" count={unreadCount} />
          <Tab id="messages" label="Messages" count={0} />
        </div>

        {tab === 'notifications' ? (
          <>
            <div className="max-h-80 overflow-y-auto">
              <AnimatePresence initial={false}>
                {notifications.map((n) => {
                  const st = styleFor(n.kind);
                  const Icon = st.icon;
                  return (
                    <SwipeRow key={n.id} onDelete={() => dismiss(n.id)}>
                      <button
                        type="button"
                        onClick={() => markRead(n.id)}
                        className={cn('flex w-full gap-3 border-b border-border px-4 py-3 text-left', !n.read && 'bg-secondary/30')}
                      >
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', st.tint)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-foreground">{n.title}</span>
                            {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{n.body}</div>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{ago(n.createdAt)}</span>
                      </button>
                    </SwipeRow>
                  );
                })}
              </AnimatePresence>
              {notifications.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">You're all caught up.</div>}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs">
              <button
                type="button"
                disabled={unreadCount === 0}
                onClick={markAllRead}
                className="font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                Mark all read
              </button>
              {!IS_LIVE_APP && (
                <button
                  type="button"
                  onClick={() => void sendTest()}
                  className="font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Send test
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="max-h-80 overflow-y-auto">
              {threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openConversation(t.id)}
                  className="flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                    {t.avatar}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{t.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">Tap to open conversation</span>
                  </div>
                </button>
              ))}
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
