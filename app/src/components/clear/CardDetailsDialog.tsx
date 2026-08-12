import Modal from './Modal';
import type { CardData } from '@/lib/clearModel';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b-[0.5px] border-border py-2 last:border-b-0">
      <span className="text-foreground-secondary">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Card details — the sub-view behind the Details action (spec §9).
 *
 * The number stays masked. Revealing a full PAN needs a call to the issuer and a
 * re-authentication step; until card issuing is live there is nothing real to
 * reveal, and rendering a plausible-looking full number would invite someone to
 * try paying with it.
 */
export default function CardDetailsDialog({
  card,
  open,
  onOpenChange,
}: {
  card: CardData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Card details"
      description="Details for your Clear card. The full number stays hidden."
      onBack={() => onOpenChange(false)}
    >
      <div className="text-xs">
          <Row label="Card number" value={`•••• •••• •••• ${card.last4}`} />
          <Row label="Cardholder" value={card.cardholder} />
          <Row label="Expires" value={card.expiry} />
          <Row label="Network" value={card.network} />
          <Row label="Status" value={card.frozen ? 'Frozen' : 'Active'} />
        </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Spends your cash first, then your credit line. No transfers needed.
      </p>
    </Modal>
  );
}
