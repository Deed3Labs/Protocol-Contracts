import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ShieldCheck, IdCard, Camera, Check, Loader2, Lock, Sparkles, ScanLine, ExternalLink, TriangleAlert } from 'lucide-react';
import { useBridge } from '@/context/BridgeContext';
import { getBridgeStatus, startBridgeKyc } from '@/utils/apiClient';

/*
 * Identity verification (KYC) — Bridge, and only Bridge.
 *
 * We ask for the member's full legal name, get a hosted Bridge link (Terms of Service first, then the
 * KYC flow), open it in a new tab, and poll until Bridge reports the customer `active`. Bridge owns
 * the verdict, so it survives reloads and matches exactly what the backend will permit.
 *
 * There deliberately is no local fallback. Verification exists solely to unlock Bridge — a pass from
 * anyone else would mark someone "verified" here while Bridge still refuses to open their account or
 * move their money. When Bridge isn't reachable we say so instead of inventing a verdict.
 *
 * If any of the member's account emails already maps to a Bridge customer, the backend reuses it
 * rather than onboarding them twice.
 */
export default function KycModal({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onVerified: () => void;
}) {
  const { configured: bridgeConfigured } = useBridge();
  const [step, setStep] = useState<'intro' | 'name' | 'verifying' | 'done'>('intro');
  const [fullName, setFullName] = useState('');
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep('intro');
      setHostedUrl(null);
      setError(null);
    }
  }, [open]);

  // Fetch the hosted link and open it. Popup blockers eat window.open inside an await, so we keep the
  // URL around and offer a manual "Reopen verification" link as the fallback.
  const startBridge = async () => {
    if (fullName.trim().length < 2) return;
    setStarting(true);
    setError(null);
    const r = await startBridgeKyc(fullName.trim());
    setStarting(false);
    if (!r.url) {
      setError(r.message || 'Could not start verification. Try again.');
      return;
    }
    setHostedUrl(r.url);
    window.open(r.url, '_blank', 'noopener,noreferrer');
    setStep('verifying');
  };

  // Poll until the customer goes `active` — the member completes KYC in another tab, so there's no
  // callback to hang off of.
  useEffect(() => {
    if (step !== 'verifying') return;
    let active = true;
    const id = setInterval(() => {
      void getBridgeStatus()
        .then((s) => {
          if (active && s.verified) setStep('done');
        })
        .catch(() => {});
    }, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [step]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        {/* Bridge unreachable → no verification is possible. Say so rather than fake a pass. */}
        {!bridgeConfigured ? (
          <div className="p-5">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-info/10 text-info">
              <TriangleAlert className="h-6 w-6" />
            </span>
            <h2 className="mt-3 font-display text-2xl tracking-tight text-foreground">Verification is unavailable</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              We can't start identity verification right now, so moving money is paused. This is on our side —
              nothing is wrong with your account. Please try again shortly.
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {step === 'intro' && (
              <div className="p-5">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-info/10 text-info">
                  <ShieldCheck className="h-6 w-6" />
                </span>
                <h2 className="mt-3 font-display text-2xl tracking-tight text-foreground">Verify your identity</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  A quick check is required before you can move money. Takes about 2 minutes — powered by Bridge.
                </p>

                <div className="mt-4 space-y-2.5">
                  <Need icon={IdCard} text="A government-issued photo ID" />
                  <Need icon={Camera} text="A quick selfie to match it" />
                  <Need icon={Lock} text="Encrypted, and reusable across Clear's partners" />
                </div>

                <button
                  type="button"
                  onClick={() => setStep('name')}
                  className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                >
                  Start verification
                </button>
                <p className="mt-3 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-positive" /> Verify once — reused for cards, transfers &amp; partners like Bridge.
                </p>
              </div>
            )}

            {step === 'name' && (
              <div className="p-5">
                <div className="mb-1 text-base font-semibold text-foreground">Your legal name</div>
                <p className="text-sm text-muted-foreground">
                  Exactly as it appears on your government ID — Bridge matches it against your documents.
                </p>
                <label className="mt-4 block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Full legal name</span>
                  <input
                    autoFocus
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void startBridge(); }}
                    placeholder="Jordan Alex Rivera"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:outline-none"
                  />
                </label>
                {error && <p className="mt-2 text-xs text-negative">{error}</p>}
                <button
                  type="button"
                  onClick={() => void startBridge()}
                  disabled={fullName.trim().length < 2 || starting}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99] disabled:opacity-40"
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {starting ? 'Opening…' : 'Continue to verification'}
                </button>
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  Opens in a new tab. Come back here when you're done — we'll pick it up automatically.
                </p>
              </div>
            )}

            {step === 'verifying' && (
              <div className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Verifying identity</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <ScanLine className="h-3 w-3" /> Powered by Bridge
                  </span>
                </div>
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Loader2 className="h-9 w-9 animate-spin text-muted-foreground" />
                  <p className="mt-4 text-sm font-medium text-foreground">Waiting for your verification…</p>
                  <p className="mt-1 text-xs text-muted-foreground">Finish the steps in the Bridge tab. This updates on its own.</p>
                  {hostedUrl && (
                    <a
                      href={hostedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Reopen verification
                    </a>
                  )}
                </div>
              </div>
            )}

            {step === 'done' && (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-positive/10">
                  <Check className="h-7 w-7 text-positive" strokeWidth={3} />
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">You're verified</div>
                <div className="mt-1 text-sm text-muted-foreground">You can now move money — cards and transfers are unlocked too.</div>
                <div className="mt-4 flex w-full items-center gap-2.5 rounded-xl border border-border bg-secondary/40 p-3 text-left">
                  <Sparkles className="h-4 w-4 shrink-0 text-positive" />
                  <p className="text-[11px] text-muted-foreground">
                    Saved with Bridge — reused across Clear, so there's no re-check for cards or transfers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onVerified}
                  className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
                >
                  Continue
                </button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Need({ icon: Icon, text }: { icon: typeof IdCard; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-foreground">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      {text}
    </div>
  );
}
