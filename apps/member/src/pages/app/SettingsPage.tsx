import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useIdentity } from '@/context/IdentityContext';
import { Btn, CMain, Rows } from '@/components/clear/brand/anatomy';
import { ChevronIcon } from '@/components/clear/brand/icons';
import { Done, KvRow, Pane, TwoLineRow } from '@/components/settings/SettingsKit';
import Switch from '@/components/clear/brand/Switch';
import LinkAccountDialog from '@/components/clear/LinkAccountDialog';
import RecoveryContactsDialog from '@/components/clear/RecoveryContactsDialog';
import ProfilePhotoDialog from '@/components/settings/ProfilePhotoDialog';
import MemberAvatar from '@/components/clear/MemberAvatar';
import LoginHistoryPanel from '@/components/settings/LoginHistoryPanel';
import PermissionsPanel from '@/components/settings/PermissionsPanel';
import LegalPanel from '@/components/settings/LegalPanel';
import HelpPanel from '@/components/settings/HelpPanel';
import DisputesPanel from '@/components/settings/DisputesPanel';
import RaiseDisputeDialog, { type FileDisputeResult } from '@/components/settings/RaiseDisputeDialog';
import BylawsPanel from '@/components/settings/BylawsPanel';
import PatronagePanel from '@/components/settings/PatronagePanel';
import VotingPanel from '@/components/settings/VotingPanel';
import BallotDialog from '@/components/settings/BallotDialog';
import AdvancedDialog from '@/components/settings/AdvancedDialog';
import { money } from '@clear/domain';
import ThemePicker from '@/components/clear/ThemePicker';
import { THEME_PINNED } from '@/context/ThemeContext';
import AccelerationPanel from '@/components/settings/AccelerationPanel';
import PatronageCalculationPanel from '@/components/settings/PatronageCalculationPanel';
import ChangePhoneDialog from '@/components/settings/ChangePhoneDialog';
import ChangeAddressDialog from '@/components/settings/ChangeAddressDialog';
import { EMPTY_ADDRESS, formatAddress, type MailingAddress } from '@/hooks/useMemberProfile';
import TrustedDevicesDialog from '@/components/settings/TrustedDevicesDialog';
import CloseAccountDialog from '@/components/settings/CloseAccountDialog';
import ContactsPane from '@/components/settings/ContactsPane';
import { SETTINGS, CONTACTS, DISPUTE_SAMPLE_CANDIDATES, DISPUTE_SAMPLE_MINE } from '@/data/clearPlaceholder';
import { useIsDesktop } from '@/lib/useIsDesktop';
import type { CardDisputeReason, Contact, DisputeCandidate, DisputeKind, MemberDispute, SettingsData } from '@/lib/clearModel';
import { cn } from '@/lib/utils';
import { SETTINGS_PAGES, settingsPageOf, type SettingsPageId, type SettingsSection } from './settingsPages';

/**
 * Settings — reached from the avatar, not the nav.
 *
 * Sub-pages are panes; only actions are modals. A pane and a mobile drill-in are the same content in
 * two frames, so each body is written once: the desktop rail selects it beside the rail, the phone
 * pushes it as its own route with the header's back arrow. A pane is a component — header, main,
 * footer — like anything in a slab.
 *
 * Advanced and Close account are actions, so they are modals; Permissions, reached from Advanced, is
 * a pane and keeps Advanced lit on the rail.
 */

const RAIL: { id: SettingsSection | 'advanced'; label: string; detail: string }[] = [
  { id: 'account', label: 'Account', detail: 'Name, contact, identity' },
  { id: 'membership', label: 'Membership', detail: 'Shares, votes, your co-op record' },
  { id: 'security', label: 'Security', detail: 'Passkeys, devices, recovery' },
  { id: 'notifications', label: 'Notifications', detail: 'What reaches you and how' },
  { id: 'contacts', label: 'Contacts', detail: 'People you send to and partners you follow' },
  { id: 'linked', label: 'Linked accounts', detail: 'Banks and cards that clear your balance' },
  // Appearance returns with the dark/dusk pass; while the theme is pinned there is nothing to pick.
  ...(THEME_PINNED ? [] : [{ id: 'appearance' as const, label: 'Appearance', detail: 'Theme and display' }]),
  { id: 'advanced', label: 'Advanced', detail: 'Wallet, exports, permissions' },
];

export default function SettingsPage({
  data = SETTINGS,
  onSavePhoto,
  onRemovePhoto,
  onSignOut,
  contacts = CONTACTS,
  available = 0,
  address = EMPTY_ADDRESS,
  onSaveAddress,
  savingAddress = false,
  addressError = null,
  phoneChange,
  faceId,
  disputes,
}: {
  data?: SettingsData;
  /** The address book, and Ready to allocate for sending from it. */
  contacts?: Contact[];
  available?: number;
  /** Live wiring — see SettingsRoute. Absent in the preview harness. */
  onSavePhoto?: (dataUrl: string) => Promise<void> | void;
  onRemovePhoto?: () => Promise<void> | void;
  onSignOut?: () => void;
  /** The member's own mailing address. The Home address row shows and edits this. */
  address?: MailingAddress;
  onSaveAddress?: (next: MailingAddress) => void;
  savingAddress?: boolean;
  addressError?: string | null;
  /**
   * Changing the number a code goes to. Absent in the preview harness, where the sheet is there to
   * be looked at rather than to move a credential.
   */
  phoneChange?: {
    stage: 'enter' | 'code';
    busy: boolean;
    error: string | null;
    onSendCode: (phone: string) => void;
    onVerify: (code: string) => void;
    onClose: () => void;
  };
  /**
   * Face ID, for real. Absent in the preview harness, where the switch stays local.
   *
   * `on` is whether a passkey is actually linked to the account, read from Privy. The switch used to
   * be local state that linked nothing, so a member could turn it on and still have sign-in fail.
   */
  faceId?: {
    on: boolean;
    busy: boolean;
    error: string | null;
    onChange: (on: boolean) => void;
  };
  /**
   * Disputes, for real: the member's own payments and a filing that reaches the API (and Lithic, for
   * a card). Absent in the preview harness, which shows sample payments and files nothing.
   */
  disputes?: {
    candidates: DisputeCandidate[] | null;
    load: (include?: { kind: DisputeKind; ref: string }) => void;
    file: (input: { kind: DisputeKind; ref: string; detail: string; reason?: CardDisputeReason }) => Promise<FileDisputeResult>;
    mine: MemberDispute[];
    withdraw: (token: string) => Promise<string | null>;
  };
}) {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const desktop = useIsDesktop();
  const verification = useIdentity();
  const { profile } = data;

  // The bare /settings is the index on a phone and Account beside the rail on desktop.
  const page: SettingsPageId | null = settingsPageOf(pathname) ?? (desktop ? 'account' : null);

  const [phoneOpen, setPhoneOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [ballotOpen, setBallotOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  /*
   * Arriving from "Something wrong" on a transaction: the payment comes with the navigation, and
   * Raise a dispute opens with it already chosen rather than making the member find it again.
   */
  const arrivedWith = (state as { dispute?: { kind: DisputeKind; ref: string } } | null)?.dispute;
  const [disputeOpen, setDisputeOpen] = useState(() => Boolean(arrivedWith));
  const [disputeFor, setDisputeFor] = useState(arrivedWith);
  useEffect(() => {
    if (arrivedWith) disputes?.load(arrivedWith);
    // Once, on arrival. A later visit to this page without the payment starts clean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => ({
    faceid: data.faceIdOn,
    'faceid-payments': true,
    ...Object.fromEntries(data.notificationGroups.flatMap((g) => g.prefs.map((p) => [`notify-${p.id}`, true] as const))),
  }));

  const go = (id: SettingsPageId) => navigate(`/settings/${id}`);
  const toggle = (id: string) => (
    <Switch
      id={id}
      checked={toggles[id] ?? false}
      onCheckedChange={(v) => setToggles((prev) => ({ ...prev, [id]: v }))}
    />
  );
  /** Rows children must be direct divs, so the rule runs between them. */
  const rows = (items: ReactNode[]) => (
    <Rows>
      {items.map((item, i) => (
        <div key={i}>{item}</div>
      ))}
    </Rows>
  );

  const verified = verification.status.state === 'verified';

  // ---- Pane bodies, rendered by both frames ------------------------------------------------------

  const BODIES: Record<SettingsPageId, ReactNode> = {
    account: (
      <Pane
        label="Personal information"
        aside={<span className="c-det">{verification.status.label}</span>}
        foot={<p className="c-det">Name and date of birth are locked after identity verification. Contact support to correct them.</p>}
      >
        <CMain>
          {rows([
            <KvRow label="Legal name" value={profile.legalName} />,
            /*
             * Date of birth is not listed. It rendered a hardcoded year for everybody, and a real one
             * cannot replace it: a date of birth is passed straight to the card issuer and never kept.
             */
            /*
             * The address the member gave us, and an em dash when they have not.
             *
             * It read 'Redlands, CA' for everybody — the fixture's value, shown as though it were
             * theirs. Editable here because this is the only place the app holds it, and ordering a
             * physical card reads it rather than asking again.
             */
            <KvRow
              label="Home address"
              value={formatAddress(address) || '—'}
              onSelect={onSaveAddress ? () => setAddressOpen(true) : undefined}
            />,
            <KvRow
              label="Identity"
              value={verified ? <Done>{verification.status.label}</Done> : verification.status.label}
              onSelect={verification.status.actionable ? verification.openVerification : undefined}
            />,
            <KvRow label="Phone" value={profile.phone} onSelect={() => setPhoneOpen(true)} />,
            <KvRow label="Email" value={profile.email} />,
          ])}
        </CMain>
      </Pane>
    ),

    membership: (
      <Pane label="Membership" aside={<span className="c-det">{profile.region}</span>}>
        <CMain>
          {rows([
            <KvRow label="Member since" value={<span className="text-ink">{profile.memberSince}</span>} />,
            <KvRow label="Your stake" value={<span className="text-ink">Your savings balance</span>} />,
            <KvRow label="Your vote" value={<span className="text-ink">{profile.votes} of {profile.votes}</span>} />,
          ])}
          <p className="c-det mt-s2">However much you save, your vote counts the same as every other member&rsquo;s.</p>
        </CMain>
        <CMain>
          {rows([
            <KvRow label="Membership agreement" onSelect={() => go('legal')} />,
            <KvRow label="Bylaws" value={data.bylaws.version} onSelect={() => go('bylaws')} />,
            <KvRow label="Patronage & distributions" onSelect={() => go('patronage')} />,
            <KvRow label="Voting history" value={`${data.votesCast} votes cast`} onSelect={() => go('voting')} />,
            <KvRow
              label="Acceleration"
              value={data.accelerationActive ? 'Active' : 'Not active'}
              onSelect={() => go('acceleration')}
            />,
          ])}
        </CMain>
      </Pane>
    ),

    security: (
      <Pane
        label="Security"
        foot={<p className="c-det">There&rsquo;s no password on your account. Sign-in uses your phone, email, or Face ID.</p>}
      >
        <CMain>
          {rows([
            <TwoLineRow
              title={<label htmlFor="faceid">Face ID</label>}
              detail={
                faceId?.error ? (
                  <span className="c-errline">{faceId.error}</span>
                ) : faceId?.busy ? (
                  'Waiting for Face ID…'
                ) : (
                  'Sign in without a code'
                )
              }
              trailing={
                faceId ? (
                  <Switch
                    id="faceid"
                    checked={faceId.on}
                    disabled={faceId.busy}
                    onCheckedChange={(v) => faceId.onChange(v)}
                  />
                ) : (
                  toggle('faceid')
                )
              }
            />,
            <TwoLineRow
              title={<label htmlFor="faceid-payments">Require Face ID for payments</label>}
              detail={`Over ${money(data.paymentFaceIdOver)}`}
              trailing={toggle('faceid-payments')}
            />,
          ])}
        </CMain>
        <CMain>
          {rows([
            <KvRow label="Trusted devices" value={String(data.devices.length)} onSelect={() => setDevicesOpen(true)} />,
            <KvRow label="Login history" value={`Last: ${data.lastLogin}`} onSelect={() => go('logins')} />,
            <KvRow
              label="Recovery contacts"
              value={data.recoveryContacts.length === 0 ? 'None set' : String(data.recoveryContacts.length)}
              onSelect={() => setRecoveryOpen(true)}
            />,
          ])}
        </CMain>
      </Pane>
    ),

    notifications: (
      <div className="flex flex-col gap-s3">
        {data.notificationGroups.map((group) => (
          <Pane key={group.title} label={group.title}>
            <CMain>
              {rows(
                group.prefs.map((pref) => (
                  <TwoLineRow
                    title={<label htmlFor={`notify-${pref.id}`}>{pref.label}</label>}
                    detail={pref.detail}
                    trailing={toggle(`notify-${pref.id}`)}
                  />
                )),
              )}
            </CMain>
          </Pane>
        ))}
      </div>
    ),

    linked: (
      <div className="flex flex-col gap-s3">
        <Pane label="Direct deposit" aside={<span className="c-det"><Done>Active</Done></span>} foot={<Btn lg>Account details</Btn>}>
          <CMain>
            <p className="c-det">
              Payroll from {data.employer} arrives here. This is what backs your income-based limit.
            </p>
          </CMain>
        </Pane>
        <Pane
          label="Accounts"
          foot={
            <>
              <p className="c-det">
                We use your linked bank to verify income and pull scheduled savings. We never move money without you asking.
              </p>
              <Btn lg className="mt-s2" onClick={() => setLinkOpen(true)}>
                Link another account
              </Btn>
            </>
          }
        >
          <CMain>
            {rows([
              <KvRow label="External bank" value={data.externalBank} />,
              <KvRow label="Employer" value={data.employer} />,
            ])}
          </CMain>
        </Pane>
      </div>
    ),

    contacts: <ContactsPane contacts={contacts} available={available} />,

    appearance: (
      <Pane label="Appearance">
        <CMain>
          <ThemePicker />
        </CMain>
      </Pane>
    ),

    help: <HelpPanel topics={data.helpTopics} onDispute={() => go('disputes')} />,
    disputes: (
      <DisputesPanel
        intro={!desktop}
        onRaise={() => {
          setDisputeFor(undefined);
          disputes?.load();
          setDisputeOpen(true);
        }}
        // There is no dispute policy document yet; the agreements it will sit among are here.
        onPolicy={() => go('legal')}
        mine={disputes ? disputes.mine : DISPUTE_SAMPLE_MINE}
        onWithdraw={disputes?.withdraw ?? (async () => 'Sign in to withdraw a dispute — nothing was changed.')}
      />
    ),
    bylaws: <BylawsPanel bylaws={data.bylaws} />,
    permissions: <PermissionsPanel permissions={data.permissions} />,
    patronage: <PatronagePanel patronage={data.patronage} onExplain={() => go('patronage-calculation')} />,
    'patronage-calculation': <PatronageCalculationPanel patronage={data.patronage} desktop={desktop} />,
    acceleration: <AccelerationPanel data={data} intro={!desktop} />,
    voting: <VotingPanel ballot={data.ballot} pastVotes={data.pastVotes} onVote={() => setBallotOpen(true)} />,
    legal: <LegalPanel docs={data.legalDocs} />,
    logins: <LoginHistoryPanel logins={data.logins} />,
  };

  const identity = (
    <div className="mb-s3 flex items-center gap-s2">
      <button type="button" onClick={() => setPhotoOpen(true)} aria-label="Change profile photo" className="c-avatar">
        <MemberAvatar profile={profile} className="h-full w-full bg-transparent text-inherit" />
      </button>
      <div className="min-w-0">
        <p className="c-fig c-fig-sec truncate">{profile.name}</p>
        <p className="c-sub mt-[3px] truncate">
          {profile.handle} &middot; Member since {profile.memberSince}
        </p>
      </div>
    </div>
  );

  const modals = (
    <>
      <ChangePhoneDialog
        current={profile.phone}
        open={phoneOpen}
        onOpenChange={(o) => {
          setPhoneOpen(o);
          if (!o) phoneChange?.onClose();
        }}
        stage={phoneChange?.stage ?? 'enter'}
        busy={phoneChange?.busy ?? false}
        error={phoneChange?.error ?? null}
        onSendCode={phoneChange?.onSendCode}
        onVerify={phoneChange?.onVerify}
      />
      <ChangeAddressDialog
        current={address}
        open={addressOpen}
        onOpenChange={setAddressOpen}
        onSave={(next) => onSaveAddress?.(next)}
        busy={savingAddress}
        error={addressError}
      />
      <TrustedDevicesDialog devices={data.devices} open={devicesOpen} onOpenChange={setDevicesOpen} />
      <LinkAccountDialog open={linkOpen} onOpenChange={setLinkOpen} />
      <ProfilePhotoDialog
        profile={profile}
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        onSave={onSavePhoto}
        onRemove={onRemovePhoto}
      />
      <RecoveryContactsDialog contacts={CONTACTS} open={recoveryOpen} onOpenChange={setRecoveryOpen} />
      <AdvancedDialog
        walletAddress={profile.walletAddress}
        permissionsOn={data.permissions.filter((p) => !p.held).length}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        onPermissions={() => {
          setAdvancedOpen(false);
          go('permissions');
        }}
        onClose={() => {
          setAdvancedOpen(false);
          setCloseOpen(true);
        }}
      />
      <CloseAccountDialog
        closure={data.closure}
        handle={profile.handle}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onTalk={() => {
          setCloseOpen(false);
          go('help');
        }}
      />
      <RaiseDisputeDialog
        open={disputeOpen}
        onOpenChange={setDisputeOpen}
        candidates={disputes ? disputes.candidates : DISPUTE_SAMPLE_CANDIDATES}
        preselect={disputeFor}
        onFile={disputes?.file ?? (async () => ({ error: 'Sign in to file a dispute — nothing was sent.' }))}
      />
      {data.ballot && <BallotDialog ballot={data.ballot} open={ballotOpen} onOpenChange={setBallotOpen} />}
    </>
  );

  // ---- Desktop: the rail selects the pane beside it ----------------------------------------------

  if (desktop && page) {
    const meta = SETTINGS_PAGES[page];
    const isSub = meta.up !== '/settings' || page === 'permissions';
    const railClass = (id: string) => cn(meta.rail === id && 'c-on');

    return (
      <>
        {identity}
        <div className="c-pane">
          <nav className="c-railnav" aria-label="Settings">
            {RAIL.map((item) =>
              item.id === 'advanced' ? (
                <button key={item.id} type="button" className={railClass(item.id)} onClick={() => setAdvancedOpen(true)}>
                  {item.label}
                </button>
              ) : (
                <Link
                  key={item.id}
                  to={`/settings/${item.id}`}
                  className={railClass(item.id)}
                  aria-current={meta.rail === item.id ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ),
            )}
            <div className="c-sep">
              <Link to="/settings/help" className={railClass('help')} aria-current={page === 'help' ? 'page' : undefined}>
                Help
              </Link>
            </div>
          </nav>

          <div className="min-w-0">
            {isSub ? (
              <button type="button" className="c-paneback mb-s2!" onClick={() => navigate(meta.up)}>
                <ChevronIcon size={16} strokeWidth={2} className="rotate-180 text-ink-50" />
                <span className="c-panetitle">{meta.title}</span>
              </button>
            ) : (
              <p className="c-panetitle mb-s2">{meta.title}</p>
            )}
            {BODIES[page]}
          </div>
        </div>
        {modals}
      </>
    );
  }

  // ---- Phone: a pushed page, titled by the header -----------------------------------------------

  if (page) {
    return (
      <>
        {BODIES[page]}
        {modals}
      </>
    );
  }

  // ---- Phone: the index. Each row states what is inside, not only its name. ----------------------

  return (
    <>
      {identity}
      <Pane foot={<Btn lg onClick={onSignOut}>Sign out</Btn>}>
        <CMain>
          {rows(
            RAIL.map((item) => (
              <TwoLineRow
                title={item.label}
                detail={item.detail}
                onSelect={() => (item.id === 'advanced' ? setAdvancedOpen(true) : go(item.id))}
              />
            )),
          )}
        </CMain>
      </Pane>
      {modals}
    </>
  );
}
