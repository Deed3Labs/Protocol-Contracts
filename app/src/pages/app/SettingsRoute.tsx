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
      onSavePhoto={async (dataUrl) => {
        member.setAvatar(dataUrl);
        const res = await uploadMemberAvatar(dataUrl);
        if (res?.avatarUrl) member.refresh();
      }}
      onRemovePhoto={async () => {
        member.setAvatar(null);
        await deleteMemberAvatar();
        member.refresh();
      }}
    />
  );
}
