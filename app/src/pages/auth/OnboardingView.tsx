import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, Sparkles, PiggyBank, Receipt, Landmark, ShieldCheck, ArrowRight, ArrowLeft, Check,
  Loader2, X, Wallet, Send, type LucideIcon,
} from 'lucide-react';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';
import Wordmark from '@/components/app-ui/Wordmark';
import { cn } from '@/lib/utils';

/**
 * Onboarding contract handed to the wrapper, which maps it to the member-onboarding submit. The
 * redesigned flow (Welcome → Fund → Goal → Done) collects a goal and defaults the rest — identity
 * stays privacy-first until the user verifies (KYC is required later, at money movement).
 */
export interface OnboardingResult {
  accessTrack: 'wallet' | 'hybrid' | 'verified';
  accountMethod: 'wallet' | 'appkit-account' | 'anonymous-preview';
  identityMode: 'anonymous' | 'privacy' | 'verified';
  reasons: string[];
  referralSource: string;
  inviteCode: string;
  username: string;
  email: string;
  country: string;
  settlementCurrency: string;
  membershipPlan: 'standard' | 'accelerated';
  cardWaitlist: boolean;
  notificationsOptIn: boolean;
  termsAccepted: boolean;
}

type StepId = 'welcome' | 'fund' | 'goal' | 'finish';
const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'fund', label: 'Fund' },
  { id: 'goal', label: 'Goal' },
  { id: 'finish', label: 'Done' },
];

const GOALS: { id: string; icon: LucideIcon; label: string; body: string }[] = [
  { id: 'home', icon: Home, label: 'Buy a home', body: 'Work toward a debt-free Clear Deed.' },
  { id: 'equity', icon: Sparkles, label: 'Build equity', body: 'Grow equity credits with a 1:1 match.' },
  { id: 'save', icon: PiggyBank, label: 'Save with a match', body: 'Every dollar you save is matched.' },
  { id: 'rent', icon: Receipt, label: 'Make rent count', body: 'On-time rent builds ownership.' },
];

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {STEPS.map((s, i) => (
        <div key={s.id} className={cn('h-1.5 rounded-full transition-all duration-300', i === current ? 'w-6 bg-foreground' : i < current ? 'w-1.5 bg-positive' : 'w-1.5 bg-border')} />
      ))}
    </div>
  );
}

/** Redesigned onboarding funnel — presentational; the wrapper maps the result to the submit contract. */
export default function OnboardingView({
  onComplete,
  onExit,
  submitting,
  error,
}: {
  onComplete: (r: OnboardingResult) => void;
  onExit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx].id;
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);
  const [goalId, setGoalId] = useState<string | null>(null);

  const next = () => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setStepIdx((i) => Math.max(i - 1, 0));
  const linkBank = () => {
    setLinking(true);
    setTimeout(() => {
      setLinking(false);
      setLinked(true);
    }, 1600);
  };
  const finish = () =>
    onComplete({
      accessTrack: 'hybrid',
      accountMethod: 'appkit-account',
      identityMode: 'privacy',
      reasons: goalId ? [GOALS.find((g) => g.id === goalId)?.label ?? ''] : [],
      referralSource: '',
      inviteCode: '',
      username: '',
      email: '',
      country: 'United States',
      settlementCurrency: 'USD',
      membershipPlan: 'standard',
      cardWaitlist: false,
      notificationsOptIn: true,
      termsAccepted: true,
    });

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-info/[0.07] blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-positive/[0.07] blur-3xl" />
      </div>

      <div className="relative w-full max-w-[440px]">
        {/* top bar */}
        <div className="mb-4 flex items-center justify-between">
          {stepIdx > 0 && step !== 'finish' ? (
            <button type="button" onClick={back} aria-label="Back" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <div className="flex items-center gap-2.5">
              <img src={ClearPathLogo} alt="Clear" className="h-8 w-8 rounded-md border border-border object-cover" />
              <Wordmark className="text-lg" />
            </div>
          )}
          <button type="button" onClick={onExit} aria-label="Exit setup" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <StepDots current={stepIdx} />

        <div className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }}>
              {step === 'welcome' && (
                <div>
                  <h1 className="font-display text-2xl leading-tight tracking-tight text-foreground">Welcome to Clear</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">Let's set up your account — it takes about a minute.</p>
                  <div className="mt-5 space-y-3">
                    <Step n={1} icon={Landmark} title="Link your bank" body="Add money in seconds, when you're ready." />
                    <Step n={2} icon={Sparkles} title="Set your goal" body="We'll tailor your path to ownership." />
                    <Step n={3} icon={Home} title="Start building equity" body="Every payment moves you forward." />
                  </div>
                </div>
              )}

              {step === 'fund' && (
                <div>
                  <h1 className="font-display text-2xl leading-tight tracking-tight text-foreground">Link your bank</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">Connect a bank so you can add money and pay rent the moment you're set up.</p>

                  <button
                    type="button"
                    onClick={linkBank}
                    disabled={linking || linked}
                    className={cn(
                      'mt-5 flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors',
                      linked ? 'border-positive/40 bg-positive/5' : 'border-border hover:bg-secondary/40',
                    )}
                  >
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', linked ? 'bg-positive/15 text-positive' : 'bg-secondary text-foreground')}>
                      {linking ? <Loader2 className="h-5 w-5 animate-spin" /> : linked ? <Check className="h-5 w-5" strokeWidth={3} /> : <Landmark className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{linking ? 'Connecting…' : linked ? 'Bank linked' : 'Link a bank'}</span>
                      <span className="block text-xs text-muted-foreground">{linked ? 'You can manage this anytime in Settings.' : 'Securely via Plaid'}</span>
                    </span>
                  </button>

                  <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" /> Read-only & bank-grade encrypted. You can also do this later.
                  </p>
                </div>
              )}

              {step === 'goal' && (
                <div>
                  <h1 className="font-display text-2xl leading-tight tracking-tight text-foreground">What's your goal?</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">Pick what matters most — you can change it anytime.</p>
                  <div className="mt-5 grid grid-cols-2 gap-2.5">
                    {GOALS.map((g) => {
                      const Icon = g.icon;
                      const on = goalId === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setGoalId(g.id)}
                          className={cn('flex flex-col rounded-xl border p-3 text-left transition-colors', on ? 'border-foreground bg-secondary/50' : 'border-border hover:bg-secondary/40')}
                        >
                          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', on ? 'bg-foreground text-background' : 'bg-secondary text-foreground')}>
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="mt-2 text-sm font-medium text-foreground">{g.label}</span>
                          <span className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{g.body}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 'finish' && (
                <div className="py-2 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                    <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                  </div>
                  <h1 className="mt-4 font-display text-2xl tracking-tight text-foreground">You're all set</h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">Your account is ready. Verify your identity later to move money.</p>
                  <div className="mt-5 flex items-center justify-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Account</span>
                    <span className="inline-flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" /> {linked ? 'Bank linked' : 'Bank later'}</span>
                    <span className="inline-flex items-center gap-1.5"><Send className="h-3.5 w-3.5" /> {goalId ? 'Goal set' : 'Explore'}</span>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {error && <p className="mt-4 rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

          {/* nav */}
          {step !== 'finish' ? (
            <div className="mt-6">
              <button
                type="button"
                onClick={next}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
              >
                {step === 'welcome' ? 'Get started' : 'Continue'} <ArrowRight className="h-4 w-4" />
              </button>
              {(step === 'fund' || step === 'goal') && (
                <button type="button" onClick={next} className="mt-2 w-full rounded-xl py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  Skip for now
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={submitting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-60"
            >
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Setting up…</> : <>Go to dashboard <ArrowRight className="h-4 w-4" /></>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ n, icon: Icon, title, body }: { n: number; icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground">{n}</span>
    </div>
  );
}
