import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import BillList from '@/components/app-ui/pay/BillList';
import BillDetailPane from '@/components/app-ui/pay/BillDetailPane';
import BillAddForm from '@/components/app-ui/pay/BillAddForm';
import { usePay } from '@/context/PayContext';
import { cn } from '@/lib/utils';

/*
 * Master–detail workspace for bills.
 *
 * Desktop: list and detail side by side, sharing a fixed height so the two panes always line up —
 * an auto-height list next to a tall detail pane leaves an obvious dead void under the list.
 * Mobile: the same panes, one at a time, with selecting pushing to the detail.
 *
 * Adding a bill happens IN the detail pane rather than a dialog: the pane is empty until you pick
 * something, so it's already the right space, and the list stays visible beside you.
 */
export default function BillWorkspace() {
  const { bills } = usePay();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // A selected bill that's since been deleted shouldn't strand the pane.
  useEffect(() => {
    if (selectedId && !bills.some((b) => b.id === selectedId)) setSelectedId(null);
  }, [bills, selectedId]);

  const selected = useMemo(() => bills.find((b) => b.id === selectedId) ?? null, [bills, selectedId]);
  // On mobile only one pane shows at a time; on desktop both always do.
  const paneOpen = adding || !!selected;

  const startAdd = () => {
    setSelectedId(null);
    setAdding(true);
  };

  return (
    <>
      <div className="grid gap-3 lg:h-[460px] lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)]">
        <div className={cn('min-h-0', paneOpen && 'hidden lg:block')}>
          <BillList
            bills={bills}
            selectedId={selectedId}
            onSelect={(id) => {
              setAdding(false);
              setSelectedId(id);
            }}
            onAdd={startAdd}
          />
        </div>

        <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card', !paneOpen && 'hidden lg:flex')}>
          {paneOpen && (
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setAdding(false);
              }}
              className="inline-flex shrink-0 items-center gap-1 px-4 pt-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:hidden"
            >
              <ChevronLeft className="h-4 w-4" /> All bills
            </button>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {adding ? (
              <BillAddForm
                onDone={(createdId) => {
                  setAdding(false);
                  if (createdId) setSelectedId(createdId);
                }}
              />
            ) : (
              <BillDetailPane bill={selected} bills={bills} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
