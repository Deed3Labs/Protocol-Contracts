import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import Card, { CardRule } from '@/components/clear/Card';
import SettingRows from '@/components/clear/SettingRows';
import ToggleRows from '@/components/clear/ToggleRows';
import ContactsPanel from '@/components/clear/ContactsPanel';
import LinkAccountDialog from '@/components/clear/LinkAccountDialog';
import RecoveryContactsDialog from '@/components/clear/RecoveryContactsDialog';
import ProfilePhotoRow from '@/components/settings/ProfilePhotoRow';
import ProfilePhotoDialog from '@/components/settings/ProfilePhotoDialog';
import MemberAvatar from '@/components/clear/MemberAvatar';
import LoginHistoryPanel from '@/components/settings/LoginHistoryPanel';
import PermissionsPanel from '@/components/settings/PermissionsPanel';
import LegalPanel from '@/components/settings/LegalPanel';
import HelpPanel from '@/components/settings/HelpPanel';
import BylawsPanel from '@/components/settings/BylawsPanel';
import PatronagePanel from '@/components/settings/PatronagePanel';
import VotingPanel from '@/components/settings/VotingPanel';
import BallotDialog from '@/components/settings/BallotDialog';
import { money } from '@/lib/money';
import ThemePicker from '@/components/clear/ThemePicker';
import InfoBlock from '@/components/clear/InfoBlock';
import AccelerationDialog from '@/components/settings/AccelerationDialog';
import ChangePhoneDialog from '@/components/settings/ChangePhoneDialog';
import TrustedDevicesDialog from '@/components/settings/TrustedDevicesDialog';
import CloseAccountDialog from '@/components/settings/CloseAccountDialog';
import { SETTINGS, CONTACTS } from '@/data/clearPlaceholder';
import type { SettingsData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';

/**
 * Profile & settings — reached from the avatar, not the nav.
 *
 * One section is shown at a time on both layouts: the desktop rail swaps the
 * pane beside it, mobile pushes the same content as a sub-page with a back
 * arrow. Section contents are written once and rendered by both, so the two
 * can't drift.
 *
 * What's a pane and what's a modal is a real distinction, not a coin toss.
 * Sections are places you go and browse; modals are single decisions with a
 * consequence — changing the number you sign in with, paying for acceleration,
 * closing the account. Those interrupt on purpose.
 */

type SectionId =
  | 'account'
  | 'membership'
  | 'contacts'
  | 'security'
  | 'notifications'
  | 'linked'
  | 'appearance'
  | 'advanced'
  | 'help';

/** Pages that sit one level below a section, on both layouts. */
type SubId = 'bylaws' | 'patronage' | 'voting' | 'legal' | 'logins' | 'permissions';

export default function SettingsPage({
  data = SETTINGS,
  onSavePhoto,
  onRemovePhoto,
}: {
  data?: SettingsData;
  /** Live wiring — see SettingsRoute. Absent in the preview harness. */
  onSavePhoto?: (dataUrl: string) => Promise<void> | void;
  onRemovePhoto?: () => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const { profile } = data;
  const [section, setSection] = useState<SectionId>('account');
  /** Mobile only: null means the section list, otherwise the pushed sub-page. */
  const [mobileSection, setMobileSection] = useState<SectionId | null>(null);

  const [accelerationOpen, setAccelerationOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  /** A drill-in below the current section, on either layout. */
  const [sub, setSub] = useState<SubId | null>(null);
  const [ballotOpen, setBallotOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const [notifyOn, setNotifyOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      data.notificationGroups.flatMap((g) => g.prefs.map((p) => [p.id, true] as const)),
    ),
  );

  // ---- Section contents, rendered by both layouts ----------------------------

  const personalInformation = (
    <>
      <ProfilePhotoRow profile={profile} onOpen={() => setPhotoOpen(true)} />

      <SettingRows
        rows={[
          { label: 'Legal name', value: profile.legalName },
          { label: 'Date of birth', value: profile.dateOfBirth },
          { label: 'Home address', value: profile.address },
          { label: 'Phone', value: profile.phone, onSelect: () => setPhoneOpen(true) },
          { label: 'Email', value: profile.email },
        ]}
      />
      <InfoBlock tone="neutral" className="mt-3.5 text-[11px]">
        Name and date of birth are locked after identity verification. Contact support to correct
        them.
      </InfoBlock>
    </>
  );

  /** The four membership facts, shown both in the overview card and its own pane. */
  const membershipStats = (
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
          {profile.votes} of {profile.votes}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-foreground-secondary">Region</span>
        <span>{profile.region}</span>
      </div>
    </div>
  );

  /**
   * Open a drill-in and select the section it belongs to, so the desktop rail
   * points at the right parent however the page was reached — including from the
   * mobile list, which has no rail of its own.
   */
  const openSub = (id: SubId, parent: SectionId) => {
    setSection(parent);
    setSub(id);
  };

  const SECTIONS: Record<SectionId, { label: string; title: string; content: ReactNode }> = {
    account: {
      label: 'Account',
      title: 'Personal information',
      content: personalInformation,
    },

    membership: {
      label: 'Membership',
      title: 'Membership',
      content: (
        <>
          <Card className="mb-3.5">{membershipStats}</Card>

          <p className="mb-3.5 text-xs leading-relaxed text-muted-foreground">
            However much you save, your vote counts the same as every other member&rsquo;s.
          </p>

          <SettingRows
            rows={[
              { label: 'Membership agreement', onSelect: () => openSub('legal', 'membership') },
              { label: 'Bylaws', value: data.bylaws.version, onSelect: () => openSub('bylaws', 'membership') },
              { label: 'Patronage & distributions', onSelect: () => openSub('patronage', 'membership') },
              {
                label: 'Voting history',
                value: `${data.votesCast} votes cast`,
                onSelect: () => openSub('voting', 'membership'),
              },
              {
                label: 'Acceleration',
                value: data.accelerationActive ? 'Active' : 'Not active',
                onSelect: () => setAccelerationOpen(true),
              },
            ]}
          />
        </>
      ),
    },

    contacts: {
      label: 'Contacts',
      title: 'Contacts',
      content: <ContactsPanel contacts={CONTACTS} />,
    },

    security: {
      label: 'Security',
      title: 'Security',
      content: (
        <>
          <ToggleRows
            rows={[
              {
                id: 'faceid',
                label: 'Face ID',
                detail: 'Sign in without a code',
                defaultOn: data.faceIdOn,
              },
              {
                id: 'faceid-payments',
                label: 'Require Face ID for payments',
                detail: `Over ${money(data.paymentFaceIdOver)}`,
                defaultOn: true,
              },
            ]}
          />

          <SettingRows
            className="mt-3.5 border-t-[0.5px] border-border pt-1"
            rows={[
              {
                label: 'Trusted devices',
                value: String(data.devices.length),
                onSelect: () => setDevicesOpen(true),
              },
              {
                label: 'Login history',
                value: `Last: ${data.lastLogin}`,
                onSelect: () => openSub('logins', 'security'),
              },
              {
                label: 'Recovery contacts',
                value:
                  data.recoveryContacts.length === 0
                    ? 'None set'
                    : String(data.recoveryContacts.length),
                onSelect: () => setRecoveryOpen(true),
              },
            ]}
          />

          {/* Says the quiet part out loud: there is nothing here to phish. */}
          <InfoBlock tone="neutral" className="mt-3.5 text-[11px]">
            There's no password on your account. Sign-in uses your phone, email, or Face ID.
          </InfoBlock>
        </>
      ),
    },

    notifications: {
      label: 'Notifications',
      title: 'Notifications',
      content: (
        <>
          {data.notificationGroups.map((group, gi) => (
            <div key={group.title} className={cn(gi > 0 && 'mt-4')}>
              <p className="mb-0.5 text-[11px] text-foreground-secondary">{group.title}</p>
              <div className="text-[13px]">
                {group.prefs.map((pref, i) => (
                  <div
                    key={pref.id}
                    className={cn(
                      'flex items-center justify-between gap-3.5 py-2.5',
                      i < group.prefs.length - 1 && 'border-b-[0.5px] border-border',
                    )}
                  >
                    <span className="min-w-0">
                      <label htmlFor={`notify-${pref.id}`} className="block truncate">
                        {pref.label}
                      </label>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {pref.detail}
                      </span>
                    </span>
                    <Switch
                      id={`notify-${pref.id}`}
                      checked={notifyOn[pref.id]}
                      onCheckedChange={(v) => setNotifyOn((prev) => ({ ...prev, [pref.id]: v }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      ),
    },

    linked: {
      label: 'Linked accounts',
      title: 'Linked accounts',
      content: (
        <>
          <Card className="mb-3">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-xs text-foreground-secondary">Direct deposit</span>
              <span className="flex items-center gap-1.5 text-[11px] text-tier-savings-fg">
                <CircleCheck className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
                Active
              </span>
            </div>
            <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Payroll from {data.employer} arrives here. This is what backs your income-based limit.
            </p>
            <Button variant="clear" size="xs" className="w-full">
              Account details
            </Button>
          </Card>

          <SettingRows
            rows={[
              { label: 'External bank', value: data.externalBank },
              { label: 'Employer', value: data.employer },
            ]}
          />

          <Button
            variant="clear"
            size="xs"
            className="mt-3.5 w-full"
            onClick={() => setLinkOpen(true)}
          >
            Link another account
          </Button>

          <InfoBlock tone="neutral" className="mt-3.5 text-[11px]">
            We use your linked bank to verify income and pull scheduled savings. We never move money
            without you asking.
          </InfoBlock>
        </>
      ),
    },

    appearance: { label: 'Appearance', title: 'Appearance', content: <ThemePicker /> },

    advanced: {
      label: 'Advanced',
      title: 'Advanced',
      content: (
        <>
          <Card className="mb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-foreground-secondary">Wallet address</p>
                <p className="mt-[3px] truncate font-mono text-xs">{profile.walletAddress}</p>
              </div>
              <Button
                variant="clear"
                size="xs"
                aria-label="Copy wallet address"
                onClick={() => navigator.clipboard?.writeText(profile.walletAddress).catch(() => {})}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Your account is a smart wallet. You don&rsquo;t need this for anything in the app —
              it&rsquo;s here if you want it.
            </p>
          </Card>

          <SettingRows
            rows={[
              {
                label: 'Permissions',
                value: String(data.permissions.length),
                onSelect: () => openSub('permissions', 'advanced'),
              },
            ]}
          />

          <div className="mt-3.5 border-t-[0.5px] border-border pt-1 text-[13px]">
            <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-border py-2.5">
              <span>Export account data</span>
              <Button variant="clear" size="xs">
                Download
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span>Transaction history (CSV)</span>
              <Button variant="clear" size="xs">
                Download
              </Button>
            </div>
          </div>

          <CardRule>
            <Button
              variant="clear"
              size="xs"
              className="w-full text-foreground-secondary"
              onClick={() => setCloseOpen(true)}
            >
              Close account &amp; withdraw
            </Button>
          </CardRule>
        </>
      ),
    },

    help: {
      label: 'Help',
      title: 'Help',
      content: <HelpPanel topics={data.helpTopics} onDispute={() => navigate('/learn/disputes')} />,
    },
  };

  /**
   * One level below a section. Same content in both layouts — pushed on mobile,
   * swapped into the pane on desktop — because a document you're reading is a
   * place you go, not a dialog over the page you came from.
   */
  // `bare` opts a drill-in out of the pane's Card wrapper, for content that supplies its own
  // cards. Permissions needs it: its group labels belong above their cards, and nesting cards
  // inside a card puts them inside one instead.
  const SUBPAGES: Record<SubId, { title: string; content: ReactNode; bare?: boolean }> = {
    bylaws: { title: 'Bylaws', content: <BylawsPanel bylaws={data.bylaws} /> },
    permissions: {
      title: 'Permissions',
      content: <PermissionsPanel permissions={data.permissions} />,
      bare: true,
    },
    patronage: {
      title: 'Patronage & distributions',
      content: (
        <PatronagePanel
          patronage={data.patronage}
          onExplain={() => navigate('/learn/patronage')}
        />
      ),
    },
    voting: {
      title: 'Voting',
      content: (
        <VotingPanel
          ballot={data.ballot}
          pastVotes={data.pastVotes}
          onVote={() => setBallotOpen(true)}
        />
      ),
    },
    legal: { title: 'Legal & agreements', content: <LegalPanel docs={data.legalDocs} /> },
    logins: { title: 'Login history', content: <LoginHistoryPanel logins={data.logins} /> },
  };

  const RAIL: SectionId[] = [
    'account',
    'membership',
    'contacts',
    'security',
    'notifications',
    'linked',
    'appearance',
    'advanced',
  ];

  const identity = (avatarSize: string, nameSize: string) => (
    <>
      <MemberAvatar profile={profile} className={cn('rounded-full', avatarSize)} />
      <span className="min-w-0">
        <span className={cn('block truncate font-medium', nameSize)}>{profile.name}</span>
        <span className="mt-[3px] block text-xs text-foreground-secondary">
          {profile.handle} · Member since {profile.memberSince}
        </span>
      </span>
    </>
  );

  const modals = (
    <>
      <AccelerationDialog data={data} open={accelerationOpen} onOpenChange={setAccelerationOpen} />
      <ChangePhoneDialog current={profile.phone} open={phoneOpen} onOpenChange={setPhoneOpen} />
      <TrustedDevicesDialog devices={data.devices} open={devicesOpen} onOpenChange={setDevicesOpen} />
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} />
      <ProfilePhotoDialog
        profile={profile}
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        onSave={onSavePhoto}
        onRemove={onRemovePhoto}
      />
      <RecoveryContactsDialog
        contacts={CONTACTS}
        open={recoveryOpen}
        onOpenChange={setRecoveryOpen}
      />
      <CloseAccountDialog closure={data.closure} open={closeOpen} onOpenChange={setCloseOpen} />
      {data.ballot && (
        <BallotDialog ballot={data.ballot} open={ballotOpen} onOpenChange={setBallotOpen} />
      )}
    </>
  );

  /** Back arrow + title, shared by every pushed page. */
  const pushedHeader = (title: string, onBack: () => void) => (
    <div className="mb-4 flex items-center gap-2.5">
      <button
        type="button"
        aria-label="Back to settings"
        onClick={onBack}
        className="text-foreground-secondary transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-[17px] w-[17px]" strokeWidth={1.75} />
      </button>
      <span className="text-[15px] font-medium">{title}</span>
    </div>
  );

  /** Desktop: the rail swaps the pane beside it. */
  const desktopSettings = (
    <div className="hidden lg:block">
      <div className="mb-5 flex items-center gap-3.5">
        {identity('h-[52px] w-[52px] text-[17px]', 'text-xl')}
      </div>

      <div className="grid grid-cols-[190px_minmax(0,1fr)] items-start gap-6">
        <nav className="sticky top-[72px] text-[13px]">
          {RAIL.map((id) => (
            <button
              key={id}
              type="button"
              // Picking a rail item leaves any drill-in below it: the rail is the
              // top level, so it always lands you at the top level.
              onClick={() => {
                setSection(id);
                setSub(null);
              }}
              aria-current={id === section ? 'true' : undefined}
              className={cn(
                'block w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                id === section
                  ? 'bg-secondary text-foreground'
                  : 'text-foreground-secondary hover:text-foreground',
              )}
            >
              {SECTIONS[id].label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setSection('help');
              setSub(null);
            }}
            aria-current={section === 'help' ? 'true' : undefined}
            className={cn(
              'mt-1.5 block w-full rounded-lg border-t-[0.5px] border-border px-2.5 pb-2 pt-3 text-left transition-colors',
              section === 'help' ? 'text-foreground' : 'text-foreground-secondary hover:text-foreground',
            )}
          >
            Help
          </button>
        </nav>

        <div>
          {/* A drill-in takes the pane while the rail keeps its parent
              selected — you're still inside that section, one level down. */}
          {sub ? (
            <>
              {pushedHeader(SUBPAGES[sub].title, () => setSub(null))}
              {SUBPAGES[sub].bare ? (
                SUBPAGES[sub].content
              ) : (
                <Card>{SUBPAGES[sub].content}</Card>
              )}
            </>
          ) : section === 'account' ? (
            <div className="flex flex-col gap-3">
              <Card>
                <p className="mb-1 text-[13px] text-foreground-secondary">Personal information</p>
                {personalInformation}
              </Card>

              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <p className="mb-2.5 text-[13px] text-foreground-secondary">Membership</p>
                  {membershipStats}
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
                    Reach member benefits sooner instead of earning them over time through saving
                    and clean cycles.
                  </p>
                  <Button
                    variant="clear"
                    size="xs"
                    className="mt-auto w-full"
                    onClick={() => setAccelerationOpen(true)}
                  >
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
                  {SECTIONS.security.content}
                </Card>
                <Card>
                  <p className="mb-1 text-[13px] text-foreground-secondary">Linked accounts</p>
                  {SECTIONS.linked.content}
                </Card>
              </div>

              <Card>
                <p className="mb-1 text-[13px] text-foreground-secondary">Advanced</p>
                {SECTIONS.advanced.content}
              </Card>
            </div>
          ) : (
            <Card>{SECTIONS[section].content}</Card>
          )}

          <Button variant="clear" size="xs" className="mt-3 w-full">
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );

  // ---- Mobile: pushed sub-page ------------------------------------------------

  if (mobileSection || sub) {
    // Mobile only: the desktop layout renders the same drill-in in its pane, so
    // this branch is hidden there rather than replacing the page.
    const current = sub ? SUBPAGES[sub] : SECTIONS[mobileSection as SectionId];
    return (
      <>
        <div className="lg:hidden">
          {pushedHeader(current.title, () => (sub ? setSub(null) : setMobileSection(null)))}
          {current.content}
        </div>
        {desktopSettings}
        {modals}
      </>
    );
  }

  return (
    <>
      {/* Mobile: the section list */}
      <div className="lg:hidden">
        <div className="mb-3.5 flex items-center gap-3 border-b-[0.5px] border-border pb-3.5">
          {identity('h-11 w-11 text-sm', 'text-[15px]')}
        </div>

        <p className="mb-2 text-[11px] text-foreground-secondary">Appearance</p>
        <ThemePicker className="mb-4" />

        <p className="mb-0.5 text-[11px] text-foreground-secondary">Account</p>
        <SettingRows
          rows={[
            { label: 'Personal information', onSelect: () => setMobileSection('account') },
            {
              label: 'Membership',
              value: `${profile.votes} vote`,
              onSelect: () => setMobileSection('membership'),
            },
            {
              label: 'Acceleration',
              value: data.accelerationActive ? 'Active' : 'Not active',
              onSelect: () => setAccelerationOpen(true),
            },
            {
              label: 'Contacts',
              value: String(CONTACTS.length),
              onSelect: () => setMobileSection('contacts'),
            },
            {
              label: 'Security',
              value: data.faceIdOn ? 'Face ID on' : 'Off',
              onSelect: () => setMobileSection('security'),
            },
            { label: 'Notifications', onSelect: () => setMobileSection('notifications') },
            {
              label: 'Linked accounts',
              value: String(data.linkedAccountCount),
              onSelect: () => setMobileSection('linked'),
            },
          ]}
        />

        <p className="mb-0.5 mt-4 text-[11px] text-foreground-secondary">More</p>
        <SettingRows
          rows={[
            { label: 'Advanced', onSelect: () => setMobileSection('advanced') },
            { label: 'Help', onSelect: () => setMobileSection('help') },
            { label: 'Legal & agreements', onSelect: () => openSub('legal', 'membership') },
          ]}
        />

        <Button variant="clear" size="xs" className="mt-4 w-full">
          Sign out
        </Button>
      </div>

      {desktopSettings}

      {modals}
    </>
  );
}
