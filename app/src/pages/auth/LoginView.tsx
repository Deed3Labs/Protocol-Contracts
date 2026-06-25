import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Home, PiggyBank, ArrowRight, type LucideIcon } from 'lucide-react';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';
import { cn } from '@/lib/utils';

interface Slide {
  icon: LucideIcon;
  title: string;
  body: string;
  gradient: string;
  chip: string;
}

const SLIDES: Slide[] = [
  { icon: Sparkles, title: 'Earn a 1:1 equity match', body: 'Every $1 you save earns $1 in equity credits — up to $1,500/mo.', gradient: 'from-emerald-500/30 via-emerald-500/5 to-transparent', chip: 'bg-positive/20 text-positive' },
  { icon: Home, title: 'Rent that builds equity', body: 'On-time rent counts toward your own Clear Deed.', gradient: 'from-blue-500/30 via-blue-500/5 to-transparent', chip: 'bg-info/20 text-info' },
  { icon: PiggyBank, title: 'Savings you control', body: 'Your CLRUSD stays liquid — withdraw it any time.', gradient: 'from-violet-500/30 via-violet-500/5 to-transparent', chip: 'bg-violet-500/20 text-violet-400' },
];

/**
 * Login — a single sleek card with an auto-rotating media/slider slot (a spot for a
 * future product video) and the primary action front-and-centre. Presentational so it
 * renders in the preview harness; LoginPage wires the AppKit auth callbacks.
 */
export default function LoginView({
  onGetStarted,
  onPreviewOnboarding,
}: {
  onGetStarted: () => void;
  onPreviewOnboarding: () => void;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((p) => (p + 1) % SLIDES.length), 4200);
    return () => clearInterval(t);
  }, []);
  const slide = SLIDES[i];
  const Icon = slide.icon;

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-8 text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-info/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-positive/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-[420px]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-32px_rgba(0,0,0,0.45)]">
          {/* media / slider — drop in a video here later */}
          <div className="relative h-[228px] overflow-hidden bg-gradient-to-br from-neutral-800 via-neutral-900 to-black">
            <AnimatePresence mode="wait">
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className={cn('absolute inset-0 bg-gradient-to-br', slide.gradient)}
              >
                <div className="flex h-full flex-col justify-end p-6 text-white">
                  <span className={cn('mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl', slide.chip)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <h2 className="font-display text-xl tracking-tight">{slide.title}</h2>
                  <p className="mt-1 max-w-[18rem] text-sm text-white/70">{slide.body}</p>
                </div>
              </motion.div>
            </AnimatePresence>
            <div className="absolute bottom-4 right-5 flex gap-1.5">
              {SLIDES.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setI(idx)}
                  aria-label={`Slide ${idx + 1}`}
                  className={cn('h-1.5 rounded-full transition-all', idx === i ? 'w-5 bg-white' : 'w-1.5 bg-white/40')}
                />
              ))}
            </div>
          </div>

          {/* body */}
          <div className="p-6">
            <div className="flex items-center gap-2.5">
              <img src={ClearPathLogo} alt="Clear" className="h-8 w-8 rounded-md border border-border object-cover" />
              <span className="font-display tracking-tight">Clear</span>
            </div>
            <h1 className="mt-4 font-display text-2xl leading-tight tracking-tight">Turn rent into ownership.</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Build equity with every payment. Start in minutes — it's free.</p>

            <button
              type="button"
              onClick={onGetStarted}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-foreground py-3 text-sm font-semibold text-background transition-transform active:scale-[0.99]"
            >
              Get started <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onGetStarted}
              className="mt-2 w-full rounded-lg border border-border py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Log in
            </button>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
              By continuing you agree to our <span className="underline">Terms</span> &{' '}
              <span className="underline">Privacy Policy</span>.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onPreviewOnboarding}
          className="mx-auto mt-4 block text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          See how it works →
        </button>
      </div>
    </div>
  );
}
