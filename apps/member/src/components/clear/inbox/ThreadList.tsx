import { Btn, CBar, CFoot, CHead, CMain, Cell, Line, Rows, SecHead } from '../brand/anatomy';
import { ChevronIcon, SearchIcon, ShieldIcon, StorefrontIcon } from '../brand/icons';
import { unreadThreads, type Thread } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** Support and partners are marked; a member needs no tag, because a person is the default. */
function KindBadge({ kind }: { kind: Thread['kind'] }) {
  if (kind === 'support') {
    return (
      <span className="c-kindbadge c-support" title="Clear Support">
        <ShieldIcon size={11} />
      </span>
    );
  }
  if (kind === 'partner') {
    return (
      <span className="c-kindbadge" title="Clear Partner">
        <StorefrontIcon />
      </span>
    );
  }
  return null;
}

/**
 * The Inbox list: conversations only.
 *
 * Notifications are events and the Inbox is conversations — an alert is cleared and never replied
 * to, so they are separate surfaces that point at each other in their footers. The selected thread
 * is marked with a rule rather than a fill, the same selector the settings rail uses.
 */
export default function ThreadList({
  threads,
  activeId,
  query,
  onQuery,
  onSelect,
  onNew,
  onOpenNotifications,
}: {
  threads: Thread[];
  activeId?: string;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (thread: Thread) => void;
  onNew: () => void;
  onOpenNotifications: () => void;
}) {
  const unread = unreadThreads(threads);

  return (
    <Cell>
      <CHead>
        <SecHead label="Inbox">
          <span className="c-det">{threads.length === 0 ? 'Nothing yet' : `${unread} unread`}</span>
        </SecHead>
      </CHead>
      {threads.length > 0 && (
        <CBar>
          <div className="c-listctl c-nowrap">
            <label className="c-searchfield">
              <span className="c-ic">
                <SearchIcon />
              </span>
              <input
                className="c-field c-bare"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="Search messages"
                aria-label="Search messages"
              />
            </label>
            <Btn onClick={onNew}>New</Btn>
          </div>
        </CBar>
      )}
      <CMain>
        {threads.length === 0 ? (
          <div className="py-s4 text-center">
            <p className="c-fig c-fig-sec">No messages</p>
            <p className="c-det mt-s1">Support answers here, and so do members and partners you have paid.</p>
            <Btn primary className="mt-s3" onClick={onNew}>
              Message support
            </Btn>
          </div>
        ) : (
          <Rows>
            {threads.map((thread) => (
              <div key={thread.id} className={cn(thread.id === activeId && 'c-on')}>
                <button type="button" onClick={() => onSelect(thread)} className="block w-full text-left">
                  <Line className="items-start!">
                    <span className="flex min-w-0 gap-[11px]">
                      <span aria-hidden className="c-avatarbtn c-sm cursor-default">
                        {thread.initials}
                      </span>
                      <span className="min-w-0">
                        <span className={cn('flex min-w-0 items-center text-sec', thread.unread && 'font-semibold')}>
                          <span className="truncate">{thread.name}</span>
                          <KindBadge kind={thread.kind} />
                        </span>
                        <span className="c-det mt-[3px] block truncate">{thread.preview}</span>
                      </span>
                    </span>
                    <span className="c-det flex shrink-0 items-center gap-[7px]">
                      {thread.time}
                      {thread.unread && (
                        <span
                          aria-label="Unread"
                          className="block h-[7px] w-[7px] shrink-0 rounded-full bg-live shadow-[0_0_6px_1px_color-mix(in_srgb,var(--live)_55%,transparent)]"
                        />
                      )}
                    </span>
                  </Line>
                </button>
              </div>
            ))}
          </Rows>
        )}
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det">Alerts live in Notifications</span>
          <button type="button" onClick={onOpenNotifications} className="c-det inline-flex! items-center gap-1 hover:text-ink">
            Open notifications
            <ChevronIcon />
          </button>
        </Line>
      </CFoot>
    </Cell>
  );
}
