import Modal from './Modal';
import { Btn, Line, Rows } from './brand/anatomy';
import { TIER_TEXT_CLASS } from './ClearCreditCard';
import { money } from '@clear/domain';
import { backingTotal, sectionTotal, type LimitBacking, type LimitBackingRow } from '@/lib/clearModel';

function Section({
  title,
  rows,
  onAdd,
}: {
  title: string;
  rows: LimitBackingRow[];
  onAdd?: (row: LimitBackingRow) => void;
}) {
  return (
    <>
      <p className="c-grouplabel">
        {title} &middot; {money(sectionTotal(rows), { cents: true })}
      </p>
      <Rows>
        {rows.map((row) => (
          <div key={row.label}>
            {/* An opt-in tier isn't a figure yet — it's an offer, so it gets the action. */}
            {row.notAdded ? (
              <Line className="items-center!">
                <span className="c-muted">{row.label}</span>
                <Btn className="h-[30px]! px-3! text-detail!" onClick={() => onAdd?.(row)}>
                  Add {money(row.addAmount ?? row.contribution, { cents: true })}
                </Btn>
              </Line>
            ) : (
              <Line>
                <span className={TIER_TEXT_CLASS[row.tier]}>{row.label}</span>
                <span className="c-fig c-fig-row">{money(row.contribution, { cents: true })}</span>
              </Line>
            )}
            <p className="c-det mt-[3px]">{row.detail}</p>
          </div>
        ))}
      </Rows>
    </>
  );
}

/**
 * "What backs your limit" — behind Limit breakdown on the Credit cell.
 *
 * Keeps its secured and unsecured grouping as two stacked mains, so the group break is a full-bleed
 * rule rather than a floating label. Boost sits in the unsecured group as the one row you can act on,
 * rather than being listed as a tier you already have. The footer is the total, which is the same
 * figure as the Credit cell's limit because it is that figure.
 */
export default function LimitBreakdown({
  backing,
  open,
  onOpenChange,
  onAdd,
}: {
  backing: LimitBacking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: (row: LimitBackingRow) => void;
}) {
  const sections = [
    backing.assetBacked.length > 0 && <Section key="s" title="Secured" rows={backing.assetBacked} onAdd={onAdd} />,
    backing.unsecured.length > 0 && <Section key="u" title="Unsecured" rows={backing.unsecured} onAdd={onAdd} />,
  ].filter(Boolean);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="What backs your limit"
      description="The positions and income that set your Clear credit limit."
      sections={sections}
      footer={
        <>
          <Line>
            <span className="c-sub">Total limit</span>
            <span className="c-fig c-fig-sec">{money(backingTotal(backing), { cents: true })}</span>
          </Line>
          <p className="c-det mt-s1">Your bonds are worth more each month, so this limit grows on its own.</p>
        </>
      }
    />
  );
}
