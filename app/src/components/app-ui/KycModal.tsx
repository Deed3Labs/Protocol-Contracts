import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ShieldCheck, IdCard, Camera, Check, Loader2, Lock, Sparkles, ScanLine } from 'lucide-react';
import { PERSONA_CONFIGURED, runPersonaInquiry } from '@/lib/personaInquiry';
import { cn } from '@/lib/utils';

/*
 * Identity verification gate (KYC). Required before moving money. When Persona is configured
 * (VITE_PERSONA_TEMPLATE_ID), the verifying step launches the real embedded Persona inquiry and
 * returns its inquiry id; otherwise it falls back to a mocked checklist so the prototype works.
 *
 * The completed inquiry id is the reusable KYC "passport" handed to Bridge customer creation
 * (persona_inquiry_type) / Colossus — see BridgeContext + lib/integrations.
 */
export default function KycModal({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onVerified: (inquiryId?: string) => void;
}) {
  const [step, setStep] = useState<'intro' | 'verifying' | 'done'>('intro');
  const [phase, setPhase] = useState(0);
  const [inquiryId, setInquiryId] = useState<string | undefined>(undefined);
  const launchedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setStep('intro');
      setInquiryId(undefined);
    }
  }, [open]);

  useEffect(() => {
    if (step !== 'verifying') {
      setPhase(0);
      launchedRef.current = false;
      return;
    }

    // Real Persona embedded inquiry.
    if (PERSONA_CONFIGURED) {
      if (launchedRef.current) return;
      launchedRef.current = true;
      let active = true;
      runPersonaInquiry()
        .then((res) => {
          if (!active) return;
          if (res) {
            setInquiryId(res.inquiryId);
            setStep('done');
          } else {
            setStep('intro'); // cancelled
          }
        })
        .catch(() => active && setStep('intro'));
      return () => {
        active = false;
      };
    }

    // Mock fallback (Persona not configured).
    const t1 = setTimeout(() => setPhase(1), 700);
    const t2 = setTimeout(() => setPhase(2), 1500);
    const t3 = setTimeout(() => setStep('done'), 2400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [step]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        {step === 'intro' && (
          <div className="p-5">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-info/10 text-info">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <h2 className="mt-3 font-display text-2xl tracking-tight text-foreground">Verify your identity</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">A quick check is required before you can move money. Takes about 2 minutes — powered by Persona.</p>

            <div className="mt-4 space-y-2.5">
              <Need icon={IdCard} text="A government-issued photo ID" />
              <Need icon={Camera} text="A quick selfie to match it" />
              <Need icon={Lock} text="Encrypted, and reusable across Clear's partners" />
            </div>

            <button
              type="button"
              onClick={() => setStep('verifying')}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Start verification
            </button>
            <button
              type="button"
              disabled
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground opacity-60"
            >
              Continue without verifying · privacy-first
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium">Soon</span>
            </button>
            <p className="mt-3 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3 text-positive" /> Verify once — reused for cards, transfers &amp; partners like Bridge.
            </p>
          </div>
        )}

        {step === 'verifying' && (
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Verifying identity</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <ScanLine className="h-3 w-3" /> Powered by Persona
              </span>
            </div>
            {PERSONA_CONFIGURED ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Loader2 className="h-9 w-9 animate-spin text-muted-foreground" />
                <p className="mt-4 text-sm font-medium text-foreground">Opening secure verification…</p>
                <p className="mt-1 text-xs text-muted-foreground">Complete the steps in the Persona window.</p>
              </div>
            ) : (
              <>
                {/* mock fallback when Persona isn't configured */}
                <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3">
                  <Progress icon={IdCard} label="Government ID" done={phase >= 1} active={phase < 1} />
                  <Progress icon={Camera} label="Selfie match" done={phase >= 2} active={phase === 1} />
                  <Progress icon={ShieldCheck} label="Checking records" done={false} active={phase >= 2} />
                </div>
                <p className="mt-3 text-center text-[11px] text-muted-foreground">This usually takes a few seconds — hang tight.</p>
              </>
            )}
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
              <p className="text-[11px] text-muted-foreground">Saved as your verification passport — reused for partners like Bridge, no re-check needed.</p>
            </div>
            <button
              type="button"
              onClick={() => onVerified(inquiryId)}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.99]"
            >
              Continue
            </button>
          </div>
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

function Progress({ icon: Icon, label, done, active }: { icon: typeof IdCard; label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          done ? 'bg-positive/15 text-positive' : active ? 'bg-info/15 text-info' : 'bg-secondary text-muted-foreground',
        )}
      >
        {done ? <Check className="h-4 w-4" strokeWidth={3} /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className={cn('text-sm', done || active ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}
