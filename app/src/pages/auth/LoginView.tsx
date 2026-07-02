import { Sparkles, Home, PiggyBank, type LucideIcon } from 'lucide-react';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';
import Wordmark from '@/components/app-ui/Wordmark';
import PrivyLoginControls from './PrivyLoginControls';

interface Benefit {
  icon: LucideIcon;
  title: string;
}

const BENEFITS: Benefit[] = [
  { icon: Sparkles, title: '1:1 equity match' },
  { icon: Home, title: 'Rent builds equity' },
  { icon: PiggyBank, title: 'Liquid savings' },
];

/**
 * Login / sign-up — full-screen (not a card), using the whole viewport with generous spacing so it
 * feels native on mobile: brand up top, value prop in the middle, auth controls in the thumb zone at
 * the bottom. Auth runs through Privy headlessly (PrivyLoginControls: email/phone OTP up front, socials
 * behind a slide-up sheet). All theme tokens, so it adapts to light/dusk/dark.
 */
export default function LoginView({
  onPreviewOnboarding,
}: {
  onPreviewOnboarding: () => void;
}) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      {/* ambient */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-32 -top-40 h-96 w-96 rounded-full bg-info/[0.07] blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-positive/[0.07] blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[440px] flex-1 flex-col px-6">
        {/* brand */}
        <header className="flex items-center gap-3 pt-[max(1.75rem,env(safe-area-inset-top))]">
          <img src={ClearPathLogo} alt="Clear" className="h-10 w-10 rounded-xl border border-border object-cover" />
          <div className="min-w-0">
            <Wordmark className="text-xl" />
            <div className="-mt-0.5 truncate text-[11px] text-muted-foreground">Turn rent into ownership</div>
          </div>
        </header>

        {/* hero — fills the space between brand and controls */}
        <main className="flex flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-[2.5rem] leading-[1.05] tracking-tight">
            Stop renting.
            <br />
            Start owning.
          </h1>
          <p className="mt-3 max-w-[22rem] text-[15px] leading-relaxed text-muted-foreground">
            Build equity with every rent payment and dollar you save. Free to start.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {BENEFITS.map((b) => {
              const Icon = b.icon;
              return (
                <span key={b.title} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {b.title}
                </span>
              );
            })}
          </div>
        </main>

        {/* auth — thumb zone */}
        <footer className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <PrivyLoginControls />

          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
            By continuing you agree to our <span className="underline">Terms</span> &amp; <span className="underline">Privacy Policy</span>.
          </p>
          <button
            type="button"
            onClick={onPreviewOnboarding}
            className="mx-auto mt-2 block text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            See how it works →
          </button>
        </footer>
      </div>
    </div>
  );
}
