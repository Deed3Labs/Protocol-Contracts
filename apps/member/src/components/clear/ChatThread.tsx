import { useState } from 'react';
import { ArrowLeft, MoreHorizontal, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Avatar from './Avatar';
import { TIER_FILL, type ChatMessage, type Thread } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * A conversation — design spec §1.
 *
 * The attachment card is why messages live inside the app at all: support can
 * answer "which tier paid for this" with the actual draw attached, in the same
 * colours the rest of the app uses for it. Over email that's a screenshot and a
 * paragraph.
 */
export default function ChatThread({
  thread,
  messages,
  onBack,
  className,
}: {
  thread: Thread;
  messages: ChatMessage[];
  /** Mobile pushes the thread over the list, so it needs a way back. */
  onBack?: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState('');

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="mb-3.5 flex items-center gap-[11px] border-b-[0.5px] border-border pb-3">
        {onBack && (
          <button
            type="button"
            aria-label="Back to inbox"
            onClick={onBack}
            className="shrink-0 text-foreground-secondary transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-[17px] w-[17px]" strokeWidth={1.75} />
          </button>
        )}
        <Avatar
          id={thread.id}
          initials={thread.initials}
          className="h-[34px] w-[34px] rounded-xl text-xs"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{thread.name}</p>
          {thread.subtitle && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{thread.subtitle}</p>
          )}
        </div>
        <button
          type="button"
          aria-label="Conversation options"
          className="shrink-0 text-foreground-secondary transition-colors hover:text-foreground"
        >
          <MoreHorizontal className="h-[17px] w-[17px]" strokeWidth={1.75} />
        </button>
      </div>

      <div className="mb-3.5 flex flex-1 flex-col gap-[9px] text-[13px]">
        {messages.map((message) =>
          message.attachment ? (
            <div
              key={message.id}
              className="max-w-[78%] self-start rounded-[14px] border-[0.5px] border-border px-3.5 py-3"
            >
              <p className="mb-2 text-xs text-foreground-secondary">{message.attachment.label}</p>
              <div className="mb-1.5 h-2 overflow-hidden rounded-[4px] bg-border">
                <div className={cn('h-full w-full', TIER_FILL[message.attachment.tier])} />
              </div>
              <p className="text-[11px] text-muted-foreground">{message.attachment.note}</p>
            </div>
          ) : (
            <div
              key={message.id}
              className={cn(
                'max-w-[78%] px-3.5 py-2.5 leading-relaxed',
                message.mine
                  ? 'self-end rounded-[14px] rounded-br-[4px] bg-foreground text-background'
                  : 'self-start rounded-[14px] rounded-bl-[4px] bg-secondary',
              )}
            >
              {message.body}
            </div>
          ),
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message"
          aria-label="Write a message"
          className="h-10 min-w-0 flex-1 text-xs"
        />
        <Button
          size="icon"
          aria-label="Send message"
          disabled={!draft.trim()}
          onClick={() => setDraft('')}
          className="h-10 w-10 shrink-0 rounded-[12px]"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
