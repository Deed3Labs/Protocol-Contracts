import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Wallet, Banknote, PiggyBank, Landmark } from 'lucide-react';
import './index.css';
import MetricRow from '@/components/app-ui/accounts/MetricRow';
import PathToOwnership from '@/components/app-ui/accounts/PathToOwnership';
import EquitySources from '@/components/app-ui/accounts/EquitySources';
import type { PaySummary } from '@/utils/apiClient';

/**
 * Design preview harness — /design-preview.html
 *
 * Renders the redesigned Accounts regions with SAMPLE data, outside the Privy/AppKit provider
 * stack, so the layout can be reviewed without authenticating as a real member. This is a
 * design tool, not a route in the product: it is a separate Vite entry, is not linked from the
 * app, and nothing in src/ imports it.
 *
 * The components rendered here are the REAL ones used by AccountsPage — only the data is faked.
 */

const SAMPLE: PaySummary = {
  dueThisMonth: 1600,
  paid30: 1600,
  totalEquity: 18_420,
  vestedEquity: 15_260,
  pendingEquity: 3_160,
  equityThisMonth: 1_800,
  streak: 14,
  sources: { rent: 13_400, match: 3_820, bills: 1_200 },
  series: [
    { label: 'Aug', rent: 1600, equity: 1600 },
    { label: 'Sep', rent: 1600, equity: 1600 },
    { label: 'Oct', rent: 1600, equity: 1750 },
    { label: 'Nov', rent: 1600, equity: 1600 },
    { label: 'Dec', rent: 1600, equity: 2100 },
    { label: 'Jan', rent: 1600, equity: 1600 },
    { label: 'Feb', rent: 1600, equity: 1900 },
    { label: 'Mar', rent: 1600, equity: 1600 },
    { label: 'Apr', rent: 1600, equity: 2270 },
    { label: 'May', rent: 1600, equity: 1600 },
    { label: 'Jun', rent: 1600, equity: 1800 },
    { label: 'Jul', rent: 1600, equity: 1800 },
  ],
};

type Skin = 'light' | 'dusk' | 'dark';

function Harness() {
  const [skin, setSkin] = useState<Skin>('light');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'dusk');
    if (skin === 'dark') root.classList.add('dark');
    if (skin === 'dusk') root.classList.add('dusk');
  }, [skin]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1180px] px-6 pb-24 sm:px-10">
        {/* harness chrome — not part of the design */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4">
          <div>
            <div className="text-sm font-semibold">Accounts — design preview</div>
            <div className="text-xs text-muted-foreground">
              Real components, sample data. Not a product route.
            </div>
          </div>
          <div className="flex gap-1">
            {(['light', 'dusk', 'dark'] as Skin[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSkin(s)}
                aria-pressed={s === skin}
                className={
                  'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ' +
                  (s === skin
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <MetricRow
          metrics={[
            { label: 'Total balance', value: 8500.75, icon: Wallet, change: '2.4% this week', changePositive: true },
            { label: 'Cash · USDC', value: 2410.55, icon: Banknote, change: '0.8% this week', changePositive: true },
            { label: 'Savings · CLRUSD', value: 4210.0, icon: PiggyBank, change: '1.1% this week', changePositive: true },
            { label: 'External · Plaid', value: 1880.2, icon: Landmark, change: '0.4% this week', changePositive: false },
          ]}
        />

        <PathToOwnership summary={SAMPLE} className="border-b border-border" />

        <div className="grid border-b border-border lg:grid-cols-3">
          <div className="flex items-center justify-center border-border py-16 text-sm text-muted-foreground lg:col-span-2 lg:border-r lg:pr-6">
            Balance chart (unchanged component)
          </div>
          <EquitySources summary={SAMPLE} className="border-t border-border lg:border-t-0 lg:pl-6" />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
