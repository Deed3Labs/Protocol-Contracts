import { useCallback, useEffect, useState } from 'react';
import { useUpdatePhone } from '@privy-io/react-auth';
import SettingsPage from './SettingsPage';
import { useMemberProfile, type MailingAddress } from '@/hooks/useMemberProfile';
import { useFaceId } from '@/hooks/useFaceId';
import { useLogout } from '@/hooks/useLogout';
import { useContacts } from '@/context/ContactsContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { toSendContact } from './SendRoute';
import { SETTINGS } from '@/data/clearPlaceholder';
import { uploadMemberAvatar, deleteMemberAvatar, updateMemberProfile, getDisputeCandidates, fileDispute, getMyDisputes, withdrawMyDispute } from '@/utils/apiClient';
import type { DisputeCandidate, MemberDispute } from '@/lib/clearModel';

/**
 * Live Settings — the presentational page with the member's real identity behind
 * it.
 *
 * Only the photo is wired so far; the rest of the page still renders placeholder
 * figures, which is the rebuild's standing merge blocker. The photo is set
 * optimistically before the upload so it appears instantly and survives a failed
 * request as a local fallback, which is how the old account modal behaved.
 */
export default function SettingsRoute() {
  const member = useMemberProfile();
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const phone = usePhoneChange(() => member.refresh());
  const logout = useLogout();
  const { contacts } = useContacts();
  const { cash } = useClearBalances();
  const faceId = useFaceId();
  const disputes = useDisputes();

  const profile = {
    ...SETTINGS.profile,
    name: member.name || SETTINGS.profile.name,
    /*
     * The verified name, then the display name, then nothing.
     *
     * This row used to fall through to the fixture's 'Kai Moore' — a name that looked plausible
     * and belonged to nobody. The display name is a reasonable stand-in because a member chose it,
     * but it is "Kai M" by design (it is what other members see beside a payment), so it is second
     * rather than first. An em dash is the honest end of the chain: this row is empty until
     * verification fills it.
     */
    legalName: member.legalName || member.name || '—',
    initials: member.initials || SETTINGS.profile.initials,
    handle: member.handle || SETTINGS.profile.handle,
    email: member.email || SETTINGS.profile.email,
    phone: member.phone || SETTINGS.profile.phone,
    avatarUrl: member.avatarUrl,
  };

  return (
    <SettingsPage
      data={{ ...SETTINGS, profile, accelerationActive: member.accelerated }}
      onSignOut={() => void logout()}
      phoneChange={phone}
      // The switch shows whether a passkey is really on the account, and moves it.
      faceId={{
        on: faceId.on,
        busy: faceId.busy,
        error: faceId.error,
        onChange: (on) => void (on ? faceId.turnOn() : faceId.turnOff()),
      }}
      disputes={disputes}
      address={member.mailingAddress}
      savingAddress={savingAddress}
      addressError={addressError}
      /*
       * The one place the app holds an address. Ordering a physical card reads it rather than
       * asking again, so a save here is what unblocks that sheet.
       */
      onSaveAddress={(next: MailingAddress) => {
        setSavingAddress(true);
        setAddressError(null);
        void updateMemberProfile({
          addressLine1: next.line1.trim() || null,
          addressLine2: next.line2.trim() || null,
          addressCity: next.city.trim() || null,
          addressState: next.state.trim() || null,
          addressPostalCode: next.postalCode.trim() || null,
        })
          .then((saved) => {
            if (!saved) {
              setAddressError("We couldn't save that. Please try again.");
              return;
            }
            member.refresh();
          })
          .catch(() => setAddressError("We couldn't save that. Please try again."))
          .finally(() => setSavingAddress(false));
      }}
      contacts={contacts.map(toSendContact)}
      available={cash}
      // The photo is applied locally first and the backend call is best-effort:
      // avatar_url is capped at 2048 chars, so a real photo lives in local
      // storage until there's image hosting (see lib/avatarStore). A failed or
      // truncated round-trip must not undo what the member just did.
      onSavePhoto={async (dataUrl) => {
        member.setAvatar(dataUrl);
        try {
          await uploadMemberAvatar(dataUrl);
        } catch {
          /* kept locally */
        }
      }}
      onRemovePhoto={async () => {
        member.setAvatar(null);
        try {
          await deleteMemberAvatar();
          member.refresh();
        } catch {
          /* cleared locally */
        }
      }}
    />
  );
}


/** Privy wants E.164. Strip everything else and keep a single leading +. */
const toE164 = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  return `+${digits.length === 10 ? `1${digits}` : digits}`;
};

/**
 * Changing the number a code goes to.
 *
 * Two real steps against Privy — send, then verify — because the phone is the credential and a new
 * one has to answer before it replaces the old one. Privy holds the number that signs you in; the
 * member's own profile holds the one Settings shows, so a successful change writes both. The sheet
 * itself is headless for the same reason the sign-in screen is: Privy's own modal cannot say any of
 * this.
 */
function usePhoneChange(onChanged: () => void) {
  const { sendCode, verifyCode } = useUpdatePhone();
  const [stage, setStage] = useState<'enter' | 'code'>('enter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState('');

  const onSendCode = useCallback(
    (raw: string) => {
      setBusy(true);
      setError(null);
      const number = toE164(raw);
      void sendCode({ newPhoneNumber: number })
        .then(() => {
          setPending(number);
          setStage('code');
        })
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : "We couldn't send a code to that number."),
        )
        .finally(() => setBusy(false));
    },
    [sendCode],
  );

  const onVerify = useCallback(
    (code: string) => {
      setBusy(true);
      setError(null);
      void verifyCode({ code })
        .then(async () => {
          // Privy now signs them in on the new number; the profile row still shows the old one.
          await updateMemberProfile({ phone: pending }).catch(() => null);
          onChanged();
          setStage('enter');
        })
        .catch((e: unknown) =>
          setError(e instanceof Error ? e.message : 'That code did not work. Try again.'),
        )
        .finally(() => setBusy(false));
    },
    [verifyCode, pending, onChanged],
  );

  const onClose = useCallback(() => {
    setStage('enter');
    setError(null);
    setPending('');
  }, []);

  return { stage, busy, error, onSendCode, onVerify, onClose };
}

/**
 * The member's own payments to dispute, read when the modal opens — never earlier, because most
 * visits to Settings are not about a dispute and this reads three tables.
 */
function useDisputes() {
  const [candidates, setCandidates] = useState<DisputeCandidate[] | null>(null);
  const [mine, setMine] = useState<MemberDispute[]>([]);
  const loadMine = useCallback(() => {
    void getMyDisputes().then((list) => setMine(list ?? []));
  }, []);
  useEffect(() => loadMine(), [loadMine]);

  const load = useCallback((include?: { kind: DisputeCandidate['kind']; ref: string }) => {
    setCandidates(null);
    void getDisputeCandidates(include).then((list) => setCandidates(list ?? []));
  }, []);

  const file = useCallback(
    async (input: { kind: DisputeCandidate['kind']; ref: string; detail: string; reason?: string }) => {
      const result = await fileDispute(input);
      if (result.error) return { error: result.error };
      loadMine();
      return { networkFiled: result.networkFiled ?? null };
    },
    [loadMine],
  );

  const withdraw = useCallback(
    async (token: string) => {
      const result = await withdrawMyDispute(token);
      loadMine();
      return result.ok ? null : (result.error ?? 'We could not withdraw that just now.');
    },
    [loadMine],
  );

  return { candidates, load, file, mine, withdraw };
}
