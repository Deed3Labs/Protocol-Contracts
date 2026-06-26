import { Umbrella, Home, HeartPulse, Smartphone, Briefcase, ShieldCheck, Check, Lock, Sparkles, type LucideIcon } from 'lucide-react';

/*
 * Assurance — mutual-benefit (insurance-like) products members EARN/UNLOCK, not pay for. Unlocks
 * are driven by CLRUSD (savings) + Equity Credit balances. Rent Protection ships first; the rest
 * are greyed "coming soon." Backed by the Assurance Pool (shared, zero-premium).
 *
 * SEAM: wire unlock state + coverage to AssurancePool / AssuranceOracle; "earn" thresholds read
 * from the member's CLRUSD + Equity Credit balances.
 */

interface AssuranceProduct {
  id: string;
  name: string;
  icon: LucideIcon;
  blurb: string;
  coverage: string;
  unlock: string;
  status: 'active' | 'soon';
}

const PRODUCTS: AssuranceProduct[] = [
  { id: 'home', name: 'Home Repair Assurance', icon: Home, blurb: 'Help with urgent home repairs while you rent or after you own.', coverage: 'Up to $2,500 / incident', unlock: 'Unlocks at 6 months of on-time rent', status: 'soon' },
  { id: 'income', name: 'Income Protection', icon: Briefcase, blurb: 'A cushion that covers essentials if you lose income.', coverage: 'Up to 30 days of essentials', unlock: 'Unlocks with $7,500 in savings', status: 'soon' },
  { id: 'health', name: 'Care Assurance', icon: HeartPulse, blurb: 'Support for unexpected medical or family-care costs.', coverage: 'Up to $1,500 / year', unlock: 'Unlocks with 5,000 equity credits', status: 'soon' },
  { id: 'device', name: 'Device & Purchase Protection', icon: Smartphone, blurb: 'Coverage on big purchases made through Clear.', coverage: 'Up to $1,000 / item', unlock: 'Unlocks with Clear Partner spend', status: 'soon' },
];

export default function AssurancePage() {
  const unlocked = 1;
  const total = PRODUCTS.length + 1;

  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Assurance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mutual-benefit protection you <span className="font-medium text-foreground">earn</span>, not pay for — unlocked as your savings and equity credits grow.
        </p>
      </header>

      {/* standing / how it works */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
              <Umbrella className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-medium text-foreground">{unlocked} of {total} protections unlocked</div>
              <div className="text-xs text-muted-foreground">Backed by the Assurance Pool · $0 premiums, $0 payback</div>
            </div>
          </div>
          <span className="rounded-full bg-positive/10 px-2.5 py-1 text-xs font-medium text-positive">No premiums</span>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-info" style={{ width: `${(unlocked / total) * 100}%` }} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-positive" /> Grow your savings and earn equity credits to unlock more protections.
        </p>
      </div>

      {/* featured: Rent Protection (active) */}
      <div className="overflow-hidden rounded-xl border border-positive/30 bg-card">
        <div className="bg-positive/5 p-5">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-positive/15 text-positive">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Rent Protection</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-positive/15 px-2 py-0.5 text-[11px] font-medium text-positive">
                  <Check className="h-3 w-3" /> Active
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                If a crisis hits, the co-op covers your rent so you stay in your home — zero premium, zero payback.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Covers" value="Up to 60 days" />
            <Stat label="Your premium" value="$0" />
            <Stat label="To pay back" value="$0" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-[11px] text-muted-foreground">Standard track · 90-day waiting period active</span>
          <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform active:scale-[0.98]">
            View coverage
          </button>
        </div>
      </div>

      {/* coming soon */}
      <div>
        <h3 className="mb-3 text-xs font-medium text-muted-foreground">Unlock as you grow</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRODUCTS.map((p) => (
            <div key={p.id} className="flex flex-col rounded-xl border border-border bg-card p-4 opacity-80">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                  <p.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{p.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <Lock className="h-2.5 w-2.5" /> Soon
                </span>
              </div>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{p.blurb}</p>
              <div className="mt-3 border-t border-border pt-2">
                <div className="text-xs font-medium text-foreground">{p.coverage}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{p.unlock}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 text-center">
      <div className="text-sm font-semibold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
