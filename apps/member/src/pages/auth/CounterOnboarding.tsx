import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SplitChooser from '@/components/clear/SplitChooser';
import PendingTotalHeader from '@/components/onboarding/PendingTotalHeader';
import AddToHomeScreen from '@/components/onboarding/AddToHomeScreen';
import BankLinkStep, { BankLinkSkip } from '@/components/onboarding/BankLinkStep';
import { installActionLabel, type InstallMode } from '@/lib/installPrompt';
import { money } from '@/lib/money';

/**
 * Signing up at a merchant counter — design spec §12b.
 *
 * A different flow from the direct path, not a variant of it. It starts by scanning the shop's code
 * rather than arriving at a site, and the **pending total rides along on every step**: it's the
 * strongest motivation in the product, and it's what makes a five-step flow tolerable while someone
 * stands at a counter waiting.
 *
 * **Linking an account is required here**, where the direct path defers it. It's the underwriting,
 * the repayment rail and the limit calculation at once — and it's the likeliest place to lose
 * someone, which is why the step spends its words on what the link is for rather than on the
 * mechanics of connecting it.
 *
 * Identity verification still waits for the first deposit, exactly as on the direct path. A bank
 * link isn't a KYC substitute, but it's enough to extend a small term plan.
 *
 * Presentational, like `OnboardingFlow`. Every prop below is optional and falls back to the
 * reference's own figures, which is what lets the preview harness render all five steps with no
 * backend while `CounterOnboardingRoute` drives the same component live.
 */
export type CounterStep = 'scan' | 'enter' | 'join' | 'link' | 'choose';

export const COUNTER_STEPS: CounterStep[] = ['scan', 'enter', 'join', 'link', 'choose'];

export interface CounterValues {
  phone: string;
  zip: string;
  splitInto: number;
}

const EYEBROW: Record<CounterStep, string> = {
  scan: '1 · SCAN',
  enter: '2 · ENTER',
  join: '3 · JOIN',
  link: '4 · LINK',
  choose: '5 · CHOOSE',
};

function Step({
  step,
  headline,
  body,
  children,
  footnote,
  action,
  onAction,
  pending,
  afterFootnote,
  busy = false,
  actionDisabled = false,
}: {
  step: CounterStep;
  headline: string;
  body: string;
  children?: ReactNode;
  footnote: ReactNode;
  action: string;
  onAction?: () => void;
  pending?: ReactNode;
  /** Sits below the step's footnote — for anything that must not interrupt it. */
  afterFootnote?: ReactNode;
  busy?: boolean;
  actionDisabled?: boolean;
}) {
  return (
    // Full-bleed and full-height: this is someone's whole screen while they stand at a counter.
    <div className="flex min-h-screen flex-col px-5 py-8">
      <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col">
        <p className="mb-5 text-[10px] tracking-[0.3px] text-muted-foreground">
          {EYEBROW[step]}
          {step === 'link' && <span className="text-tier-boost-fg"> — REQUIRED</span>}
        </p>

        {pending}

        <p className="mb-1.5 text-[19px] font-medium tracking-[-0.3px]">{headline}</p>
        <p className="mb-5 text-[13px] leading-relaxed text-foreground-secondary">{body}</p>

        {children}

        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{footnote}</p>

        {afterFootnote}

        {/* Pinned to the bottom so the button lands under the thumb regardless of step length. */}
        <Button
          size="sm"
          className="mt-auto w-full"
          onClick={onAction}
          disabled={busy || actionDisabled}
        >
          {busy ? 'One moment…' : action}
        </Button>
      </div>
    </div>
  );
}

export default function CounterOnboarding({
  step = 'scan',
  onStepChange,
  merchant = "Mike's Tire",
  amount = 940,
  shopUrl = 'clear.coop/mikes-tire',
  inviteCode = 'MIKES-TIRE',
  splitOptions = [1, 2, 4, 12],
  ratePerCycle = 0.02,
  rate = '2% / cycle',
  values,
  onValuesChange,
  install,
  bank,
  approvedCents = null,
  busy = false,
}: {
  step?: CounterStep;
  onStepChange?: (step: CounterStep) => void;
  merchant?: string;
  /** Null when the code carried no charge — a printed shop sticker rather than a sale in progress. */
  amount?: number | null;
  shopUrl?: string;
  inviteCode?: string;
  splitOptions?: number[];
  ratePerCycle?: number;
  rate?: string;
  values?: CounterValues;
  onValuesChange?: (patch: Partial<CounterValues>) => void;
  install?: { mode: InstallMode; onInstall: () => void };
  bank?: {
    linked: boolean;
    busy: boolean;
    error?: string | null;
    onConnect: () => void;
    onSkip?: () => void;
  };
  /** What the member's line actually covers, read from the credit contracts. Null when unchecked. */
  approvedCents?: number | null;
  busy?: boolean;
}) {
  // Uncontrolled fallback so the preview harness renders every step without a container.
  const [ownValues, setOwnValues] = useState<CounterValues>({ phone: '', zip: '', splitInto: 4 });
  const v = values ?? ownValues;
  const setValues = (patch: Partial<CounterValues>) =>
    onValuesChange ? onValuesChange(patch) : setOwnValues((prev) => ({ ...prev, ...patch }));

  const go = (next: CounterStep) => () => onStepChange?.(next);
  const pending =
    amount == null ? undefined : <PendingTotalHeader merchant={merchant} amount={amount} className="mb-[18px]" />;

  if (step === 'scan') {
    const mode = install?.mode ?? 'prompt';
    return (
      <Step
        step="scan"
        headline="Add Clear"
        body="Point your camera at the code on the counter."
        footnote={
          <>
            Then tap <strong className="font-medium">Add to Home Screen</strong>. No app store, no
            download.
          </>
        }
        action={install ? installActionLabel(mode) : 'Add to Home Screen'}
        onAction={install ? install.onInstall : go('enter')}
        busy={busy}
      >
        <AddToHomeScreen shopUrl={shopUrl} mode={mode} />
      </Step>
    );
  }

  if (step === 'enter') {
    return (
      <Step
        step="enter"
        pending={pending}
        headline="Cover this over time"
        body="Clear pays the shop today. You pay Clear back over the next few cycles."
        footnote="No credit check. About three minutes."
        action="Continue"
        onAction={go('join')}
        busy={busy}
      >
        <Input
          value={v.phone}
          onChange={(e) => setValues({ phone: e.target.value })}
          placeholder="Phone number"
          aria-label="Phone number"
          inputMode="tel"
        />
      </Step>
    );
  }

  if (step === 'join') {
    return (
      <Step
        step="join"
        pending={pending}
        headline="You're joining a co-op"
        body="Not signing up for a card. Members own Clear — one member, one vote, no buy-in."
        footnote="Invite code filled in from the shop."
        action="Agree & join"
        onAction={go('link')}
        busy={busy}
      >
        <Input
          value={v.zip}
          onChange={(e) => setValues({ zip: e.target.value })}
          placeholder="ZIP code"
          aria-label="ZIP code"
          inputMode="numeric"
          className="mb-2"
        />
        {/* Pre-filled from the shop's code — the member never types it, and shouldn't have to. */}
        <Input value={inviteCode} readOnly aria-label="Invite code" />
      </Step>
    );
  }

  if (step === 'link') {
    return (
      <Step
        step="link"
        pending={pending}
        headline="Connect your bank"
        body="This is how we say yes without a credit check, and how repayment comes out. Use the account your pay lands in."
        footnote="Read-only. We never see your login, and nothing moves without your say-so."
        action={bank?.linked ? 'Continue' : 'Connect securely'}
        onAction={bank && !bank.linked ? bank.onConnect : go('choose')}
        busy={busy}
        actionDisabled={bank?.busy ?? false}
        afterFootnote={
          bank?.onSkip && !bank.linked ? (
            <BankLinkSkip busy={bank.busy} onSkip={bank.onSkip} />
          ) : undefined
        }
      >
        {bank ? (
          <BankLinkStep
            linked={bank.linked}
            busy={bank.busy}
            error={bank.error}
            onConnect={bank.onConnect}
          />
        ) : (
          <BankLinkStep linked={false} busy={false} onConnect={go('choose')} />
        )}
      </Step>
    );
  }

  const due = amount ?? 0;
  // "Approved" is a claim about the member's line, so it is made from the line rather than from
  // the amount on the screen. Short of it, the screen says what is actually there — a number
  // somebody can act on beats a word that turns out not to have been true at the register.
  const covered = approvedCents == null || approvedCents >= Math.round(due * 100);
  const available = (approvedCents ?? 0) / 100;

  return (
    <Step
      step="choose"
      headline={covered ? `${money(due, { cents: true })} approved` : `${money(available, { cents: true })} available`}
      body={
        covered
          ? 'Pick how to clear it. You can change this any time.'
          : 'Your line covers part of this today. Pick how to clear that part, and put the rest on another method.'
      }
      footnote="Clearing early always costs less."
      action="Confirm & show the shop"
      onAction={go('scan')}
      busy={busy}
    >
      <SplitChooser
        amount={covered ? due : available}
        options={splitOptions}
        ratePerCycle={ratePerCycle}
        rate={rate}
        splitInto={v.splitInto}
        onChange={(n) => setValues({ splitInto: n })}
        doneBy={(n) => `${n} cycle${n === 1 ? '' : 's'} from now`}
      />
    </Step>
  );
}
