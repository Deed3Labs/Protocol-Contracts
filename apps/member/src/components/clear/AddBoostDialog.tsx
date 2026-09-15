import Modal from './Modal';
import BigAmount from './brand/BigAmount';
import { Btn } from './brand/anatomy';
import { money } from '@clear/domain';
import { creditLimit, type Credit, type CreditTier } from '@/lib/clearModel';

/**
 * Add Clear Boost™ — the opt-in tier, behind Add Boost on the Credit cell.
 *
 * Main is the amount and why Boost costs what it does. The footer is what adding it does: the rate,
 * the limit after, where it sits in the clearing order, and the addition itself — so the cost is
 * legible before anyone commits. The carry rate is the one cobalt line: it is the thing to read.
 */
export default function AddBoostDialog({
  credit,
  tier,
  open,
  onOpenChange,
  onAdd,
}: {
  credit: Credit;
  tier: CreditTier;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: () => void;
}) {
  const limitToday = creditLimit(credit);
  const rate = tier.ratePerCycle !== undefined ? `${+(tier.ratePerCycle * 100).toFixed(2)}%` : tier.rate.replace(' / cycle', '');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${tier.label}`}
      description="Review what Clear Boost adds to your limit and what it costs before adding it."
      footer={
        <>
          <div className="c-conseq">
            <div className="c-earn">
              <span>Carry rate</span>
              <span>{rate} a cycle on what you use</span>
            </div>
            <div>
              <span>Limit after</span>
              <span>{money(limitToday + tier.limit, { cents: true })}</span>
            </div>
            <div>
              <span>Clears</span>
              <span>Last, after every cheaper tier</span>
            </div>
            <div className="c-limit">
              <span>Adds to your credit limit</span>
              <span>+{money(tier.limit, { cents: true })}</span>
            </div>
          </div>
          <Btn primary lg className="mt-s2" onClick={onAdd}>
            Add Clear Boost
          </Btn>
          <p className="c-det mt-s1 text-center">You can remove it any time you are not carrying it.</p>
        </>
      }
    >
      <p className="c-label">How much</p>
      <BigAmount amount={tier.limit} />
      <p className="c-det mt-s2">
        Boost is unsecured credit. Nothing backs it but your record, which is why it costs the most.
      </p>
    </Modal>
  );
}
