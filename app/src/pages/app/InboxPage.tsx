import { useState } from 'react';
import { SquarePen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Card from '@/components/clear/Card';
import InfoBlock from '@/components/clear/InfoBlock';
import SegmentedTabs from '@/components/clear/SegmentedTabs';
import AlertRows from '@/components/clear/AlertRows';
import ThreadRows from '@/components/clear/ThreadRows';
import ChatThread from '@/components/clear/ChatThread';
import { INBOX } from '@/data/clearPlaceholder';
import { unreadAlerts, unreadThreads, type InboxData } from '@/lib/clearModel';
import { useIsDesktop } from '@/lib/useIsDesktop';

/**
 * Inbox — design spec §1. One surface, two tabs: what the app is telling you, and
 * who is talking to you.
 *
 * They're together because from the member's side they're the same question —
 * "what's waiting for me" — and splitting them into a notification tray and a
 * messages app means checking two places and trusting neither.
 *
 * Desktop keeps the list and the open thread side by side; mobile pushes the
 * thread over the list, since a 375px column can't hold both.
 */
export default function InboxPage({
  data = INBOX,
  onMarkAllRead,
  onRead,
  onClear,
}: {
  data?: InboxData;
  onMarkAllRead?: () => void;
  onRead?: (id: string) => void;
  onClear?: (id: string) => void;
}) {
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<'alerts' | 'messages'>('alerts');
  const [openId, setOpenId] = useState<string | null>(null);

  const openThread = data.threads.find((t) => t.id === openId);
  const messages = openId ? (data.messages[openId] ?? []) : [];

  const tabs = (
    <SegmentedTabs
      className="mb-3.5"
      value={tab}
      onChange={(id) => {
        setTab(id);
        setOpenId(null);
      }}
      tabs={[
        { id: 'alerts', label: 'Alerts', count: unreadAlerts(data.alerts) },
        { id: 'messages', label: 'Messages', count: unreadThreads(data.threads) },
      ]}
    />
  );

  const list =
    tab === 'alerts' ? (
      <AlertRows alerts={data.alerts} onRead={onRead} onClear={onClear} />
    ) : (
      <>
        <ThreadRows
          threads={data.threads}
          activeId={openId ?? undefined}
          onSelect={(thread) => setOpenId(thread.id)}
        />
        <InfoBlock tone="neutral" className="mt-3.5 text-[11px]">
          Messages are end-to-end encrypted and tied to your account, not your phone number.
        </InfoBlock>
      </>
    );

  // Mobile: the open thread replaces the list entirely.
  if (!isDesktop && openThread) {
    return (
      <ChatThread
        thread={openThread}
        messages={messages}
        onBack={() => setOpenId(null)}
        className="min-h-[70vh]"
      />
    );
  }

  return (
    <>
      {/* The chrome already names the page on mobile, so only the actions show
          there — a second "Inbox" under the header is just noise. */}
      <div className="mb-3 flex items-center justify-end gap-3 lg:justify-between">
        <h1 className="hidden text-xl font-medium lg:block">Inbox</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-xs text-tier-boost-fg transition-opacity hover:opacity-80"
          >
            Mark all read
          </button>
          <Button variant="clear" size="xs" className="hidden lg:inline-flex">
            <SquarePen className="h-3.5 w-3.5" strokeWidth={1.75} />
            New message
          </Button>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div>
          {tabs}
          {list}
        </div>

        {/* Desktop always shows a thread pane — an empty one still says what the
            tab is for, where a blank half-screen would just look broken. */}
        <Card className="hidden lg:block">
          {openThread ? (
            <ChatThread thread={openThread} messages={messages} className="min-h-[420px]" />
          ) : (
            <p className="py-16 text-center text-xs text-muted-foreground">
              {tab === 'messages'
                ? 'Pick a conversation to read it here.'
                : 'Alerts are on the left. Switch to Messages to talk to someone.'}
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
