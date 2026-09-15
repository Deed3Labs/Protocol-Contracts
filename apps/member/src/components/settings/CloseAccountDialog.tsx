import Modal from '@/components/clear/Modal';
import { Btn, Rows } from '@/components/clear/brand/anatomy';
import { KvRow } from './SettingsKit';

/**
 * Close account — what leaving actually does, before the exit.
 *
 * The same shape as move money: the four consequences in main, and the footer is what follows and
 * the commit. Continue does not close anything; the confirmation is the next screen.
 */
export default function CloseAccountDialog({
  open,
  onOpenChange,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue?: () => void;
}) {
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
          <Btn primary lg className="mt-s2" onClick={onContinue}>
            Continue
          </Btn>
        </>
      }
    >
      <p className="text-sec">Leaving ends your membership. Here is exactly what happens.</p>
      <Rows className="mt-s2">
        <div>
          <KvRow label="Savings and cash" value="Paid out in full" />
        </div>
        <div>
          <KvRow label="Equity credits" value="Vested credits are kept, vesting stops" />
        </div>
        <div>
          <KvRow label="Credit you carry" value="Must clear first" />
        </div>
        <div>
          <KvRow label="Your share of the co-op" value="Returned at book value" />
        </div>
      </Rows>
    </Modal>
  );
}
