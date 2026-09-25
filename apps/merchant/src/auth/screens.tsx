import { useRef, type ReactNode } from 'react';
import type { StaffRole } from '@clear/domain';
import { IconMail, IconPasskey, IconTablet } from '@/brand/icons';
import { CodeBoxes, Lockup, PinDots, PinKeys, Sheet, Wordmark, cx, initials } from '@/brand/ui';
import { ForgotLine, roleLabel } from '@/shell/chrome';

/**
 * Signing in, drawn from docs/merchant-reference/clear-merchant-sign-in.html.
 *
 * Three levels of authority, and only one of them is a login: the device is enrolled once by the
 * owner, the shift is a name and a PIN, and anything that moves money needs the owner signed in
 * with Privy. These are the screens and sheets for all three. They only draw; the containers in
 * this folder decide which one is showing and call the API.
 *
 * Where the reference has no figure (a person's hours, before the schedule is wired), the screen
 * shows an em dash rather than inventing one.
 */

const DASH = '—';

/** The full-screen frame every sign-in screen sits in: the lockup on a rule, then the middle. */
export function SignInFrame({
  shop,
  right,
  children,
}: {
  /** Absent before the tablet knows which shop it belongs to. */
  shop?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="c-app c-mc-tablet c-si-lock">
      <div className="c-si-top">
        {shop ? <Lockup shop={shop} /> : <Wordmark />}
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * A code typed with the keyboard the device has, drawn as boxes. The input is invisible and
 * covers the boxes, so a tap on them opens the on-screen keyboard on a tablet.
 */
function CodeField({
  value,
  onChange,
  bad,
  small,
  label,
}: {
  value: string;
  onChange?: (v: string) => void;
  bad?: boolean;
  small?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ position: 'relative' }} onClick={() => ref.current?.focus()}>
      <CodeBoxes value={value} bad={bad} small={small} />
      {onChange && (
        <input
          ref={ref}
          aria-label={label}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', border: 0 }}
        />
      )}
    </div>
  );
}

// ---- 1 · Enrolling a device -------------------------------------------------------------------

export function EnrollCodeScreen({
  code,
  onCode,
  expired,
  onOwner,
}: {
  code: string;
  onCode?: (v: string) => void;
  expired?: boolean;
  onOwner?: () => void;
}) {
  return (
    <SignInFrame>
      <div className="c-si-center">
        <span className="c-si-bigic">
          <IconTablet />
        </span>
        <p className="c-si-title">Set up this tablet</p>
        <p className="c-det c-si-sub">
          On a device where the owner is signed in, open Settings, Devices, Add a device, and enter the code it shows.
        </p>
        <CodeField value={code} onChange={onCode} bad={expired} label="Code from Settings, Devices" />
        {expired && (
          <>
            <p className="c-si-err" role="alert">
              That code has expired. Codes work once, for 10 minutes.
            </p>
            <p className="c-det">Ask for a new one in Settings, Devices.</p>
          </>
        )}
        <p className="c-det">
          Or{' '}
          <button type="button" className="c-si-link" onClick={onOwner}>
            sign in as the owner here
          </button>
        </p>
      </div>
    </SignInFrame>
  );
}

export function EnrollConfirmScreen({
  shop,
  name,
  onName,
  cap,
  busy,
  error,
  onEnroll,
}: {
  shop: string;
  name: string;
  onName?: (v: string) => void;
  /** "$1,500.00", or null when the shop's cap is not known. */
  cap: string | null;
  busy?: boolean;
  error?: string | null;
  onEnroll?: () => void;
}) {
  return (
    <SignInFrame shop={shop}>
      <div className="c-si-center c-wide">
        <p className="c-si-title">Set up this tablet</p>
        <p className="c-det c-si-sub">
          This device will be able to raise charges for {shop}. It will not be able to move money, change terms or see
          your bank details. Only the owner can do those, and only after signing in.
        </p>
        <div className="c-si-rows">
          <div className="c-rows">
            <div>
              <div className="c-kv">
                <span>
                  Name<span className="c-det c-si-under">So you recognise it later</span>
                </span>
                <span className="c-v">
                  <input
                    className="c-field c-si-in"
                    aria-label="Name"
                    value={name}
                    maxLength={40}
                    onChange={(e) => onName?.(e.target.value)}
                  />
                </span>
              </div>
            </div>
            <div>
              <div className="c-kv">
                <span>
                  Charges up to<span className="c-det c-si-under">Enforced by policy, not by this app</span>
                </span>
                <span className="c-v c-ink">{cap ?? DASH}</span>
              </div>
            </div>
            <div>
              <div className="c-kv">
                <span>
                  Locks after<span className="c-det c-si-under">Back to the shift screen</span>
                </span>
                <span className="c-v c-ink">5 minutes idle</span>
              </div>
            </div>
          </div>
        </div>
        {error && (
          <p className="c-si-err" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="c-btn c-btn-primary c-btn-lg c-si-cta" disabled={busy || !name.trim()} onClick={onEnroll}>
          Enroll this device
        </button>
        <p className="c-det">Remove it any time from Settings, from any device.</p>
      </div>
    </SignInFrame>
  );
}

// ---- 2 · Starting a shift ---------------------------------------------------------------------

export interface ShiftPerson {
  id: string;
  name: string;
  role: StaffRole;
  /** "Until 4:00pm today", "No hours set". Absent when the schedule is not known. */
  hours?: string;
  /** "8:00am – 4:00pm", for the PIN screen. */
  span?: string;
  /** Has not had a first shift, so picks a PIN instead of typing one. */
  first?: boolean;
}

export function WhoIsOnScreen({
  shop,
  deviceLabel,
  people,
  onPick,
  loading,
}: {
  shop: string;
  deviceLabel: string;
  people: ShiftPerson[];
  onPick?: (p: ShiftPerson) => void;
  loading?: boolean;
}) {
  return (
    <SignInFrame shop={shop} right={<span className="c-det">This tablet &middot; {deviceLabel}</span>}>
      <div className="c-si-center c-wide">
        <p className="c-si-title">Who&rsquo;s on the counter?</p>
        <p className="c-det c-si-sub">Every charge is recorded against whoever is on shift.</p>
        {!loading && (
          <div className="c-si-people">
            {people.map((p) => (
              <div key={p.id} className={cx('c-si-p', p.first && 'c-first')}>
                <span className="c-av">{initials(p.name)}</span>
                <p className="c-t">{p.name}</p>
                <p className="c-det">{roleLabel(p.role)}</p>
                <p className="c-det c-s">{p.first ? 'First shift' : (p.hours ?? DASH)}</p>
                <button type="button" className="c-btn" onClick={() => onPick?.(p)}>
                  {p.first ? 'Pick a PIN' : 'Start'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </SignInFrame>
  );
}

export function PinScreen({
  shop,
  person,
  filled,
  error,
  disabled,
  resetters,
  onDigit,
  onDelete,
  onNotMe,
}: {
  shop: string;
  person: ShiftPerson;
  filled: number;
  error?: string | null;
  disabled?: boolean;
  resetters?: string;
  onDigit?: (d: string) => void;
  onDelete?: () => void;
  onNotMe?: () => void;
}) {
  return (
    <SignInFrame shop={shop}>
      <div className="c-si-pinwrap">
        <div className="c-si-who">
          <span className="c-av">{initials(person.name)}</span>
          <p className="c-t">{person.name}</p>
          <p className="c-hrs">{person.span ?? DASH}</p>
          <p className="c-det">{roleLabel(person.role)} &middot; today&rsquo;s shift</p>
        </div>
        <PinDots filled={error ? 4 : filled} bad={!!error} />
        {error && (
          <p className="c-si-err" role="alert" style={{ textAlign: 'center' }}>
            {error}
          </p>
        )}
        <PinKeys
          disabled={disabled}
          onDigit={(d) => onDigit?.(d)}
          onDelete={() => onDelete?.()}
          left="Not me"
          onLeft={onNotMe}
        />
        <ForgotLine resetters={resetters} />
      </div>
    </SignInFrame>
  );
}

/** Locked after the idle minutes. The shift keeps running under it, with anything waiting intact. */
export function IdleLockScreen({
  shop,
  person,
  started,
  waiting,
  minutes,
  filled,
  error,
  disabled,
  onDigit,
  onDelete,
  onSomeoneElse,
}: {
  shop: string;
  person: ShiftPerson;
  /** "8:04am" */
  started?: string;
  waiting?: number;
  minutes: number;
  filled: number;
  error?: string | null;
  disabled?: boolean;
  onDigit?: (d: string) => void;
  onDelete?: () => void;
  onSomeoneElse?: () => void;
}) {
  const first = person.name.split(/\s+/)[0];
  const detail = [started && `Started ${started}`, waiting !== undefined && `${waiting} waiting`].filter(Boolean).join(' · ');
  return (
    <SignInFrame shop={shop}>
      <div className="c-si-pinwrap">
        <p className="c-label" style={{ textAlign: 'center' }}>
          Locked after {minutes} minutes idle
        </p>
        <div className="c-si-who" style={{ marginTop: 'var(--s2)' }}>
          <span className="c-av">{initials(person.name)}</span>
          <p className="c-t">{first}&rsquo;s shift</p>
          <p className="c-hrs">{person.span ?? DASH}</p>
          <p className="c-det">{detail || DASH}</p>
        </div>
        <PinDots filled={error ? 4 : filled} bad={!!error} />
        {error && (
          <p className="c-si-err" role="alert" style={{ textAlign: 'center' }}>
            {error}
          </p>
        )}
        <PinKeys
          disabled={disabled}
          onDigit={(d) => onDigit?.(d)}
          onDelete={() => onDelete?.()}
          left="Someone else"
          onLeft={onSomeoneElse}
        />
        <p className="c-det">Their shift keeps running while it is locked. Nothing waiting is lost.</p>
      </div>
    </SignInFrame>
  );
}

/** A first shift: four digits only this person knows, typed twice. */
export function FirstPinSheet({
  name,
  role,
  choose,
  again,
  error,
  onDigit,
  onDelete,
  onClose,
  inline,
}: {
  name: string;
  role: StaffRole;
  choose: number;
  again: number;
  error?: string | null;
  onDigit?: (d: string) => void;
  onDelete?: () => void;
  onClose?: () => void;
  inline?: boolean;
}) {
  return (
    <Sheet
      inline={inline}
      className="c-si-sheet"
      title="Pick your PIN"
      closeSize="lg"
      onClose={onClose}
      foot={<p className="c-det">Avoid 1234 and your birthday. Four digits on a counter is attribution, not a lock.</p>}
    >
      <div className="c-si-pinhead">
        <span className="c-av">{initials(name)}</span>
        <div>
          <p className="c-t">{name}</p>
          <p className="c-det">First shift &middot; {roleLabel(role)}</p>
        </div>
      </div>
      <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
        Four digits only you know. Nobody at the shop sets it or sees it, not even the owner.
      </p>
      <div className="c-si-two">
        <div>
          <p className="c-label">Choose</p>
          <PinDots filled={choose} />
        </div>
        <div>
          <p className="c-label">Again</p>
          <PinDots filled={again} bad={!!error} />
        </div>
      </div>
      {error && (
        <p className="c-si-err" role="alert" style={{ textAlign: 'center' }}>
          {error}
        </p>
      )}
      <PinKeys onDigit={(d) => onDigit?.(d)} onDelete={() => onDelete?.()} />
    </Sheet>
  );
}

// ---- 3 · The owner, for anything that moves money ---------------------------------------------

/** Asked for at the moment it is needed: what is being done, and that the shift is untouched. */
export function OwnerNeededSheet({
  what,
  owner,
  onNotNow,
  onSignIn,
  inline,
}: {
  /** "Withdrawing $612.40 to Chase ••4417 moves money, so Mike signs in for it. Jen's shift stays as it is." */
  what: ReactNode;
  owner: string;
  onNotNow?: () => void;
  onSignIn?: () => void;
  inline?: boolean;
}) {
  return (
    <Sheet
      inline={inline}
      className="c-si-sheet"
      title="This needs the owner"
      closeSize="lg"
      onClose={onNotNow}
      foot={
        <div className="c-si-pair">
          <button type="button" className="c-btn c-btn-lg" onClick={onNotNow}>
            Not now
          </button>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={onSignIn}>
            Sign in as {owner}
          </button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)', lineHeight: 1.5 }}>{what}</p>
    </Sheet>
  );
}

export interface OwnerFormProps {
  email: string;
  onEmail?: (v: string) => void;
  onSendCode?: () => void;
  onPasskey?: () => void;
  busy?: boolean;
  error?: string | null;
}

function OwnerForm({ email, onEmail, onSendCode, onPasskey, busy, error }: OwnerFormProps) {
  return (
    <>
      <p className="c-label" style={{ margin: '0 0 6px' }}>
        Email
      </p>
      <input
        className="c-field c-si-in2"
        type="email"
        inputMode="email"
        autoComplete="username"
        aria-label="Email"
        value={email}
        onChange={(e) => onEmail?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSendCode?.();
        }}
      />
      {error && (
        <p className="c-si-err" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="c-btn c-btn-primary c-btn-lg c-si-cta"
        disabled={busy || !email.includes('@')}
        onClick={onSendCode}
      >
        <IconMail />
        <span>Email me a code</span>
      </button>
      <div className="c-si-or">
        <span>or</span>
      </div>
      <button type="button" className="c-btn c-btn-lg c-si-cta2" disabled={busy} onClick={onPasskey}>
        <IconPasskey />
        <span>Use a passkey</span>
      </button>
    </>
  );
}

export function OwnerSignInSheet({ onClose, inline, ...form }: OwnerFormProps & { onClose?: () => void; inline?: boolean }) {
  return (
    <Sheet
      inline={inline}
      className="c-si-sheet"
      title="Sign in as the owner"
      closeSize="lg"
      onClose={onClose}
      foot={<p className="c-det">Signed in with Privy. There is no password: Clear never holds one to lose.</p>}
    >
      <p className="c-det" style={{ margin: '0 0 var(--s2)' }}>
        Needed to move money, change terms or manage people. Not needed to take a payment.
      </p>
      <OwnerForm {...form} />
    </Sheet>
  );
}

export interface CodeStepProps {
  email: string;
  code: string;
  onCode?: (v: string) => void;
  error?: string | null;
  onResend?: () => void;
  onPasskey?: () => void;
}

export function CheckEmailSheet({
  email,
  code,
  onCode,
  error,
  onResend,
  onPasskey,
  onClose,
  inline,
}: CodeStepProps & { onClose?: () => void; inline?: boolean }) {
  return (
    <Sheet
      inline={inline}
      className="c-si-sheet"
      title="Check your email"
      closeSize="lg"
      onClose={onClose}
      foot={
        <p className="c-det c-si-links">
          <button type="button" className="c-si-link" onClick={onResend}>
            Send another
          </button>
          <button type="button" className="c-si-link" onClick={onPasskey}>
            Use a passkey instead
          </button>
        </p>
      }
    >
      <p className="c-det" style={{ margin: '0 0 var(--s2)', textAlign: 'center' }}>
        A six-digit code went to <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{email}</b>.<br />
        It works for 10 minutes.
      </p>
      <CodeBoxes value={code} small bad={!!error} />
      {error && (
        <p className="c-si-err" role="alert" style={{ textAlign: 'center' }}>
          {error}
        </p>
      )}
      <PinKeys
        onDigit={(d) => code.length < 6 && onCode?.(code + d)}
        onDelete={() => onCode?.(code.slice(0, -1))}
      />
    </Sheet>
  );
}

/**
 * The owner's own sign-in, full screen: on the back-office computer, the owner's phone, or a
 * tablet not yet enrolled. On the phone it is the reference's narrower layout.
 */
export function OwnerSignInScreen({ phone, onSetUpShop, ...form }: OwnerFormProps & { phone?: boolean; onSetUpShop?: () => void }) {
  const setUp = (
    <button type="button" className="c-si-link" onClick={onSetUpShop}>
      Set up your shop
    </button>
  );
  if (phone) {
    return (
      <div className="c-app c-mc-tablet c-si-ph">
        <div className="c-si-phtop">
          <Wordmark small />
        </div>
        <p className="c-si-title" style={{ fontSize: 22 }}>
          Sign in
        </p>
        <p className="c-det" style={{ margin: '6px 0 var(--s2)' }}>
          For owners. Staff use the counter tablet.
        </p>
        <OwnerForm {...form} />
        <p className="c-det" style={{ textAlign: 'center', marginTop: 'var(--s3)' }}>
          New to Clear? {setUp}
        </p>
      </div>
    );
  }
  return (
    <SignInFrame>
      <div className="c-si-center">
        <p className="c-si-title">Sign in</p>
        <p className="c-det c-si-sub">
          For owners, on any device. Staff start a shift on the counter tablet instead, with their PIN.
        </p>
        <div className="c-si-form">
          <OwnerForm {...form} />
        </div>
        <p className="c-det c-si-fsfoot">New to Clear? {setUp}</p>
      </div>
    </SignInFrame>
  );
}

export function CheckEmailScreen({ email, code, onCode, error, onResend, onPasskey }: CodeStepProps) {
  return (
    <SignInFrame>
      <div className="c-si-center">
        <p className="c-si-title">Check your email</p>
        <p className="c-det c-si-sub">
          A six-digit code went to <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{email}</b>. It works for 10
          minutes.
        </p>
        <CodeField value={code} onChange={onCode} bad={!!error} label="The code we emailed" />
        {error && (
          <p className="c-si-err" role="alert">
            {error}
          </p>
        )}
        <p className="c-det c-si-links">
          <button type="button" className="c-si-link" onClick={onResend}>
            Send another
          </button>
          <button type="button" className="c-si-link" onClick={onPasskey}>
            Use a passkey instead
          </button>
        </p>
      </div>
    </SignInFrame>
  );
}

export function PasskeyScreen({ onRetry, onEmail }: { onRetry?: () => void; onEmail?: () => void }) {
  return (
    <SignInFrame>
      <div className="c-si-center">
        <span className="c-si-bigic">
          <IconPasskey />
        </span>
        <p className="c-si-title">Waiting for your passkey</p>
        <p className="c-det c-si-sub">
          Confirm with Face ID, Touch ID or your security key in the window your device just opened.
        </p>
        <p className="c-det c-si-links">
          <button type="button" className="c-si-link" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="c-si-link" onClick={onEmail}>
            Email me a code instead
          </button>
        </p>
      </div>
    </SignInFrame>
  );
}

export function SignedInScreen({
  name,
  shop,
  onHome,
}: {
  name: string;
  shop: string;
  onHome?: () => void;
}) {
  const first = name.split(/\s+/)[0];
  return (
    <SignInFrame>
      <div className="c-si-center">
        <span className="c-si-live" aria-hidden="true" />
        <p className="c-si-title">Signed in as {first}</p>
        <p className="c-det c-si-sub">
          Owner of {shop}. On this computer you stay signed in for 12 hours; on the counter tablet it is 15 minutes.
        </p>
        <button type="button" className="c-btn c-btn-primary c-btn-lg c-si-cta" style={{ maxWidth: 280 }} onClick={onHome}>
          Go to Home
        </button>
      </div>
    </SignInFrame>
  );
}

// ---- 4 · A forgotten PIN, and a lost tablet ---------------------------------------------------

export function ResetPinSheet({
  name,
  approver,
  approverRole,
  filled,
  onCancel,
  onReset,
  inline,
}: {
  name: string;
  approver: string;
  approverRole: StaffRole;
  filled: number;
  onCancel?: () => void;
  onReset?: () => void;
  inline?: boolean;
}) {
  const first = name.split(/\s+/)[0];
  return (
    <Sheet
      inline={inline}
      className="c-si-sheet"
      title={`Reset ${first}’s PIN`}
      closeSize="lg"
      onClose={onCancel}
      foot={
        <div className="c-si-pair">
          <button type="button" className="c-btn c-btn-lg" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={onReset}>
            Reset PIN
          </button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 'var(--t-sec)', lineHeight: 1.5 }}>
        Their old PIN stops working now. They pick a new one the next time they start a shift. Nothing they raised changes.
      </p>
      <div className="c-si-pinhead" style={{ marginTop: 'var(--s2)' }}>
        <span className="c-av">{initials(approver)}</span>
        <div>
          <p className="c-t">{approver} approves</p>
          <p className="c-det">{roleLabel(approverRole)}</p>
        </div>
      </div>
      <PinDots filled={filled} />
    </Sheet>
  );
}

export function RemoveTabletSheet({
  label,
  enrolled,
  lastUsed,
  onShift,
  onKeep,
  onRemove,
  inline,
}: {
  label: string;
  enrolled: string;
  lastUsed: string;
  onShift?: string;
  onKeep?: () => void;
  onRemove?: () => void;
  inline?: boolean;
}) {
  const first = onShift?.split(/\s+/)[0];
  return (
    <Sheet
      inline={inline}
      className="c-si-sheet"
      title={`Remove ${label}?`}
      closeSize="lg"
      onClose={onKeep}
      foot={
        <div className="c-si-pair">
          <button type="button" className="c-btn c-btn-lg" onClick={onKeep}>
            Keep it
          </button>
          <button type="button" className="c-btn c-btn-primary c-btn-lg" onClick={onRemove}>
            Remove
          </button>
        </div>
      }
    >
      <div className="c-rows">
        <div>
          <div className="c-kv">
            <span>Enrolled</span>
            <span className="c-v c-ink">{enrolled}</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>Last used</span>
            <span className="c-v c-ink">{lastUsed}</span>
          </div>
        </div>
        <div>
          <div className="c-kv">
            <span>On shift now</span>
            <span className="c-v c-ink">{onShift ?? DASH}</span>
          </div>
        </div>
      </div>
      <p className="c-det" style={{ marginTop: 'var(--s2)', lineHeight: 1.5 }}>
        It signs out at once{first ? ` and ${first}’s shift on it ends` : ''}. No charge, payout or record is lost,
        and it holds no keys to lose: it only ever had a session.
      </p>
    </Sheet>
  );
}

export function TabletRemovedScreen({
  by,
  shop,
  at,
  onSetUp,
}: {
  by?: string;
  shop?: string;
  at?: string;
  onSetUp?: () => void;
}) {
  // Who removed it is only known when the server says; without it the sentence is left out rather
  // than guessed.
  const who = by && shop && at ? `${by} removed it from ${shop} at ${at}. ` : '';
  return (
    <SignInFrame>
      <div className="c-si-center">
        <span className="c-si-bigic">
          <IconTablet />
        </span>
        <p className="c-si-title">This tablet was removed</p>
        <p className="c-det c-si-sub">{who}To use it again, set it up with a new code.</p>
        <button type="button" className="c-btn c-btn-lg c-si-cta" style={{ maxWidth: 280 }} onClick={onSetUp}>
          Set up again
        </button>
      </div>
    </SignInFrame>
  );
}
