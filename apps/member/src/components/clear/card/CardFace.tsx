import { cn } from '@/lib/utils';

/**
 * The card face — one component, three grounds.
 *
 * Hardware is rounded, software is square: this is a picture of a physical object, so it takes the
 * object's radius. Physical is ink with the chip; virtual has no chip and says Online only on the
 * face itself; frozen is ink 70 and says Frozen. The number stays in mono — a PAN is an identifier,
 * not a figure, and mono is what it is embossed in.
 *
 * The last four sits in the top strip as well as in the number, because a card standing behind the
 * one in front of it still has to say which card it is.
 */
export default function CardFace({
  variant,
  frozen,
  last4,
  cardholder,
  expiry,
  network,
  /** Overrides the bottom-left line: "Virtual · subscriptions", "Kai M · on its way". */
  meta,
  className,
}: {
  variant: 'physical' | 'virtual';
  frozen: boolean;
  last4: string;
  cardholder: string;
  expiry: string;
  network: string;
  meta?: string;
  className?: string;
}) {
  const virtual = variant === 'virtual';
  return (
    <div
      className={cn('c-cardface', frozen ? 'c-frozen' : virtual && 'c-virtual', className)}
      role="img"
      aria-label={`${virtual ? 'Virtual' : 'Physical'} ${network} card${last4 ? ` ending ${last4}` : ''}${frozen ? ', frozen' : ''}`}
    >
      <div className="c-line items-center!">
        <span className="flex items-center">
          <span className="c-wm text-[15px]!">Clear</span>
          {frozen ? (
            <span className="c-cstate ml-s1">Frozen</span>
          ) : (
            virtual && <span className="c-cstate ml-s1">Online only</span>
          )}
        </span>
        <span className="c-ctag">···· {last4 || '••••'}</span>
      </div>
      {!virtual && <span className="c-cchip" aria-hidden />}
      <div>
        <p className="c-pan">•••• •••• •••• {last4 || '••••'}</p>
        <div className="c-line mt-[6px]">
          <span className="c-cmeta">
            {meta ?? (
              <>
                {cardholder}
                {expiry && ` · ${expiry}`}
              </>
            )}
          </span>
          <span className="c-cmeta">{network}</span>
        </div>
      </div>
    </div>
  );
}
