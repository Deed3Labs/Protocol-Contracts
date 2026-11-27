import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Btn, CMain, Cell } from '@/components/clear/brand/anatomy';
import { PlusIcon } from '@/components/clear/brand/icons';
import { useSetMobileAction } from '@/components/shell/MobileAction';
import { useSetPaneTitle } from '@/components/shell/PaneTitle';
import ThreadList from '@/components/clear/inbox/ThreadList';
import ThreadView from '@/components/clear/inbox/ThreadView';
import NewMessageDialog from '@/components/clear/inbox/NewMessageDialog';
import DeleteThreadDialog from '@/components/clear/inbox/DeleteThreadDialog';
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
  /*
   * What the member has done to the list, held here until there is a store for it: read, archived
   * and deleted. Archiving is reversible and has its own view; deleting is not, which is why it is
   * the last action and the only one in ink.
   */
  const [readState, setReadState] = useState<Record<string, boolean>>({});
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  /** The thread waiting on its confirmation, because deleting cannot be undone. */
  const [deleting, setDeleting] = useState<Thread | null>(null);

  useSetMobileAction({ label: 'New', icon: PlusIcon, onSelect: () => setNewOpen(true) });

  const term = query.trim().toLowerCase();
  const all = data.threads
    .filter((t) => !deleted.has(t.id))
    .map((t) => (t.id in readState ? { ...t, unread: !readState[t.id] } : t));
  const inList = all.filter((t) => archived.has(t.id) === showArchived);
  const threads = term
    ? inList.filter((t) => t.name.toLowerCase().includes(term) || t.preview.toLowerCase().includes(term))
    : inList;
  // Nothing selected is a state rather than a gap: the pane keeps its width and says what the inbox
  // holds, instead of opening a thread the member did not ask for.
  const open = all.find((t) => t.id === openId);
  const messages = open ? [...(data.messages[open.id] ?? []), ...(sent[open.id] ?? [])] : [];

  const send = (body: string) => {
    if (!open) return;
    setSent((prev) => ({
      ...prev,
      [open.id]: [...(prev[open.id] ?? []), { id: `local-${Date.now()}`, body, mine: true, time: 'Just now' }],
    }));
    onSend?.(open.id, body);
  };

  const openThread = (thread: Thread) => {
    setReadState((prev) => ({ ...prev, [thread.id]: true }));
    return desktop ? setSelected(thread.id) : navigate(`/inbox/${thread.id}`);
  };

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
      onRead={(thread, markRead) => setReadState((prev) => ({ ...prev, [thread.id]: markRead }))}
      onArchive={(thread, put) =>
        setArchived((prev) => {
          const next = new Set(prev);
          if (put) next.add(thread.id);
          else next.delete(thread.id);
          // An empty archive is not a place to stand in; putting the last one back returns the list.
          if (next.size === 0) setShowArchived(false);
          return next;
        })
      }
      onDelete={setDeleting}
      showingArchived={showArchived}
      onShowArchived={setShowArchived}
    />
  );

  const dialogs = (
    <>
      {deleting && (
        <DeleteThreadDialog
          thread={deleting}
          messages={data.messages[deleting.id] ?? []}
          open={deleting !== null}
          onOpenChange={(o) => !o && setDeleting(null)}
          onDelete={() => {
            setDeleted((prev) => new Set(prev).add(deleting.id));
            if (openId === deleting.id) {
              setSelected(null);
              if (threadId) navigate('/inbox');
            }
            setDeleting(null);
          }}
        />
      )}
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
    </>
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
        {dialogs}
      </>
    );
  }

  return (
    <>
      {/* The list is a screen too: the control bar and the footer hold while the threads scroll. */}
      <div className={desktop ? 'c-slab c-inbox c-fillscreen' : 'c-slab c-one c-fillscreen -mt-s1'}>
        {list}
        {desktop &&
          (open ? (
            <ThreadView thread={open} messages={messages} onSend={send} />
          ) : (
            <Cell>
              <CMain>
                <div className="c-panehint">
                  <p className="c-fig c-fig-sec">Pick a thread</p>
                  <p className="c-det mt-s1 max-w-[34ch]">
                    Support, members you have paid and partners you owe all land in the same inbox.
                  </p>
                  <Btn className="mt-s3" onClick={() => setNewOpen(true)}>
                    New message
                  </Btn>
                </div>
              </CMain>
            </Cell>
          ))}
      </div>
      {dialogs}
    </>
  );
}
