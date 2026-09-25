import { useContext, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { IconBackChevron } from '@/brand/chargeIcons';
import { OneColumn } from '@/brand/ui';
import { api, type EnrolledDevice, type MerchantProfile, type PayoutPosition } from '@/data/apiClient';
import { useApi } from '@/data/useApi';
import { usd } from '@/home/model';
import { useLayout } from '@/lib/useBreakpoint';
import { roleLabel } from '@/shell/chrome';
import { currentPlatform, previewPlatform } from '@/reader';
import { useShiftActions } from '@/shell/shiftActions';
import { HOURS_DET, hoursBody, paneBody, REFERENCE, SECTIONS, YOU, type Section, type SettingsData } from '@/settings/panes';
import { AddDeviceSheet, ChangeAccountSheet, ConfirmLeaveSheet, IndexCell, LeaveSheet, NewCodeSheet, PaneHead, Rail, Who } from '@/settings/views';

/**
 * Settings — docs/merchant-reference/clear-merchant-settings.html.
 *
 * On a landscape tablet: the shop, then a rail and a pane, Shop first. Everywhere narrower: an
 * index, and each section a pushed page. Sub-pages are panes; only actions are sheets. A counter
 * shift's rail has one item, You: money and the listing are absent, not locked.
 *
 * A live shop gets the sections the API can fill: the listing, payouts, the partnership, security
 * and help. The rest are the preview's until their backends land:
 * `/settings[/<section>]?preview=1`, `&screen=counter|payments-connected|account|device|leave|
 * confirm|code`, and `/settings/shop/hours`.
 */

type Open = 'account' | 'device' | 'leave' | 'confirm' | 'code' | null;

const monthYear = (iso: string | null, short: boolean) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: 'numeric' }) : null;

function fromApi(p: MerchantProfile | null, pos: PayoutPosition | null, devices: EnrolledDevice[] | null, me: { name: string; role: string }, currentDevice: string | null): SettingsData {
  const rate = p?.discountRate ?? null;
  const next = pos?.nextPayoutOn ? new Date(pos.nextPayoutOn).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  return {
    ...REFERENCE,
    preview: false,
    shop: p?.name ?? 'Your shop',
    owner: me.name,
    category: p?.category ?? '—',
    oneLine: '—',
    photo: 'Your initials for now',
    hours: null,
    closedDates: [],
    account: p?.payoutAccount ? { bank: 'Business checking', det: p.payoutAccount } : null,
    nextPayout: next && pos ? `${next} · ${usd(pos.owedCents)}` : '—',
    payoutWhen: p?.payoutTerms ?? '—',
    ratesNow: '—',
    ratesOver: rate === null ? '—' : `${(rate * 100).toFixed(1)}%`,
    cap: p?.approvalCapCents == null ? '—' : usd(p.approvalCapCents),
    signed: p?.partnerSince ? `Signed ${new Date(p.partnerSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '',
    memberSince: p?.partnerSince ? new Date(p.partnerSince).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—',
    joinedWith: p?.founding ? 'Founding partner' : '—',
    signIn: '—',
    devices: (devices ?? [])
      .filter((d) => !d.revokedAt)
      .map((d) => ({
        id: d.id,
        name: d.label,
        det: `${d.id === currentDevice ? 'This one · ' : ''}enrolled ${new Date(d.enrolledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        kind: 'tablet' as const,
        current: d.id === currentDevice,
      })),
    me: { ...me, hours: '—' },
  };
}

export default function SettingsPage() {
  const { section, sub } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const layout = useLayout();
  const phone = layout === 'phone';
  const one = useContext(OneColumn);
  const shift = useShiftActions();
  const { session, device } = useAuth();

  const preview = import.meta.env.DEV && params.get('preview') === '1' && params.get('live') !== '1';
  const screen = preview ? (params.get('screen') ?? '') : '';
  const role = screen === 'counter' ? 'counter' : (session?.staff.role ?? 'counter');
  // A counter shift and a manager see You: the owner's sections are about the business.
  const owner = role === 'owner';
  const q = preview ? `?preview=1${screen === 'counter' || screen === 'payments-connected' ? `&screen=${screen}` : ''}` : '';

  const { data: profile } = useApi(() => (preview ? Promise.resolve(null) : api.profile()), [preview]);
  const { data: position } = useApi(() => (preview || !seesMoney(role) ? Promise.resolve(null) : api.payouts()), [preview, role]);
  const { data: devices, reload: reloadDevices } = useApi(() => (preview || !owner ? Promise.resolve(null) : api.devices()), [preview, owner]);

  const me = { name: session?.staff.name ?? '', role: roleLabel(role) };
  // The preview is the installed app, as the reference draws it; `&platform=web` shows a browser's list.
  const platform = preview ? (previewPlatform(params) ?? 'ios') : currentPlatform();
  const d: SettingsData = preview
    ? { ...REFERENCE, platform, stripe: screen === 'payments-connected', owner: screen === 'counter' ? REFERENCE.owner : (session?.staff.name ?? REFERENCE.owner) }
    : { ...fromApi(profile, position, devices, me, device?.id ?? null), platform };

  const [open, setOpen] = useState<Open>(() =>
    (['account', 'device', 'leave', 'confirm', 'code'] as const).find((s) => s === screen) ?? null,
  );
  const close = () => setOpen(null);

  const items = owner ? SECTIONS.filter((s) => preview || s.live) : [YOU];
  const helpItem = owner ? items.find((s) => s.key === 'help') : undefined;
  const railItems = items.filter((s) => s.key !== 'help');
  const fallback: Section = owner ? 'shop' : 'you';
  const current = (items.find((s) => s.key === section)?.key ?? (one ? null : fallback)) as Section | null;
  const hours = current === 'shop' && sub === 'hours' && !!d.hours;
  const go = (k: string) => navigate(`/settings/${k}${q}`);

  const since = preview
    ? { long: 'August 2026', short: 'Aug 2026' }
    : { long: monthYear(profile?.partnerSince ?? null, false) ?? '—', short: monthYear(profile?.partnerSince ?? null, true) ?? '—' };
  const kind = preview || profile?.founding ? 'Founding partner' : 'Partner';
  const who = owner ? (
    <Who name={d.shop} sub={phone ? `${kind} since ${since.short}` : `${kind} since ${since.long} · ${d.owner}, owner`} />
  ) : (
    <Who person name={preview ? REFERENCE.me.name : me.name} sub={`${me.role} at ${d.shop}${preview ? ' since August 2026' : ''}`} />
  );

  const actions = {
    onHours: () => navigate(`/settings/shop/hours${q}`),
    onAccount: () => setOpen('account'),
    onPayouts: () => navigate(`/payouts${preview ? '?preview=1' : ''}`),
    onDevice: () => setOpen('device'),
    onLeave: () => setOpen('leave'),
    onNewCode: () => setOpen('code'),
    onSignOutDevice: preview
      ? undefined
      : async (id: string) => {
          await api.revokeDevice(id).catch(() => undefined);
          reloadDevices();
        },
  };

  const meta = current ? (current === 'you' ? YOU : SECTIONS.find((s) => s.key === current)!) : null;
  const body = hours ? hoursBody(d) : current ? paneBody(current, d, actions) : null;
  const head = hours ? (
    <PaneHead title="Shop hours" det={HOURS_DET} back={() => navigate(`/settings/shop${q}`)} small={phone} />
  ) : meta ? (
    <PaneHead title={meta.label} det={meta.det} back={one ? () => navigate(`/settings${q}`) : undefined} small={phone} />
  ) : null;

  const sheets = (
    <>
      {open === 'account' && <ChangeAccountSheet now={preview ? 'Chase ••4417' : (profile?.payoutAccount ?? '—')} next={`${d.nextPayout.split(' · ')[0]} payout`} onClose={close} />}
      {open === 'device' && <AddDeviceSheet shop={d.shop} code="482719" onClose={close} />}
      {open === 'leave' && <LeaveSheet onTalk={close} onContinue={() => setOpen('confirm')} onClose={close} />}
      {open === 'confirm' && (
        <ConfirmLeaveSheet payout={['Paid to Chase ••4417 on Oct 14', '$4,218.91']} waiting="2 · $1,350.00" names="Nina P. and Dana R." onStay={close} />
      )}
      {open === 'code' && <NewCodeSheet onCreate={preview ? close : undefined} onClose={close} />}
    </>
  );

  // ---- Narrower than a landscape tablet: an index, and pushed pages -------------------------------
  if (one) {
    if (!current)
      return (
        <>
          <div className="c-paneback" style={phone ? { marginBottom: 'var(--s2)' } : { margin: 'var(--s1) 0 var(--s2)' }}>
            <button type="button" aria-label="Back" onClick={() => navigate(preview ? '/?preview=1' : '/')} style={{ display: 'flex' }}>
              <IconBackChevron />
            </button>
            <p className="c-panetitle" style={phone ? { fontSize: 15 } : undefined}>
              Settings
            </p>
          </div>
          {who}
          <IndexCell items={items} onPick={go} onEnd={shift.endShift} />
          {sheets}
        </>
      );
    return (
      <>
        {head}
        <div className="c-panebody">{body}</div>
        {sheets}
      </>
    );
  }

  // ---- A landscape tablet: the rail and the pane ---------------------------------------------------
  return (
    <>
      {who}
      <div className="c-pane">
        <Rail items={railItems} help={helpItem} on={current ?? fallback} onPick={go} />
        <div>
          {head}
          <div className="c-panebody">{body}</div>
        </div>
      </div>
      {sheets}
    </>
  );
}
