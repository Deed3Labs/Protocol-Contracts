import { Link } from 'react-router-dom';
import { motion, type PanInfo } from 'framer-motion';
import { MailOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ALERT_DOT, type Alert } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * One alert, with the row actions behind it.
 *
 * Swipe reveals Read and Clear rather than putting a menu on every row: these are
 * the only two things anyone does to a notification, and a list of twenty rows
 * with twenty menus is unreadable. The drag is capped at the width of the two
 * actions so the row can't be flung off the screen.
 */
function AlertRow({
  alert,
  onRead,
  onClear,
  last,
}: {
  alert: Alert;
  onRead?: (id: string) => void;
  onClear?: (id: string) => void;
  last?: boolean;
}) {
  const actionable = Boolean(onRead || onClear);

  const body = (
    <div
      className={cn(
        'flex gap-[11px] bg-background px-1 py-3',
        !last && 'border-b-[0.5px] border-border',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full',
          alert.read ? 'bg-transparent' : ALERT_DOT[alert.tone],
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2.5">
          <p className={cn('text-[13px]', alert.read && 'text-foreground-secondary')}>
            {alert.title}
          </p>
          <span className="shrink-0 text-[11px] text-muted-foreground">{alert.time}</span>
        </div>
        <p className="mt-[3px] text-xs leading-relaxed text-muted-foreground">{alert.detail}</p>
        {alert.action && (
          <Button variant="clear" size="xs" className="mt-2" asChild>
            <Link to={alert.action.to}>{alert.action.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );

  if (!actionable) return body;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60) return; // held open — the actions are what they wanted
  };

  return (
    <div className="relative -mx-1 overflow-hidden rounded-xl">
      <div className="absolute inset-0 flex items-center justify-end gap-[18px] bg-secondary pr-4">
        <button
          type="button"
          onClick={() => onRead?.(alert.id)}
          className="flex flex-col items-center gap-1 text-[11px] text-foreground-secondary"
        >
          <MailOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
          Read
        </button>
        <button
          type="button"
          onClick={() => onClear?.(alert.id)}
          className="flex flex-col items-center gap-1 text-[11px] text-foreground-secondary"
        >
          <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
          Clear
        </button>
      </div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -96, right: 0 }}
        dragElastic={0.04}
        onDragEnd={onDragEnd}
        className="relative touch-pan-y"
      >
        {body}
      </motion.div>
    </div>
  );
}

/**
 * Alerts grouped by when they landed — design spec §1.
 *
 * Group headers are uppercase and small: they're a scanning aid, not content, and
 * an alert list is read by skimming for the one you remember.
 */
export default function AlertRows({
  alerts,
  onRead,
  onClear,
  emptyMessage = "Nothing yet — you'll hear from us when something moves.",
}: {
  alerts: Alert[];
  onRead?: (id: string) => void;
  onClear?: (id: string) => void;
  emptyMessage?: string;
}) {
  if (alerts.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  const groups: { label: string; rows: Alert[] }[] = [];
  for (const alert of alerts) {
    const last = groups[groups.length - 1];
    if (last && last.label === alert.group) last.rows.push(alert);
    else groups.push({ label: alert.group, rows: [alert] });
  }

  return (
    <div>
      {groups.map((group, gi) => (
        <div key={group.label} className={cn(gi > 0 && 'mt-4')}>
          <p className="mb-0.5 text-[11px] uppercase tracking-[0.2px] text-muted-foreground">
            {group.label}
          </p>
          {group.rows.map((alert, i) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onRead={onRead}
              onClear={onClear}
              last={i === group.rows.length - 1}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
