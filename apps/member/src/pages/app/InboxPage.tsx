import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PlusIcon } from '@/components/clear/brand/icons';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import { useSetPaneTitle } from '@/components/shell/PaneTitle';
import ThreadList from '@/components/clear/inbox/ThreadList';
import ThreadView from '@/components/clear/inbox/ThreadView';
import NewMessageDialog from '@/components/clear/inbox/NewMessageDialog';
import { CONTACTS, INBOX } from '@/data/clearPlaceholder';
import { useIsDesktop } from '@/lib/useIsDesktop';
import type { ChatMessage, Contact, InboxData, Thread } from '@/lib/clearModel';

/** Ask the header to open its notifications panel — the footer's way back to alerts. */
export const OPEN_NOTIFICATIONS = 'clear:open-notifications';

/**
 * Messages — three things sharing a thread but not a purpose: support, a member you paid, and a
 * partner you owe.
 *
 * Notifications are events and this is conversations, so they are separate surfaces that point at
 * each other in their footers. Desktop puts the list and the thread side by side, two cells with
 * their rules lined up; a phone opens the thread over the list, because a 340px column cannot hold
 * both, and the nav's action button reads New.
 */
export default function InboxPage({
  data = INBOX,
  contacts = CONTACTS,
  onSend,
}: {
  data?: InboxData;
  contacts?: Contact[];
  onSend?: (threadId: string, body: string) => void;
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  // A thread is an address on a phone, so its header can name it and its back arrow knows the list
  // is above it. On desktop the list and the thread share a screen, so the choice is just state.
  const { threadId } = useParams();
  const [selected, setSelected] = useState<string | null>(null);
  const openId = threadId ?? selected;
  const [query, setQuery] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  /** Messages sent in this session, until there is somewhere to send them. */
  const [sent, setSent] = useState<Record<string, ChatMessage[]>>({});

  useSetMobileAction({ label: 'New', icon: PlusIcon, onSelect: () => setNewOpen(true) });

  const term = query.trim().toLowerCase();
  const threads = term
    ? data.threads.filter((t) => t.name.toLowerCase().includes(term) || t.preview.toLowerCase().includes(term))
    : data.threads;
  // Desktop always has a thread open: an empty half of the slab reads as broken.
  const open = data.threads.find((t) => t.id === openId) ?? (desktop ? threads[0] : undefined);
  const messages = open ? [...(data.messages[open.id] ?? []), ...(sent[open.id] ?? [])] : [];

  const send = (body: string) => {
    if (!open) return;
    setSent((prev) => ({
      ...prev,
      [open.id]: [...(prev[open.id] ?? []), { id: `local-${Date.now()}`, body, mine: true, time: 'Just now' }],
    }));
    onSend?.(open.id, body);
  };

  const openThread = (thread: Thread) => (desktop ? setSelected(thread.id) : navigate(`/inbox/${thread.id}`));

  // The pushed thread is named after whoever is in it; the list keeps the address's own name.
  useSetPaneTitle(!desktop && threadId && open ? open.name : undefined);

  const list = (
    <ThreadList
      threads={threads}
      activeId={desktop ? open?.id : undefined}
      query={query}
      onQuery={setQuery}
      onSelect={openThread}
      onNew={() => setNewOpen(true)}
      onOpenNotifications={() => window.dispatchEvent(new Event(OPEN_NOTIFICATIONS))}
    />
  );

  const dialog = (
    <NewMessageDialog
      contacts={contacts}
      open={newOpen}
      onOpenChange={setNewOpen}
      onSupport={() => {
        setNewOpen(false);
        const support = data.threads.find((t) => t.kind === 'support');
        if (support) openThread(support);
      }}
      onContact={(contact) => {
        setNewOpen(false);
        // Until a thread can be created, this opens the one that already exists with them.
        const existing = data.threads.find((t) => t.name === contact.name);
        if (existing) openThread(existing);
      }}
    />
  );

  // A phone opens the thread over the list.
  if (!desktop && open && openId) {
    return (
      <>
        {/* The thread is the screen: nothing above or below it scrolls, only the messages do, and it
            starts against the header rather than a page's worth of margin below it. */}
        <div className="c-slab c-one c-fillscreen -mt-s1">
          <ThreadView thread={open} messages={messages} onSend={send} />
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      <div className={desktop ? 'c-slab' : 'c-slab c-one'}>
        {list}
        {desktop && open && <ThreadView thread={open} messages={messages} onSend={send} />}
      </div>
      {dialog}
    </>
  );
}
