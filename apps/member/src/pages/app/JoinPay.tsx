import type { InputHTMLAttributes, ReactNode } from 'react';
import AuthShell, { LabelledField, StepHead } from '@/components/clear/auth/AuthShell';
import { Btn } from '@/components/clear/brand/anatomy';
import PendingTotalHeader from '@/components/onboarding/PendingTotalHeader';
import BankLinkStep, { BankLinkSkip } from '@/components/onboarding/BankLinkStep';
import DocumentUpload from '@/components/app-ui/DocumentUpload';
import { ApprovalNotice } from './ApprovalPage';
import { STEP_LABEL, contactLabel, startAgainLine, type IdentityValues, type JoinStep, type JoinWindowView } from '@/lib/joinPay';

/**
 * The join window's screens (`/join/pay?h=`): Pay with Clear's step 2, drawn with the counter flow's
 * shell, since it's the same job (joining with an order waiting). The shop and the amount ride above
 * every step. Presentational: JoinPayRoute drives it live, and the preview harness drives it with
 * Marco Alvarez's order at Mi Casa Tacos.
 */
export type JoinScreen = 'loading' | 'signin' | Exclude<JoinStep, 'finish'> | 'checking' | 'finish' | 'done' | 'ended' | 'unreadable';

export interface JoinPayProps {
  screen: JoinScreen;
  /** Null before the hand-off has been read (signed out, when the API wants a session first). */
  view: JoinWindowView | null;
  busy?: boolean;
  error?: string | null;
  onSignIn?: () => void;
  onRetry?: () => void;
  identity?: {
    values: IdentityValues;
    onChange: (patch: Partial<IdentityValues>) => void;
    editing: boolean;
    onEdit: () => void;
    onSubmit: () => void;
    onLater: () => void;
  };
  onDocumentDone?: () => void;
  bank?: { linked: boolean; busy: boolean; error?: string | null; onConnect: () => void; onSkip: () => void };
  done?: { lede: string; doneLine: string | null; onClose: () => void };
}

function Step({
  view,
  label,
  title,
  lede,
  children,
  footer,
  footnote,
}: {
  view: JoinWindowView | null;
  label: string;
  title: string;
  lede: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <AuthShell
      solo
      label={label}
      count="Step 2 of 3"
      pending={view ? <PendingTotalHeader merchant={view.shop.name} amount={view.order.totalCents / 100} /> : undefined}
      footer={footer}
      footnote={footnote}
    >
      <StepHead title={title} lede={lede} />
      {children && <div className="mt-s3">{children}</div>}
    </AuthShell>
  );
}

function Sum({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="c-pc-sum">
      {rows.map(([k, v]) => (
        <div key={k} className="c-kv">
          <span>{k}</span>
          <span className="min-w-0 text-right">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, ...input }: { label: string; value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <LabelledField label={label}>
      <input className="c-field w-full" value={value} onChange={(e) => onChange(e.target.value)} {...input} />
    </LabelledField>
  );
}

function ErrorLine({ error }: { error?: string | null }) {
  return error ? (
    <p role="status" className="c-det c-errline mt-s2">
      {error}
    </p>
  ) : null;
}

function IdentityForm({ view, identity, error }: { view: JoinWindowView | null; identity: NonNullable<JoinPayProps['identity']>; error?: string | null }) {
  const v = identity.values;
  const set = (key: keyof IdentityValues) => (value: string) => identity.onChange({ [key]: value });
  // City and state are asked when step 1's street didn't say them; the rest is shown as typed there.
  const missingPlace = !v.city.trim() || !v.state.trim();
  const otherContact = view?.contact.channel === 'email' ? 'phone' : 'email';

  return (
    <div className="space-y-s2">
      {!identity.editing ? (
        <div>
          <Sum
            rows={[
              ['Legal name', v.name],
              ['Date of birth', v.dob],
              ['Address', [v.address1, v.city, [v.state, v.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
            ]}
          />
          <p className="c-det mt-[6px]">
            From {view?.shop.name ?? 'the shop'}’s page.{' '}
            <button type="button" className="underline underline-offset-2" onClick={identity.onEdit}>
              Not right? Change it
            </button>
          </p>
        </div>
      ) : (
        <>
          <Field label="Legal name" value={v.name} onChange={set('name')} autoComplete="name" />
          <Field label="Date of birth" value={v.dob} onChange={set('dob')} inputMode="numeric" placeholder="MM / DD / YYYY" autoComplete="off" />
          <Field label="Street address" value={v.address1} onChange={set('address1')} autoComplete="address-line1" />
          <Field label="ZIP" value={v.zip} onChange={set('zip')} inputMode="numeric" autoComplete="postal-code" />
        </>
      )}
      {(identity.editing || missingPlace) && (
        <div className="grid grid-cols-[2fr_1fr] gap-s2">
          <Field label="City" value={v.city} onChange={set('city')} autoComplete="address-level2" />
          <Field label="State" value={v.state} onChange={set('state')} autoComplete="address-level1" />
        </div>
      )}
      {otherContact === 'email' && (
        <Field label="Email" value={v.email} onChange={set('email')} inputMode="email" autoComplete="email" />
      )}
      {otherContact === 'phone' && <Field label="Phone number" value={v.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" />}
      {/* type=password so it isn't shoulder-read; autoComplete off so it's never saved. */}
      <Field label="Social security number" value={v.ssn} onChange={set('ssn')} type="password" inputMode="numeric" placeholder="••• •• ••••" autoComplete="off" />
      <ErrorLine error={error} />
    </div>
  );
}

export default function JoinPay(props: JoinPayProps) {
  const { screen, view, busy = false, error = null } = props;
  const shopName = view?.shop.name ?? null;
  const host = view?.shopHost ?? null;

  if (screen === 'loading') return <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">Loading…</p>;

  if (screen === 'ended') return <ApprovalNotice title="This link has ended">{startAgainLine(shopName)}</ApprovalNotice>;

  if (screen === 'unreadable') {
    return (
      <ApprovalNotice
        title="We couldn’t open this"
        action={
          <Btn lg className="w-full" onClick={props.onRetry}>
            Try again
          </Btn>
        }
      >
        Check your connection. Nothing has been charged.
      </ApprovalNotice>
    );
  }

  const retryOrWait = (label: string) => (
    <Btn primary lg onClick={error ? props.onRetry : undefined} disabled={busy || !error}>
      {error ? 'Try again' : label}
    </Btn>
  );

  if (screen === 'signin') {
    const contact = view ? contactLabel(view.contact) : null;
    return (
      <Step
        view={view}
        label={STEP_LABEL.signin}
        title="Finish joining Clear"
        lede={host ? `Two quick checks, then you’re back on ${host}.` : 'Two quick checks, then you’re back with the shop.'}
        footer={
          <Btn primary lg onClick={props.onSignIn} disabled={busy}>
            {busy ? 'One moment…' : contact ? `Continue with ${contact}` : 'Sign in'}
          </Btn>
        }
        footnote="Clear sends you its own code."
      >
        {view && (
          <Sum
            rows={[
              ['For', view.order.summary],
              ['Confirm it’s you', 'About 1 min'],
              ['Link your bank', 'About 1 min'],
            ]}
          />
        )}
        <ErrorLine error={error} />
      </Step>
    );
  }

  if (screen === 'onboard') {
    return (
      <Step view={view} label={STEP_LABEL.onboard} title="Setting up your account" lede="Joining makes you a part-owner. No buy-in, no fee." footer={retryOrWait('One moment…')}>
        <ErrorLine error={error} />
      </Step>
    );
  }

  if (screen === 'identity' && props.identity) {
    return (
      <Step
        view={view}
        label={STEP_LABEL.identity}
        title="Confirm it’s you"
        lede="The law asks us to know who our members are. This is not a credit check."
        footer={
          <Btn primary lg onClick={props.identity.onSubmit} disabled={busy}>
            {busy ? 'Sending…' : 'Continue'}
          </Btn>
        }
        footnote={
          <>
            Encrypted and sent straight to our card issuer. Clear never keeps it.
            <button type="button" onClick={props.identity.onLater} disabled={busy} className="c-det mt-s1 block w-full text-center underline underline-offset-2 disabled:opacity-60">
              Not now. Pay by card this time
            </button>
          </>
        }
      >
        <IdentityForm view={view} identity={props.identity} error={error} />
      </Step>
    );
  }

  if (screen === 'checking') {
    return <Step view={view} label={STEP_LABEL.identity} title="Checking" lede="Details received. Usually a few seconds." footer={retryOrWait('One moment…')} />;
  }

  if (screen === 'document') {
    return (
      <Step
        view={view}
        label={STEP_LABEL.document}
        title="Photo of your ID"
        lede="About 1 min."
        footer={
          <Btn lg onClick={props.onDocumentDone}>
            Do this later
          </Btn>
        }
      >
        <DocumentUpload onDone={() => props.onDocumentDone?.()} />
      </Step>
    );
  }

  if (screen === 'bank' && props.bank) {
    const bank = props.bank;
    return (
      <Step
        view={view}
        label={STEP_LABEL.bank}
        title="Link your bank"
        lede="This is how we say yes without a credit check."
        footer={
          <Btn primary lg onClick={bank.onConnect} disabled={bank.busy || busy}>
            {bank.busy ? 'One moment…' : 'Link with Plaid'}
          </Btn>
        }
        footnote={
          <>
            About 1 min. You don’t need it to join.
            <BankLinkSkip busy={bank.busy || busy} onSkip={bank.onSkip} />
          </>
        }
      >
        <BankLinkStep linked={bank.linked} error={bank.error} />
      </Step>
    );
  }

  if (screen === 'finish') {
    return (
      <Step view={view} label={STEP_LABEL.finish} title="Finishing" lede="Handing you back to the shop." footer={retryOrWait('One moment…')}>
        <ErrorLine error={error} />
      </Step>
    );
  }

  // Done: "You're in", and the window closes itself; when it won't, it says where to go.
  const done = props.done;
  return (
    <Step
      view={view}
      label={STEP_LABEL.done}
      title="You’re in"
      lede={done?.lede ?? ''}
      footer={
        <Btn primary lg onClick={done?.onClose}>
          Close
        </Btn>
      }
    >
      {/* The window wouldn't close itself: say where to go, where it's seen first. */}
      {done?.doneLine && <p className="c-pc-t">{done.doneLine}</p>}
    </Step>
  );
}
