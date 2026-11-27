import { useEffect, useState } from 'react';
import Modal from './Modal';
import { Btn, Line, Rows } from './brand/anatomy';
import { TickIcon } from './brand/icons';
import type { LinkedAccount } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/** "Chase ····4471" → the bank, and the masked number that follows it. */
function splitName(name: string): { bank: string; mask?: string } {
  const at = name.indexOf(' ····');
  return at === -1 ? { bank: name } : { bank: name.slice(0, at), mask: name.slice(at + 1) };
}

/**
 * Clears from — a leg picker, reached from the Term plans footer and from the route in Add money.
 *
 * Plans clear from the Clear balance first, and it says so before anything else, because otherwise
 * picking an account reads as choosing who gets paid. The chooser mark is square like every other
 * drawn control. The footer states the limit of what a linked account can do before you pick one.
 */
export default function PaymentAccountDialog({
  accounts,
  selectedId,
  onSave,
  onLink,
  open,
  onOpenChange,
}: {
  accounts: LinkedAccount[];
  selectedId?: string;
  /** Commit the choice. Picking a row only previews it. */
  onSave?: (id: string) => void;
  onLink?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [picked, setPicked] = useState(selectedId);

  // Reopening should show the account that's actually in force, not the last one auditioned.
  useEffect(() => {
    if (open) setPicked(selectedId);
  }, [open, selectedId]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Clears from"
      description="Choose which linked account covers what your Clear balance does not."
      footer={
        <>
          <Line className="items-center!">
            <span className="c-det">Read-only · Clear cannot pull from it except to clear a plan</span>
            <Btn className="c-linkish" onClick={onLink}>
              Link another
            </Btn>
          </Line>
          <Btn primary lg className="mt-s2" disabled={picked === undefined} onClick={() => picked && onSave?.(picked)}>
            Use this account
          </Btn>
        </>
      }
    >
      <p className="c-det mb-s2">Plans clear from your Clear balance first. This account covers whatever is left.</p>
      {accounts.length === 0 ? (
        <p className="c-det">No accounts linked yet.</p>
      ) : (
        <Rows>
          {accounts.map((account) => {
            const on = account.id === picked;
            const { bank, mask } = splitName(account.name);
            return (
              <button
                key={account.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPicked(account.id)}
                className="c-line block w-full items-center! text-left"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={cn('c-pick', on && 'c-on')}>
                    {on && <TickIcon size={12} strokeWidth={3.2} className="text-paper" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sec">{bank}</span>
                    <span className="c-det mt-[2px] block">
                      {account.kind}
                      {mask ? ` ${mask}` : ''}
                    </span>
                    <span className="c-det block">
                      {account.linkedOn
                        ? `${account.verified ? 'Verified · ' : ''}linked ${account.linkedOn}`
                        : account.detail}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </Rows>
      )}
    </Modal>
  );
}
