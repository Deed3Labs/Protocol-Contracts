import { useMemo, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import BillTable from '@/components/app-ui/pay/BillTable';
import BillAddForm from '@/components/app-ui/pay/BillAddForm';
import BillDetailModal from '@/components/app-ui/BillDetailModal';
import { usePay } from '@/context/PayContext';

/*
 * The bill schedule (a page-level table) plus its detail drawer.
 *
 * Detail reuses BillDetailModal — the rich drawer we already built for bills/transactions (tabs,
 * collapsible sections, receipt, grouped history) — so the sheet actually fills its space rather than
 * a thin custom pane. Adding a bill opens the compact form in the responsive Sheet.
 */
export default function BillManager() {
  const { bills } = usePay();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selected = useMemo(() => bills.find((b) => b.id === selectedId) ?? null, [bills, selectedId]);

  return (
    <>
      <BillTable
        bills={bills}
        onSelect={(id) => {
          setAdding(false);
          setSelectedId(id);
        }}
        onAdd={() => {
          setSelectedId(null);
          setAdding(true);
        }}
      />

      <BillDetailModal bill={selected} onClose={() => setSelectedId(null)} />

      <Sheet open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <SheetContent onDismiss={() => setAdding(false)} aria-label="Add a bill" className="p-0">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <BillAddForm
              onDone={(createdId) => {
                setAdding(false);
                if (createdId) setSelectedId(createdId);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
