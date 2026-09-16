import { useState, type ReactNode } from 'react';
import AuthShell, { LabelledField, StepHead } from '@/components/clear/auth/AuthShell';
import { Btn } from '@/components/clear/brand/anatomy';
import SplitChooser from '@/components/clear/SplitChooser';
import PendingTotalHeader from '@/components/onboarding/PendingTotalHeader';
import AddToHomeScreen from '@/components/onboarding/AddToHomeScreen';
import BankLinkStep, { BankLinkSkip } from '@/components/onboarding/BankLinkStep';
import { installActionLabel, type InstallMode } from '@/lib/installPrompt';
import { money } from '@clear/domain';

/**
 * Signing up at a merchant counter — design spec §12b.
 *
 * A different flow from the direct path, not a variant of it. It starts by scanning the shop's code
 * rather than arriving at a site, and the **pending total rides along on every step**: it's the
 * strongest motivation in the product, and it's what makes a five-step flow tolerable while someone
 * stands at a counter waiting. The total sits above the panel, because it belongs to the visit
 * rather than to any one step.
 *
 * **Linking an account is required here**, where the direct path defers it. It's the underwriting,
 * the repayment rail and the limit calculation at once — and it's the likeliest place to lose
 * someone, which is why the step states all three reasons rather than asking for trust.
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

const LABEL: Record<CounterStep, string> = {
  scan: '1 · Scan',
  enter: '2 · Enter',
  join: '3 · Join',
  link: '4 · Link',
  choose: '5 · Choose',
};

function Step({
  step,
  title,
  lede,
  children,
  footnote,
  action,
  onAction,
  pending,
  afterAction,
  busy = false,
  actionDisabled = false,
}: {
  step: CounterStep;
  title: string;
  lede: ReactNode;
  children?: ReactNode;
  footnote?: ReactNode;
  action: string;
  onAction?: () => void;
  pending?: ReactNode;
  /** Sits below the action — for anything that must not interrupt the step's own reasoning. */
  afterAction?: ReactNode;
  busy?: boolean;
  actionDisabled?: boolean;
}) {
  return (
    <AuthShell
      solo
      label={LABEL[step]}
      count={step === 'link' ? 'Required' : undefined}
      pending={pending}
      footer={
        <Btn primary lg onClick={onAction} disabled={busy || actionDisabled}>
          {busy ? 'One moment…' : action}
        </Btn>
      }
      // The way out goes after the step's own reassurance, never between the action and it:
      // offering the exit before finishing the reason to stay is how a step loses somebody.
      footnote={
        afterAction ? (
          <>
            {footnote}
            {afterAction}
          </>
        ) : (
          footnote
        )
      }
    >
      <StepHead title={title} lede={lede} />
      {children && <div className="mt-s3">{children}</div>}
    </AuthShell>
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
    amount == null ? undefined : <PendingTotalHeader merchant={merchant} amount={amount} />;

  if (step === 'scan') {
    const mode = install?.mode ?? 'prompt';
    return (
      <Step
        step="scan"
        title="Add Clear"
        lede="Point your camera at the code on the counter."
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
        title="Cover this over time"
        lede="Clear pays the shop today. You pay Clear back over the next few cycles."
        action="Continue"
        onAction={go('join')}
        busy={busy}
      >
        <LabelledField label="Phone number">
          <input
            className="c-field w-full"
            value={v.phone}
            onChange={(e) => setValues({ phone: e.target.value })}
            placeholder="Phone number"
            inputMode="tel"
          />
        </LabelledField>
        <p className="c-det mt-s2">No credit check. About three minutes.</p>
      </Step>
    );
  }

  if (step === 'join') {
    return (
      <Step
        step="join"
        pending={pending}
        title="Join the co-op"
        lede="Joining makes you a part-owner. No buy-in, no fee."
        action="Join Clear"
        onAction={go('link')}
        busy={busy}
      >
        {/* Pre-filled from the shop's code — the member never types it, and shouldn't have to. */}
        <LabelledField label="Invite">
          <input className="c-field w-full" value={inviteCode} readOnly />
        </LabelledField>
        <p className="c-det mt-[6px]">Filled in from the shop code</p>
        <div className="mt-s2">
          <LabelledField label="Your ZIP">
            <input
              className="c-field w-full"
              value={v.zip}
              onChange={(e) => setValues({ zip: e.target.value })}
              inputMode="numeric"
            />
          </LabelledField>
        </div>
      </Step>
    );
  }

  if (step === 'link') {
    return (
      <Step
        step="link"
        pending={pending}
        title="Link an account"
        lede="This is how we say yes without a credit check."
        action={bank?.linked ? 'Continue' : 'Link with Plaid'}
        onAction={bank && !bank.linked ? bank.onConnect : go('choose')}
        busy={busy}
        actionDisabled={bank?.busy ?? false}
        footnote="Required here. It is the only step that cannot be deferred."
        afterAction={
          bank?.onSkip && !bank.linked ? <BankLinkSkip busy={bank.busy} onSkip={bank.onSkip} /> : undefined
        }
      >
        <BankLinkStep linked={bank?.linked ?? false} error={bank?.error} />
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
      pending={pending}
      title={covered ? 'Pick how to clear it' : `${money(available, { cents: true })} available`}
      lede={
        covered
          ? 'You can change this later that week, or three cycles in.'
          : 'Your line covers part of this today. Pick how to clear that part, and put the rest on another method.'
      }
      action="Approve"
      onAction={go('scan')}
      busy={busy}
      footnote="You have not been charged yet."
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
