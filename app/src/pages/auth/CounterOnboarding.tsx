import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SplitChooser from '@/components/clear/SplitChooser';
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
 */
export type CounterStep = 'scan' | 'enter' | 'join' | 'link' | 'choose';

export const COUNTER_STEPS: CounterStep[] = ['scan', 'enter', 'join', 'link', 'choose'];

const EYEBROW: Record<CounterStep, string> = {
  scan: '1 · SCAN',
  enter: '2 · ENTER',
  join: '3 · JOIN',
  link: '4 · LINK',
  choose: '5 · CHOOSE',
};

/** The shop and the amount, carried on every step between the scan and the choice. */
function PendingTotal({ merchant, amount }: { merchant: string; amount: number }) {
  return (
    <div className="mb-[18px] flex items-baseline justify-between gap-3 rounded-lg bg-tier-boost/10 px-3 py-2.5">
      <span className="min-w-0 truncate text-xs text-tier-boost-fg">{merchant}</span>
      <span className="shrink-0 text-sm font-medium tabular-nums text-tier-boost-fg">
        {money(amount, { cents: true })}
      </span>
    </div>
  );
}

function Step({
  step,
  headline,
  body,
  children,
  footnote,
  action,
  onAction,
  pending,
}: {
  step: CounterStep;
  headline: string;
  body: string;
  children?: ReactNode;
  footnote: ReactNode;
  action: string;
  onAction?: () => void;
  pending?: ReactNode;
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

        {/* Pinned to the bottom so the button lands under the thumb regardless of step length. */}
        <Button size="sm" className="mt-auto w-full" onClick={onAction}>
          {action}
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
}: {
  step?: CounterStep;
  onStepChange?: (step: CounterStep) => void;
  merchant?: string;
  amount?: number;
  shopUrl?: string;
  inviteCode?: string;
  splitOptions?: number[];
  ratePerCycle?: number;
  rate?: string;
}) {
  const [phone, setPhone] = useState('');
  const [zip, setZip] = useState('');
  const [splitInto, setSplitInto] = useState(4);

  const go = (next: CounterStep) => () => onStepChange?.(next);
  const pending = <PendingTotal merchant={merchant} amount={amount} />;

  if (step === 'scan') {
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
        action="Add to Home Screen"
        onAction={go('enter')}
      >
        <div className="rounded-xl border-[0.5px] border-dashed border-border px-5 py-5 text-center">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Shop code opens
            <br />
            {shopUrl}
          </p>
        </div>
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
      >
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
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
      >
        <Input
          value={zip}
          onChange={(e) => setZip(e.target.value)}
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
        action="Connect securely"
        onAction={go('choose')}
      >
        <button
          type="button"
          className="w-full rounded-[10px] border-[0.5px] border-border px-3.5 py-[11px] text-left text-[13px]"
        >
          Search your bank
        </button>
      </Step>
    );
  }

  return (
    <Step
      step="choose"
      headline={`${money(amount, { cents: true })} approved`}
      body="Pick how to clear it. You can change this any time."
      footnote="Clearing early always costs less."
      action="Confirm & show the shop"
      onAction={go('scan')}
    >
      <SplitChooser
        amount={amount}
        options={splitOptions}
        ratePerCycle={ratePerCycle}
        rate={rate}
        splitInto={splitInto}
        onChange={setSplitInto}
        doneBy={(n) => `${n} cycle${n === 1 ? '' : 's'} from now`}
      />
    </Step>
  );
}
