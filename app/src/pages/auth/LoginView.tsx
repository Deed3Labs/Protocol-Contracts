import { Sparkles, Home, PiggyBank, ArrowRight, ShieldCheck, type LucideIcon } from 'lucide-react';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';
import Wordmark from '@/components/app-ui/Wordmark';

interface Benefit {
  icon: LucideIcon;
  title: string;
  body: string;
}

const BENEFITS: Benefit[] = [
  { icon: Sparkles, title: '1:1 equity match', body: 'Every $1 you save earns $1 in equity credits.' },
  { icon: Home, title: 'Rent that builds equity', body: 'On-time rent counts toward your own Clear Deed.' },
  { icon: PiggyBank, title: 'Savings you control', body: 'Your balance stays liquid — withdraw it any time.' },
];

/**
 * Login / sign-up — brand + value prop + the primary action. Auth itself runs through AppKit
 * (LoginPage wires `onGetStarted` → openModal('Connect'), which offers email / Google / Apple /
 * wallet). All theme tokens, so it adapts to light/dusk/dark.
 */
export default function LoginView({
  onGetStarted,
  onPreviewOnboarding,
}: {
  onGetStarted: () => void;
  onPreviewOnboarding: () => void;
}) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-10 text-foreground">
      {/* ambient */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-info/[0.07] blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-positive/[0.07] blur-3xl" />
      </div>

      <div className="relative w-full max-w-[440px]">
        {/* brand */}
        <div className="mb-6 flex items-center gap-3">
          <img src={ClearPathLogo} alt="Clear" className="h-10 w-10 rounded-lg border border-border object-cover" />
          <div className="min-w-0">
            <Wordmark className="text-xl" />
            <div className="-mt-0.5 truncate text-[11px] text-muted-foreground">Turn rent into ownership</div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="font-display text-3xl leading-[1.1] tracking-tight">Stop renting.<br />Start owning.</h1>
          <p className="mt-2 text-sm text-muted-foreground">Build equity with every rent payment and dollar you save. Free to start.</p>

          <div className="mt-5 space-y-3">
            {BENEFITS.map((b) => {
              const Icon = b.icon;
              return (
                <div key={b.title} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{b.title}</div>
                    <div className="text-xs text-muted-foreground">{b.body}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onGetStarted}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
          >
            Get started <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onGetStarted}
            className="mt-2 w-full rounded-xl border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            I already have an account
          </button>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Continue with email, Google, Apple, or a wallet
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          By continuing you agree to our <span className="underline">Terms</span> &amp; <span className="underline">Privacy Policy</span>.
        </p>
        <button
          type="button"
          onClick={onPreviewOnboarding}
          className="mx-auto mt-3 block text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          See how it works →
        </button>
      </div>
    </div>
  );
}
