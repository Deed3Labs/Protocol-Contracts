import { useEffect, useState } from 'react';
import { dollars } from '@clear/domain';
import { api, type MerchantProfile } from '@/data/apiClient';
import { useAuth } from '@/auth/authContext';
import { Card, PrimaryButton, Row } from '@/shell/ui';

/**
 * Setting up a tablet — reference section 19. Once, by the owner, on the tablet itself.
 *
 * **It states the ceiling before it asks for consent.** The screen's job is not to collect a name;
 * it is to tell an owner exactly what they are handing to a device that will sit on a counter all
 * day, before they agree to it. So the limits are shown as facts, above the button, in the same
 * card as the one field — not buried in a help page an owner reads after something goes wrong.
 *
 * **The device is the security boundary, not the PIN.** Four digits on a shared tablet will be
 * watched and shared; that is fine, because a PIN only has to say who raised a charge. What has to
 * be revocable is the tablet, which is why the last line is the most load-bearing sentence here:
 * remove it any time, from any device. A lost tablet is the risk this design actually answers.
 *
 * **The tablet holds no key.** Clear's backend holds one authorization key per merchant
 * organization and does the signing, so what gets stored here is a session and nothing more. That
 * is what makes "enforced by policy, not by this app" true rather than reassuring: the cap lives in
 * MerchantRegistry and the wallet policy, so it holds on every device at once and holds even if
 * this app is bypassed entirely.
 */

/** Long enough not to interrupt a queue, short enough that a walked-away tablet closes itself. */
const IDLE_OPTIONS = [
  // Abbreviated: four full labels do not fit the row at phone width, and the row reads as a set
  // of choices rather than as prose. The sentence above it still says "5 minutes" in full.
  { seconds: 60, label: '1 min' },
  { seconds: 300, label: '5 min' },
  { seconds: 900, label: '15 min' },
  { seconds: 1800, label: '30 min' },
] as const;

function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m === 1 ? '1 minute' : `${m} minutes`;
}

export function EnrollDevice({ onDone }: { onDone: () => void }) {
  const { enrollDevice } = useAuth();
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [label, setLabel] = useState('Counter tablet');
  const [idle, setIdle] = useState(300);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The shop's name and cap are the two facts this screen is built to state, so it says them in
  // the owner's own terms rather than in the abstract.
  useEffect(() => {
    api.profile().then(setProfile).catch(() => setProfile(null));
  }, []);

  const shopName = profile?.name ?? 'this shop';
  const cap = profile?.approvalCapCents;

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      await enrollDevice({ label, idleLockSeconds: idle });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That tablet could not be set up.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--clear-surface-2)] px-4 py-8">
      <div className="w-full max-w-[380px]">
        <p className="m-0 mb-[3px] text-[11.5px] text-[var(--clear-text-muted)]">
          Clear for Merchants
        </p>
        <h1 className="m-0 mb-1.5 text-[24px] font-semibold tracking-[-0.4px]">
          Set up this tablet
        </h1>

        {/* What it can do, then — at greater length — what it cannot. An owner handing a device to
            a counter is asking the second question, so the screen answers it without being asked. */}
        <p className="m-0 mb-[18px] text-[12.5px] leading-[1.6] text-[var(--clear-text-secondary)]">
          This device will be able to raise charges for{' '}
          <strong className="font-medium text-[var(--clear-text-primary)]">{shopName}</strong>. It
          will not be able to move money, change terms or see your bank details. Only you can do
          those, and only after signing in.
        </p>

        <Card rows>
          <Row
            title={
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={40}
                aria-label="Device name"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--clear-text-muted)]"
                placeholder="Counter tablet"
              />
            }
            meta="Name it so you recognise it later"
          />

          {/* Shown, never editable. A per-device cap here would contradict the line beneath it —
              the ceiling is the shop's, held in the registry and the wallet policy. */}
          <Row
            title={
              cap === null || cap === undefined
                ? 'Charges up to your approved limit'
                : `Charges up to ${dollars(cap / 100)}`
            }
            meta="Enforced by policy, not by this app"
            right={<span className="text-[11.5px] text-[var(--clear-text-muted)]">Fixed</span>}
          />

          <Row
            title={`Locks after ${minutes(idle)} idle`}
            meta="Back to the shift screen"
            right={
              <button
                type="button"
                onClick={() => setPicking((p) => !p)}
                className="text-[11.5px] text-[var(--clear-text-accent)]"
              >
                {picking ? 'Done' : 'Change'}
              </button>
            }
          />
        </Card>

        {picking && (
          <div className="mt-2 grid grid-cols-4 gap-2">
            {IDLE_OPTIONS.map((o) => (
              <button
                key={o.seconds}
                type="button"
                onClick={() => {
                  setIdle(o.seconds);
                  setPicking(false);
                }}
                className={`rounded-[10px] border-[0.5px] py-2.5 text-[12px] ${
                  idle === o.seconds
                    ? 'border-[var(--clear-text-primary)] bg-[var(--clear-surface-1)]'
                    : 'border-[var(--clear-border)] bg-[var(--clear-surface-1)] text-[var(--clear-text-secondary)]'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-[18px]">
          <PrimaryButton disabled={busy || !label.trim()} onClick={enroll} className="!py-[13px] !text-[14px]">
            {busy ? 'Setting up…' : 'Enroll this device'}
          </PrimaryButton>
        </div>

        {error && (
          <p role="alert" className="m-0 mt-3 text-center text-[13px]">
            {error}
          </p>
        )}

        {/* The sentence that makes a lost tablet survivable, and the reason the device rather than
            the PIN is the real control. Last, because it is what an owner needs to remember. */}
        <p className="m-0 mt-4 text-center text-[11.5px] leading-[1.55] text-[var(--clear-text-muted)]">
          Remove it any time from Settings, from any device.
        </p>
      </div>
    </div>
  );
}
