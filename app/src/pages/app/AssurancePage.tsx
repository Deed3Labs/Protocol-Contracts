import { useEffect, useState } from 'react';
import {
  ShieldCheck, Home, Briefcase, HeartPulse, Smartphone, Users, PiggyBank, Award, Lock, Check,
  Sparkles, Zap, ArrowRight, Loader2, type LucideIcon,
} from 'lucide-react';
import StatBar from '@/components/app-ui/StatBar';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { CLRUSD_BALANCE } from '@/context/CreditContext';
import { cn } from '@/lib/utils';

/*
 * Assurance — mutual-benefit protections you EARN/unlock (never pay for), driven by CLRUSD
 * (savings) + Equity Credit balances and backed by the shared Assurance Pool. Each locked
 * protection unlocks FREE at a milestone, or can be ACCELERATED (one-time payment) to unlock now.
 *
 * SEAM: unlock state ← AssurancePool / AssuranceOracle vs the member's CLRUSD + Equity Credit
 * balances; "accelerate" = a one-time payment that flips unlock early.
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

export default function AssurancePage() {
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [accelTarget, setAccelTarget] = useState<Protection | null>(null);

  const remaining = LOCKED.filter((p) => !unlocked.has(p.id));
  const next = remaining.length ? remaining.reduce((a, b) => (b.progress > a.progress ? b : a)) : null;
  const activeCount = 1 + unlocked.size;

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
          { label: 'Protections active', value: `${activeCount} of 5`, icon: ShieldCheck },
          { label: 'Pool members', value: '12,480', icon: Users },
          { label: 'Unlock power', value: fmt(SAVINGS), icon: PiggyBank },
          { label: 'Next unlock', value: next ? next.remaining : 'All set', icon: Sparkles },
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

          <div className="mt-4 grid grid-cols-3 gap-3 border-y border-border py-4">
            <div>
              <div className="text-lg font-semibold text-foreground">60 days</div>
              <div className="text-[11px] text-muted-foreground">Covers</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-foreground">$0</div>
              <div className="text-[11px] text-muted-foreground">Premium</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-foreground">$0</div>
              <div className="text-[11px] text-muted-foreground">To pay back</div>
            </div>
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
          <div className="mt-3 grid grid-cols-2 divide-x divide-border">
            <div className="pr-4">
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
              <div className="mt-1.5 text-lg font-semibold tabular-nums text-foreground">{fmt(SAVINGS)}</div>
              <div className="text-[11px] text-muted-foreground">Saved</div>
            </div>
            <div className="pl-4">
              <Award className="h-4 w-4 text-positive" />
              <div className="mt-1.5 text-lg font-semibold tabular-nums text-foreground">{EQUITY_CREDITS.toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground">Equity credits</div>
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            {next ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">Next unlock</span>
                  <span className="truncate pl-2 text-muted-foreground">{next.name}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-info" style={{ width: `${next.progress}%` }} />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{next.remaining} · unlocks free.</p>
              </>
            ) : (
              <div className="text-sm font-medium text-foreground">All protections unlocked 🎉</div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
            <ProtectionCard key={p.id} p={p} isNext={p.id === next?.id} unlocked={unlocked.has(p.id)} onAccelerate={() => setAccelTarget(p)} />
          ))}
        </div>
      </div>

      <AccelerateModal
        protection={accelTarget}
        onOpenChange={(o) => !o && setAccelTarget(null)}
        onUnlocked={(id) => setUnlocked((s) => new Set(s).add(id))}
      />
    </div>
  );
}

function ProtectionCard({ p, isNext, unlocked, onAccelerate }: { p: Protection; isNext: boolean; unlocked: boolean; onAccelerate: () => void }) {
  const Icon = p.icon;

  if (unlocked) {
    return (
      <div className="flex flex-col rounded-xl border border-positive/30 bg-card p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-positive/10 text-positive">
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{p.name}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
            <Check className="h-2.5 w-2.5" /> Active
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{p.tagline}</p>
        <div className="mt-2.5 text-xs font-medium text-foreground">{p.coverage}</div>
        <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          View coverage <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    );
  }

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
          onClick={onAccelerate}
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

/** Pay a one-time fee to unlock a protection now instead of waiting for the milestone. */
function AccelerateModal({ protection, onOpenChange, onUnlocked }: { protection: Protection | null; onOpenChange: (o: boolean) => void; onUnlocked: (id: string) => void }) {
  const [step, setStep] = useState<'confirm' | 'status'>('confirm');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (protection) {
      setStep('confirm');
      setDone(false);
    }
  }, [protection]);

  useEffect(() => {
    if (step !== 'status' || !protection) return;
    setDone(false);
    const t = setTimeout(() => {
      setDone(true);
      onUnlocked(protection.id);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const Icon = protection?.icon ?? ShieldCheck;

  return (
    <Dialog open={!!protection} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[400px]">
        {protection && step === 'confirm' && (
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-base font-semibold text-foreground">Unlock {protection.name}</div>
                <div className="text-xs text-muted-foreground">Get covered now instead of waiting.</div>
              </div>
            </div>

            <div className="mt-4 space-y-1.5 rounded-xl bg-secondary/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Coverage</span>
                <span className="text-foreground">{protection.coverage}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-medium">
                <span className="text-foreground">One-time fee</span>
                <span className="tabular-nums text-foreground">{protection.accelerate}</span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-secondary/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-positive" />
              Or keep growing — it unlocks free {protection.unlockLabel.replace('Unlocks at ', 'at ').replace('Unlocks ', '')}.
            </div>

            <button
              type="button"
              onClick={() => setStep('status')}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Pay {protection.accelerate} &amp; unlock now
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Backed by the Assurance Pool · $0 ongoing premium
            </p>
          </div>
        )}

        {protection && step === 'status' && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            {!done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <div className="mt-4 text-base font-semibold text-foreground">Unlocking…</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">{protection.name} unlocked</div>
                <div className="mt-1 text-sm text-muted-foreground">You're covered now — {protection.coverage.toLowerCase()}.</div>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                >
                  Done
                </button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
