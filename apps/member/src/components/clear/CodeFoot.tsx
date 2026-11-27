import { money } from '@clear/domain';

/**
 * The code's split footer: Available and At partners, two facts about the same thing. The same
 * component as Limit and Clears from on Term plans.
 */
export default function CodeFoot({ available, atPartners }: { available: number; atPartners: number }) {
  return (
    <div className="c-foot2" style={{ ['--fp' as string]: '12px' }}>
      <div>
        <p className="c-det">
          <span className="c-muted">Available</span>{' '}
          <span className="text-ink">{money(available, { cents: true })}</span>
        </p>
      </div>
      <div>
        <p className="c-det">
          <span className="c-muted">At partners</span>{' '}
          <span className="text-ink">{money(atPartners, { cents: true })}</span>
        </p>
      </div>
    </div>
  );
}
