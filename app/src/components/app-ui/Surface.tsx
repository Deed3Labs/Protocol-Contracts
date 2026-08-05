import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The flat page system.
 *
 * Every app page is one continuous canvas: no card wrappers around content groups, regions
 * separated by 1px hairlines and the 8/16/24 spacing scale, and the same hairline recurring
 * inside the data displays. These primitives exist so each page doesn't re-derive the bleed
 * maths and the region anatomy by hand.
 *
 *   <Page>
 *     <MetricRow … />
 *     <Row cols={3}>
 *       <Region label="Upcoming">…</Region>
 *       …
 *     </Row>
 *   </Page>
 */

/**
 * Page canvas. Bleeds out of AppShell's horizontal padding (and its top padding) so every
 * hairline runs edge to edge to the sidebar and the right edge; each Region re-applies the
 * padding to its own content.
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('animate-fade-in -mx-5 -mt-6 lg:-mx-8', className)}>{children}</div>
  );
}

/**
 * A horizontal band closed by a bottom hairline. Children become equal columns from `lg`,
 * divided by vertical hairlines, and stack with horizontal rules below that.
 *
 * Column rules are applied here rather than by each child so a page can't drift out of the
 * system by forgetting a border on one panel.
 */
export function Row({
  cols = 1,
  children,
  className,
  divided = true,
}: {
  /** Columns from the `lg` breakpoint. Below that, children stack. */
  cols?: 1 | 2 | 3 | 4;
  children: ReactNode;
  className?: string;
  /** Set false to omit the closing bottom rule (for the last row on a page). */
  divided?: boolean;
}) {
  const colClass =
    cols === 4
      ? 'lg:grid-cols-4'
      : cols === 3
        ? 'lg:grid-cols-3'
        : cols === 2
          ? 'lg:grid-cols-2'
          : '';

  return (
    <div className={cn('grid', divided && 'border-b border-border', colClass, className)}>
      {children}
    </div>
  );
}

/**
 * A content region: uppercase label, an optional control on the right, then the content.
 * Carries the page padding and, when it isn't the first column, the dividing rules.
 */
export function Region({
  label,
  action,
  children,
  className,
  /** Column position within a Row — drives which hairlines this region draws. */
  first = false,
  span,
}: {
  label?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  first?: boolean;
  span?: 2 | 3;
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col px-5 py-6 lg:px-8',
        // stacked on mobile: a rule above every region but the first
        !first && 'border-t border-border lg:border-t-0',
        // side by side from lg: a rule to the left of every region but the first
        !first && 'lg:border-l lg:border-border',
        span === 2 && 'lg:col-span-2',
        span === 3 && 'lg:col-span-3',
        className,
      )}
    >
      {(label || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {label ? (
            <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {label}
            </span>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A headline figure. 28px is the ceiling for any number in the app — nothing renders larger,
 * and everything at this altitude renders identically.
 */
export function Figure({
  children,
  className,
  muted,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        'text-2xl font-light leading-none tracking-tight tabular-nums lg:text-[1.75rem]',
        muted ? 'text-muted-foreground/40' : 'text-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A row in an edge-to-edge list: label left, value right, hairline beneath. */
export function ListRow({
  label,
  hint,
  value,
  sub,
  onClick,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {(value || sub) && (
        <span className="shrink-0 text-right">
          {value && <span className="block text-sm tabular-nums text-foreground">{value}</span>}
          {sub && <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>}
        </span>
      )}
    </>
  );

  const base = 'flex w-full items-baseline justify-between gap-4 border-b border-border py-3 last:border-b-0';

  return onClick ? (
    <button type="button" onClick={onClick} className={cn(base, 'text-left hover:bg-foreground/[0.03]', className)}>
      {body}
    </button>
  ) : (
    <div className={cn(base, className)}>{body}</div>
  );
}

/** Empty state sized to hold a region open so a column never collapses. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center border-t border-border py-10 text-center',
        className,
      )}
    >
      {icon}
      <p className={cn('text-sm text-foreground', icon && 'mt-3')}>{title}</p>
      {body && <p className="mt-1 max-w-[28ch] text-xs text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
