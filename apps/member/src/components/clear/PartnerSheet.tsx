import Modal from './Modal';
import { Btn, Chip, Line, Rows } from './brand/anatomy';
import { KvRow } from '@/components/settings/SettingsKit';
import { money } from '@clear/domain';
import { PARTNER_SPLIT_CYCLES, type Partner } from '@/lib/clearModel';

/** "2, 4 or 12" */
const cycles = (list: number[]) =>
  list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : String(list[0] ?? '');

/**
 * A partner, from the directory or the Send page. It answers what a member wants to know at a
 * counter — can I pay from my balance, can I split it, and how much can I split here — rather than
 * being a business card. The split lines only appear where the partner offers Credit.
 */
export default function PartnerSheet({
  partner,
  open,
  onOpenChange,
  onPay,
}: {
  partner: Partner;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPay?: () => void;
}) {
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${partner.name}, ${partner.city}`)}`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Partner"
      description={`${partner.name}, ${partner.category} in ${partner.city}`}
      footer={
        <div className="c-pair">
          <Btn primary onClick={onPay}>
            Pay
          </Btn>
          <a href={directions} target="_blank" rel="noreferrer" className="c-btn">
            Directions
          </a>
        </div>
      }
    >
      <Line className="items-center!">
        <span className="flex min-w-0 items-center gap-[12px]">
          <span aria-hidden className="c-avatarbtn h-[44px]! w-[44px]! cursor-default text-sec!">
            {partner.initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-body font-semibold">{partner.name}</span>
            <span className="c-det mt-[2px] block truncate">
              {partner.category} &middot; {partner.city}
            </span>
          </span>
        </span>
        {partner.credit && <Chip tone="neutral">Credit</Chip>}
      </Line>
      <Rows className="mt-s3">
        <div>
          <KvRow label="Pay from your balance" value="Instant, no fee" />
        </div>
        {partner.credit && (
          <div>
            <KvRow label="Split a purchase" value={`In ${cycles(PARTNER_SPLIT_CYCLES)} cycles`} />
          </div>
        )}
        {partner.credit && partner.splitCap !== undefined && (
          <div>
            <KvRow label="Most you can split here" value={<span className="text-ink">{money(partner.splitCap, { cents: true })} a cycle</span>} />
          </div>
        )}
        {partner.referredBy && (
          <div>
            <KvRow label="Referred by" value={partner.referredBy} />
          </div>
        )}
      </Rows>
    </Modal>
  );
}
