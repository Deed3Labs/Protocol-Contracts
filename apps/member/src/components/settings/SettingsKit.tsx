import type { ReactNode } from 'react';
import { Btn, CFoot, CHead, CMain, Cell, Line, SecHead } from '@/components/clear/brand/anatomy';
import { ChevronIcon, TickIcon } from '@/components/clear/brand/icons';
import { cn } from '@/lib/utils';

/*
 * The Settings vocabulary, on the anatomy. A pane is a component like anything in a slab — header,
 * main, footer — so every pane here is one of these rather than a tinted box with a heading.
 */

/** The 14px chevron the reference puts beside a value. */
export function RowChevron() {
  return <ChevronIcon size={14} strokeWidth={2} className="shrink-0 text-ink-50" />;
}

/** A pane: one cell in a one-column slab. Label and aside make the header; foot is the footer. */
export function Pane({
  label,
  aside,
  foot,
  children,
  className,
}: {
  label?: string;
  aside?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('c-slab c-one', className)}>
      <Cell>
        {label && (
          <CHead>
            <SecHead label={label}>{aside}</SecHead>
          </CHead>
        )}
        {children}
        {foot && <CFoot>{foot}</CFoot>}
      </Cell>
    </div>
  );
}

/** A footer that is only a sentence. */
export function FootNote({ children }: { children: ReactNode }) {
  return <p className="c-det">{children}</p>;
}

export { CMain as PaneMain };

/**
 * Label and value — the `.kv` row. The value is the point: most visits are checking what something
 * is set to. A chevron only when the row opens something.
 */
export function KvRow({ label, value, onSelect }: { label: ReactNode; value?: ReactNode; onSelect?: () => void }) {
  const inner = (
    <>
      <span className="min-w-0 truncate">{label}</span>
      {(value !== undefined || onSelect) && (
        <span className="c-v">
          {value}
          {onSelect && <RowChevron />}
        </span>
      )}
    </>
  );
  return onSelect ? (
    <button type="button" onClick={onSelect} className="c-kv w-full text-left">
      {inner}
    </button>
  ) : (
    <div className="c-kv">{inner}</div>
  );
}

/** Title over a detail line, with whatever acts on it at the right. */
export function TwoLineRow({
  title,
  detail,
  trailing,
  onSelect,
}: {
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onSelect?: () => void;
}) {
  const inner = (
    <>
      <div className="min-w-0">
        <p className="text-sec">{title}</p>
        {detail && <p className="c-det mt-[3px]">{detail}</p>}
      </div>
      {trailing ?? (onSelect && <RowChevron />)}
    </>
  );
  return onSelect ? (
    <button type="button" onClick={onSelect} className="c-line w-full items-center! text-left">
      {inner}
    </button>
  ) : (
    <Line className="items-center!">{inner}</Line>
  );
}

/** The reference's row button: 30px, detail-sized. */
export function RowBtn({ className, ...props }: Parameters<typeof Btn>[0]) {
  return <Btn className={cn('h-[30px]! px-[12px]! text-detail!', className)} {...props} />;
}

/** Settled green with a tick, for a status that is done. */
export function Done({ children }: { children: ReactNode }) {
  return (
    <span className="c-pos inline-flex items-center gap-[5px]">
      <TickIcon size={12} className="text-settled" />
      {children}
    </span>
  );
}
