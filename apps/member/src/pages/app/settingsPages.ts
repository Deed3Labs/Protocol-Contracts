/**
 * Settings addresses. Each section and drill-in is a route under /settings, so the phone header can
 * title it and its back arrow knows where up is — one level, not wherever the browser was before.
 */
export type SettingsSection = 'account' | 'membership' | 'security' | 'notifications' | 'contacts' | 'linked' | 'appearance' | 'help';
export type SettingsSub = 'bylaws' | 'patronage' | 'voting' | 'legal' | 'logins' | 'permissions';
export type SettingsPageId = SettingsSection | SettingsSub;

/** Title, and the rail item it sits under. Advanced is a modal, so Permissions sits under it by name. */
export const SETTINGS_PAGES: Record<SettingsPageId, { title: string; rail: SettingsSection | 'advanced'; up: string }> = {
  account: { title: 'Personal information', rail: 'account', up: '/settings' },
  membership: { title: 'Membership', rail: 'membership', up: '/settings' },
  security: { title: 'Security', rail: 'security', up: '/settings' },
  notifications: { title: 'Notifications', rail: 'notifications', up: '/settings' },
  contacts: { title: 'Contacts', rail: 'contacts', up: '/settings' },
  linked: { title: 'Linked accounts', rail: 'linked', up: '/settings' },
  appearance: { title: 'Appearance', rail: 'appearance', up: '/settings' },
  help: { title: 'Help', rail: 'help', up: '/settings' },
  bylaws: { title: 'Bylaws', rail: 'membership', up: '/settings/membership' },
  patronage: { title: 'Patronage & distributions', rail: 'membership', up: '/settings/membership' },
  voting: { title: 'Voting', rail: 'membership', up: '/settings/membership' },
  legal: { title: 'Legal & agreements', rail: 'membership', up: '/settings/membership' },
  logins: { title: 'Login history', rail: 'security', up: '/settings/security' },
  permissions: { title: 'Permissions', rail: 'advanced', up: '/settings' },
};

export function settingsPageOf(pathname: string): SettingsPageId | null {
  const id = pathname.match(/^\/settings\/([a-z]+)\/?$/)?.[1];
  return id && id in SETTINGS_PAGES ? (id as SettingsPageId) : null;
}
