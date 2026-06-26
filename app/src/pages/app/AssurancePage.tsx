import {
  ShieldCheck, Home, Briefcase, HeartPulse, Smartphone, Users, PiggyBank, Award, Lock, Check,
  Sparkles, Zap, ArrowRight, type LucideIcon,
} from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import { CLRUSD_BALANCE } from '@/context/CreditContext';
import { cn } from '@/lib/utils';

/*
 * Assurance — mutual-benefit protections you EARN/unlock (never pay for), driven by CLRUSD
 * (savings) + Equity Credit balances and backed by the shared Assurance Pool. Each locked
 * protection unlocks FREE at a milestone, or can be ACCELERATED (one-time payment) to unlock now.
 * Matches the Borrow/Pay bento language (StatBar + rounded-xl border bg-card cards, subtle tints).
 *
 * SEAM: unlock state + coverage ← AssurancePool / AssuranceOracle vs the member's CLRUSD + Equity
 * Credit balances; "accelerate" = a one-time payment that flips unlock early.
 */

const SAVINGS = CLRUSD_BALANCE; // $5,000
const EQUITY_CREDITS = 6240;
const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;

interface Protection {
  id: string;
  name: string;
  icon: LucideIcon;
  tagline: string;
  coverage: string;
  unlockLabel: string;
  progress: number;
  remaining: string;
  accelerate: string;
}

const LOCKED: Protection[] = [
  { id: 'home', name: 'Home Repair Assurance', icon: Home, tagline: 'Help with urgent home repairs.', coverage: 'Up to $2,500 / incident', unlockLabel: 'Unlocks at $7,500 saved', progress: 67, remaining: '$2,500 to go', accelerate: '$49' },
  { id: 'income', name: 'Income Protection', icon: Briefcase, tagline: 'A cushion if you lose income.', coverage: 'Up to 30 days of essentials', unlockLabel: 'Unlocks at 10,000 equity credits', progress: 62, remaining: '3,760 credits to go', accelerate: '$79' },
  { id: 'care', name: 'Care Assurance', icon: HeartPulse, tagline: 'Support for medical or family-care costs.', coverage: 'Up to $1,500 / year', unlockLabel: 'Unlocks at 12 months on-time rent', progress: 50, remaining: '6 months to go', accelerate: '$59' },
  { id: 'device', name: 'Device & Purchase Protection', icon: Smartphone, tagline: 'Coverage on big purchases through Clear.', coverage: 'Up to $1,000 / item', unlockLabel: 'Unlocks with Clear Partner spend', progress: 15, remaining: 'Start using Clear Partner', accelerate: '$39' },
];
const nextId = LOCKED.reduce((a, b) => (b.progress > a.progress ? b : a)).id;

export default function AssurancePage() {
  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Assurance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mutual-benefit protection you build as you grow — never a premium, never paid back.
        </p>
      </header>

      <StatBar
        stats={[
          { label: 'Protections active', value: '1 of 5', icon: ShieldCheck },
          { label: 'Pool members', value: '12,480', icon: Users },
          { label: 'Unlock power', value: fmt(SAVINGS), icon: PiggyBank },
          { label: 'Next unlock', value: '$2,500 away', icon: Sparkles },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* active coverage — featured */}
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active coverage</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive">
              <Check className="h-3 w-3" /> Active
            </span>
          </div>

          <div className="mt-3 flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-positive/10 text-positive">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-foreground">Rent Protection</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">If a crisis hits, the co-op pays your rent so you stay in your home.</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <MiniStat label="Covers" value="60 days" />
            <MiniStat label="Premium" value="$0" />
            <MiniStat label="To pay back" value="$0" />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]">
              View coverage
            </button>
            <button type="button" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Get help in a crisis →
            </button>
          </div>

          <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-4 text-[11px] text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Backed by the Assurance Pool · 12,480 members protecting each other
          </div>
        </div>

        {/* your unlock power */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Your unlock power</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-secondary/30 p-3">
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
              <div className="mt-1.5 text-base font-semibold tabular-nums text-foreground">{fmt(SAVINGS)}</div>
              <div className="text-[11px] text-muted-foreground">Saved</div>
            </div>
            <div className="rounded-xl border border-border bg-secondary/30 p-3">
              <Award className="h-4 w-4 text-positive" />
              <div className="mt-1.5 text-base font-semibold tabular-nums text-foreground">{EQUITY_CREDITS.toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground">Equity credits</div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-secondary/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Next unlock</span>
              <span className="text-muted-foreground">Home Repair</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full bg-info" style={{ width: '67%' }} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">$2,500 more in savings to unlock — free.</p>
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-positive" /> Grow savings &amp; credits to unlock more.
          </div>
        </div>
      </div>

      {/* unlock as you grow */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">Unlock as you grow</h3>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3 text-info" /> Earn free, or accelerate to unlock now
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {LOCKED.map((p) => (
            <ProtectionCard key={p.id} p={p} isNext={p.id === nextId} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-2.5 text-center">
      <div className="text-base font-semibold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ProtectionCard({ p, isNext }: { p: Protection; isNext: boolean }) {
  const Icon = p.icon;
  return (
    <div className={cn('flex flex-col rounded-xl border bg-card p-4', isNext ? 'border-info/40' : 'border-border')}>
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', isNext ? 'bg-info/10 text-info' : 'bg-secondary text-muted-foreground')}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{p.name}</span>
        {isNext ? (
          <span className="shrink-0 rounded-full bg-info/10 px-2 py-0.5 text-[10px] font-medium text-info">Up next</span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Lock className="h-2.5 w-2.5" /> Locked
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{p.tagline}</p>
      <div className="mt-2.5 text-xs font-medium text-foreground">{p.coverage}</div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className={cn('h-full rounded-full', isNext ? 'bg-info' : 'bg-muted-foreground/40')} style={{ width: `${p.progress}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{p.remaining}</span>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
            isNext ? 'bg-foreground text-background hover:opacity-90' : 'border border-border text-foreground hover:bg-secondary',
          )}
        >
          <Zap className="h-3 w-3" /> Accelerate {p.accelerate}
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <ArrowRight className="h-2.5 w-2.5" /> {p.unlockLabel}
      </div>
    </div>
  );
}
