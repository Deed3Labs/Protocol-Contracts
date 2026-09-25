import { Sheet, cx } from '@/brand/ui';
import { usd } from '@/home/model';

/**
 * A waiting charge, opened from Home: who, how much, and every step it has passed, with the one
 * that is moving in cobalt. That is what no card terminal can show a writer.
 */

export interface Milestone {
  t: string;
  det: string;
  state: 'done' | 'now' | 'later';
}

export function WaitingSheet({
  name,
  amountCents,
  steps,
  opened,
  onResend,
  onCancel,
  onClose,
  inline,
}: {
  name: string;
  amountCents: number;
  steps: Milestone[];
  opened: boolean;
  onResend?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  return (
    <Sheet
      inline={inline}
      title="Waiting"
      onClose={onClose}
      foot={
        <>
          {opened && (
            <p className="c-det" style={{ marginBottom: 'var(--s2)' }}>
              They have seen it. Most people approve within the hour; if they drive off first, it still works.
            </p>
          )}
          <div className="c-pair">
            <button type="button" className="c-btn" onClick={onResend}>
              Resend
            </button>
            <button type="button" className="c-btn c-btn-danger" onClick={onCancel}>
              Cancel charge
            </button>
          </div>
        </>
      }
    >
      <div className="c-line" style={{ alignItems: 'baseline', marginBottom: 'var(--s3)' }}>
        <span style={{ fontSize: 'var(--t-body)', fontWeight: 500 }}>{name}</span>
        <span className="c-fig c-fig-sec">{usd(amountCents)}</span>
      </div>
      <div className="c-rail">
        {steps.map((s, i) => (
          <div key={s.t} className={cx('c-mstone', `c-${s.state}`, i === steps.length - 1 && 'c-last')}>
            <span className="c-mdot" />
            <div className="c-line">
              <span style={{ fontSize: 'var(--t-sec)' }}>{s.t}</span>
              <span className="c-det" style={s.state === 'now' ? { color: 'var(--live)' } : undefined}>
                {s.det}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
