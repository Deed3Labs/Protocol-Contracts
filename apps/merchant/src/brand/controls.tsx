import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '@/brand/ui';

/**
 * The reference's shared controls, as components: chips, segmented controls, tick boxes,
 * toggles, the stepper, search, stock dots, method marks and the step strip.
 *
 * The reference drew several of these more than once, per page (three segmented controls, four
 * tick boxes). Where the drawings are the same control at a different size, `kind` picks the
 * drawing so each page still matches its own frames; where they are the same control drawn
 * differently, the decision in DECISIONS.md picks one.
 */

const onEnterOrSpace = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

// ---- Chips ------------------------------------------------------------------------------------

export type ChipTone = 'settled' | 'underway' | 'absent' | 'live' | 'neutral';

/**
 * A state, in mono capitals. `dot` adds the core; `live` makes it pulse, which is only for
 * something actually live — a reader waiting, someone on shift.
 */
export function Chip({ tone, dot, live, children }: { tone: ChipTone; dot?: boolean; live?: boolean; children: ReactNode }) {
  return (
    <span className={cx('c-chip', `c-${tone}`)}>
      {(dot || live) && <span className={cx('c-core', live && 'c-ping')} />}
      {children}
    </span>
  );
}

// ---- Segmented --------------------------------------------------------------------------------

/**
 * A full-height pill of choices. `sheet` is the 44px one sheets use (Settings, onboarding,
 * sign-in); `inline` the 34px one in a page; `mode` the Amount / Items and list / grid switch.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  kind = 'sheet',
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange?: (v: T) => void;
  kind?: 'sheet' | 'inline' | 'wide' | 'mode';
  label: string;
}) {
  const cls = { sheet: 'c-st-seg', inline: 'c-cc-seg', wide: 'c-cc-seg c-wide', mode: 'c-ci-mode' }[kind];
  return (
    <div className={cls} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <b
          key={o.value}
          className={o.value === value ? 'c-on' : undefined}
          role="radio"
          aria-checked={o.value === value}
          tabIndex={0}
          onClick={() => onChange?.(o.value)}
          onKeyDown={onEnterOrSpace(() => onChange?.(o.value))}
        >
          {o.label}
        </b>
      ))}
    </div>
  );
}

// ---- Tick box and toggle ----------------------------------------------------------------------

/**
 * Ticked is a small paper square in a dark box (or a green one, `settled`), never a drawn check.
 * `kind` picks the drawing: `pick` in rows and money lists, `check` in item options, `charge` in
 * a refund's lines, `agree` for accepting terms.
 */
export function TickBox({
  on,
  onChange,
  kind = 'pick',
  settled,
  label,
}: {
  on: boolean;
  onChange?: (on: boolean) => void;
  kind?: 'pick' | 'check' | 'charge' | 'agree';
  settled?: boolean;
  label?: string;
}) {
  const cls = { pick: 'c-pick', check: 'c-iv-check', charge: 'c-ch-check', agree: 'c-ob-tick' }[kind];
  return (
    <span
      className={cx(cls, on && 'c-on')}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      style={settled && on ? { background: 'var(--settled)', borderColor: 'var(--settled)' } : undefined}
      onClick={() => onChange?.(!on)}
      onKeyDown={onEnterOrSpace(() => onChange?.(!on))}
    />
  );
}

/** A pill switch. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange?: (on: boolean) => void; label: string }) {
  return (
    <span
      className={cx('c-tg', on && 'c-on')}
      role="switch"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      onClick={() => onChange?.(!on)}
      onKeyDown={onEnterOrSpace(() => onChange?.(!on))}
    />
  );
}

// ---- Stepper and search -----------------------------------------------------------------------

export function Stepper({
  value,
  onChange,
  min = 0,
  max = Infinity,
}: {
  value: number;
  onChange?: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const icon = (d: string) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
  return (
    <span className="c-iv-stepper">
      <button type="button" aria-label="Less" disabled={value <= min} onClick={() => onChange?.(value - 1)}>
        {icon('M5 12h14')}
      </button>
      <b aria-live="polite">{value}</b>
      <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange?.(value + 1)}>
        {icon('M12 5v14M5 12h14')}
      </button>
    </span>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange?: (v: string) => void; placeholder: string }) {
  return (
    <label className="c-iv-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        style={{ border: 0, background: 'transparent', font: 'inherit', color: 'var(--ink)', outline: 'none', minWidth: 0, flex: 1 }}
      />
    </label>
  );
}

// ---- Stock and method marks -------------------------------------------------------------------

/** "14 in stock", "6 left · 2 held", "Out". A still dot: stock is a state, not something live. */
export function StockDot({ level, children, held }: { level: 'ok' | 'low' | 'out'; children: ReactNode; held?: number }) {
  return (
    <span className={cx('c-iv-st', `c-${level}`)}>
      <i />
      {children}
      {held ? <span className="c-h">{held} held</span> : null}
    </span>
  );
}

export type Method = 'clear' | 'card' | 'cash';

/** How a charge was paid, as the mark at the start of its row. */
export function MethodMark({ method }: { method: Method }) {
  const label = { clear: 'Clear', card: 'Card', cash: 'Cash' }[method];
  return (
    <span className={cx('c-ch-pm', `c-${method}`)} title={label} aria-label={label} role="img">
      {method === 'clear' ? (
        <svg width="15" height="15" viewBox="0 0 336 336" aria-hidden="true">
          <g transform="translate(168 168)" fill="none" stroke="currentColor">
            <path d="M 148.28 -64 A 161.5 161.5 0 1 0 148.28 64 L 74.22 64 A 98 98 0 1 1 74.22 -64 Z" strokeWidth="4" fill="currentColor" />
            <path d="M 0 -8 H 114 V 8 H 0 Z" fill="currentColor" stroke="none" />
            <circle cx="0" cy="0" r="34" fill="currentColor" stroke="none" />
            <circle cx="131.5" cy="0" r="25.25" strokeWidth="15.5" />
          </g>
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {method === 'card' ? (
            <>
              <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
              <path d="M3 10h18M7 15h3" />
            </>
          ) : (
            <>
              <rect x="2.5" y="6" width="19" height="12" rx="1" />
              <circle cx="12" cy="12" r="2.6" />
              <path d="M6 9.5v5M18 9.5v5" />
            </>
          )}
        </svg>
      )}
    </span>
  );
}

// ---- Step strip -------------------------------------------------------------------------------

/** Numbered steps across the top of a flow; `on` is the current one, drawn once per view in cobalt. */
export function StepStrip({ steps, current }: { steps: { t: ReactNode; det?: ReactNode }[]; current: number }) {
  return (
    <div className="c-mc-steps" style={{ ['--n' as string]: steps.length }}>
      {steps.map((s, i) => (
        <div key={i} className={i === current ? 'c-on' : ''} aria-current={i === current ? 'step' : undefined}>
          <p className="c-t">{s.t}</p>
          {s.det && <p className="c-det">{s.det}</p>}
        </div>
      ))}
    </div>
  );
}
