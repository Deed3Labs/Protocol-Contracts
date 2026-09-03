import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Card from '@/components/clear/Card';
import DetailRows from '@/components/clear/DetailRows';
import InfoBlock from '@/components/clear/InfoBlock';
import OnboardingShell from '@/components/onboarding/OnboardingShell';
import CodeInput from '@/components/onboarding/CodeInput';
import { money } from '@/lib/money';

/**
 * Sign-in, sign-up and onboarding.
 *
 * Signing in and signing up are the same entry — there's no separate "already
 * have an account?" branch, because a member typing their phone number doesn't
 * know or care which one they're doing.
 *
 * Two things are deliberately deferred rather than gated at the door: identity
 * verification waits until the first deposit, so someone can look around before
 * handing over an SSN; and there is no password at any point, only a mailed code
 * and then the device itself.
 *
 * Presentational only — no auth calls, on purpose. `OnboardingRoute` drives it live and
 * `PreviewApp` drives it to be looked at, and neither has to know which the other is doing.
 *
 * That is also why steps and fields are both controllable: the flow says where somebody wants to
 * go and what they typed, and the container decides what any of it means. An unserved ZIP going
 * to the waitlist instead of through is a decision, and it is made there rather than here.
 *
 * `LoginRoute` drives `enter` and `verify`; `OnboardingRoute` starts at `join`, because a member
 * reaching /onboarding has already signed in.
 * ClaimFunds still owns the claim steps.
 */
export type OnboardingStep =
  | 'enter'
  | 'verify'
  | 'join'
  | 'identity'
  | 'waitlist'
  | 'claim'
  | 'claimJoin';

/** The brand-panel copy answers the question each step raises. */
const BRAND: Record<OnboardingStep, { eyebrow: string; note?: string; headline: string; body: string }> = {
  enter: {
    eyebrow: '1 · ENTER',
    headline: 'Your rent is making someone else rich.',
    body: 'Clear is a member-owned cooperative. Save toward a home, spend what you save, and borrow against it when you need to — without a credit check.',
  },
  verify: {
    eyebrow: '2 · VERIFY',
    headline: 'A code, not a password.',
    body: 'We text or email you a six-digit code. Next time your phone unlocks the app — there is no password to forget or leak.',
  },
  join: {
    eyebrow: '3 · JOIN',
    headline: 'Member-owned, not customer-owned.',
    body: "What you save is your stake. One member, one vote — decisions about what we build and where get made by the people living in the homes, not by whoever saved the most.",
  },
  identity: {
    eyebrow: '4 · VERIFY IDENTITY',
    note: '— AT FIRST DEPOSIT',
    headline: 'We only ask once, and only when it matters.',
    body: 'Identity checks are required before anyone can hold money for you. We wait until your first deposit so you can look around first.',
  },
  waitlist: {
    eyebrow: 'WAITLIST',
    headline: 'We open regions when enough people are waiting.',
    body: 'Clear starts in one place and grows to the next. Adding your ZIP tells us where to go.',
  },
  claim: {
    eyebrow: 'CLAIM · 1',
    headline: 'Someone already put money in your account.',
    body: 'Members can send to anyone. If they are not a member yet, the money waits until they join — and joining is free.',
  },
  claimJoin: {
    eyebrow: 'CLAIM · 2',
    note: '— INVITE PREFILLED',
    headline: 'Someone already put money in your account.',
    body: 'Members can send to anyone. If they are not a member yet, the money waits until they join — and joining is free.',
  },
};

const COOP_TERMS = [
  {
    title: 'What you save is your share',
    body: 'Your Equity Savings Account is your ownership stake. No buy-in, no fee to join.',
  },
  {
    title: 'One member, one vote',
    body: "However much you save, your vote counts the same as everyone else's.",
  },
  { title: 'Yours to withdraw', body: 'If you leave, your balance leaves with you.' },
];

const IDENTITY_STEPS = [
  { label: 'Legal name & date of birth' },
  { label: 'Home address' },
  { label: 'SSN', note: "Not a credit check. Doesn't affect your score." },
  { label: 'Photo of your ID' },
];

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs text-foreground-secondary">{children}</label>;
}

/** Pushes the footnote to the bottom of the panel, as the reference does. */
function Footnote({ children, align = 'center' }: { children: React.ReactNode; align?: 'center' | 'left' }) {
  return (
    <p
      className={`mt-auto pt-4 text-[11px] leading-relaxed text-muted-foreground ${align === 'center' ? 'text-center' : ''}`}
    >
      {children}
    </p>
  );
}

/** Everything the flow collects. The container owns these; the flow only reports edits. */
export interface OnboardingValues {
  contact: string;
  code: string;
  zip: string;
  invite: string;
  email: string;
}

const EMPTY_VALUES: OnboardingValues = { contact: '', code: '', zip: '', invite: '', email: '' };

export default function OnboardingFlow({
  step = 'enter',
  onStepChange,
  values,
  onValuesChange,
  /** Who sent the money, on the claim steps. */
  sender = 'Diego R.',
  claimAmount = 40,
  claimExpiresInDays = 12,
  /** The ZIP that isn't covered, on the waitlist step. */
  waitlistZip = '43215',
  waitlistRegion = 'Columbus, OH',
  waitlistPosition = 184,
  sentTo = '(909) 555-0148',
  auth,
}: {
  step?: OnboardingStep;
  onStepChange?: (step: OnboardingStep) => void;
  /**
   * Controlled fields. Omit them and the flow keeps its own, which is what the preview harness
   * wants -- it drives steps to look at them, not to collect anything.
   */
  values?: OnboardingValues;
  onValuesChange?: (patch: Partial<OnboardingValues>) => void;
  sender?: string;
  claimAmount?: number;
  claimExpiresInDays?: number;
  waitlistZip?: string;
  waitlistRegion?: string;
  waitlistPosition?: number;
  sentTo?: string;
  /**
   * Real sign-in, when a container is driving. Omitted in the preview harness, where the buttons
   * simply advance the step — the screens are the same either way, which is the point of keeping
   * this optional rather than forking the component.
   */
  auth?: {
    busy: boolean;
    error?: string | null;
    /** Seconds until a code can be resent; 0 means it can be. */
    resendIn: number;
    onContinue: () => void;
    onOAuth: (provider: 'google' | 'apple') => void;
    onSubmitCode: (code: string) => void;
    onResend: () => void;
  };
}) {
  // Uncontrolled unless a container supplies values, so PreviewApp keeps working untouched: it
  // passes a step and nothing else, because looking at a screen is not collecting anything.
  const [internal, setInternal] = useState<OnboardingValues>({
    ...EMPTY_VALUES,
    code: '492',
    zip: '92373',
  });
  const current = values ?? internal;
  const patch = (next: Partial<OnboardingValues>) => {
    setInternal((previous) => ({ ...previous, ...next }));
    onValuesChange?.(next);
  };
  const { contact, code, zip, invite, email } = current;
  const setContact = (v: string) => patch({ contact: v });
  const setCode = (v: string) => patch({ code: v });
  const setZip = (v: string) => patch({ zip: v });
  const setInvite = (v: string) => patch({ invite: v });
  const setEmail = (v: string) => patch({ email: v });

  const go = (next: OnboardingStep) => () => onStepChange?.(next);
  const brand = BRAND[step];

  return (
    <OnboardingShell
      eyebrow={brand.eyebrow}
      eyebrowNote={brand.note}
      headline={brand.headline}
      body={brand.body}
    >
      {step === 'enter' && (
        <>
          <p className="mb-1.5 text-[22px] font-medium tracking-[-0.3px]">Clear</p>
          <p className="mb-5 text-[13px] leading-relaxed text-foreground-secondary">
            Save for a home. Spend what you save. No credit check.
          </p>
          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Phone or email"
            aria-label="Phone or email"
            className="mb-2"
            inputMode="email"
            autoComplete="username"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && auth && !auth.busy) auth.onContinue();
            }}
          />
          <Button
            size="xs"
            className="mb-3.5 w-full"
            onClick={auth ? auth.onContinue : go('verify')}
            disabled={auth?.busy}
          >
            {auth?.busy ? 'Sending…' : 'Continue'}
          </Button>

          <div className="mb-3.5 flex items-center gap-2">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            variant="clear"
            size="xs"
            className="mb-2 w-full"
            onClick={auth ? () => auth.onOAuth('google') : go('verify')}
            disabled={auth?.busy}
          >
            Continue with Google
          </Button>
          <Button
            variant="clear"
            size="xs"
            className="w-full"
            onClick={auth ? () => auth.onOAuth('apple') : go('verify')}
            disabled={auth?.busy}
          >
            Continue with Apple
          </Button>

          {auth?.error && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-negative">{auth.error}</p>
          )}

          <Footnote>Signing in and signing up are the same. We&rsquo;ll figure out which.</Footnote>
        </>
      )}

      {step === 'verify' && (
        <>
          <p className="mb-1.5 text-xl font-medium">Enter your code</p>
          <p className="mb-5 text-[13px] leading-relaxed text-foreground-secondary">
            Sent to {sentTo}
          </p>
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next);
              // Submitted on the sixth digit rather than behind a button. There is nothing else to
              // decide on this screen, and a code that sits there waiting for a press is a step
              // somebody has to be told to take.
              if (auth && next.length === 6 && !auth.busy) auth.onSubmitCode(next);
            }}
          />

          {auth?.error && (
            <p className="mb-1.5 text-[11px] leading-relaxed text-negative">{auth.error}</p>
          )}

          {auth ? (
            auth.resendIn > 0 ? (
              <p className="text-xs text-muted-foreground">
                Resend in 0:{String(auth.resendIn).padStart(2, '0')}
              </p>
            ) : (
              <button
                type="button"
                onClick={auth.onResend}
                disabled={auth.busy}
                className="text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-60"
              >
                Send a new code
              </button>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Resend in 0:24</p>
          )}

          <Footnote align="left">Next time, use Face ID instead.</Footnote>
        </>
      )}

      {(step === 'join' || step === 'claimJoin') && (
        <>
          <p className="mb-1.5 text-xl font-medium">Join the co-op</p>
          <p className="mb-4 text-[13px] leading-relaxed text-foreground-secondary">
            {step === 'claimJoin'
              ? `Your ${money(claimAmount)} is waiting. Joining is free — the full amount lands in your account.`
              : 'Clear is member-owned. Joining makes you a part-owner, not a customer.'}
          </p>

          {step === 'claimJoin' ? (
            <>
              <DetailRows
                className="mb-3"
                rows={[
                  { label: 'You receive', value: money(claimAmount, { cents: true }) },
                  { label: 'Cost to join', value: 'None' },
                  { label: 'Your vote', value: 'Same as every member' },
                ]}
              />
              <InfoBlock className="mb-3.5 text-[11px]">
                Invited by {sender} — no code needed.
              </InfoBlock>
            </>
          ) : (
            <>
              <Card className="mb-3 text-xs leading-relaxed">
                {COOP_TERMS.map((term, i) => (
                  <div
                    key={term.title}
                    className={`flex gap-2.5 py-2.5 first:pt-0 last:pb-0 ${i < COOP_TERMS.length - 1 ? 'border-b-[0.5px] border-border' : ''}`}
                  >
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-tier-savings" />
                    <div>
                      <p>{term.title}</p>
                      <p className="mt-0.5 text-muted-foreground">{term.body}</p>
                    </div>
                  </div>
                ))}
              </Card>

              <Label>ZIP code</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} className="mb-3" />

              <Label>
                Invite code <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                placeholder="IE-7742"
                className="mb-3.5"
              />
            </>
          )}

          <Button size="xs" className="w-full" onClick={go('identity')}>
            Agree &amp; join
          </Button>
          {step === 'join' && <Footnote>Membership agreement &amp; bylaws</Footnote>}
        </>
      )}

      {step === 'identity' && (
        <>
          <p className="mb-1.5 text-xl font-medium">One-time check</p>
          <p className="mb-4 text-[13px] leading-relaxed text-foreground-secondary">
            Required before we can hold money for you. Takes about two minutes.
          </p>

          <ol className="mb-4 text-xs leading-relaxed">
            {IDENTITY_STEPS.map((item, i) => (
              <li key={item.label} className="flex gap-2.5 pb-3 last:pb-0">
                <span className="text-muted-foreground">{i + 1}</span>
                <div>
                  <p>{item.label}</p>
                  {item.note && <p className="mt-0.5 text-muted-foreground">{item.note}</p>}
                </div>
              </li>
            ))}
          </ol>

          <Button size="xs" className="mt-auto w-full">
            Start
          </Button>
          <p className="mt-2.5 text-center text-[11px] text-muted-foreground">
            You can look around first — this only blocks deposits.
          </p>
        </>
      )}

      {step === 'waitlist' && (
        <>
          <p className="mb-1.5 text-xl font-medium">Not in your area yet</p>
          <p className="mb-4 text-[13px] leading-relaxed text-foreground-secondary">
            Clear is starting in the Inland Empire. We&rsquo;re not open in{' '}
            <strong className="font-medium">{waitlistZip}</strong> — but we&rsquo;re keeping a list.
          </p>

          <InfoBlock className="mb-3.5">
            You&rsquo;re #{waitlistPosition} on the list for {waitlistRegion}. We open regions where
            enough people are waiting.
          </InfoBlock>

          <Label>Email for updates</Label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mb-3"
          />
          <Button size="xs" className="mb-2 w-full">
            Keep me posted
          </Button>
          <Button variant="clear" size="xs" className="w-full">
            Share Clear with a neighbor
          </Button>

          <Footnote>Moving to the IE? Change your ZIP any time.</Footnote>
        </>
      )}

      {step === 'claim' && (
        <>
          <div className="mb-4 rounded-lg bg-tier-savings/10 p-3.5 text-center">
            <p className="mb-1 text-xs text-tier-savings-fg">{sender} sent you</p>
            <p className="font-display text-[30px] font-medium leading-none tracking-[-0.5px] text-tier-savings-fg">
              {money(claimAmount)}
            </p>
          </div>

          <p className="mb-4 text-[13px] leading-relaxed text-foreground-secondary">
            Claim it with your phone number. Clear is a member-owned co-op in the Inland Empire —{' '}
            {sender.split(' ')[0]}&rsquo;s already a member.
          </p>

          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Phone or email"
            aria-label="Phone or email"
            className="mb-2"
          />
          <Button size="xs" className="w-full" onClick={go('claimJoin')}>
            Claim {money(claimAmount)}
          </Button>

          <Footnote>Expires in {claimExpiresInDays} days</Footnote>
        </>
      )}
    </OnboardingShell>
  );
}
