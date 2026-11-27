import Modal from '../Modal';
import { Btn, Line, Rows } from '../brand/anatomy';
import { KvRow } from '@/components/settings/SettingsKit';
import type { ChatMessage, Thread } from '@/lib/clearModel';

/** The figure the thread is about, when its context names one. */
const amountIn = (about?: string) => about?.match(/\$[\d,]+(?:\.\d{2})?/)?.[0];

/**
 * Delete confirms, and the confirmation is where the honest part goes.
 *
 * Three things people get wrong about deleting a message: it is not an unsend, the other side keeps
 * their copy, and the money stays in Activity. Support is the same sheet with one line changed —
 * Clear keeps its own record of what it told you, because you may need it.
 */
export default function DeleteThreadDialog({
  thread,
  messages,
  open,
  onOpenChange,
  onDelete,
}: {
  thread: Thread;
  messages: ChatMessage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const support = thread.kind === 'support';
  const amount = amountIn(thread.context?.about);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Delete this thread?"
      description={`Delete your copy of the thread with ${thread.name}`}
      footer={
        <>
          <div className="c-footnote mt-0! border-t-0! pt-0!">
            <p>
              Deleting removes the thread from your inbox.{' '}
              {support
                ? 'Clear keeps its own record of what support told you, because you may need it.'
                : 'It does not unsend anything and it does not remove the payment.'}{' '}
              This cannot be undone.
            </p>
          </div>
          <div className="c-pair mt-s2">
            <Btn primary onClick={() => onOpenChange(false)}>
              Keep it
            </Btn>
            <Btn className="c-btn-danger" onClick={onDelete}>
              Delete
            </Btn>
          </div>
        </>
      }
    >
      <Line className="mb-s2 items-center!">
        <span className="flex min-w-0 items-center gap-[12px]">
          <span aria-hidden className="c-avatarbtn h-10! w-10! cursor-default text-sec!">
            {thread.initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-body font-semibold">{thread.name}</span>
            {thread.subtitle && <span className="c-det mt-[2px] block truncate">{thread.subtitle}</span>}
          </span>
        </span>
      </Line>
      <Rows>
        <div>
          <KvRow label="Messages removed for you" value={<span className="text-ink">{messages.length}</span>} />
        </div>
        <div>
          {support ? (
            <KvRow label="Clear keeps the case record" value="Required" />
          ) : (
            <KvRow label={`${thread.name} keeps their copy`} value="Always" />
          )}
        </div>
        {amount && (
          <div>
            <KvRow label={`The ${amount} ${support ? 'credit' : 'you sent'}`} value="Stays in Activity" />
          </div>
        )}
      </Rows>
    </Modal>
  );
}
