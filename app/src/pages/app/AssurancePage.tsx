import {
  ShieldCheck, Home, Briefcase, HeartPulse, Smartphone, Umbrella, Check, Lock, Sparkles,
  Zap, Users, PiggyBank, Award, ArrowRight, type LucideIcon,
} from 'lucide-react';
import { CLRUSD_BALANCE } from '@/context/CreditContext';
import { cn } from '@/lib/utils';

/*
 * Assurance — mutual-benefit protections you EARN/unlock (never pay for), driven by CLRUSD
 * (savings) + Equity Credit balances and backed by the shared Assurance Pool. Coverage-forward
 * hero (active Rent Protection) + a gamified unlock journey. Each locked protection unlocks FREE
 * at a savings/credit milestone, or can be ACCELERATED (one-time payment) to get covered sooner.
 *
 * SEAM: unlock state + coverage ← AssurancePool / AssuranceOracle read against the member's
 * CLRUSD + Equity Credit balances; "accelerate" = a one-time payment that flips unlock early.
 */

const SAVINGS = CLRUSD_BALANCE; // $5,000 — drives unlocks alongside equity credits
const EQUITY_CREDITS = 6240;
const POOL_MEMBERS = 12480;

interface Protection {
  id: string;
  name: string;
  icon: LucideIcon;
  tagline: string;
  coverage: string;
  status: 'active' | 'locked';
  unlockLabel?: string;
  progress?: number; // 0–100 toward the free unlock
  remaining?: string;
  accelerate?: string; // one-time price to unlock now
}

const PROTECTIONS: Protection[] = [
  { id: 'rent', name: 'Rent Protection', icon: ShieldCheck, tagline: 'The co-op covers your rent if a crisis hits.', coverage: 'Up to 60 days', status: 'active' },
  { id: 'home', name: 'Home Repair Assurance', icon: Home, tagline: 'Help with urgent home repairs.', coverage: 'Up to $2,500 / incident', status: 'locked', unlockLabel: 'Unlocks at $7,500 saved', progress: 67, remaining: '$2,500 to go', accelerate: '$49' },
  { id: 'income', name: 'Income Protection', icon: Briefcase, tagline: 'A cushion that covers essentials if you lose income.', coverage: 'Up to 30 days of essentials', status: 'locked', unlockLabel: 'Unlocks at 10,000 equity credits', progress: 62, remaining: '3,760 credits to go', accelerate: '$79' },
  { id: 'care', name: 'Care Assurance', icon: HeartPulse, tagline: 'Support for unexpected medical or family-care costs.', coverage: 'Up to $1,500 / year', status: 'locked', unlockLabel: 'Unlocks at 12 months on-time rent', progress: 50, remaining: '6 months to go', accelerate: '$59' },
  { id: 'device', name: 'Device & Purchase Protection', icon: Smartphone, tagline: 'Coverage on big purchases made through Clear.', coverage: 'Up to $1,000 / item', status: 'locked', unlockLabel: 'Unlocks with Clear Partner spend', progress: 15, remaining: 'Start using Clear Partner', accelerate: '$39' },
];

const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;

export default function AssurancePage() {
  const active = PROTECTIONS.filter((p) => p.status === 'active').length;
  const next = PROTECTIONS.filter((p) => p.status === 'locked').sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0];

  return (
    <div className="animate-fade-in space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Assurance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mutual-benefit protection you <span className="font-medium text-foreground">earn</span> as you grow — never a premium, never paid back.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ---- HERO: active coverage ---- */}
        <div className="relative overflow-hidden rounded-2xl border border-info/20 bg-gradient-to-br from-info/[0.10] to-positive/[0.06] p-6 lg:col-span-2">
          <Umbrella className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 text-info/[0.07]" strokeWidth={1.25} />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs font-medium text-info">
              <span className="flex h-1.5 w-1.5 rounded-full bg-positive" /> Active coverage
            </div>

            <div className="mt-3 flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-positive/15 text-positive">
                <ShieldCheck className="h-7 w-7" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-2xl tracking-tight text-foreground">Rent Protection</h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  If a crisis hits, the co-op pays your rent so you stay in your home.
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <HeroStat label="Covers" value="60 days" />
              <HeroStat label="Premium" value="$0" />
              <HeroStat label="To pay back" value="$0" />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]">
                View coverage
              </button>
              <button type="button" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                Get help in a crisis →
              </button>
            </div>

            <div className="mt-5 flex items-center gap-1.5 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Backed by the Assurance Pool · {POOL_MEMBERS.toLocaleString()} members protecting each other
            </div>
          </div>
        </div>

        {/* ---- STANDING: your unlock power ---- */}
        <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
          <span className="text-xs font-medium text-muted-foreground">Your unlock power</span>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <DriverStat icon={PiggyBank} label="Saved" value={fmt(SAVINGS)} />
            <DriverStat icon={Award} label="Equity credits" value={EQUITY_CREDITS.toLocaleString()} tint="positive" />
          </div>

          <div className="mt-4 flex items-center gap-4 rounded-xl bg-secondary/40 p-3">
            <Ring pct={next?.progress ?? 0} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-muted-foreground">Next unlock</div>
              <div className="truncate text-sm font-medium text-foreground">{next?.name}</div>
              <div className="text-[11px] text-muted-foreground">{next?.remaining}</div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-positive" /> {active} of {PROTECTIONS.length} protections active
          </div>
        </div>
      </div>

      {/* ---- UNLOCK JOURNEY ---- */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Your protection journey</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3 text-info" /> Earn free as you grow · or accelerate to unlock now
          </span>
        </div>

        <div className="mt-4">
          {PROTECTIONS.map((p, i) => (
            <JourneyRow key={p.id} p={p} last={i === PROTECTIONS.length - 1} isNext={p.id === next?.id} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-3 text-center backdrop-blur-sm">
      <div className="font-display text-xl tracking-tight text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function DriverStat({ icon: Icon, label, value, tint }: { icon: LucideIcon; label: string; value: string; tint?: 'positive' }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3">
      <Icon className={cn('h-4 w-4', tint === 'positive' ? 'text-positive' : 'text-muted-foreground')} />
      <div className="mt-1.5 text-base font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Compact SVG progress ring. */
function Ring({ pct }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 44 44" className="h-12 w-12 shrink-0">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(var(--secondary))" strokeWidth="4" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke="rgb(var(--info))"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (c * pct) / 100}
        transform="rotate(-90 22 22)"
      />
      <text x="22" y="22" textAnchor="middle" dominantBaseline="central" fill="rgb(var(--foreground))" className="text-[11px] font-semibold">
        {pct}%
      </text>
    </svg>
  );
}

function JourneyRow({ p, last, isNext }: { p: Protection; last: boolean; isNext: boolean }) {
  const active = p.status === 'active';
  const Icon = p.icon;
  return (
    <div className="flex gap-3">
      {/* rail */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            active ? 'bg-positive/15 text-positive' : isNext ? 'bg-info/15 text-info' : 'bg-secondary text-muted-foreground',
          )}
        >
          {active ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
        </span>
        {!last && <span className="my-1 w-px flex-1 bg-border" />}
      </div>

      {/* card */}
      <div
        className={cn(
          'mb-3 min-w-0 flex-1 rounded-xl border p-4 transition-colors',
          isNext ? 'border-info/40 bg-info/[0.04]' : 'border-border bg-card',
          !active && !isNext && 'opacity-80',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{p.name}</span>
          {active ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-positive/15 px-2 py-0.5 text-[10px] font-medium text-positive">
              <Check className="h-2.5 w-2.5" /> Active
            </span>
          ) : isNext ? (
            <span className="shrink-0 rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-medium text-info">Up next</span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Lock className="h-2.5 w-2.5" /> Locked
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{p.tagline}</p>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-foreground">{p.coverage}</span>
          {active && <span className="text-[11px] text-muted-foreground">Included</span>}
        </div>

        {!active && (
          <>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className={cn('h-full rounded-full', isNext ? 'bg-info' : 'bg-muted-foreground/40')} style={{ width: `${p.progress ?? 0}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">{p.unlockLabel} · {p.remaining}</span>
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
          </>
        )}

        {active && (
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
            View coverage <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
