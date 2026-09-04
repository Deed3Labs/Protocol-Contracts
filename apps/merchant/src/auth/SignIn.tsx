import { useEffect, useState } from 'react';
import { Delete } from 'lucide-react';
import type { StaffRole } from '@clear/domain';
import { api } from '@/data/apiClient';
import { useAuth } from '@/auth/authContext';
import { Card } from '@/shell/ui';
import { OwnerSignIn } from '@/auth/OwnerSignIn';

/**
 * Starting a shift — reference section 19.
 *
 * **Pick a name, then a PIN.** A bare PIN field asks a writer to remember which of four codes is
 * theirs, which is the most common reason somebody borrows a colleague's — and a borrowed code
 * makes the staff name on every charge row a lie. A face and a name is one tap.
 *
 * **This is not a login.** A PIN is attribution, not authentication: four digits on a shared
 * counter tablet will be watched and shared, and pretending otherwise is how a design talks itself
 * into trusting one. The security boundary is the enrolled device. Nothing that moves money
 * happens from this screen — that needs the owner's Privy sign-in, and there is deliberately no
 * password field anywhere, because Clear holds no owner credential to check.
 *
 * The owner appears on the same roster. Mike works the counter too, and making him sign in
 * differently to raise a charge is a reason to hand the tablet to Jen instead.
 */

interface RosterEntry {
  id: string;
  name: string;
  role: StaffRole;
}

/** "Jen R." → "JR". Two letters is enough to tell four colleagues apart at a glance. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'not-me', '0', 'del'] as const;

export function SignIn() {
  const { signInWithPin, refresh } = useAuth();
  const [ownerMode, setOwnerMode] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [picked, setPicked] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .roster()
      .then(setRoster)
      .catch(() => setRoster([]));
  }, []);

  // Four digits is the whole PIN, so it submits on the fourth rather than asking for a confirm tap.
  useEffect(() => {
    if (pin.length !== 4 || !picked || busy) return;
    setBusy(true);
    setError(null);
    signInWithPin(pin, picked.id)
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'That did not match.');
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin, picked, busy, signInWithPin]);

  function press(key: string) {
    if (key === 'not-me') {
      // Where a clear key would sit. Picking the wrong name is the common mistake, not a wrong
      // digit, and backing out of it should cost one tap.
      setPicked(null);
      setPin('');
      setError(null);
      return;
    }
    if (key === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    setPin((p) => (p.length >= 4 ? p : p + key));
  }

  // A separate screen rather than a mode of this one: signing in as the owner is a different act
  // with a different authority, and blending them is how a tablet ends up left signed in as Mike.
  if (ownerMode) {
    return (
      <OwnerSignIn
        onDone={async () => {
          await refresh();
          setOwnerMode(false);
        }}
        onBack={() => setOwnerMode(false)}
      />
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--clear-surface-2)] px-4">
      <div className="w-full max-w-[330px]">
        <p className="m-0 mb-[3px] text-[11.5px] text-[var(--clear-text-muted)]">
          Clear for Merchants
        </p>

        {!picked ? (
          <>
            <p className="m-0 mb-2 text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
              Start a shift
            </p>
            <p className="m-0 mb-[14px] text-[12.5px] text-[var(--clear-text-secondary)]">
              Who&rsquo;s on the counter?
            </p>

            {roster === null ? (
              <Card className="!py-3.5">
                <p className="m-0 text-[13px] text-[var(--clear-text-muted)]">Loading the shift…</p>
              </Card>
            ) : roster.length === 0 ? (
              <Card className="!py-3.5">
                <p className="m-0 text-[13px] leading-[1.6] text-[var(--clear-text-secondary)]">
                  Nobody is set up on this tablet yet. An owner adds staff in Settings after signing
                  in.
                </p>
              </Card>
            ) : (
              <Card rows className="mb-[14px] !px-[14px] !py-0">
                {roster.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPicked(s)}
                    className="flex w-full items-center gap-[11px] border-b-[0.5px] border-[var(--clear-border)] py-3 text-left last:border-b-0"
                  >
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[34%] bg-[var(--clear-surface-0)] text-[11px] text-[var(--clear-text-secondary)]">
                      {initials(s.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px]">{s.name}</span>
                      <span className="mt-0.5 block text-[11.5px] text-[var(--clear-text-muted)]">
                        {s.role === 'owner' ? 'Owner' : 'Counter'}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border-[0.5px] border-[var(--clear-border)] px-2.5 py-0.5 text-[10.5px] text-[var(--clear-text-muted)]">
                      Start
                    </span>
                  </button>
                ))}
              </Card>
            )}

            <p className="m-0 mt-4 text-center text-[11.5px] leading-[1.55] text-[var(--clear-text-muted)]">
              Every charge is recorded against whoever is on shift.
            </p>

            {/* Deliberately quiet and last. Taking a payment needs a shift, not this — an owner
                who thinks otherwise signs in on a shared tablet and leaves it signed in. */}
            <button
              type="button"
              onClick={() => setOwnerMode(true)}
              className="mt-4 block w-full text-center text-[12.5px] text-[var(--clear-text-accent)]"
            >
              Sign in as the owner
            </button>
          </>
        ) : (
          <>
            <p className="m-0 mb-2 text-[10px] uppercase tracking-[0.5px] text-[var(--clear-text-muted)]">
              Their PIN
            </p>

            <div className="mb-[18px] flex items-center justify-center gap-2.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[34%] bg-[var(--clear-surface-0)] text-[11px] text-[var(--clear-text-secondary)]">
                {initials(picked.name)}
              </span>
              <span className="text-[14px]">
                {picked.name} · {picked.role === 'owner' ? 'Owner' : 'Counter'}
              </span>
            </div>

            {/* Dots, not a text field: the PIN is never legible over a customer's shoulder. */}
            <div className="mb-4 mt-1.5 flex justify-center gap-2.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`block h-3 w-3 rounded-full ${
                    i < pin.length ? 'bg-[var(--clear-text-primary)]' : 'bg-[var(--clear-surface-0)]'
                  }`}
                />
              ))}
            </div>

            <div className="mx-auto mb-4 grid max-w-[280px] grid-cols-3 gap-2">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() => press(k)}
                  aria-label={k === 'del' ? 'Delete' : k === 'not-me' ? 'Not me' : k}
                  className={`flex items-center justify-center rounded-[11px] bg-[var(--clear-surface-1)] py-[15px] ${
                    k === 'not-me' || k === 'del'
                      ? 'text-[13px] text-[var(--clear-text-secondary)]'
                      : 'text-[20px]'
                  }`}
                >
                  {k === 'del' ? <Delete size={19} aria-hidden /> : k === 'not-me' ? 'Not me' : k}
                </button>
              ))}
            </div>

            {error && (
              <p role="alert" className="m-0 mb-2 text-center text-[13px]">
                {error}
              </p>
            )}

            {/* Reset is the owner's job, said on the screen: it removes the support call and
                reinforces who holds authority without a lecture. */}
            <p className="m-0 text-center text-[11.5px] leading-[1.55] text-[var(--clear-text-muted)]">
              Forgot it? An owner can reset it in Staff.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
