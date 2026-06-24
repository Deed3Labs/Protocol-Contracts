import { cn } from '@/lib/utils';

/** A debit-card visual widget (monochrome, on-brand). */
export default function CardVisual({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-3xl border border-border bg-card p-5', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">Your card</h3>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">Debit</span>
      </div>
      <div className="aspect-[1.6/1] w-full rounded-2xl bg-foreground p-5 text-background">
        <div className="flex items-start justify-between">
          <span className="text-sm font-medium">Clear</span>
          <span className="flex gap-1">
            <span className="h-5 w-5 rounded-full bg-background/30" />
            <span className="-ml-2.5 h-5 w-5 rounded-full bg-background/60" />
          </span>
        </div>
        <div className="mt-6 font-display text-lg tracking-[0.15em] tabular-nums">5231 7252 1769 8152</div>
        <div className="mt-4 flex items-end justify-between text-xs">
          <div>
            <div className="opacity-60">Card holder</div>
            <div className="font-medium">Steven Spark</div>
          </div>
          <div className="text-right">
            <div className="opacity-60">Expires</div>
            <div className="font-medium tabular-nums">08/29</div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className="flex-1 rounded-xl border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
          Freeze
        </button>
        <button type="button" className="flex-1 rounded-xl border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
          Details
        </button>
      </div>
    </div>
  );
}
