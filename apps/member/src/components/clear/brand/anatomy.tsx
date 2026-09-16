import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

/*
 * The brand guide's component anatomy, as React.
 *
 * Every component is header / control bar / main / footer. Padding lives on the sections and never on
 * the container, so every divider runs edge to edge; main flexes, which pins the footer to the floor
 * and puts slack in the middle. The rules themselves are in styles/clear-components.css, transcribed
 * from the guide — these components only apply them, so a page cannot drift from the anatomy by
 * restyling a section by hand.
 */

// React 19 passes a ref like any other prop, which is how a section can be measured from outside.
type DivProps = HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };

/** A cell on the slab: paper, no border of its own — the seam is the grid's background. */
export function Cell({ full, className, ...props }: DivProps & { full?: boolean }) {
  return <div className={cn('c-cell', full && 'c-full', className)} {...props} />;
}

/**
 * A standalone component with its own border.
 *
 * `act` is the raised variant (paper-2). `tone` is only meaningful with it: `short` takes the cycle's
 * cobalt, `clear` settled green.
 */
export function Panel({
  act,
  tone,
  className,
  ...props
}: DivProps & { act?: boolean; tone?: 'short' | 'clear' }) {
  return (
    <div
      className={cn('c-panel', act && 'c-act', act && tone === 'short' && 'c-short', act && tone === 'clear' && 'c-clear', className)}
      {...props}
    />
  );
}

export function CHead({ className, ...props }: DivProps) {
  return <div className={cn('c-chead', className)} {...props} />;
}
export function CBar({ className, ...props }: DivProps) {
  return <div className={cn('c-cbar', className)} {...props} />;
}
export function CMain({ className, ...props }: DivProps) {
  return <div className={cn('c-cmain', className)} {...props} />;
}
export function CFoot({ className, ...props }: DivProps) {
  return <div className={cn('c-cfoot', className)} {...props} />;
}

/** Section header: a label and one figure on a fixed 24px line that never wraps. */
export function SecHead({ label, children }: { label: ReactNode; children?: ReactNode }) {
  return (
    <div className="c-sechead">
      <p className="c-label">{label}</p>
      {children}
    </div>
  );
}

/** Header figure with an optional "of Y" tail. */
export function HeadFig({ value, of }: { value: string; of?: string }) {
  return (
    <p className="c-fig c-fig-sec">
      {value}
      {of && <span className="c-of"> of {of}</span>}
    </p>
  );
}

export function Line({ className, style, ...props }: DivProps & { style?: CSSProperties }) {
  return <div className={cn('c-line', className)} style={style} {...props} />;
}

export function Rows({ ruled, className, ...props }: DivProps & { ruled?: boolean }) {
  return <div className={cn('c-rows', ruled && 'c-ruled', className)} {...props} />;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  /** Full-width, 44px. */
  lg?: boolean;
};

/** Pill button. Ghost by default; `primary` fills it with ink. */
export function Btn({ primary, lg, className, type = 'button', ...props }: BtnProps) {
  return (
    <button
      type={type}
      className={cn('c-btn', primary && 'c-btn-primary', lg && 'c-btn-lg', className)}
      {...props}
    />
  );
}

export type ChipTone = 'settled' | 'underway' | 'neutral' | 'live';

/**
 * Status chip. `core` adds the glowing dot; `ping` animates it, for the one live thing on a screen.
 * `figs` is for a chip that counts rather than names — its numerals stay together.
 */
export function Chip({
  tone,
  core,
  ping,
  figs,
  children,
}: {
  tone: ChipTone;
  core?: boolean;
  ping?: boolean;
  figs?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cn('c-chip', `c-${tone}`, figs && 'c-figs')}>
      {(core || ping) && <span className={cn('c-core', ping && 'c-ping')} />}
      {children}
    </span>
  );
}

export interface BarSegment {
  /** Share of the bar, 0–100. */
  pct: number;
  color: string;
  label: string;
}

/** The 8px bar. Square, ink-13 track, segments laid left to right. */
export function Bar({
  segments,
  label,
  className,
  style,
}: {
  segments: BarSegment[];
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div role="img" aria-label={label} className={cn('c-bar', className)} style={style}>
      {segments
        .filter((s) => s.pct > 0)
        .map((s) => (
          <div key={s.label} style={{ width: `${Math.min(100, s.pct)}%`, background: s.color }} />
        ))}
    </div>
  );
}

/** A single-value track, filled from the left. */
export function Track({ pct, color, label }: { pct?: number; color?: string; label: string }) {
  return (
    <div role="img" aria-label={label} className="c-track">
      {pct !== undefined && pct > 0 && (
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color }} />
      )}
    </div>
  );
}
