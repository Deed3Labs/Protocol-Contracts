import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search, SendHorizontal, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/*
 * Messages — the redesign-native conversation modal (new fonts + dusk/dawn tokens). Two-pane
 * on desktop (list | thread), single-pane on mobile. Mock data for now; wire to the existing
 * XMTP logic later: `convos` ← useXMTP().conversations/messages, `send()` ← sendMessage().
 */

interface Msg {
  id: string;
  me: boolean;
  text: string;
  time: string;
}
interface Convo {
  id: string;
  name: string;
  avatar: string;
  time: string;
  unread: boolean;
  msgs: Msg[];
}

const CONVOS: Convo[] = [
  {
    id: 't1',
    name: 'Ahmad Sulaiman',
    avatar: 'AS',
    time: '1h',
    unread: true,
    msgs: [
      { id: 'a', me: false, text: 'Hey — did the $574 go through?', time: '2:31 PM' },
      { id: 'b', me: true, text: 'Yep, just sent it. Should land in a minute.', time: '2:34 PM' },
      { id: 'c', me: false, text: 'Thanks, got the transfer 🙏', time: '2:40 PM' },
    ],
  },
  {
    id: 't2',
    name: 'Clear Support',
    avatar: 'CS',
    time: '3h',
    unread: true,
    msgs: [{ id: 'a', me: false, text: 'Good news — your dispute was resolved and $134 was refunded to your balance.', time: '11:02 AM' }],
  },
  {
    id: 't3',
    name: 'Maple Apartments',
    avatar: 'MA',
    time: '1d',
    unread: false,
    msgs: [
      { id: 'a', me: false, text: 'June rent receipt attached — thanks for the on-time payment!', time: 'Yesterday' },
      { id: 'b', me: true, text: 'Appreciate it, thank you.', time: 'Yesterday' },
    ],
  },
];

export default function MessagesModal({ open, onOpenChange, initialId }: { open: boolean; onOpenChange: (o: boolean) => void; initialId?: string }) {
  const [convos, setConvos] = useState(CONVOS);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setSelectedId(initialId ?? null);
      setDraft('');
    }
  }, [open, initialId]);

  const selected = convos.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [selected?.msgs.length, selectedId]);

  const select = (id: string) => {
    setSelectedId(id);
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, unread: false } : c)));
  };
  const send = () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setConvos((cs) =>
      cs.map((c) => (c.id === selected.id ? { ...c, msgs: [...c.msgs, { id: `m${Date.now()}`, me: true, text, time: 'now' }] } : c)),
    );
    setDraft('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[640px] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="flex min-h-0 flex-1">
          {/* conversation list */}
          <div className={cn('flex w-full flex-col border-r border-border sm:w-72', selected && 'hidden sm:flex')}>
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-display text-lg tracking-tight text-foreground">Messages</h2>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  placeholder="Search"
                  className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {convos.map((c) => {
                const last = c.msgs[c.msgs.length - 1];
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => select(c.id)}
                    className={cn('flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-secondary/50', selectedId === c.id && 'bg-secondary/50')}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                      {c.avatar}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{c.name}</span>
                        {c.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />}
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{c.time}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{last?.text}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-1 border-t border-border py-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Encrypted · XMTP
            </div>
          </div>

          {/* thread */}
          <div className={cn('flex w-full flex-1 flex-col', !selected && 'hidden sm:flex')}>
            {selected ? (
              <>
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <button type="button" onClick={() => setSelectedId(null)} aria-label="Back" className="-ml-1 rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground sm:hidden">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
                    {selected.avatar}
                  </span>
                  <span className="truncate text-sm font-medium text-foreground">{selected.name}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
                  {selected.msgs.map((m) => (
                    <div key={m.id} className={cn('flex', m.me ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                          m.me ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-secondary text-foreground',
                        )}
                      >
                        {m.text}
                        <div className={cn('mt-0.5 text-[10px]', m.me ? 'text-primary-foreground/60' : 'text-muted-foreground')}>{m.time}</div>
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
                <div className="flex items-center gap-2 border-t border-border p-3">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') send();
                    }}
                    placeholder="Message…"
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={!draft.trim()}
                    aria-label="Send"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform active:scale-95 disabled:opacity-40"
                  >
                    <SendHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <div className="hidden flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground sm:flex">
                <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                  <SendHorizontal className="h-5 w-5" />
                </span>
                Select a conversation to start messaging.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
