import { useEffect, useState } from 'react';
import { dollars, fromWire } from '@clear/domain';
import { api } from '@/data/apiClient';
import { Button, Cap, Inset } from '@/shell/ui';

/**
 * Waiting — reference section 05.
 *
 * The state that separates this from a card terminal: a charge can be raised and confirmed
 * asynchronously. The customer's phone can be dead, or they can be under the car, and it still
 * completes when they get to it. So the copy releases the writer rather than holding them: they do
 * not have to wait at the counter.
 *
 * The delivery receipts are not decoration. They are how a writer decides whether to walk to the
 * waiting room, and they are the reason an async flow reads as trustworthy rather than a black
 * hole. "Opened" is the one that matters.
 */
export function ChargeWaiting({
  amount,
  code,
  raisedAt,
  onSendAgain,
  onCancel,
  onApproved,
  onDeclined,
  onExpired,
}: {
  amount: number;
  /** The raised charge. Polled until the member's phone moves it on. */
  code: string;
  raisedAt: number;
  onSendAgain: () => void;
  onCancel: () => void;
  onApproved: () => void;
  onDeclined: () => void;
  onExpired: () => void;
}) {
  const [memberName, setMemberName] = useState<string | null>(null);

  /**
   * The member's phone drives this, so the tablet asks.
   *
   * Polling rather than a socket: a counter tablet sleeps, loses wifi and gets picked up again,
   * and a poll recovers from all three by simply asking again. Every three seconds is well inside
   * what a writer reads as immediate and nowhere near enough traffic to matter.
   *
   * The screen also says the customer can approve later — so this is not a countdown anybody has
   * to watch. It exists so that when they do approve at the counter, the tablet notices.
   */
  useEffect(() => {
    if (!code) return;
    let stopped = false;

    const tick = async () => {
      try {
        const c = await api.watchCharge(code);
        if (stopped) return;
        // "Not opened yet" until somebody scans it — the charge starts with no member at all.
        if (c.openedAt && !memberName) setMemberName('Opened');
        const state = fromWire(c.status);
        if (state === 'approved') onApproved();
        else if (state === 'declined') onDeclined();
        else if (state === 'expired') onExpired();
      } catch {
        // A poll that fails changes nothing on screen. The charge is safe on the server, and the
        // next tick asks again — showing an error here would put a failure in front of a writer
        // for something that is not their problem and needs no action.
      }
    };

    void tick();
    const id = window.setInterval(tick, 3_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [code, memberName, onApproved, onDeclined, onExpired]);

  const secs = Math.max(0, Math.round((Date.now() - raisedAt) / 1000));
  const sent = secs < 90 ? `sent ${secs} seconds ago` : `sent ${Math.round(secs / 60)} min ago`;

  return (
    <div className="grid grid-cols-1 gap-3.5 @[900px]:grid-cols-2">
      <div>
        <Cap>Waiting</Cap>
        <p className="m-0 mb-[3px] text-[26px] font-medium tabular-nums">{dollars(amount)}</p>
        <p className="m-0 mb-[18px] text-[12.5px] text-[var(--clear-text-muted)]">
          {memberName ?? 'Not opened yet'} · {sent}
        </p>
        <p className="m-0 mb-3.5 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          They can approve any time today. You do not have to wait at the counter.
        </p>
        <div className="flex gap-2">
          <Button onClick={onSendAgain} className="flex-1">
            Send again
          </Button>
          {/* Counter staff may cancel a charge they raised, while it is still waiting. */}
          <Button onClick={onCancel} className="flex-1">
            Cancel charge
          </Button>
        </div>

        {/*
          Kept for development only. The member's phone drives this for real now — the poll above
          moves the screen on — but a shop being demonstrated has no second phone in the room, and
          statically dropped from a production build.
        */}
        {import.meta.env.DEV && (
        <div className="mt-6 flex flex-wrap gap-2 border-t-[0.5px] border-[var(--clear-border)] pt-3">
          <p className="m-0 w-full text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
            Development only — the member's phone drives this
          </p>
          <Button onClick={onApproved} className="!text-[12px]">
            They approve
          </Button>
          <Button onClick={onDeclined} className="!text-[12px]">
            Declined
          </Button>
          <Button onClick={onExpired} className="!text-[12px]">
            Expires
          </Button>
        </div>
        )}
      </div>

      <Inset className="!px-4 !py-[15px]">
        <Cap>Reached them</Cap>
        <div className="flex justify-between text-[12.5px]">
          <span className="text-[var(--clear-text-secondary)]">Text</span>
          <span className="text-[var(--clear-text-muted)]">Delivered</span>
        </div>
        <div className="mt-[7px] flex justify-between text-[12.5px]">
          <span className="text-[var(--clear-text-secondary)]">Email</span>
          <span className="text-[var(--clear-text-muted)]">Delivered</span>
        </div>
        <div className="mt-[7px] flex justify-between text-[12.5px]">
          <span className="text-[var(--clear-text-secondary)]">App</span>
          <span className="text-[var(--clear-text-success)]">Opened</span>
        </div>
        <p className="m-0 mt-3 text-[11.5px] leading-[1.55] text-[var(--clear-text-muted)]">
          All three go out together. “Opened” is what tells you not to walk to the waiting room.
        </p>
      </Inset>
    </div>
  );
}
