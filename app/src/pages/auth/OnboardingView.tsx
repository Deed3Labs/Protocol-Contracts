import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, Home, ShieldCheck, Zap, IdCard, ArrowRight, ArrowLeft, Check, Loader2,
  PiggyBank, CreditCard, BarChart3, Receipt, type LucideIcon,
} from 'lucide-react';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';
import { cn } from '@/lib/utils';

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

type StepId = 'path' | 'goals' | 'profile' | 'finish';
const STEPS: { id: StepId; label: string }[] = [
  { id: 'path', label: 'Path' },
  { id: 'goals', label: 'Goals' },
  { id: 'profile', label: 'Profile' },
  { id: 'finish', label: 'Finish' },
];

const TRACKS: { id: OnboardingResult['accessTrack']; accountMethod: OnboardingResult['accountMethod']; identityMode: OnboardingResult['identityMode']; icon: LucideIcon; title: string; body: string; tag?: string }[] = [
  { id: 'wallet', accountMethod: 'wallet', identityMode: 'anonymous', icon: Zap, title: 'Quick start', body: 'Explore with a wallet — no details needed yet.' },
  { id: 'hybrid', accountMethod: 'appkit-account', identityMode: 'privacy', icon: ShieldCheck, title: 'Recommended', body: 'Email or wallet with privacy-first defaults.', tag: 'Most popular' },
  { id: 'verified', accountMethod: 'wallet', identityMode: 'verified', icon: IdCard, title: 'Full access', body: 'Verify identity to unlock the Clear Deed + card.' },
];

const REASONS: { label: string; icon: LucideIcon }[] = [
  { label: 'Buy a home', icon: Home },
  { label: 'Build equity', icon: Sparkles },
  { label: 'Save with a 1:1 match', icon: PiggyBank },
  { label: 'Pay rent & bills', icon: Receipt },
  { label: 'Track my spending', icon: BarChart3 },
  { label: 'Get a debit card', icon: CreditCard },
];

const REFERRALS = ['Friend or family', 'Social media', 'Search', 'Podcast or ad', 'Other'];
const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Other'];
const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR'];

const PLANS: { id: OnboardingResult['membershipPlan']; name: string; price: string; per: string; note: string; tag?: string }[] = [
  { id: 'standard', name: 'Standard', price: 'Free', per: '', note: '200 credits/mo · rent protection after a 90-day cliff.' },
  { id: 'accelerated', name: 'Accelerated', price: '$250', per: '/yr', note: '300 credits/mo (1.5×) · protection from day one · ~$21/mo, fees capped.', tag: 'Most popular' },
];

const emailValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => (
        <div key={s.id} className={cn('h-1.5 rounded-full transition-all duration-300', i === current ? 'w-6 bg-foreground' : i < current ? 'w-1.5 bg-positive' : 'w-1.5 bg-border')} />
      ))}
    </div>
  );
}

/**
 * New onboarding funnel — presentational (renders in the preview harness). Collects
 * path / goals / profile / plan across four steps and hands the result to onComplete,
 * which the wrapper maps to the existing member-onboarding submit contract.
 */
export default function OnboardingView({
  onComplete, onExit, submitting = false, error = null,
}: {
  onComplete: (result: OnboardingResult) => void | Promise<void>;
  onExit?: () => void;
  submitting?: boolean;
  error?: string | null;
}) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingResult>({
    accessTrack: 'hybrid', accountMethod: 'appkit-account', identityMode: 'privacy',
    reasons: [], referralSource: '', inviteCode: '',
    username: '', email: '', country: 'United States', settlementCurrency: 'USD',
    membershipPlan: 'standard', cardWaitlist: true, notificationsOptIn: true, termsAccepted: false,
  });
  const set = <K extends keyof OnboardingResult>(k: K, v: OnboardingResult[K]) => setData((d) => ({ ...d, [k]: v }));
  const toggleReason = (r: string) =>
    setData((d) => ({ ...d, reasons: d.reasons.includes(r) ? d.reasons.filter((x) => x !== r) : [...d.reasons, r] }));

  const valid = useMemo(() => {
    if (step === 0) return Boolean(data.accessTrack);
    if (step === 1) return data.reasons.length > 0;
    if (step === 2) return data.username.trim().length >= 2 && emailValid(data.email) && Boolean(data.country);
    if (step === 3) return Boolean(data.membershipPlan) && data.termsAccepted;
    return false;
  }, [step, data]);

  const last = step === STEPS.length - 1;
  const next = () => {
    if (!valid) return;
    if (last) void onComplete(data);
    else setStep((s) => s + 1);
  };
  const back = () => (step === 0 ? onExit?.() : setStep((s) => s - 1));

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-40 -top-40 h-[26rem] w-[26rem] rounded-full bg-info/10 blur-3xl" />
        <div className="absolute -bottom-44 right-0 h-[26rem] w-[26rem] rounded-full bg-positive/10 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-4xl grid-cols-1 lg:grid-cols-[0.85fr_1fr]">
        {/* reassurance panel */}
        <aside className="hidden flex-col justify-between gap-8 border-r border-border px-8 py-10 lg:flex">
          <div className="flex items-center gap-2.5">
            <img src={ClearPathLogo} alt="Clear" className="h-9 w-9 rounded-md border border-border object-cover" />
            <span className="font-display text-lg tracking-tight">Clear</span>
          </div>
          <div>
            <h2 className="font-display text-3xl leading-tight tracking-tight">
              You're minutes from building <span className="bg-gradient-to-r from-info to-positive bg-clip-text text-transparent">equity</span>.
            </h2>
            <div className="mt-6">
              <AnimatedDeedCard step={step} />
            </div>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-positive" /> No fees to open</li>
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-positive" /> Bank-level security · self-custody</li>
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-positive" /> Cancel any time</li>
          </ul>
        </aside>

        {/* step content */}
        <main className="flex flex-col px-6 py-8 lg:px-10">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 lg:hidden">
              <img src={ClearPathLogo} alt="Clear" className="h-8 w-8 rounded-md border border-border object-cover" />
              <span className="font-display tracking-tight">Clear</span>
            </div>
            <StepDots current={step} />
            <span className="text-xs font-medium text-muted-foreground">Step {step + 1} of {STEPS.length}</span>
          </div>

          <div key={step} className="flex-1 animate-fade-in">
            {step === 0 && (
              <Step title="How do you want to start?" subtitle="You can upgrade your access any time.">
                <div className="space-y-3">
                  {TRACKS.map((t) => (
                    <OptionCard
                      key={t.id}
                      selected={data.accessTrack === t.id}
                      onClick={() => setData((d) => ({ ...d, accessTrack: t.id, accountMethod: t.accountMethod, identityMode: t.identityMode }))}
                      icon={t.icon}
                      title={t.title}
                      body={t.body}
                      tag={t.tag}
                    />
                  ))}
                </div>
              </Step>
            )}

            {step === 1 && (
              <Step title="What brings you to Clear?" subtitle="Pick all that apply — we'll tailor your setup.">
                <div className="flex flex-wrap gap-2">
                  {REASONS.map(({ label, icon: Icon }) => {
                    const on = data.reasons.includes(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleReason(label)}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                          on ? 'border-foreground bg-foreground text-background' : 'border-border text-foreground hover:bg-secondary',
                        )}
                      >
                        <Icon className="h-4 w-4" /> {label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <Field label="How did you hear about us?">
                    <Select value={data.referralSource} onChange={(v) => set('referralSource', v)} options={REFERRALS} placeholder="Select one" />
                  </Field>
                  <Field label="Invite code (optional)">
                    <TextInput value={data.inviteCode} onChange={(v) => set('inviteCode', v)} placeholder="e.g. CLEAR25" />
                  </Field>
                </div>
              </Step>
            )}

            {step === 2 && (
              <Step title="Set up your profile" subtitle="This is how you'll show up on Clear.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Username">
                    <TextInput value={data.username} onChange={(v) => set('username', v)} placeholder="stevenspark" />
                  </Field>
                  <Field label="Email">
                    <TextInput value={data.email} onChange={(v) => set('email', v)} placeholder="you@email.com" type="email" invalid={data.email.length > 0 && !emailValid(data.email)} />
                  </Field>
                  <Field label="Country of residence">
                    <Select value={data.country} onChange={(v) => set('country', v)} options={COUNTRIES} />
                  </Field>
                  <Field label="Settlement currency">
                    <Select value={data.settlementCurrency} onChange={(v) => set('settlementCurrency', v)} options={CURRENCIES} />
                  </Field>
                </div>
              </Step>
            )}

            {step === 3 && (
              <Step title="Pick a plan & finish" subtitle="Start free — choose a plan when you're ready to convert.">
                <div className="grid gap-3">
                  {PLANS.map((p) => (
                    <OptionCard
                      key={p.id}
                      selected={data.membershipPlan === p.id}
                      onClick={() => set('membershipPlan', p.id)}
                      title={p.name}
                      body={p.note}
                      tag={p.tag}
                      right={<span className="font-display text-xl tabular-nums text-foreground">{p.price}<span className="text-xs font-normal text-muted-foreground"> {p.per}</span></span>}
                    />
                  ))}
                </div>
                <div className="mt-5 space-y-3">
                  <CheckRow checked={data.termsAccepted} onChange={(v) => set('termsAccepted', v)} required>
                    I agree to the <span className="underline">Membership Terms</span> & <span className="underline">Privacy Policy</span>.
                  </CheckRow>
                  <CheckRow checked={data.cardWaitlist} onChange={(v) => set('cardWaitlist', v)}>Join the Clear debit card waitlist.</CheckRow>
                  <CheckRow checked={data.notificationsOptIn} onChange={(v) => set('notificationsOptIn', v)}>Send me product updates & milestones.</CheckRow>
                </div>
              </Step>
            )}
          </div>

          {error && <div className="mt-4 rounded-lg bg-negative/10 px-3 py-2 text-xs font-medium text-negative">{error}</div>}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
            <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              type="button"
              onClick={next}
              disabled={!valid || submitting}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-all active:scale-[0.98]',
                valid && !submitting ? 'bg-foreground text-background' : 'cursor-not-allowed bg-secondary text-muted-foreground',
              )}
            >
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Finishing…</> : last ? <>Create my account <Check className="h-4 w-4" /></> : <>Continue <ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

function Step({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-2xl tracking-tight text-foreground sm:text-3xl">{title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function OptionCard({ selected, onClick, icon: Icon, title, body, tag, right }: {
  selected: boolean; onClick: () => void; icon?: LucideIcon; title: string; body: string; tag?: string; right?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all',
        selected ? 'border-foreground bg-secondary/40 ring-1 ring-foreground/40' : 'border-border hover:bg-secondary/40',
      )}
    >
      {Icon && (
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', selected ? 'bg-foreground text-background' : 'bg-secondary text-foreground')}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {tag && <span className="rounded-lg bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">{tag}</span>}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
      </span>
      {right}
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-foreground bg-foreground text-background' : 'border-border')}>
        {selected && <Check className="h-3 w-3" />}
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', invalid }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; invalid?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'w-full rounded-lg border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/15',
        invalid ? 'border-negative' : 'border-border',
      )}
    />
  );
}

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-foreground/15', value ? 'text-foreground' : 'text-muted-foreground')}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o} className="text-foreground">{o}</option>)}
    </select>
  );
}

function CheckRow({ checked, onChange, required, children }: { checked: boolean; onChange: (v: boolean) => void; required?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start gap-2.5 text-left">
      <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors', checked ? 'border-foreground bg-foreground text-background' : 'border-border')}>
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {children}{required && <span className="text-negative"> *</span>}
      </span>
    </button>
  );
}

const EQUITY_BY_STEP = [0, 2080, 4160, 6240];

/**
 * Gamified, non-interactive "live preview" of the Clear Deed: the equity figure counts
 * up and the bar fills as the user advances steps, and the whole card floats + pulses
 * so it reads as a dynamic display rather than something clickable.
 */
function AnimatedDeedCard({ step }: { step: number }) {
  const target = EQUITY_BY_STEP[Math.min(step, EQUITY_BY_STEP.length - 1)] ?? 0;
  const [val, setVal] = useState(0);

  useEffect(() => {
    let raf = 0;
    const from = val;
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const pct = Math.min(100, (val / 25000) * 100);

  return (
    <motion.div
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 5, ease: 'easeInOut', repeat: Infinity }}
      className="relative cursor-default select-none overflow-hidden rounded-xl bg-gradient-to-br from-neutral-800 via-neutral-900 to-black p-5 text-white"
      aria-hidden
    >
      <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-info/40 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-positive/30 blur-2xl" />
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-white/60">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
          </span>
          Live preview
        </span>
        <span className="rounded-lg bg-positive/20 px-2 py-0.5 text-[10px] font-medium text-positive">1:1 match</span>
      </div>
      <div className="relative mt-2 font-display text-2xl tabular-nums">
        ${val.toLocaleString()} <span className="text-sm font-normal text-white/50">/ $25,000</span>
      </div>
      <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-lg bg-white/15">
        <div className="h-full rounded-lg bg-gradient-to-r from-info to-positive transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <div className="relative mt-2 text-[11px] text-white/50">
        {step === 0 ? 'Watch your equity grow as you set up' : 'Equity credits build with every step'}
      </div>
    </motion.div>
  );
}
