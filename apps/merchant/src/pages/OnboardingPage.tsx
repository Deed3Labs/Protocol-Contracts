import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { dollars } from '@clear/domain';
import { Button, Cap, Card, Inset, PrimaryButton, Row } from '@/shell/ui';
import { STUB_MERCHANT, STUB_TERMS } from '@/data/stubs';

/**
 * Merchant onboarding — reference section 13.
 *
 * The merchant signs themselves up. For merchants one to five a rep is sitting there, but the flow
 * must not require one, or merchant twenty needs a visit that does not scale.
 *
 * **The last step is the one that decides whether the shop transacts.** Signing takes four minutes
 * and any owner will do it; training the counter takes fifteen and is the step people skip. So it
 * is inside the flow rather than a follow-up email, and what is skipped carries over to Home as
 * the checklist that screen already knows how to show.
 *
 * Desktop-primary — an owner does this at the back-office computer, not standing at the counter.
 * Step rail left, one step at a time on the right. On tablet and phone the same six steps in the
 * same order, the rail replaced by a progress line: **no step is removed and no state differs**,
 * only the two-column panels stack.
 *
 * Outside the signed-in shell, because a shop working through this has no counter session yet and
 * the nav would offer them places they cannot go.
 */

const STEPS = [
  'Start',
  'Your shop',
  'Your terms',
  'Verify',
  'Where payouts go',
  'The counter',
] as const;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3">
      <p className="m-0 mb-1 text-[11px] tracking-[0.3px] text-[var(--clear-text-muted)]">
        {label}
      </p>
      <div className="rounded-[8px] border-[0.5px] border-[var(--clear-border-strong)] bg-[var(--clear-surface-2)] px-3 py-2 text-[13px]">
        {value}
      </div>
    </div>
  );
}

function TermLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1.5 flex justify-between gap-3 text-[12.5px] first:mt-0">
      <span className="text-[var(--clear-text-secondary)]">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function StepFrame({ title, blurb, children }: { title: string; blurb?: string; children: ReactNode }) {
  return (
    <div>
      <p className="m-0 mb-1 text-[17px] font-medium">{title}</p>
      {blurb && (
        <p className="m-0 mb-4 text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          {blurb}
        </p>
      )}
      {children}
    </div>
  );
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const rate = Math.round(STUB_MERCHANT.discountRate * 1000) / 10;

  return (
    <div className="@container min-h-dvh bg-[var(--clear-surface-2)] text-[var(--clear-text-primary)]">
      <div className="mx-auto max-w-[900px] px-5 py-6">
        <header className="mb-[18px] flex items-center justify-between gap-4 border-b-[0.5px] border-[var(--clear-border)] pb-[13px]">
          <span className="text-[15px] font-semibold tracking-[-0.2px]">
            Clear <span className="font-normal text-[var(--clear-text-muted)]">for Merchants</span>
          </span>
          <span className="text-[12.5px] text-[var(--clear-text-muted)]">
            Setting up {STUB_MERCHANT.name}
          </span>
        </header>

        <div className="grid grid-cols-1 gap-5 @[900px]:grid-cols-[210px_minmax(0,1fr)] @[900px]:gap-7">
          {/* The rail on a back-office screen; a progress line everywhere narrower. Same six steps
              in the same order either way. */}
          <nav className="hidden @[900px]:block">
            <ol className="m-0 list-none p-0">
              {STEPS.map((label, i) => (
                <li key={label} className="mb-3 flex items-center gap-2.5 text-[12.5px]">
                  <span
                    className={[
                      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px]',
                      i < step
                        ? 'bg-[var(--clear-bg-success)] text-[var(--clear-text-success)]'
                        : i === step
                          ? 'bg-[var(--clear-text-primary)] text-[var(--clear-surface-2)]'
                          : 'border-[0.5px] border-[var(--clear-border)] text-[var(--clear-text-muted)]',
                    ].join(' ')}
                  >
                    {i < step ? <Check size={11} strokeWidth={3} aria-hidden /> : i + 1}
                  </span>
                  <span className={i === step ? '' : 'text-[var(--clear-text-muted)]'}>{label}</span>
                </li>
              ))}
            </ol>
          </nav>

          <div className="@[900px]:hidden">
            <p className="m-0 mb-1.5 text-[11px] tracking-[0.3px] text-[var(--clear-text-muted)]">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </p>
            <div className="h-[3px] w-full rounded-full bg-[var(--clear-surface-1)]">
              <div
                className="h-full rounded-full bg-[var(--clear-text-primary)] transition-[width]"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>

          <div>
            {step === 0 && (
              <StepFrame
                title="Clear for Merchants"
                blurb="Finance work at your counter. Customers sign up in about three minutes; you are paid on your normal terms."
              >
                <Field label="Business name" value={STUB_MERCHANT.name} />
                <Field label="Your email" value="mike@mikestire.com" />
                <Field label="Phone" value="(909) 555–0118" />
                <p className="m-0 mb-4 text-[11.5px] text-[var(--clear-text-muted)]">
                  Have a code?{' '}
                  <span className="text-[var(--clear-text-accent)] underline underline-offset-2">
                    Enter it
                  </span>{' '}
                  — some codes carry different terms.
                </p>
                <PrimaryButton onClick={next} className="!py-[11px] !text-[15px]">
                  Get started
                </PrimaryButton>
              </StepFrame>
            )}

            {step === 1 && (
              <StepFrame
                title="About the business"
                blurb="This is also your entry in the Clear Partners directory, where members look for somewhere to spend."
              >
                <Field label="Business name" value={STUB_MERCHANT.name} />
                <Field label="Category" value="Auto & tires" />
                <Field label="Address" value="412 W State St, Redlands, CA 92373" />
                <Field label="Typical ticket" value="$300 – $1,500" />
                <Field label="Phone" value="(909) 555–0118" />
                <p className="m-0 mb-4 text-[11.5px] leading-[1.6] text-[var(--clear-text-muted)]">
                  Typical ticket sets your starting approval cap. It moves on its own once you have
                  volume — you do not have to ask.
                </p>
                <PrimaryButton onClick={next} className="!py-[11px] !text-[15px]">
                  Continue
                </PrimaryButton>
              </StepFrame>
            )}

            {step === 2 && (
              <StepFrame
                title="One page, in plain terms"
                blurb="Read it here. The full agreement is linked below and emailed to you when you sign."
              >
                {/*
                  Six lines, not a document. An owner who reads six lines has actually read their
                  agreement; one who scrolls a contract has not, and will be surprised later —
                  which is the same thing as churning.
                */}
                <Cap>What you pay</Cap>
                <Card className="mb-3.5 !py-3">
                  <TermLine label="Your rate" value={`${rate}% of financed amount`} />
                  <TermLine label="Instead of" value="Card processing" />
                  <TermLine label="Setup, monthly, hardware" value="None" />
                </Card>

                <Cap>What you get</Cap>
                <Card className="mb-3.5 !py-3">
                  <TermLine label="You are paid" value={STUB_TERMS.payoutTerms} />
                  <TermLine label="Who bears a default" value="Clear" />
                  <TermLine
                    label="Approval cap"
                    value={`${dollars(STUB_TERMS.approvalCap)} per charge`}
                  />
                  <TermLine label="Exclusivity" value="None — keep Synchrony, Snap, anything else" />
                  <TermLine label="Leaving" value="Any time, no fee, no notice" />
                </Card>

                <Inset className="mb-3.5 !py-3">
                  <p className="m-0 text-[12px] leading-[1.6] text-[var(--clear-text-secondary)]">
                    Signing also makes {STUB_MERCHANT.name} a{' '}
                    <strong className="font-medium text-[var(--clear-text-primary)]">
                      partner member of the Clear co-op
                    </strong>{' '}
                    — one member, one vote, the same as every other member.
                  </p>
                </Inset>

                <PrimaryButton onClick={next} className="mb-2 !py-[11px] !text-[15px]">
                  Agree &amp; sign
                </PrimaryButton>
                <Button className="w-full">Read the full agreement</Button>
              </StepFrame>
            )}

            {step === 3 && (
              <StepFrame
                title="Business details"
                blurb="Standard for anyone receiving payouts — the same details your bank and your card processor already hold."
              >
                {/*
                  Said before they ask, not after. A shop that thinks it is being credit-checked
                  stops here, and the reason never reaches you.
                */}
                <div className="mb-3.5 rounded-r-[8px] border-l-[2.5px] border-[var(--clear-border-accent)] bg-[var(--clear-bg-accent)] px-3.5 py-3">
                  <p className="m-0 text-[12px] leading-[1.6] text-[var(--clear-text-secondary)]">
                    <strong className="font-medium text-[var(--clear-text-accent)]">
                      This is not a credit check.
                    </strong>{' '}
                    Nothing here affects your rate, your cap or whether you are approved. You
                    already have terms — you signed them on the last screen.
                  </p>
                </div>

                <Field label="Legal business name" value="Mike's Tire & Auto LLC" />
                <Field label="EIN" value="88–•••••••" />
                <Field label="Who is authorised to sign" value="Michael Ruiz" />
                <Field label="Their role" value="Owner" />
                <PrimaryButton onClick={next} className="!py-[11px] !text-[15px]">
                  Continue
                </PrimaryButton>
              </StepFrame>
            )}

            {step === 4 && (
              <StepFrame
                title="Where payouts go"
                blurb="Payouts land here on the 14th of each month. You can change it any time in Settings."
              >
                <Field label="Search for your bank" value="Chase, Bank of America, a credit union…" />
                <PrimaryButton onClick={next} className="mb-2 !py-[11px] !text-[15px]">
                  Connect securely
                </PrimaryButton>
                <Button className="mb-3.5 w-full">Enter account details instead</Button>

                <Inset className="mb-3.5 !py-3">
                  <p className="m-0 text-[12px] leading-[1.6] text-[var(--clear-text-secondary)]">
                    <strong className="font-medium text-[var(--clear-text-primary)]">
                      Nobody from Clear ever sees your banking credentials.
                    </strong>{' '}
                    You sign in to your own bank; we receive a token that lets us send money to you
                    and nothing else. If someone from Clear is sitting with you, they should stand
                    back for this step — and say so.
                  </p>
                </Inset>

                {/* Skippable on purpose: a shop can sign, train the counter and take charges today,
                    and add banking before the 14th. */}
                <Button onClick={next} className="w-full">
                  Skip — add it before my first payout
                </Button>
              </StepFrame>
            )}

            {step === 5 && (
              <StepFrame
                title="Set up your counter"
                blurb="The part that decides whether any of this gets used. Fifteen minutes, once."
              >
                <Card rows className="mb-3.5">
                  <Row
                    title="Add your staff"
                    meta="A four-digit PIN each, so charges are attributed"
                    right={<Button className="!px-[11px] !py-1 !text-[12px]">Add</Button>}
                  />
                  <Row
                    title="Print counter cards"
                    meta="The same code the tablet shows — goes home with an estimate"
                    right={<Button className="!px-[11px] !py-1 !text-[12px]">Print</Button>}
                  />
                  <Row
                    title="Run a test charge"
                    meta="$1.00 to your own phone, refunded straight away"
                    right={<Button className="!px-[11px] !py-1 !text-[12px]">Run</Button>}
                  />
                </Card>

                <Inset className="mb-3.5 !py-3">
                  <p className="m-0 text-[12px] leading-[1.6] text-[var(--clear-text-secondary)]">
                    <strong className="font-medium text-[var(--clear-text-primary)]">
                      Run the test charge with whoever works the counter.
                    </strong>{' '}
                    It puts the whole loop in front of them once — enter the amount, turn the
                    screen, they approve, you refund it — with no customer waiting.
                  </p>
                </Inset>

                <PrimaryButton onClick={() => navigate('/')} className="mb-2 !py-[11px] !text-[15px]">
                  Open Clear
                </PrimaryButton>
                <Button onClick={() => navigate('/')} className="w-full">
                  Finish later
                </Button>
                <p className="m-0 mt-[11px] text-[11.5px] leading-[1.55] text-[var(--clear-text-muted)]">
                  Anything skipped carries over to Home as a checklist until it is done.
                </p>
              </StepFrame>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
