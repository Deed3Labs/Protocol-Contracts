import { useState } from 'react';
import SettingsPage from './SettingsPage';
import { useMemberProfile, type MailingAddress } from '@/hooks/useMemberProfile';
import { useLogout } from '@/hooks/useLogout';
import { useContacts } from '@/context/ContactsContext';
import { useClearBalances } from '@/hooks/useClearBalances';
import { toSendContact } from './SendRoute';
import { SETTINGS } from '@/data/clearPlaceholder';
import { uploadMemberAvatar, deleteMemberAvatar, updateMemberProfile } from '@/utils/apiClient';

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
  const logout = useLogout();
  const { contacts } = useContacts();
  const { cash } = useClearBalances();

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
