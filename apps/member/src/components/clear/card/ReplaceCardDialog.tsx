import Modal from '../Modal';
import { Rows } from '../brand/anatomy';
import { TwoLineRow } from '@/components/settings/SettingsKit';

export type ReplaceReason = 'lost' | 'stolen' | 'damaged';

const REASONS: { id: ReplaceReason; title: string; detail: string }[] = [
  { id: 'lost', title: 'Lost it', detail: 'New number, new card posted. The old one stops working now.' },
  { id: 'stolen', title: 'It was stolen', detail: 'Same as lost, and recent charges are flagged for review.' },
  { id: 'damaged', title: 'It is damaged', detail: 'Same number, new plastic. Keep using the virtual card meanwhile.' },
];

/**
 * Replace this card — the one thing a member needs at the worst possible moment, so it leads with
 * the three real situations rather than a form.
 */
export default function ReplaceCardDialog({
  open,
  onOpenChange,
  onReplace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace?: (reason: ReplaceReason) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Replace this card"
      description="Choose what happened to your card."
      footer={
        <div className="c-footnote mt-0! border-t-0! pt-0!">
          <p>Your virtual card keeps working either way, so nothing on file stops.</p>
        </div>
      }
    >
      <Rows>
        {REASONS.map((reason) => (
          <div key={reason.id}>
            <TwoLineRow title={reason.title} detail={reason.detail} onSelect={() => onReplace?.(reason.id)} />
          </div>
        ))}
      </Rows>
    </Modal>
  );
}
