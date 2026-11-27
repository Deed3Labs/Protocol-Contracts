import { useEffect, useState } from 'react';
import { dollars } from '@clear/domain';
import { api, type MerchantProfile } from '@/data/apiClient';
import { useAuth } from '@/auth/authContext';
import { EnrollConfirmScreen } from '@/auth/screens';
import { rememberShop } from '@/lib/shopName';

/**
 * Enrolling this tablet, from the owner's session — sign-in reference, section 1.
 *
 * It states the ceiling before it asks for consent: it can raise charges up to the shop's cap,
 * enforced by policy rather than by the app, and it cannot move money. The cap is shown, never
 * editable — the ceiling is the shop's, held in MerchantRegistry and the wallet policy — and the
 * tablet locks after five idle minutes, as the reference fixes it.
 *
 * The reference's first screen, entering a code from Settings on another device, needs enrollment
 * codes from the API, which do not exist yet. Until they do, an unenrolled tablet goes to the
 * owner's own sign-in and then here, which is the reference's other way in ("or sign in as the
 * owner here").
 */
const IDLE_SECONDS = 300;

export function EnrollDevice({ onDone }: { onDone: () => void }) {
  const { enrollDevice } = useAuth();
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [label, setLabel] = useState('Counter tablet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .profile()
      .then((p) => {
        setProfile(p);
        rememberShop(p.name);
      })
      .catch(() => setProfile(null));
  }, []);

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      await enrollDevice({ label: label.trim(), idleLockSeconds: IDLE_SECONDS });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That tablet could not be set up.');
    } finally {
      setBusy(false);
    }
  }

  const cap = profile?.approvalCapCents;
  return (
    <EnrollConfirmScreen
      shop={profile?.name ?? ''}
      name={label}
      onName={setLabel}
      cap={cap === null || cap === undefined ? null : dollars(cap / 100)}
      busy={busy}
      error={error}
      onEnroll={enroll}
    />
  );
}
