import { useEffect } from 'react';
import { Home, SendHorizontal, ArrowDownLeft, Repeat } from 'lucide-react';
import BillWorkspace from '@/components/app-ui/pay/BillWorkspace';
import { usePay } from '@/context/PayContext';
import { useMoneyActions } from '@/context/MoneyActionsContext';

const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * Pay — a workspace for the member's bills.
 *
 * The page is the bills: an attention band for anything urgent, then a master–detail workspace for
 * managing and paying them. Secondary money actions sit in a slim rail beneath so they're reachable
 * without competing with the bills for attention.
 */
export default function PayPage() {
  const { bills, summary, openPay, reconcile } = usePay();
  const { openSend, openRequest, openAutoSave } = useMoneyActions();

  // Detect on-time recurring payments from Plaid when the Pay page opens (Plaid call kept off other pages).
  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  const dueThisMonth = summary?.dueThisMonth ?? 0;

  return (
    <div className="animate-fade-in space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl tracking-tight text-foreground">Pay</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {bills.length === 0
              ? 'Track your rent and bills — and earn equity for paying on time.'
              : `${bills.length} ${bills.length === 1 ? 'bill' : 'bills'} · ${fmtUsd(dueThisMonth)} due this month`}
          </p>
        </div>
      </header>

      <BillWorkspace />

      {/* Slim rail: reachable, never dominant. */}
      <div className="flex flex-wrap gap-2">
        {[
          { icon: Home, label: 'Pay rent', onClick: () => openPay('rent') },
          { icon: SendHorizontal, label: 'Send', onClick: openSend },
          { icon: ArrowDownLeft, label: 'Request', onClick: openRequest },
          { icon: Repeat, label: 'Auto-save', onClick: openAutoSave },
        ].map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
