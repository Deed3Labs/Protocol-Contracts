import { ContactlessIcon } from '../brand/icons';
import { cn } from '@/lib/utils';

/**
 * The card face — one component, three grounds.
 *
 * Hardware is rounded, software is square: this is a picture of a physical object, so it takes the
 * object's radius. Physical is ink with the chip; virtual has no chip and says Online only on the
 * face itself; frozen is ink 70 and says Frozen. The number stays in mono — a PAN is an identifier,
 * not a figure, and mono is what it is embossed in.
 */
export default function CardFace({
  variant,
  frozen,
  last4,
  cardholder,
  expiry,
  network,
}: {
  variant: 'physical' | 'virtual';
  frozen: boolean;
  last4: string;
  cardholder: string;
  expiry: string;
  network: string;
}) {
  const virtual = variant === 'virtual';
  return (
    <div
      className={cn('c-cardface', frozen ? 'c-frozen' : virtual && 'c-virtual')}
      role="img"
      aria-label={`${virtual ? 'Virtual' : 'Physical'} ${network} card${last4 ? ` ending ${last4}` : ''}${frozen ? ', frozen' : ''}`}
    >
      <div className="c-line items-center!">
        <span className="c-wm text-[15px]!">Clear</span>
        {frozen ? (
          <span className="c-cstate">Frozen</span>
        ) : virtual ? (
          <span className="c-cstate">Online only</span>
        ) : (
          <ContactlessIcon className="text-ink-28" />
        )}
      </div>
      {!virtual && <span className="c-cchip" aria-hidden />}
      <div>
        <p className="c-pan">•••• •••• •••• {last4 || '••••'}</p>
        <div className="c-line mt-[6px]">
          <span className="c-cmeta">
            {cardholder}
            {expiry && ` · ${expiry}`}
          </span>
          <span className="c-cmeta">{network}</span>
        </div>
      </div>
    </div>
  );
}
