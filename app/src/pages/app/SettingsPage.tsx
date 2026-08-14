import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Card, { CardRule } from '@/components/clear/Card';
import SettingRows from '@/components/clear/SettingRows';
import ThemePicker from '@/components/clear/ThemePicker';
import { SETTINGS } from '@/data/clearPlaceholder';
import type { SettingsData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Profile & settings — reached from the avatar, not the nav.
 *
 * Desktop spreads the sections out beside a section list; mobile collapses each
 * section to a single row that opens it, because a phone can't show eight
 * sections at once and pretending otherwise just makes everything tiny.
 *
 * Appearance is the exception on both: it's a control rather than a destination,
 * so it sits inline where you can flip it and see the result immediately.
 */

const SECTIONS = [
  'Account',
  'Membership',
  'Security',
  'Notifications',
  'Linked accounts',
  'Appearance',
  'Advanced',
] as const;

export default function SettingsPage({ data = SETTINGS }: { data?: SettingsData }) {
  const [section, setSection] = useState<string>('Account');
  const { profile } = data;

  const identity = (avatarSize: string, nameSize: string) => (
    <>
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-tier-boost/10 text-tier-boost-fg',
          avatarSize,
        )}
      >
        {profile.initials}
      </span>
      <span className="min-w-0">
        <span className={cn('block truncate font-medium', nameSize)}>{profile.name}</span>
        <span className="mt-[3px] block text-xs text-foreground-secondary">
          {profile.handle} · Member since {profile.memberSince}
        </span>
      </span>
    </>
  );

  return (
    <>
      {/* Mobile: one row per section, with appearance inline */}
      <div className="lg:hidden">
        <div className="mb-3.5 flex items-center gap-3 border-b-[0.5px] border-border pb-3.5">
          {identity('h-11 w-11 text-sm', 'text-[15px]')}
        </div>

        <p className="mb-2 text-[11px] text-foreground-secondary">Appearance</p>
        <ThemePicker className="mb-4" />

        <p className="mb-0.5 text-[11px] text-foreground-secondary">Account</p>
        <SettingRows
          className="mb-4"
          rows={[
            { label: 'Personal information' },
            { label: 'Membership', value: `${profile.votes} vote` },
            { label: 'Acceleration', value: data.accelerationActive ? 'Active' : 'Not active' },
            { label: 'Security', value: data.faceIdOn ? 'Face ID on' : 'Off' },
            { label: 'Notifications' },
            { label: 'Linked accounts', value: String(data.linkedAccountCount) },
          ]}
        />

        <p className="mb-0.5 text-[11px] text-foreground-secondary">More</p>
        <SettingRows
          className="mb-4"
          rows={[{ label: 'Advanced' }, { label: 'Help' }, { label: 'Legal & agreements' }]}
        />

        <Button variant="clear" size="xs" className="w-full">
          Sign out
        </Button>
      </div>

      {/* Desktop: section list beside the sections themselves */}
      <div className="hidden lg:block">
        <div className="mb-5 flex items-center gap-3.5">{identity('h-[52px] w-[52px] text-[17px]', 'text-xl')}</div>

        <div className="grid grid-cols-[190px_minmax(0,1fr)] gap-6">
          <nav className="text-[13px]">
            {SECTIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSection(item)}
                className={cn(
                  'block w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                  item === section ? 'bg-secondary text-foreground' : 'text-foreground-secondary hover:text-foreground',
                )}
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              className="mt-1.5 block w-full border-t-[0.5px] border-border px-2.5 pb-2 pt-3 text-left text-foreground-secondary transition-colors hover:text-foreground"
            >
              Help
            </button>
          </nav>

          <div className="flex flex-col gap-3">
            <Card>
              <p className="mb-1 text-[13px] text-foreground-secondary">Personal information</p>
              <SettingRows
                rows={[
                  { label: 'Legal name', value: profile.legalName },
                  { label: 'Phone', value: profile.phone },
                  { label: 'Email', value: profile.email },
                  { label: 'Home address', value: profile.address },
                ]}
              />
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Card>
                <p className="mb-2.5 text-[13px] text-foreground-secondary">Membership</p>
                <div className="text-xs leading-[2]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground-secondary">Member since</span>
                    <span>{profile.memberSince}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground-secondary">Your stake</span>
                    <span>Your savings balance</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground-secondary">Your vote</span>
                    <span>
                      {profile.votes} of {profile.votes} — same as everyone
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground-secondary">Region</span>
                    <span>{profile.region}</span>
                  </div>
                </div>
                <CardRule>
                  <Button variant="clear" size="xs" className="w-full">
                    Membership agreement &amp; bylaws
                  </Button>
                </CardRule>
              </Card>

              <Card className="flex flex-col">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-foreground-secondary">Acceleration</span>
                  <span className="text-xs text-muted-foreground">
                    {data.accelerationActive ? 'Active' : 'Not active'}
                  </span>
                </div>
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                  Reach member benefits sooner instead of earning them over time through saving and
                  clean cycles.
                </p>
                <Button variant="clear" size="xs" className="mt-auto w-full">
                  See what it unlocks
                </Button>
              </Card>
            </div>

            <Card>
              <p className="mb-2.5 text-[13px] text-foreground-secondary">Appearance</p>
              <ThemePicker />
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Card>
                <p className="mb-1 text-[13px] text-foreground-secondary">Security</p>
                <SettingRows
                  rows={[
                    { label: 'Face ID', value: data.faceIdOn ? 'On' : 'Off' },
                    { label: 'Trusted devices', value: String(data.trustedDevices) },
                    { label: 'Login history' },
                  ]}
                />
              </Card>

              <Card>
                <p className="mb-1 text-[13px] text-foreground-secondary">Linked accounts</p>
                <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-border py-2.5 text-[13px]">
                  <span>Direct deposit</span>
                  <span className="text-[11px] text-tier-savings-fg">Active</span>
                </div>
                <SettingRows
                  rows={[
                    { label: 'External bank', value: data.externalBank },
                    { label: 'Employer', value: data.employer },
                  ]}
                />
              </Card>
            </div>

            <Card>
              <p className="mb-1 text-[13px] text-foreground-secondary">Advanced</p>
              <SettingRows
                rows={[
                  { label: 'Wallet address', value: profile.walletAddress },
                  { label: 'Export account data' },
                  { label: 'Close account & withdraw', quiet: true },
                ]}
              />
            </Card>

            <Button variant="clear" size="xs" className="w-full">
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
