import Avatar from './Avatar';
import type { Thread } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * The message list — design spec §1.
 *
 * A squarer avatar than the contact rows use (13px radius against a circle), so
 * a conversation doesn't read as a person you're about to pay. Unread is a dot on
 * the right and a heavier name, not a highlighted row: a full-bleed unread state
 * makes an inbox with four unreads look broken.
 */
export default function ThreadRows({
  threads,
  activeId,
  onSelect,
  emptyMessage = 'No messages yet.',
}: {
  threads: Thread[];
  /** Highlighted on desktop, where the thread is open beside the list. */
  activeId?: string;
  onSelect?: (thread: Thread) => void;
  emptyMessage?: string;
}) {
  if (threads.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div>
      {threads.map((thread, i) => (
        <button
          key={thread.id}
          type="button"
          onClick={() => onSelect?.(thread)}
          className={cn(
            'flex w-full items-center gap-[11px] px-1 py-3 text-left transition-colors',
            i < threads.length - 1 && 'border-b-[0.5px] border-border',
            activeId === thread.id ? 'bg-secondary/60' : 'hover:bg-secondary/40',
          )}
        >
          <Avatar
            id={thread.id}
            initials={thread.initials}
            className="h-[38px] w-[38px] rounded-[13px] text-xs"
          />
          <span className="min-w-0 flex-1">
            <span className="flex justify-between gap-2">
              <span className={cn('truncate text-[13px]', thread.unread && 'font-medium')}>
                {thread.name}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{thread.time}</span>
            </span>
            <span
              className={cn(
                'mt-[3px] block truncate text-xs',
                thread.unread ? 'text-foreground-secondary' : 'text-muted-foreground',
              )}
            >
              {thread.preview}
            </span>
          </span>
          {thread.unread && (
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-tier-boost" />
          )}
        </button>
      ))}
    </div>
  );
}
