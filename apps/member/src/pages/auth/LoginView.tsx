import { motion } from 'framer-motion';
import { Sparkles, Home, PiggyBank, type LucideIcon } from 'lucide-react';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';
import Wordmark from '@/components/app-ui/Wordmark';
import PrivyLoginControls from './PrivyLoginControls';

interface Benefit {
  icon: LucideIcon;
  title: string;
  body: string;
}

const BENEFITS: Benefit[] = [
  { icon: Sparkles, title: '1:1 equity match', body: 'Every $1 you save earns $1 in equity credits.' },
  { icon: Home, title: 'Rent builds equity', body: 'On-time rent counts toward your Clear Deed.' },
  { icon: PiggyBank, title: 'Liquid savings', body: 'Your balance stays yours — withdraw it any time.' },
];

/** Slowly drifting colour blobs — ambient depth behind the brand panel. */
function Aurora() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <motion.div
        className="absolute -left-24 -top-28 h-[30rem] w-[30rem] rounded-full bg-info/25 blur-[110px]"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute right-[-6rem] top-1/3 h-[26rem] w-[26rem] rounded-full bg-positive/20 blur-[110px]"
        animate={{ x: [0, -34, 0], y: [0, 40, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-28 left-1/4 h-[24rem] w-[24rem] rounded-full bg-amber-400/15 blur-[110px]"
        animate={{ x: [0, 26, 0], y: [0, -26, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

/** Floating, tilted product card — the hero moment on desktop. Purely decorative. */
function CardMock() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, rotate: -7 }}
      animate={{ opacity: 1, y: 0, rotate: -7 }}
      transition={{ delay: 0.35, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <motion.div
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
        className="relative aspect-[1.6/1] w-[21rem] overflow-hidden rounded-[1.25rem] bg-foreground text-background shadow-2xl ring-1 ring-black/10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-info/40 via-transparent to-positive/25" />
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex h-full flex-col justify-between p-6">
          <div className="flex items-center justify-between">
            <span className="font-wordmark text-2xl leading-none">ClearPath</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] opacity-70">Debit</span>
          </div>
          <div>
            <div className="font-mono text-lg tracking-[0.22em]">•••• •••• •••• 8152</div>
            <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-widest opacity-75">
              <span>Your name</span>
              <span>09 / 29</span>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="absolute -right-5 -top-5 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xl"
      >
        <Sparkles className="h-3.5 w-3.5 text-positive" /> +$1 · 1:1 match
      </motion.div>
    </motion.div>
  );
}

/**
 * Login / sign-up. Split-screen on desktop (a rich, animated brand panel + the auth panel), refined
 * full-height hero on mobile. Auth runs through Privy headlessly (PrivyLoginControls: email/phone up
 * front, socials in a slide-up sheet). All theme tokens, so it adapts to light/dusk/dark.
 */
export default function LoginView({
  onPreviewOnboarding,
}: {
  onPreviewOnboarding: () => void;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      {/* ---------- BRAND PANEL ---------- */}
      <div className="relative flex flex-1 flex-col overflow-hidden border-b border-border bg-secondary/30 px-6 pb-8 pt-[max(1.75rem,env(safe-area-inset-top))] lg:flex-none lg:border-b-0 lg:border-r lg:px-14 lg:py-14">
        <Aurora />

        <div className="relative flex items-center gap-3">
          <img src={ClearPathLogo} alt="Clear" className="h-10 w-10 rounded-xl border border-border object-cover" />
          <Wordmark className="text-2xl" />
        </div>

        <div className="relative mt-auto pt-10 lg:mt-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="font-display text-[2.75rem] leading-[1.02] tracking-tight lg:text-[4rem]"
          >
            Stop renting.
            <br />
            <span className="text-muted-foreground">Start owning.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground lg:text-base"
          >
            Build equity with every rent payment and dollar you save. Free to start.
          </motion.p>

          {/* benefits — chips on mobile, rows on desktop */}
          <div className="mt-6 flex flex-wrap gap-2 lg:mt-8 lg:flex-col lg:gap-4">
            {BENEFITS.map((b, i) => {
              const Icon = b.icon;
              return (
                <motion.div
                  key={b.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.15 + i * 0.08 }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm lg:gap-3 lg:rounded-2xl lg:px-4 lg:py-3"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground lg:h-9 lg:w-9 lg:bg-secondary lg:text-foreground">
                    <Icon className="h-3.5 w-3.5 lg:h-[18px] lg:w-[18px]" />
                  </span>
                  <span className="lg:min-w-0">
                    <span className="lg:block lg:text-sm lg:font-medium lg:text-foreground">{b.title}</span>
                    <span className="hidden lg:block lg:text-xs lg:text-muted-foreground">{b.body}</span>
                  </span>
                </motion.div>
              );
            })}
          </div>

          {/* floating card — desktop only */}
          <div className="pointer-events-none relative mt-14 hidden justify-center lg:flex">
            <CardMock />
          </div>
        </div>
      </div>

      {/* ---------- AUTH PANEL ---------- */}
      <div className="relative flex flex-col justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 lg:px-14 lg:py-14">
        <div className="mx-auto w-full max-w-sm">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <h2 className="font-display text-2xl tracking-tight text-foreground">Welcome to Clear</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sign in or create your account in seconds.</p>

            <div className="mt-6">
              <PrivyLoginControls />
            </div>

            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
              By continuing you agree to our <span className="underline">Terms</span> &amp; <span className="underline">Privacy Policy</span>.
            </p>
            <button
              type="button"
              onClick={onPreviewOnboarding}
              className="mx-auto mt-2 block text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              See how it works →
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
