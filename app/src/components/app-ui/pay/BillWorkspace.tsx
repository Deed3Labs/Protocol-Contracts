import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import BillAttentionBand from '@/components/app-ui/pay/BillAttentionBand';
import BillList from '@/components/app-ui/pay/BillList';
import BillDetailPane from '@/components/app-ui/pay/BillDetailPane';
import { usePay } from '@/context/PayContext';
import { cn } from '@/lib/utils';

/*
 * Master–detail workspace for bills.
 *
 * Desktop: list and detail side by side. Mobile: the same two panes, but only one is on screen at a
 * time — selecting pushes to the detail, with a back control returning to the list. That's a real
 * push rather than a squeezed two-column layout, which is unusable at phone width.
 *
 * Nothing is selected on load, by design: the detail pane shows a short summary of the month instead
 * of demanding attention the moment the page opens.
 */
export default function BillWorkspace({ onAdd }: { onAdd: () => void }) {
  const { bills, summary } = usePay();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A selected bill that's since been deleted (or a stale optimistic id) shouldn't strand the pane.
  useEffect(() => {
    if (selectedId && !bills.some((b) => b.id === selectedId)) setSelectedId(null);
  }, [bills, selectedId]);

  const selected = useMemo(() => bills.find((b) => b.id === selectedId) ?? null, [bills, selectedId]);

  return (
    <div className="space-y-3">
      <BillAttentionBand bills={bills} streak={summary?.streak ?? 0} onSelect={setSelectedId} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
        {/* Mobile: hidden once a bill is selected. Desktop: always visible. */}
        <div className={cn('min-h-0 lg:block', selected && 'hidden')}>
          <BillList bills={bills} selectedId={selectedId} onSelect={setSelectedId} onAdd={onAdd} />
        </div>

        <div className={cn('min-h-0 rounded-2xl border border-border lg:block', !selected && 'hidden lg:block')}>
          {selected && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-1 rounded-lg px-3 pt-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:hidden"
            >
              <ChevronLeft className="h-4 w-4" /> All bills
            </button>
          )}
          <BillDetailPane bill={selected} bills={bills} />
        </div>
      </div>
    </div>
  );
}
