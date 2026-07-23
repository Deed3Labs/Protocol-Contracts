import { useMemo, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import BillTable from '@/components/app-ui/pay/BillTable';
import BillDetailPane from '@/components/app-ui/pay/BillDetailPane';
import BillAddForm from '@/components/app-ui/pay/BillAddForm';
import { usePay } from '@/context/PayContext';

/*
 * The bill schedule (a full-width table) plus its detail drawer. Selecting a row — or adding a bill —
 * opens the responsive sheet: a right-side drawer on desktop, a bottom sheet on mobile. This replaces
 * the side-by-side master/detail so the bills get the full page width to read as a table.
 */
export default function BillManager() {
  const { bills } = usePay();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selected = useMemo(() => bills.find((b) => b.id === selectedId) ?? null, [bills, selectedId]);
  const open = adding || !!selected;

  const close = () => {
    setSelectedId(null);
    setAdding(false);
  };

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

      <Sheet open={open} onOpenChange={(o) => !o && close()}>
        <SheetContent onDismiss={close} aria-label={adding ? 'Add a bill' : (selected?.name ?? 'Bill')} className="p-0">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {adding ? (
              <BillAddForm
                onDone={(createdId) => {
                  setAdding(false);
                  if (createdId) setSelectedId(createdId);
                }}
              />
            ) : selected ? (
              <BillDetailPane bill={selected} bills={bills} onClose={close} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
