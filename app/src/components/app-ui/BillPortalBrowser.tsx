import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, Lock, CreditCard, ChevronUp, ShieldCheck, Loader2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useClearCard } from '@/hooks/useClearCard';
import StripeCardDetails, { stripeCardsConfigured } from '@/components/app-ui/StripeCardDetails';
import type { BillPortal } from '@/data/billPortals';

/*
 * In-app "browser" for a bill portal: loads the biller's own page in an iframe with a read-only URL bar,
 * and a floating Clear card overlay to copy while paying. Many billers block framing (X-Frame-Options),
 * which fires no error event, so we use a load timeout: if the frame hasn't loaded in time we assume it's
 * blocked and show a branded launch screen that opens the site in a new tab instead.
 *
 * P2: <CardOverlay/> gets the live Stripe Issuing Element (PAN/CVV) + real tap-to-copy behind a passkey.
 */
const LOAD_TIMEOUT_MS = 3500;

export default function BillPortalBrowser({ portal, onClose }: { portal: BillPortal | null; onClose: () => void }) {
  const [blocked, setBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!portal) return;
    setBlocked(false);
    setLoaded(false);
    timer.current = setTimeout(() => setBlocked(true), LOAD_TIMEOUT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [portal]);

  if (!portal) return null;
  const host = (() => {
    try {
      return new URL(portal.url).host;
    } catch {
      return portal.url;
    }
  })();

  const openExternal = () => window.open(portal.url, '_blank', 'noopener,noreferrer');

  return (
    <Dialog open={!!portal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[960px] flex-col gap-0 overflow-hidden p-0">
        {/* browser chrome */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-secondary/60 px-2.5 py-1.5">
            <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs text-muted-foreground">{host}</span>
          </div>
          <button
            type="button"
            onClick={openExternal}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Open in new tab</span>
          </button>
        </div>

        {/* content: iframe, or a branded launch screen if framing is blocked */}
        <div className="relative min-h-0 flex-1 bg-background">
          {!blocked ? (
            <iframe
              title={portal.name}
              src={portal.url}
              onLoad={() => {
                if (timer.current) clearTimeout(timer.current);
                setLoaded(true);
              }}
              className="h-full w-full border-0"
              referrerPolicy="no-referrer"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-2xl">🔒</div>
              <div className="mt-4 text-base font-semibold text-foreground">{portal.name} opens in a new tab</div>
              <p className="mt-1 max-w-[320px] text-sm text-muted-foreground">
                For your security, {portal.name} doesn’t allow embedding. It’ll open in a new tab — keep your Clear card handy to pay.
              </p>
              <button
                type="button"
                onClick={openExternal}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
              >
                <ExternalLink className="h-4 w-4" /> Open {portal.name}
              </button>
            </div>
          )}
          {!blocked && !loaded && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
              Loading {portal.name}…
            </div>
          )}
        </div>

        {/* floating Clear card overlay (P2 renders the live card here) */}
        <CardOverlay />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Floating wallet to use the Clear card while paying. Shows the live Stripe Issuing card once active
 * (P2), an Activate CTA when the card program is configured but the user has no card yet, or an
 * "activating soon" state until the backend has card credentials.
 */
function CardOverlay() {
  const [open, setOpen] = useState(false);
  const { configured, card, active, hasCard, activate, activating } = useClearCard();

  return (
    <div className="border-t border-border bg-card px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
          <CreditCard className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">Pay with your Clear card</span>
          <span className="block text-xs text-muted-foreground">Funded from your Cash balance · USDC</span>
        </span>
        <ChevronUp className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2">
          {active && hasCard && card?.stripeCardId && stripeCardsConfigured() ? (
            <div className="rounded-xl bg-gradient-to-br from-neutral-900 to-neutral-700 p-3 dark:from-neutral-800 dark:to-neutral-950">
              <StripeCardDetails cardId={card.stripeCardId} />
              <p className="mt-2 text-[11px] text-white/60">Copy a field, then paste on the biller’s site.</p>
            </div>
          ) : configured && !hasCard ? (
            <button
              type="button"
              onClick={() => void activate()}
              disabled={activating}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-60"
            >
              {activating ? <><Loader2 className="h-4 w-4 animate-spin" /> Setting up…</> : 'Activate your Clear card'}
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-amber-500" />
              Your Clear card is activating — card details to copy will appear here once it’s live.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
