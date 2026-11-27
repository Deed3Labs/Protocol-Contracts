import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Btn, CBar, CFoot, CHead, CMain, Cell, Chip, Line } from '../brand/anatomy';
import { ArrowIcon, ChevronIcon, ShieldIcon, StorefrontIcon } from '../brand/icons';
import type { ChatMessage, Thread } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * One conversation. No bubbles: a message is a square block, theirs on paper-2 with a hairline and
 * yours in ink — ink is otherwise reserved for buttons, and that is the point, the thing you said is
 * the thing you did.
 *
 * The control bar carries why the thread exists, which is what stops a partner thread being a chat
 * window with no memory of it. The safety line appears in member threads only: a member asking
 * another member for money is exactly the shape a scam takes, so it is a rule rather than a message.
 */
export default function ThreadView({
  thread,
  messages,
  onSend,
}: {
  thread: Thread;
  messages: ChatMessage[];
  onSend?: (body: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);

  // A thread opens at its newest message, which is the one the member came for. The box is scrolled
  // rather than the sentinel scrolled into view: that left the last timestamp under the padding.
  useEffect(() => {
    const box = end.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [thread.id, messages.length]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    onSend?.(body);
    setDraft('');
  };

  return (
    <Cell>
      <CHead>
        <Line className="items-center!">
          <span className="c-mtitle truncate">{thread.name}</span>
          {thread.kind === 'support' && (
            <Chip tone="settled">
              <ShieldIcon size={11} />
              Verified
            </Chip>
          )}
          {thread.kind === 'partner' && (
            <Chip tone="neutral">
              <StorefrontIcon />
              Partner
            </Chip>
          )}
        </Line>
      </CHead>
      {thread.context && (
        <CBar>
          <div className="c-listctl c-nowrap">
            <span className="flex min-w-0 items-center gap-s1">
              <Chip
                tone={thread.context.tone}
                core={thread.context.tone === 'settled'}
                figs={/\d/.test(thread.context.status)}
              >
                {thread.context.status}
              </Chip>
              <span className="c-det truncate">{thread.context.about}</span>
            </span>
            {thread.context.link && (
              <Link to={thread.context.link.to} className="c-det inline-flex! shrink-0 items-center gap-1 hover:text-ink">
                {thread.context.link.label}
                <ChevronIcon />
              </Link>
            )}
          </div>
        </CBar>
      )}
      <CMain>
        {thread.kind === 'member' && (
          <div className="c-sysmsg">
            <span className="c-ic">
              <ShieldIcon size={13} />
            </span>
            Clear will never ask you for a code. If a message does, it is not from us.
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={cn('c-msgrow', message.mine && 'c-me')}>
            <div className={cn('c-msg', message.mine && 'c-me')}>{message.body}</div>
            {message.time && <p className="c-msgtime">{message.time}</p>}
          </div>
        ))}
        <div ref={end} />
      </CMain>
      <CFoot>
        <div className="c-composer">
          <input
            className="c-field"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder="Message"
            aria-label={`Message ${thread.name}`}
          />
          <Btn className="c-iconsq" aria-label="Send" onClick={send}>
            <ArrowIcon size={17} strokeWidth={1.9} />
          </Btn>
        </div>
      </CFoot>
    </Cell>
  );
}
