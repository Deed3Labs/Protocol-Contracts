import SettingsPage from './SettingsPage';
import { useMemberProfile } from '@/hooks/useMemberProfile';
import { SETTINGS } from '@/data/clearPlaceholder';
import { uploadMemberAvatar, deleteMemberAvatar } from '@/utils/apiClient';

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

  const profile = {
    ...SETTINGS.profile,
    name: member.name || SETTINGS.profile.name,
    initials: member.initials || SETTINGS.profile.initials,
    handle: member.handle || SETTINGS.profile.handle,
    email: member.email || SETTINGS.profile.email,
    phone: member.phone || SETTINGS.profile.phone,
    avatarUrl: member.avatarUrl,
  };

  return (
    <SettingsPage
      data={{ ...SETTINGS, profile, accelerationActive: member.accelerated }}
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
