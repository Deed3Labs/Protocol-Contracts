import { useState } from 'react';
import AuthShell, { LabelledField, StepHead } from '@/components/clear/auth/AuthShell';
import PinBox from '@/components/clear/auth/PinBox';
import { Btn, Line, Rows } from '@/components/clear/brand/anatomy';
import { ChevronIcon } from '@/components/clear/brand/icons';
import { money } from '@clear/domain';

/**
 * Signing in, signing up and onboarding.
 *
 * Signing in and signing up are the same entry — there's no separate "already have an account?"
 * branch, because a member typing their phone number doesn't know or care which one they're doing.
 *
 * Two things are deliberately deferred rather than gated at the door: identity verification waits
 * until the first deposit or first plan, so someone can look around before handing over anything;
 * and there is no password at any point, only a mailed code and then the device itself.
 *
 * Presentational only — no auth calls, on purpose. `OnboardingRoute` drives it live and
 * `PreviewApp` drives it to be looked at, and neither has to know which the other is doing.
 *
 * That is also why steps and fields are both controllable: the flow says where somebody wants to
 * go and what they typed, and the container decides what any of it means. An unserved ZIP going
 * to the waitlist instead of through is a decision, and it is made there rather than here.
 *
 * `LoginRoute` drives `welcome`, `enter` and `verify`; `OnboardingRoute` starts at `join`, because a
 * member reaching /onboarding has already signed in. ClaimFunds still owns the claim steps.
 */
export type OnboardingStep =
  | 'enter'
  | 'verify'
  | 'welcome'
  | 'recovery'
  | 'join'
  | 'identity'
  | 'waitlist'
  | 'claim'
  | 'claimJoin';

/** The brand-panel copy answers the question each step raises. */
const BRAND: Record<OnboardingStep, { label: string; count?: string; statement: string; blurb: string }> = {
  enter: {
    label: '1 · Enter',
    count: '1 of 3',
    statement: 'Your rent is making someone else rich.',
    blurb:
      'Clear is a member-owned cooperative. Save toward a home, spend what you save, and borrow against it when you need to, without a credit check.',
  },
  verify: {
    label: '2 · Code',
    count: '2 of 3',
    statement: 'A code, not a password.',
    blurb:
      'We text or email you six digits. Next time your phone unlocks the app. There is no password to forget or leak.',
  },
  welcome: {
    label: 'Welcome back',
    statement: 'Your face is the key.',
    blurb: 'Nothing to type, nothing to remember, and nothing a database can leak on your behalf.',
  },
  recovery: {
    label: 'Recovery',
    // The reference draws this one on a phone only, where there is no brand panel. The statement is
    // assembled from its own note rather than written new.
    statement: 'There is no password to reset.',
    blurb:
      'Recovery is a different shape: it asks what you still have. Clear never asks for a password, because there is not one.',
  },
  join: {
    label: '3 · Join',
    count: '3 of 3',
    statement: 'Member-owned, not customer-owned.',
    blurb:
      'What you save is your stake. One member, one vote, and decisions get made by the people living in the homes rather than by whoever saved the most.',
  },
  identity: {
    label: '4 · Verify',
    count: 'Deferred',
    statement: 'We only ask once, and only when it matters.',
    blurb:
      'Identity checks are required before anyone can hold money for you. We wait until your first deposit or first plan so you can look around first.',
  },
  waitlist: {
    label: 'Waitlist',
    statement: 'We open regions when enough people are waiting.',
    blurb: 'Clear starts in one place and grows to the next. Adding your ZIP tells us where to go.',
  },
  claim: {
    label: 'Claim · 1',
    statement: 'Someone already put money in your account.',
    blurb:
      'Members can send to anyone. If they are not a member yet, the money waits until they join — and joining is free.',
  },
  claimJoin: {
    label: 'Claim · 2',
    statement: 'Someone already put money in your account.',
    blurb:
      'Members can send to anyone. If they are not a member yet, the money waits until they join — and joining is free.',
  },
};

/** The code screen turns absent when a code fails, and says so on its own line. */
const CODE_FAILED = {
  statement: 'Codes expire, on purpose.',
  blurb:
    'Ten minutes is long enough to read a text and short enough that an old one is worth nothing to anyone who finds it.',
};

const COOP_TERMS = [
  {
    title: 'What you save is your share',
    body: 'Your Equity Savings Account is your ownership stake. No buy-in, no fee to join.',
  },
  {
    title: 'One member, one vote',
    body: 'However much you save, your vote counts the same as everyone else’s.',
  },
  { title: 'Yours to withdraw', body: 'If you leave, your balance leaves with you.' },
];

/** Three situations rather than a form. The stolen phone is first aid, not a sign-in. */
const RECOVERY = [
  {
    key: 'email',
    title: 'I have my email',
    body: 'We send a code there instead. Fastest if it is still yours.',
  },
  {
    key: 'neither',
    title: 'I have neither',
    body: 'A short identity check with the same provider you used to join.',
  },
  {
    key: 'stolen',
    title: 'My phone was stolen',
    body: 'We freeze the card and sign out every device first.',
  },
];

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
  /**
   * Who the device remembers, on the returning screen, and whose legal name the identity step
   * shows. No default on purpose: a fixture name in a Legal name row is somebody else's name.
   */
  member,
  auth,
  onRecover,
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
  member?: { name: string; handle: string };
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
    /** The returning screen's first action, when the device has a passkey. */
    onPasskey?: () => void;
  };
  onRecover?: (choice: string) => void;
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

  const go = (next: OnboardingStep) => () => onStepChange?.(next);
  const failed = step === 'verify' && Boolean(auth?.error);
  const brand = BRAND[step];
  const statement = failed ? CODE_FAILED.statement : brand.statement;
  const blurb = failed ? CODE_FAILED.blurb : brand.blurb;

  const shell = (
    body: { children: React.ReactNode; footer: React.ReactNode; footnote?: React.ReactNode },
  ) => (
    <AuthShell
      statement={statement}
      blurb={blurb}
      label={brand.label}
      count={brand.count}
      footer={body.footer}
      footnote={body.footnote}
    >
      {body.children}
    </AuthShell>
  );

  if (step === 'enter') {
    return shell({
      children: (
        <>
          <StepHead
            title="Save for a home"
            lede="Spend what you save, and borrow against it without a credit check."
          />
          <div className="mt-s3">
            <LabelledField label="Phone or email">
              <input
                className="c-field w-full"
                value={contact}
                onChange={(e) => patch({ contact: e.target.value })}
                placeholder="Phone or email"
                inputMode="email"
                autoComplete="username"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && auth && !auth.busy) auth.onContinue();
                }}
              />
            </LabelledField>
            <div className="c-ordiv">
              <span>or</span>
            </div>
            <div className="c-stack">
              <Btn onClick={auth ? () => auth.onOAuth('google') : go('verify')} disabled={auth?.busy}>
                Continue with Google
              </Btn>
              <Btn onClick={auth ? () => auth.onOAuth('apple') : go('verify')} disabled={auth?.busy}>
                Continue with Apple
              </Btn>
            </div>
            {auth?.error && <p className="c-det c-errline mt-s2">{auth.error}</p>}
          </div>
        </>
      ),
      footer: (
        <Btn primary lg onClick={auth ? auth.onContinue : go('verify')} disabled={auth?.busy}>
          {auth?.busy ? 'Sending…' : 'Continue'}
        </Btn>
      ),
      footnote: 'Signing in and signing up are the same. We work out which.',
    });
  }

  if (step === 'verify') {
    // Expired and wrong are the same screen: it names the cause, resends before you ask, and offers
    // a different number.
    return shell({
      children: (
        <>
          <StepHead
            title={failed ? 'That code did not work' : 'Enter your code'}
            lede={failed ? `Codes last ten minutes. Try again, or send a new one to ${sentTo}.` : `Sent to ${sentTo}`}
          />
          <div className="mt-s3">
            <PinBox
              value={code}
              err={failed}
              autoFocus
              onChange={(next) => {
                patch({ code: next });
                // Submitted on the sixth digit rather than behind a button. There is nothing else to
                // decide on this screen, and a code that sits there waiting for a press is a step
                // somebody has to be told to take.
                if (auth && next.length === 6 && !auth.busy) auth.onSubmitCode(next);
              }}
            />
            {failed ? (
              <p className="c-det c-errline mt-s2">{auth?.error}</p>
            ) : auth && auth.resendIn <= 0 ? (
              <button type="button" onClick={auth.onResend} disabled={auth.busy} className="c-det mt-s2 underline underline-offset-2">
                Send a new code
              </button>
            ) : (
              <p className="c-det mt-s2">Resend in 0:{String(auth?.resendIn ?? 24).padStart(2, '0')}</p>
            )}
          </div>
        </>
      ),
      footer: failed ? (
        <Btn primary lg onClick={auth?.onResend} disabled={auth?.busy}>
          Resend code
        </Btn>
      ) : (
        <Btn lg onClick={go('enter')}>
          {contact.includes('@') ? 'Use a different email' : 'Use email instead'}
        </Btn>
      ),
      footnote: failed
        ? 'Not your number? Use a different one.'
        : 'Next time your face or fingerprint opens the app. There is no password.',
    });
  }

  if (step === 'welcome') {
    return shell({
      children: (
        <>
          <StepHead title="Look at your phone" lede="Face ID opens Clear. No password, nothing to forget." />
          <div className="mt-s3">
            <div className="py-s3 text-center">
              <p className="c-fig c-fig-sec mt-s2">{member?.name}</p>
              <p className="c-det mt-[4px]">{member?.handle}</p>
            </div>
            {auth?.error && <p className="c-det c-errline">{auth.error}</p>}
          </div>
        </>
      ),
      footer: (
        <div className="c-stack">
          <Btn primary lg onClick={auth?.onPasskey} disabled={auth?.busy}>
            Use Face ID
          </Btn>
          <Btn lg onClick={auth ? auth.onContinue : go('verify')} disabled={auth?.busy}>
            Send me a code instead
          </Btn>
        </div>
      ),
      footnote: (
        <button type="button" onClick={go('enter')}>
          Not you? Sign in as someone else.
        </button>
      ),
    });
  }

  if (step === 'recovery') {
    return shell({
      children: (
        <>
          <StepHead
            title="No longer have that number?"
            lede="Your money is not tied to the phone. It is tied to you."
          />
          <div className="mt-s3">
            <Rows>
              {RECOVERY.map((choice) => (
                <div key={choice.key}>
                  <button type="button" onClick={() => onRecover?.(choice.key)} className="block w-full text-left">
                    <Line className="items-center!">
                      <div>
                        <p className="text-sec">{choice.title}</p>
                        <p className="c-det mt-[3px]">{choice.body}</p>
                      </div>
                      <span className="c-det flex shrink-0">
                        <ChevronIcon />
                      </span>
                    </Line>
                  </button>
                </div>
              ))}
            </Rows>
          </div>
        </>
      ),
      footer: (
        <p className="c-det leading-[1.6]">
          Recovery never asks for a password, because there is not one. Anyone who does is not Clear.
        </p>
      ),
    });
  }

  if (step === 'join' || step === 'claimJoin') {
    return shell({
      children: (
        <>
          <StepHead
            title="Join the co-op"
            lede={
              step === 'claimJoin'
                ? `Your ${money(claimAmount)} is waiting. Joining is free — the full amount lands in your account.`
                : 'Clear is member-owned. Joining makes you a part-owner, not a customer.'
            }
          />
          <div className="mt-s3">
            <Rows>
              {COOP_TERMS.map((term) => (
                <div key={term.title}>
                  <p className="text-sec">{term.title}</p>
                  <p className="c-det mt-[3px]">{term.body}</p>
                </div>
              ))}
            </Rows>
            <div className="mt-s3">
              <LabelledField label="Your ZIP">
                <input
                  className="c-field w-full"
                  value={zip}
                  onChange={(e) => patch({ zip: e.target.value })}
                  inputMode="numeric"
                />
              </LabelledField>
            </div>
            {step === 'claimJoin' && (
              <div className="mt-s2">
                <LabelledField label="Invite">
                  <input className="c-field w-full" value={invite || sender} readOnly />
                </LabelledField>
                <p className="c-det mt-[6px]">No code needed — {sender} invited you.</p>
              </div>
            )}
          </div>
        </>
      ),
      footer: (
        <Btn primary lg onClick={go('identity')}>
          Join Clear
        </Btn>
      ),
      footnote: step === 'join' ? 'Membership agreement and bylaws' : undefined,
    });
  }

  if (step === 'identity') {
    return shell({
      children: (
        <>
          <StepHead
            title="Two more details"
            lede="Asked once, at your first deposit or first plan, whichever comes first."
          />
          <div className="mt-s3">
            <LabelledField label="Legal name">
              <input
                className="c-field w-full"
                value={member?.name ?? ''}
                placeholder="From your linked account"
                readOnly
              />
            </LabelledField>
            <p className="c-det mt-[6px]">From your linked account</p>
            <p className="c-det mt-s2">
              The rest is asked by our identity provider, on their own page, at the moment it is
              needed. Required before anyone can hold money for you.{' '}
              <strong className="font-medium text-ink">This is not a credit check</strong> and nothing
              there touches your score.
            </p>
          </div>
        </>
      ),
      footer: (
        // Entering this step is what finishes onboarding — the container submits on arrival and
        // takes the member to the app, so the action has nowhere of its own to go.
        <Btn primary lg>
          Verify and continue
        </Btn>
      ),
      footnote: 'Held by our identity provider, not stored in the app.',
    });
  }

  if (step === 'waitlist') {
    return shell({
      children: (
        <>
          <StepHead
            title={`Not open in ${waitlistZip} yet`}
            lede="Clear is starting in the Inland Empire and grows to where the list is longest."
          />
          <div className="mt-s3">
            <Rows>
              <div>
                <Line className="items-baseline!">
                  <span className="text-sec">{waitlistRegion}</span>
                  <span className="c-fig c-fig-row">#{waitlistPosition}</span>
                </Line>
                <p className="c-det mt-[3px]">
                  on the list · we open regions where enough people are waiting
                </p>
              </div>
            </Rows>
            <div className="mt-s3">
              <LabelledField label="Email for updates">
                <input
                  className="c-field w-full"
                  value={email}
                  onChange={(e) => patch({ email: e.target.value })}
                  placeholder="you@example.com"
                  inputMode="email"
                />
              </LabelledField>
            </div>
          </div>
        </>
      ),
      footer: (
        <div className="c-stack">
          <Btn primary lg>
            Keep me posted
          </Btn>
          <Btn lg>Share Clear with a neighbour</Btn>
        </div>
      ),
      footnote: 'Moving to the Inland Empire? Change your ZIP any time.',
    });
  }

  // claim — someone sent money to a person who is not a member yet.
  return shell({
    children: (
      <>
        <StepHead
          title={`${sender} sent you ${money(claimAmount)}`}
          lede={`Claim it with your phone number. Clear is a member-owned co-op in the Inland Empire, and ${sender.split(' ')[0]} is already a member.`}
        />
        <div className="mt-s3">
          <LabelledField label="Phone or email">
            <input
              className="c-field w-full"
              value={contact}
              onChange={(e) => patch({ contact: e.target.value })}
              placeholder="Phone or email"
              inputMode="email"
            />
          </LabelledField>
        </div>
      </>
    ),
    footer: (
      <Btn primary lg onClick={go('claimJoin')}>
        Claim {money(claimAmount)}
      </Btn>
    ),
    footnote: `Expires in ${claimExpiresInDays} days`,
  });
}
