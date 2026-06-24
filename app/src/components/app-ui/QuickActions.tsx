import { Plus, ArrowUpRight, FileText, ArrowDownToLine, type LucideIcon } from 'lucide-react';

const actions: { icon: LucideIcon; label: string }[] = [
  { icon: Plus, label: 'Add money' },
  { icon: ArrowUpRight, label: 'Send' },
  { icon: FileText, label: 'Pay bill' },
  { icon: ArrowDownToLine, label: 'Withdraw' },
];

/** Dashboard quick-actions grid — no card wrapper; the tiles are the cards. */
export default function QuickActions({ className }: { className?: string }) {
  return (
    <div className={className}>
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">Quick actions</h3>
      <div className="grid grid-cols-2 gap-3">
        {actions.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-secondary/50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-foreground">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="text-sm font-medium text-foreground">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
