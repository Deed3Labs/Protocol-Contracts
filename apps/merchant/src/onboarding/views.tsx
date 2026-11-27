import type { ReactNode } from 'react';
import { IconUpload } from '@/brand/chargeIcons';
import { ClearMark, IconChevron } from '@/brand/icons';
import { cx, clickOnKey } from '@/brand/ui';

/**
 * Onboarding's pieces — docs/merchant-reference/clear-merchant-onboarding.html: the frame every
 * step shares (the step list with done steps marked, the step with its number and title, Back and
 * Continue at the foot, and Save and finish later always there), and the parts steps are made of.
 */

export const STEPS = ['Start', 'Your shop', 'Your team', 'Your terms', 'Verify', 'Where payouts go', 'The counter'];

const press = (fn?: () => void) =>
  fn
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: fn,
        onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fn()),
      }
    : {};

const Lockup = ({ sm }: { sm?: boolean }) => (
  <span className={cx('c-lockup', sm && 'c-sm')}>
    <ClearMark />
    <span className="c-wm">Clear</span>
  </span>
);

/** The tablet frame: the header, the step list, and the step. */
export function Frame({ shop, step, onSave, children }: { shop: string; step: number; onSave: () => void; children: ReactNode }) {
  return (
    <>
      <div className="c-ob-top">
        <span className="c-mc-who">
          <Lockup />
          <span className="c-mc-for">Setting up {shop || 'your shop'}</span>
        </span>
        <span className="c-ob-save" {...press(onSave)}>
          Save and finish later
        </span>
      </div>
      <div className="c-ob-grid">
        <ol className="c-ob-rail">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'c-done' : i === step ? 'c-on' : ''}>
              <span className="c-ob-n">{i < step ? '' : i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="c-ob-pane">{children}</div>
      </div>
    </>
  );
}

/** The phone: the step list becomes a line and a bar at the top. */
export function PhoneFrame({ step, onSave, children }: { step: number; onSave: () => void; children: ReactNode }) {
  return (
    <>
      <div className="c-ob-phtop">
        <Lockup sm />
        <span className="c-ob-save" {...press(onSave)}>
          Later
        </span>
      </div>
      <p className="c-label">
        Step {step + 1} of {STEPS.length} · {STEPS[step]}
      </p>
      <div className="c-ob-phprog">
        <i style={{ width: `${Math.floor(((step + 1) / STEPS.length) * 100)}%` }} />
      </div>
      {children}
    </>
  );
}

export function StepHead({ step, title, sub, phone }: { step: number; title: string; sub: string; phone: boolean }) {
  return phone ? (
    <p className="c-ob-title" style={{ fontSize: 20 }}>
      {title}
    </p>
  ) : (
    <>
      <p className="c-label">
        Step {step + 1} of {STEPS.length}
      </p>
      <p className="c-ob-title">{title}</p>
      <p className="c-det c-ob-sub">{sub}</p>
    </>
  );
}

/** Back and Continue: at the foot of the pane, or of the phone. */
export function Foot({
  phone,
  back,
  primary,
  onPrimary,
  disabled,
  skip,
}: {
  phone: boolean;
  back?: () => void;
  primary: string;
  onPrimary: () => void;
  disabled?: boolean;
  skip?: () => void;
}) {
  const p = (
    <button type="button" className="c-btn c-btn-primary" onClick={onPrimary} disabled={disabled}>
      {primary}
    </button>
  );
  if (phone)
    return (
      <div className="c-ob-phfoot">
        {back && (
          <button type="button" className="c-btn" onClick={back}>
            Back
          </button>
        )}
        {p}
      </div>
    );
  return (
    <div className="c-ob-foot">
      {back ? (
        <button type="button" className="c-btn" onClick={back}>
          Back
        </button>
      ) : (
        <span />
      )}
      <span className="c-ob-foot-r">
        {skip && (
          <span className="c-ob-link" {...press(skip)}>
            Skip for now
          </span>
        )}
        {p}
      </span>
    </div>
  );
}

export function Field({ label, value, onChange, hint, placeholder, inputMode }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string; inputMode?: 'numeric' | 'email' | 'tel' }) {
  return (
    <div className="c-ob-f ">
      <p className="c-label">{label}</p>
      <input className="c-field c-ob-in" aria-label={label} value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="c-det c-ob-hint">{hint}</p>}
    </div>
  );
}

export function Chips({ label, options, value, onPick, hint }: { label: string; options: string[]; value: string; onPick: (v: string) => void; hint?: string }) {
  return (
    <div className="c-ob-f">
      <p className="c-label">{label}</p>
      <div className="c-st-chips">
        {options.map((o) => (
          <button key={o} type="button" className={cx('c-btn', o === value && 'c-on')} aria-pressed={o === value} onClick={() => onPick(o)}>
            {o}
          </button>
        ))}
      </div>
      {hint && <p className="c-det c-ob-hint">{hint}</p>}
    </div>
  );
}

export function ObCell({ label, right, children, foot }: { label: string; right?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="c-slab c-one c-ob-cell ">
      <div className="c-cell c-full">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">{label}</p>
            {right}
          </div>
        </div>
        <div className="c-cmain">{children}</div>
        {foot && <div className="c-cfoot">{foot}</div>}
      </div>
    </div>
  );
}

export const Chip = ({ tone, children }: { tone: 'settled' | 'underway' | 'absent' | 'neutral'; children: ReactNode }) => (
  <span className={cx('c-chip', `c-${tone}`)}>
    {tone !== 'neutral' && <span className="c-core" />}
    {children}
  </span>
);

export const Kvs = ({ rows }: { rows: [string, string][] }) => (
  <div className="c-rows">
    {rows.map(([k, v]) => (
      <div key={k}>
        <div className="c-kv">
          <span>{k}</span>
          <span className="c-v c-ink">{v}</span>
        </div>
      </div>
    ))}
  </div>
);

export function Tick({ on, onChange, label }: { on: boolean; onChange?: (on: boolean) => void; label: string }) {
  return (
    <span
      className={cx('c-ob-tick', on && 'c-on')}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      onKeyDown={clickOnKey}
      onClick={() => onChange?.(!on)}
    />
  );
}

export function Drop({ label, onPick }: { label: string; onPick?: () => void }) {
  return (
    <div className="c-ob-drop" {...press(onPick)}>
      <IconUpload />
      <span>{label}</span>
    </div>
  );
}

// ---- After onboarding: set up the till ------------------------------------------------------------

/** Home's checklist for everything signup left out on purpose. */
export function TillCell<T extends { key: string; t: string; det: string; done?: boolean }>({
  items,
  onOpen,
  onHide,
}: {
  items: T[];
  onOpen?: (item: T) => void;
  onHide?: () => void;
}) {
  const done = items.filter((i) => i.done).length;
  return (
    <div className="c-slab c-one c-ob-cell">
      <div className="c-cell c-full">
        <div className="c-chead">
          <div className="c-sechead">
            <p className="c-label">Set up the till</p>
            <span className="c-det">
              {done} of {items.length}
            </span>
          </div>
        </div>
        <div className="c-cmain">
          <div className="c-ob-prog">
            <i style={{ width: `${Math.floor((done / items.length) * 100)}%` }} />
          </div>
          {items.map((i) => (
            <div key={i.key} className={cx('c-ob-cl', i.done && 'c-done')} {...press(onOpen ? () => onOpen(i) : undefined)}>
              <span className={cx('c-ob-tick', i.done && 'c-on')} />
              <div>
                <p className="c-t">{i.t}</p>
                <p className="c-det">{i.det}</p>
              </div>
              <IconChevron />
            </div>
          ))}
        </div>
        <div className="c-cfoot">
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">Clear works without any of these. Each one adds a way to sell.</p>
            <span className="c-ob-link" {...press(onHide)}>
              Hide for now
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
