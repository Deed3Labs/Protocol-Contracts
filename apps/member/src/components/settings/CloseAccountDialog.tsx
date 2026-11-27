import { useEffect, useState } from 'react';
import Modal from '@/components/clear/Modal';
import { Btn, Rows } from '@/components/clear/brand/anatomy';
import { KvRow } from './SettingsKit';
import { count, money } from '@clear/domain';
import { closureCreditsForfeited, closurePayout, type AccountClosure } from '@/lib/clearModel';

/**
 * Close account — two screens: what happens, then what it costs in figures.
 *
 * The first is the same shape as move money: four consequences in main, the reassurance and the
 * commit in the footer. Credits are forfeited on leaving, vested or not, and it says so in red —
 * the one fact most likely to change someone's mind. Vesting protects credits from your own
 * withdrawals, not from leaving; without that sentence this and move money read as a contradiction.
 *
 * Talk to someone first carries the weight: on a screen like this the exit ramp should not be
 * quieter than the exit. The dollar settlement lives on the second screen, where the decision is
 * actually made.
 */
export default function CloseAccountDialog({
  closure,
  handle,
  open,
  onOpenChange,
  onTalk,
  onCloseAccount,
}: {
  closure: AccountClosure;
  handle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Talk to someone first. */
  onTalk?: () => void;
  onCloseAccount?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) setConfirming(false);
  }, [open]);

  const forfeited = closureCreditsForfeited(closure);
  const deedShare = closure.creditsPerDeed > 0 ? Math.round((forfeited / closure.creditsPerDeed) * 100) : 0;
  const carrying = closure.creditToSettle > 0;

  if (confirming) {
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Confirm"
        description="What closing your account pays out and forfeits."
        footer={
          <>
            <div className="c-footnote mt-0! border-t-0! pt-0!">
              <p>
                This cannot be undone. Your handle {handle} is released and the credits cannot be restored if you come
                back.
              </p>
            </div>
            <div className="c-pair mt-s2">
              <Btn primary onClick={() => onOpenChange(false)}>
                Keep my account
              </Btn>
              <Btn className="c-btn-danger" disabled={carrying} onClick={onCloseAccount}>
                Close my account
              </Btn>
            </div>
          </>
        }
      >
        <Rows>
          <div>
            <KvRow
              label={`Paid out to ${closure.payoutAccount}`}
              value={<span className="text-ink">{money(closurePayout(closure), { cents: true })}</span>}
            />
            <p className="c-det mt-[3px]">
              {money(closure.savings, { cents: true })} savings &middot; {money(closure.cash, { cents: true })} cash
            </p>
          </div>
          <div>
            <KvRow label="Equity credits forfeited" value={<span className="text-absent">{count(forfeited)}</span>} />
            <p className="c-det mt-[3px]">
              {count(closure.creditsVested)} vested &middot; {count(closure.creditsVesting)} vesting &middot; worth{' '}
              {deedShare}% of a Clear Deed
            </p>
          </div>
          <div>
            <KvRow
              label="Credit carried"
              value={<span className="text-ink">{money(closure.creditToSettle, { cents: true })}</span>}
            />
            <p className="c-det mt-[3px]">
              {carrying ? 'Must clear before you can close' : 'Cleared before you reached this screen'}
            </p>
          </div>
          <div>
            <KvRow
              label="Share returned at book value"
              value={closure.shareBookValue === undefined ? '—' : money(closure.shareBookValue, { cents: true })}
            />
          </div>
        </Rows>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Close account"
      description="What happens to your savings, credit and equity credits if you leave."
      footer={
        <>
          <div className="c-footnote mt-0! border-t-0! pt-0!">
            <p>Nothing happens until you confirm on the next screen.</p>
          </div>
          <div className="c-pair mt-s2">
            <Btn primary onClick={onTalk}>
              Talk to someone first
            </Btn>
            <Btn onClick={() => setConfirming(true)}>Continue</Btn>
          </div>
        </>
      }
    >
      <p className="text-sec">Leaving ends your membership. Here is exactly what happens.</p>
      <Rows className="mt-s2">
        <div>
          <KvRow label="Savings and cash" value="Paid out in full" />
        </div>
        <div>
          <KvRow label="Equity credits" value={<span className="text-absent">All forfeited, vested or not</span>} />
        </div>
        <div>
          <KvRow label="Credit you carry" value="Must clear first" />
        </div>
        <div>
          <KvRow label="Your share of the co-op" value="Returned at book value" />
        </div>
      </Rows>
      <p className="c-det mt-s2">
        Vesting protects your credits from your own withdrawals. It does not protect them if you leave.
      </p>
    </Modal>
  );
}
