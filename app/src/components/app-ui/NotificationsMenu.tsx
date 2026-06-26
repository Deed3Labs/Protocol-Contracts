import { useState } from 'react';
import { Bell, ArrowDownLeft, Receipt, Sparkles, CreditCard, type LucideIcon } from 'lucide-react';
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
const NOTIFS: Notif[] = [
  { id: '1', icon: ArrowDownLeft, tint: 'bg-positive/10 text-positive', title: 'Money received', body: '+$349.00 from Macellyn Annya', time: '2h', unread: true },
  { id: '2', icon: Sparkles, tint: 'bg-info/10 text-info', title: '1:1 match applied', body: '+$520 added to your Clear Deed', time: '5h', unread: true },
  { id: '3', icon: Receipt, tint: 'bg-negative/10 text-negative', title: 'Rent due soon', body: '$1,850 due in 3 days', time: '1d', unread: false },
  { id: '4', icon: CreditCard, tint: 'bg-secondary text-foreground', title: 'Card payment posted', body: '$320.00 · Card', time: '2d', unread: false },
];

/** Top-bar notifications popover with an unread badge. */
export default function NotificationsMenu() {
  const [items, setItems] = useState(NOTIFS);
  const unread = items.filter((n) => n.unread).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground transition-colors hover:bg-muted"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground ring-2 ring-background">
              {unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium text-foreground">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => setItems((xs) => xs.map((x) => ({ ...x, unread: false })))}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 divide-y divide-border overflow-y-auto">
          {items.map((n) => {
            const Icon = n.icon;
            return (
              <div key={n.id} className={cn('flex gap-3 px-4 py-3', n.unread && 'bg-secondary/30')}>
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
            );
          })}
        </div>
        <button type="button" className="block w-full border-t border-border py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          See all notifications
        </button>
      </PopoverContent>
    </Popover>
  );
}
