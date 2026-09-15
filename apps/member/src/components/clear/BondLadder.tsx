import { Btn, CFoot, CHead, CMain, Cell, Line, SecHead } from './brand/anatomy';
import { money, signedMoney } from '@clear/domain';
import { useIsDesktop } from '@/lib/useIsDesktop';
import type { BondTerm } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Buy a bond — the ladder, as a table.
 *
 * Four terms is too few to read as a curve, so the discount is visible by subtraction on the row and
 * every row states its own face value. The footer is the note and the button that used to be a
 * sidebar card: a note plus a primary button is a footer by definition, and the table gets the width
 * back.
 */
export default function BondLadder({
  terms,
  ltv,
  onBuy,
}: {
  terms: BondTerm[];
  /** The haircut a bond backs credit at, as a fraction. */
  ltv: number;
  onBuy?: () => void;
}) {
  const desktop = useIsDesktop();
  const cols = desktop ? '74px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 56px' : '46px 1fr 1fr 1fr 42px';

  return (
    <Cell full>
      <CHead>
        <SecHead label="Buy a bond">
          <span className="c-det">Longer terms pay more</span>
        </SecHead>
      </CHead>
      <CMain>
        <div className={cn('c-ladder', !desktop && 'c-sm')}>
          <div className="c-lrow c-lhead" style={{ gridTemplateColumns: cols }}>
            <span>Term</span>
            <span>{desktop ? 'You pay' : 'Pay'}</span>
            <span>{desktop ? 'Discount' : 'Disc'}</span>
            <span>{desktop ? 'You get' : 'Get'}</span>
            <span>Yield</span>
          </div>
          {terms.map((term) => (
            <div key={term.months} className="c-lrow" style={{ gridTemplateColumns: cols }}>
              <span>
                {term.months} {desktop ? 'months' : 'mo'}
              </span>
              <span className="c-muted">{money(term.price, { cents: true })}</span>
              {/* The discount stated outright — the same fact as the yield, in dollars. */}
              <span className="c-pos">{signedMoney(term.face - term.price)}</span>
              <span>{money(term.face, { cents: true })}</span>
              <span className="font-semibold">{term.rate.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </CMain>
      <CFoot>
        <Line className="items-center!">
          <span className="c-det whitespace-normal!">
            Locked until maturity, but backs {Math.round(ltv * 100)}% of its value as credit.
          </span>
          <Btn primary onClick={onBuy}>
            Buy a bond
          </Btn>
        </Line>
      </CFoot>
    </Cell>
  );
}
