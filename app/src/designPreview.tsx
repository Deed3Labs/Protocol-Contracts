import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Wallet, Banknote, PiggyBank, Landmark } from 'lucide-react';
import './index.css';
import MetricRow from '@/components/app-ui/accounts/MetricRow';
import PathToOwnership from '@/components/app-ui/accounts/PathToOwnership';
import EquitySources from '@/components/app-ui/accounts/EquitySources';
import UpcomingCalendar from '@/components/app-ui/UpcomingCalendar';
import SpendHeatmap from '@/components/app-ui/SpendHeatmap';
import ExternalAccountsPanel from '@/components/app-ui/accounts/ExternalAccountsPanel';
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

// Matches the real near-empty account that produced "October 2162 / 1634 months".
const SPARSE: PaySummary = {
  dueThisMonth: 0, paid30: 0, totalEquity: 110, vestedEquity: 110, pendingEquity: 0,
  equityThisMonth: 60, streak: 1,
  sources: { rent: 0, match: 110, bills: 0 },
  series: [
    { label: 'Jun', rent: 0, equity: 50 },
    { label: 'Jul', rent: 0, equity: 60 },
  ],
};

const UPCOMING = [
  { id: 'u1', name: 'Rent', amount: 1600, day: 1, direction: 'out' as const },
  { id: 'u2', name: 'Auto-save', amount: 200, day: 5, direction: 'out' as const },
  { id: 'u3', name: 'Renters insurance', amount: 28, day: 5, direction: 'out' as const },
  { id: 'u4', name: 'Payroll', amount: 2400, day: 12, direction: 'in' as const },
  { id: 'u5', name: 'Utilities', amount: 90, day: 19, direction: 'out' as const },
  { id: 'u6', name: 'Phone', amount: 55, day: 19, direction: 'out' as const },
  { id: 'u7', name: 'Internet', amount: 70, day: 19, direction: 'out' as const },
  { id: 'u8', name: 'Gym', amount: 40, day: 19, direction: 'out' as const },
];

const SPEND: Record<number, number> = { 2: 23, 3: 8, 5: 60, 8: 120, 12: 687, 15: 23, 19: 938, 20: 125, 22: 1, 23: 23, 24: 114, 26: 45 };

type Skin = 'light' | 'dusk' | 'dark';

function Harness() {
  const [skin, setSkin] = useState<Skin>('light');
  const [sparse, setSparse] = useState(false);
  const data = sparse ? SPARSE : SAMPLE;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'dusk');
    if (skin === 'dark') root.classList.add('dark');
    if (skin === 'dusk') root.classList.add('dusk');
  }, [skin]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pb-24">
        {/* harness chrome — not part of the design */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4 lg:px-8">
          <div>
            <div className="text-sm font-semibold">Accounts — design preview</div>
            <div className="text-xs text-muted-foreground">
              Real components, sample data. Not a product route.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSparse((v) => !v)}
              className="border border-border px-3 py-1.5 text-xs font-medium text-foreground"
            >
              {sparse ? 'New member (sparse)' : 'Established member'}
            </button>
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
        </div>

        <MetricRow
          metrics={[
            { label: 'Total balance', value: 8500.75, icon: Wallet, change: '2.4% this week', changePositive: true },
            { label: 'Cash · USDC', value: 2410.55, icon: Banknote, change: '0.8% this week', changePositive: true },
            { label: 'Savings · CLRUSD', value: 4210.0, icon: PiggyBank, change: '1.1% this week', changePositive: true },
            { label: 'External · Plaid', value: 1880.2, icon: Landmark, change: '0.4% this week', changePositive: false },
          ]}
        />

        <PathToOwnership summary={data} className="border-b border-border px-5 lg:px-8" />

        <div className="grid border-b border-border lg:grid-cols-3">
          <div className="flex items-center justify-center px-5 py-16 text-sm text-muted-foreground lg:col-span-2 lg:border-r lg:border-border lg:px-8">
            Balance chart
          </div>
          <EquitySources summary={data} className="border-t border-border px-5 lg:border-t-0 lg:px-8" />
        </div>

        <div className="grid border-b border-border lg:grid-cols-3">
          <UpcomingCalendar flat items={UPCOMING} className="px-5 lg:border-r lg:border-border lg:px-8" />
          <SpendHeatmap flat spendingByDay={SPEND} className="border-t border-border px-5 lg:border-t-0 lg:border-r lg:border-border lg:px-8" />
          <ExternalAccountsPanel className="border-t border-border px-5 lg:border-t-0 lg:px-8" />
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
