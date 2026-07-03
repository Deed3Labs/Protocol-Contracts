import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Share, Plus, X, Download, Sparkles } from 'lucide-react';
import ClearPathLogo from '@/assets/ClearPath-Logo.png';
import { cn } from '@/lib/utils';

/*
 * First-visit PWA install takeover — a full-screen blur overlay that blocks content until the user
 * installs or dismisses. Apple (iOS/iPadOS/macOS Safari) can't do a one-click install, so we show an
 * animated "Add to Home Screen / Dock" guide; Chromium fires beforeinstallprompt so we offer one click.
 * Shown once (persisted dismissal), never when already installed.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed';

type Platform = 'ios-safari-phone' | 'ios-safari-pad' | 'ios-other' | 'mac-safari' | 'installable' | 'unsupported';

function detect(): { platform: Platform; standalone: boolean } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { platform: 'unsupported', standalone: true };
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const ua = navigator.userAgent;
  const mtp = navigator.maxTouchPoints || 0;
  const isIPhone = /iPhone|iPod/i.test(ua);
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && mtp > 1); // iPadOS 13+ masquerades as Mac
  const isIOS = isIPhone || isIPad;
  const isMac = /Macintosh/i.test(ua) && mtp <= 1;
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android|Edg\//i.test(ua);
  let platform: Platform = 'unsupported';
  if (isIOS) platform = isSafari ? (isIPad ? 'ios-safari-pad' : 'ios-safari-phone') : 'ios-other';
  else if (isMac && isSafari) platform = 'mac-safari';
  return { platform, standalone };
}

/** One animated step in the manual guide — spotlights when it's the active phase. */
function GuideStep({ active, n, icon, children }: { active: boolean; n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.div
      animate={{ scale: active ? 1.02 : 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className={cn(
        'flex items-center gap-3 rounded-2xl border p-3 transition-colors',
        active ? 'border-info bg-info/10' : 'border-border bg-secondary/30',
      )}
    >
      <span className={cn('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors', active ? 'bg-info text-white' : 'bg-secondary text-foreground')}>
        {icon}
        {active && (
          <motion.span
            className="absolute inset-0 rounded-xl ring-2 ring-info"
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 1.5 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </span>
      <span className="text-left text-sm leading-snug text-foreground">
        <span className="mr-1 font-semibold text-muted-foreground">{n}.</span>
        {children}
      </span>
    </motion.div>
  );
}

export default function PwaInstallTakeover() {
  const { platform, standalone } = useMemo(detect, []);
  const [show, setShow] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (standalone) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch { /* ignore */ }

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);

    // Apple never fires beforeinstallprompt → show the manual guide after a short beat.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (platform === 'ios-safari-phone' || platform === 'ios-safari-pad' || platform === 'mac-safari' || platform === 'ios-other') {
      t = setTimeout(() => setShow(true), 1000);
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
      if (t) clearTimeout(t);
    };
  }, [standalone, platform]);

  // Drive the 2-step guide animation (~3s loop).
  useEffect(() => {
    if (!show || deferred) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % 2), 1600);
    return () => clearInterval(id);
  }, [show, deferred]);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
  };
  const install = async () => {
    if (!deferred) return dismiss();
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
    dismiss();
  };

  const isApple = platform.startsWith('ios') || platform === 'mac-safari';
  const addLabel = platform === 'mac-safari' ? 'Add to Dock' : 'Add to Home Screen';
  const target = platform === 'mac-safari' ? 'Dock' : 'Home Screen';
  const shareWhere =
    platform === 'ios-safari-phone' ? 'at the bottom of Safari' : platform === 'mac-safari' ? 'in the Safari toolbar' : 'in the toolbar';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-background/70 px-6 py-10 backdrop-blur-2xl"
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ y: 24, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-2xl"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <img src={ClearPathLogo} alt="Clear" className="mx-auto h-16 w-16 rounded-2xl border border-border object-cover shadow-md" />
        <h2 className="mt-4 font-display text-2xl tracking-tight text-foreground">Install Clear</h2>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Add Clear to your {target} for the full app — instant access, push notifications, and a native feel.
        </p>

        {/* benefit chip */}
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1 text-[11px] font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3 text-positive" /> Works offline · gets notifications
        </div>

        {deferred ? (
          <button
            type="button"
            onClick={install}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
          >
            <Download className="h-4 w-4" /> Install app
          </button>
        ) : isApple ? (
          <div className="mt-5 space-y-2.5">
            <GuideStep active={phase === 0} n={1} icon={<Share className="h-[18px] w-[18px]" />}>
              Tap <span className="font-semibold text-foreground">Share</span> {shareWhere}
            </GuideStep>
            <GuideStep active={phase === 1} n={2} icon={<Plus className="h-[18px] w-[18px]" />}>
              Choose <span className="font-semibold text-foreground">{addLabel}</span>
            </GuideStep>
          </div>
        ) : (
          <p className="mt-5 rounded-xl border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
            Open <span className="font-semibold text-foreground">Clear</span> in your browser’s menu and choose <span className="font-semibold text-foreground">Install</span>.
          </p>
        )}

        {platform === 'ios-other' && (
          <p className="mt-3 text-xs text-muted-foreground">
            To install on iPhone/iPad, open Clear in <span className="font-semibold text-foreground">Safari</span> first.
          </p>
        )}

        <button
          type="button"
          onClick={dismiss}
          className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {deferred ? 'Maybe later' : 'Dismiss'}
        </button>
      </motion.div>
    </motion.div>
  );
}
