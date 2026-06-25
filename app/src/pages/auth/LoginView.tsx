import { Sparkles, Home, PiggyBank, ArrowRight, ShieldCheck, Star, Check } from 'lucide-react';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';
import { cn } from '@/lib/utils';

interface ValueProp {
  icon: typeof Sparkles;
  title: string;
  body: string;
  accent: 'green' | 'blue' | 'neutral';
}

const VALUE_PROPS: ValueProp[] = [
  { icon: Sparkles, accent: 'green', title: '1:1 equity match', body: 'Earn $1 in equity credits for every $1 you save — up to $1,500/mo.' },
  { icon: Home, accent: 'blue', title: 'Rent that builds equity', body: 'On-time rent payments count toward your Clear Deed.' },
  { icon: PiggyBank, accent: 'neutral', title: 'Savings you control', body: 'CLRUSD savings, redeemable any time — no lock-ups, no APY games.' },
];

const ACCENT: Record<ValueProp['accent'], string> = {
  green: 'bg-positive/10 text-positive',
  blue: 'bg-info/10 text-info',
  neutral: 'bg-secondary text-foreground',
};

const STATS = [
  { value: '$4.2M+', label: 'equity credits earned' },
  { value: '12,400+', label: 'members on the path' },
  { value: '4.9★', label: 'member rating' },
];

/**
 * Conversion-focused login/landing — presentational (auth actions are passed in so it
 * can render in the preview harness). Sells the product ("turn rent into ownership")
 * with value props + social proof beside a sign-up card showing the outcome.
 */
export default function LoginView({
  onGetStarted,
  onPreviewOnboarding,
}: {
  onGetStarted: () => void;
  onPreviewOnboarding: () => void;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* gradient backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-info/10 blur-3xl" />
        <div className="absolute -bottom-48 right-0 h-[28rem] w-[28rem] rounded-full bg-positive/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 lg:px-8">
        {/* top bar */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={ClearPathLogo} alt="Clear" className="h-9 w-9 rounded-md border border-border object-cover" />
            <span className="font-display text-lg tracking-tight">Clear</span>
          </div>
          <button
            type="button"
            onClick={onGetStarted}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Log in
          </button>
        </header>

        <main className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-2 lg:gap-12 lg:py-0">
          {/* left — pitch */}
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-positive" /> Rent-to-own, reimagined
            </span>

            <h1 className="mt-5 font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">
              Turn rent into
              <br />
              <span className="bg-gradient-to-r from-info to-positive bg-clip-text text-transparent">ownership.</span>
            </h1>

            <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
              Every rent payment and every dollar you save earns equity credits toward a home of your own.
              Real ownership — not interest games.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onGetStarted}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-transform active:scale-[0.98]"
              >
                Get started free <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onPreviewOnboarding}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                See how it works
              </button>
            </div>

            <ul className="mt-8 space-y-3">
              {VALUE_PROPS.map(({ icon: Icon, title, body, accent }) => (
                <li key={title} className="flex items-start gap-3">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ACCENT[accent])}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-foreground">{title}</div>
                    <div className="text-sm text-muted-foreground">{body}</div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex gap-6 border-t border-border pt-6">
              {STATS.map((s) => (
                <div key={s.label}>
                  <div className="font-display text-xl tracking-tight text-foreground tabular-nums">{s.value}</div>
                  <div className="text-[11px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* right — sign-up card with the outcome shown */}
          <div className="animate-fade-in lg:pl-4">
            <div className="mx-auto w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.35)]">
              {/* outcome preview */}
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-neutral-800 via-neutral-900 to-black p-5 text-white">
                <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-info/40 blur-2xl" aria-hidden />
                <div className="pointer-events-none absolute -bottom-10 -left-6 h-28 w-28 rounded-full bg-positive/30 blur-2xl" aria-hidden />
                <div className="relative flex items-center justify-between">
                  <span className="text-xs text-white/60">Your Clear Deed</span>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-positive/20 px-2 py-0.5 text-[10px] font-medium text-positive">
                    <Sparkles className="h-3 w-3" /> 1:1 match
                  </span>
                </div>
                <div className="relative mt-2 font-display text-3xl tracking-tight tabular-nums">
                  $6,240 <span className="text-sm font-normal text-white/50">/ $25,000</span>
                </div>
                <div className="relative mt-3 h-1.5 w-full overflow-hidden rounded-lg bg-white/15">
                  <div className="h-full w-1/4 rounded-lg bg-gradient-to-r from-info to-positive" />
                </div>
                <div className="relative mt-2 text-[11px] text-white/50">25% to your down payment</div>
              </div>

              <h2 className="mt-5 font-display text-2xl tracking-tight text-foreground">Create your account</h2>
              <p className="mt-1 text-sm text-muted-foreground">Start building equity in minutes — it's free.</p>

              <button
                type="button"
                onClick={onGetStarted}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-foreground py-3 text-sm font-semibold text-background transition-transform active:scale-[0.99]"
              >
                Get started <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onPreviewOnboarding}
                className="mt-2 w-full rounded-lg border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Preview onboarding
              </button>

              <p className="mt-3 text-center text-sm text-muted-foreground">
                Already a member?{' '}
                <button type="button" onClick={onGetStarted} className="font-medium text-info hover:underline">
                  Log in
                </button>
              </p>

              <div className="mt-5 space-y-2 border-t border-border pt-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-positive" /> Bank-level security · self-custody
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-positive" /> No fees to open · cancel anytime
                </div>
              </div>
            </div>

            <p className="mx-auto mt-3 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
              By continuing you agree to our <span className="underline">Terms</span> &{' '}
              <span className="underline">Privacy Policy</span>.
            </p>
          </div>
        </main>

        <footer className="flex items-center justify-center gap-1.5 py-4 text-xs text-muted-foreground">
          <Star className="h-3 w-3 text-positive" /> Trusted by thousands turning rent into ownership
        </footer>
      </div>
    </div>
  );
}
