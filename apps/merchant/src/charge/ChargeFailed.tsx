import { dollars } from '@clear/domain';
import { Button, Inset, PrimaryButton } from '@/shell/ui';

/**
 * When it does not work — reference section 17.
 *
 * **Each of these has to leave the writer with something to say to the customer.** That is the
 * whole job of these screens, and it is why none of them is a bare error.
 *
 * A decline never carries a reason to the counter. Why Clear could not cover a charge is between
 * Clear and the member — a writer who knows will repeat it out loud, in front of a queue, about
 * somebody's finances.
 *
 * There is no offline queue and there must not be one: capturing a charge the ledger has not seen
 * promises the shop something that may not hold.
 */
export function ChargeFailed({
  kind,
  amount,
  memberName,
  onRetry,
  onDone,
}: {
  kind: 'declined' | 'expired' | 'offline';
  amount: number;
  memberName: string;
  onRetry: () => void;
  onDone: () => void;
}) {
  const copy = {
    declined: {
      cap: 'Declined',
      title: 'Clear could not cover this one',
      body: `${memberName} can see why in their app. Nothing has been charged.`,
      action: 'Try a smaller amount',
    },
    expired: {
      cap: 'Expired',
      title: `${memberName} did not approve in time`,
      body: 'Charges expire after 24 hours. Nothing was charged and nothing is owed.',
      // One tap, because the common cause is a phone that was face-down.
      action: 'Send it again',
    },
    offline: {
      cap: 'No connection',
      title: 'Clear is offline',
      body: 'You cannot raise a charge right now. Take the ticket the usual way and raise it when you are back.',
      /**
       * No action, and the reference gives it none.
       *
       * There is nothing to retry — a charge cannot be raised at all — so a button invites a writer
       * to stand there tapping it while somebody waits at the counter. The screen's whole job here
       * is to send them to paper, and an affordance that looks like progress works against that.
       */
      action: null,
    },
  }[kind];

  return (
    <div className="mx-auto w-full max-w-[420px]">
      <p className="m-0 mb-2 text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
        {copy.cap}
      </p>
      {kind !== 'offline' && (
        <p className="m-0 mb-[3px] text-[26px] font-medium tabular-nums">{dollars(amount)}</p>
      )}
      <p className="m-0 mb-3.5 text-[15px]">{copy.title}</p>

      <Inset className="mb-4">
        <p className="m-0 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          {copy.body}
        </p>
      </Inset>

      {copy.action && (
        <PrimaryButton onClick={onRetry} className="!text-[12px]">
          {copy.action}
        </PrimaryButton>
      )}
      <Button onClick={onDone} className={copy.action ? 'mt-2 w-full' : 'w-full'}>
        Back to home
      </Button>
    </div>
  );
}
