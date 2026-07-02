import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { usePushRegistration, pushSupported, notificationPermission } from '@/hooks/usePushRegistration';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'clear_notif_prime_dismissed';

const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

/**
 * One-time gesture CTA to turn on notifications — the tap is the user gesture iOS requires. Only shown
 * when push can actually be enabled: supported, permission still undecided, and (on iOS) running as an
 * installed Home-Screen PWA. Dismissible; self-hides once permission is decided.
 */
export default function NotificationPrime({ className }: { className?: string }) {
  const { enablePush } = usePushRegistration();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);

  const iosBlocked = isIOS() && !isStandalone(); // iOS needs the installed PWA for push
  if (hidden || iosBlocked || !pushSupported() || notificationPermission() !== 'default') return null;

  const enable = async () => {
    setBusy(true);
    const result = await enablePush();
    setBusy(false);
    if (result !== 'default') setHidden(true); // decided (granted/denied/unsupported) → stop prompting
  };
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setHidden(true);
  };

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-info/20 bg-info/5 p-3', className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
        <Bell className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">Turn on notifications</span>
        <span className="block text-xs text-muted-foreground">Get alerts for payments, requests &amp; credits — even when the app is closed.</span>
      </span>
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Enabling…' : 'Enable'}
      </button>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
