import type { ReactNode } from 'react';
import { cx } from '@/brand/ui';

/**
 * The reference's "Raised today" component: one figure, one bar of its parts, and the key as a
 * thin footer. Charges counts money with it; Inventory counts items.
 */
export interface SaPart {
  key: string;
  /** The bar's and swatch's class: ok, wait, exp, low, out, card, cash… */
  tone: string;
  label: string;
  value: ReactNode;
  /** "· 3" */
  count?: ReactNode;
  /** Its share of the bar. Zero draws no segment. */
  grow: number;
  off?: boolean;
}

export function SaPanel({
  label,
  det,
  figure,
  unit,
  parts,
  className,
}: {
  label: string;
  det?: ReactNode;
  figure: ReactNode;
  unit?: string;
  parts: SaPart[];
  className?: string;
}) {
  return (
    <div className={cx('c-panel c-sa', className)}>
      <div className="c-sa-top">
        <div className="c-sa-head">
          <p className="c-label">{label}</p>
          {det !== undefined && <p className="c-det">{det}</p>}
        </div>
        <p className="c-f">
          {figure}
          {unit && (
            <>
              {' '}
              <span className="c-u">{unit}</span>
            </>
          )}
        </p>
        <div className="c-sa-bar" role="img" aria-label={parts.map((p) => `${p.label} ${typeof p.value === 'string' || typeof p.value === 'number' ? p.value : ''}`).join(', ')}>
          {parts
            .filter((p) => p.grow > 0)
            .map((p) => (
              <i key={p.key} className={`c-${p.tone}`} style={{ flexGrow: p.grow }} />
            ))}
        </div>
      </div>
      <div className="c-sa-key">
        {parts.map((p) => (
          <div key={p.key} className={p.off ? 'c-off' : ''}>
            <span className={`c-sw c-${p.tone}`} />
            <span className="c-k">{p.label}</span>
            <span className="c-v">{p.value}</span>
            <span className="c-c">{p.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
