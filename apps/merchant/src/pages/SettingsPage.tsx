import { useContext, useEffect, useState } from 'react';
import type { MerchantApi, Reader, Shop, ShopHours, ShopSettings, ShopSettingsPatch, TaxKind } from '@clear/merchant-contracts';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { seesMoney } from '@clear/domain';
import { useAuth } from '@/auth/authContext';
import { IconBackChevron } from '@/brand/chargeIcons';
import { OneColumn } from '@/brand/ui';
import { api, type EnrolledDevice, type MerchantProfile, type PayoutPosition } from '@/data/apiClient';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { usd } from '@/home/model';
import { useLayout } from '@/lib/useBreakpoint';
import { roleLabel } from '@/shell/chrome';
import { currentPlatform, previewPlatform } from '@/reader';
import { useShiftActions } from '@/shell/shiftActions';
import { saveFile } from '@/lib/saveFile';
import { salesCsv } from '@/overview/exportCsv';
import { printStatement, statementOf } from '@/overview/statement';
import { HOURS_DET, hoursBody, paneBody, REFERENCE, SECTIONS, YOU, type AmountEdit, type ReaderRow, type Section, type SettingsData, type ShopField, type StatementMonth } from '@/settings/panes';
import { AddDeviceSheet, AddReaderSheet, AmountSheet, Btn, Cell, ChangeAccountSheet, clock12, ConfirmLeaveSheet, DateHoursSheet, FootLine, IndexCell, Kv, LeaveSheet, Main, NewCodeSheet, Pair, PaneHead, Rail, Rows, TextSheet, WeekHoursEdit, Who } from '@/settings/views';

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

type Open = 'account' | 'device' | 'leave' | 'confirm' | 'code' | 'reader' | null;

const READER_ROW: Record<Reader['type'], { kind: ReaderRow['kind']; sub: string }> = {
  smart: { kind: 'smart', sub: 'Smart reader · on the shop’s network' },
  m2: { kind: 'bluetooth', sub: 'Chip, tap and swipe · Bluetooth' },
  tap_to_pay: { kind: 'tapToPay', sub: 'Tap only · on a phone running Clear' },
};
const readerRow = (r: Reader): ReaderRow => ({ ...READER_ROW[r.type], t: r.label, chip: 'Paired' });

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
  // Payments: whether cards are open (and why not), the readers, and the ways to pay.
  const merchant = useMerchantApi();
  const { data: cards, reload: reloadCards } = useApi(() => (preview || !owner ? Promise.resolve(null) : merchant.cardAvailability()), [preview, owner]);
  const { data: readers, reload: reloadReaders } = useApi(() => (preview || !owner ? Promise.resolve(null) : merchant.readers()), [preview, owner]);
  const { data: shopSettings, reload: reloadSettings } = useApi(() => (preview || !owner ? Promise.resolve(null) : merchant.settings()), [preview, owner]);
  const [payError, setPayError] = useState<string | null>(null);
  // Shop, hours, Counter and Devices: the shop's own, for an owner.
  const liveOwner = !preview && owner;
  const shopRecord = useApi(() => (liveOwner ? merchant.shop() : Promise.resolve(null)), [liveOwner]);
  const shopHours = useApi(() => (liveOwner ? merchant.hours() : Promise.resolve(null)), [liveOwner]);
  // Business verification with Bridge (Advanced): read fresh each visit, so coming back from Bridge shows where it stands.
  const kyb = useApi(() => (!preview && seesMoney(role) ? merchant.kyb() : Promise.resolve(null)), [preview, role]);
  // Where payouts go: the banks linked with Plaid (Payouts › Where withdrawals go).
  const banks = useApi(() => (!preview && owner ? merchant.bankAccounts() : Promise.resolve(null)), [preview, owner]);
  // Statements: this month so far and the two before.
  const statementMonths = (() => {
    const now = new Date();
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return [0, 1, 2].map((back) => {
      const first = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const last = back === 0 ? now : new Date(now.getFullYear(), now.getMonth() - back + 1, 0);
      return { label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), from: ymd(first), to: ymd(last), inProgress: back === 0 };
    });
  })();
  const [statementError, setStatementError] = useState<string | null>(null);
  const { refresh } = useAuth();
  const [textEdit, setTextEdit] = useState<ShopField | 'breaks' | 'device' | 'notifyEmail' | 'kyb' | 'statementsEmail' | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  /** Run a change, then read the shop again: what shows is what the server holds. */
  const change = async (fn: () => Promise<unknown>, after?: () => void) => {
    setEditBusy(true);
    setEditError(null);
    try {
      await fn();
      after?.();
      shopRecord.reload();
      reloadSettings();
    } catch (e) {
      setEditError(errorSentence(e));
    } finally {
      setEditBusy(false);
    }
  };
  // Tax, Tips, Discounts and Closing: the shop's own, for an owner.
  const live = !preview && owner;
  const tax = useApi(() => (live ? merchant.taxStatus() : Promise.resolve(null)), [live]);
  const codes = useApi(() => (live ? merchant.discountCodes() : Promise.resolve(null)), [live]);
  const catalog = useApi(() => (live ? merchant.catalog() : Promise.resolve(null)), [live]);
  const roster = useApi(() => (live ? api.roster() : Promise.resolve(null)), [live]);
  const [edit, setEdit] = useState<AmountEdit | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Save a change to the shop's settings, then read them again: the server's are what show. */
  const saveSettings = async (patch: ShopSettingsPatch, after?: () => void) => {
    setSaveBusy(true);
    setSaveError(null);
    try {
      await merchant.updateSettings(patch);
      after?.();
    } catch (e) {
      setSaveError(errorSentence(e));
    } finally {
      setSaveBusy(false);
      reloadSettings();
    }
  };

  const me = { name: session?.staff.name ?? '', role: roleLabel(role) };
  // The preview is the installed app, as the reference draws it; `&platform=web` shows a browser's list.
  const platform = preview ? (previewPlatform(params) ?? 'ios') : currentPlatform();
  const d: SettingsData = preview
    ? { ...REFERENCE, platform, stripe: screen === 'payments-connected', owner: screen === 'counter' ? REFERENCE.owner : (session?.staff.name ?? REFERENCE.owner) }
    : {
        ...fromApi(profile, position, devices, me, device?.id ?? null),
        // The reference's legal name must never stand in for a live shop's.
        legalName: profile?.name ?? '—',
        platform,
        stripe: cards?.available === true,
        cards: cards ?? { available: false, reason: 'not_connected' },
        readers: (readers ?? []).map(readerRow),
        ways: shopSettings?.paymentMethods ?? null,
        ...liveShopFields(shopRecord.data, shopHours.data),
        kyb: kyb.data,
        statementMonths,
        ...(banks.data?.[0] ? { account: { bank: `${banks.data[0].bankName} ••${banks.data[0].mask}`, det: `Business ${banks.data[0].subtype} · verified with Plaid` } } : {}),
        liveShop: liveOwner
          ? {
              settings: shopSettings ?? null,
              readers: readers ?? null,
              device: device ? { label: device.label, enrolledAt: devices?.find((x) => x.id === device.id)?.enrolledAt ?? '', idleLockSeconds: device.idleLockSeconds } : null,
              }
            : null,
        live: shopSettings
          ? {
              settings: shopSettings,
              tax: tax.data,
              codes: codes.data,
              kinds: catalog.data
                ? catalog.data.filter((i) => !i.archivedAt).reduce((k, i) => ({ ...k, [i.taxKind]: k[i.taxKind] + 1 }), { goods: 0, labour: 0, food: 0, exempt: 0 } as Record<TaxKind, number>)
                : null,
              address: shopRecord.data?.address ? `${shopRecord.data.address.line1}, ${shopRecord.data.address.city}, ${shopRecord.data.address.region}` : null,
              region: shopRecord.data?.address?.region ?? null,
              closers: (roster.data ?? []).filter((p) => p.role !== 'counter').map((p) => p.name).join(', ') || '—',
            }
          : null,
      };

  const connectStripe = async () => {
    setPayError(null);
    try {
      const { url } = await merchant.connectCards();
      window.location.assign(url);
    } catch (e) {
      setPayError(errorSentence(e));
    }
  };

  // Back from Stripe's onboarding: read where it stands now. Stripe sends `refresh` when its link
  // expired before the owner finished, so a fresh one is asked for straight away.
  const returned = params.get('cards');
  useEffect(() => {
    if (preview || !owner || !returned) return;
    if (returned === 'refresh') void connectStripe();
    else reloadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned, preview, owner]);

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
    onAccount: preview ? () => setOpen('account') : () => navigate('/payouts?open=destinations'),
    onStatementPdf: liveOwner
      ? (m: StatementMonth) => {
          setStatementError(null);
          Promise.all([merchant.overview({ from: m.from, to: m.to }), merchant.cardDeposits({ from: m.from, to: m.to })]).then(
            ([o, deps]) => printStatement(statementOf({ shop: shopRecord.data?.name ?? 'Your shop', month: m.label, from: m.from, to: m.to, inProgress: m.inProgress, overview: o, deposits: deps })),
            (e) => setStatementError(errorSentence(e)),
          );
        }
      : undefined,
    onStatementCsv: liveOwner
      ? (m: StatementMonth) => {
          setStatementError(null);
          Promise.all([merchant.orderHistory({ from: m.from, to: m.to }), merchant.staff()])
            .then(([orders, staff]) => {
              const names = new Map(staff.map((x) => [x.id, x.name]));
              const slug = (shopRecord.data?.name ?? 'shop').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shop';
              return saveFile(`${slug}-sales-${m.from.slice(0, 7)}.csv`, salesCsv({ orders, nameOf: (id) => names.get(id) ?? '—' }), 'text/csv');
            })
            .catch((e) => setStatementError(errorSentence(e)));
        }
      : undefined,
    onStatementsEmail: liveOwner ? () => (setEditError(null), setTextEdit('statementsEmail')) : undefined,
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
    onConnectStripe: preview ? undefined : () => void connectStripe(),
    onAddReader: () => setOpen('reader'),
    onEditShop: liveOwner ? (f: ShopField) => (setEditError(null), setTextEdit(f)) : undefined,
    onBreaks: liveOwner ? () => (setEditError(null), setTextEdit('breaks')) : undefined,
    onNotifyEmail: liveOwner ? () => (setEditError(null), setTextEdit('notifyEmail')) : undefined,
    onVerifyBusiness: liveOwner ? () => (setEditError(null), setTextEdit('kyb')) : undefined,
    onIdle: liveOwner && device ? (seconds: number) => void change(() => api.setIdleLock(device.id, seconds), () => void refresh()) : undefined,
    onRenameDevice: liveOwner && device ? () => (setEditError(null), setTextEdit('device')) : undefined,
    onSettings: live ? (patch: ShopSettingsPatch) => void saveSettings(patch) : undefined,
    onAmount: live ? (e: AmountEdit) => (setSaveError(null), setEdit(e)) : undefined,
    onWay:
      preview || !shopSettings
        ? undefined
        : async (way: 'card' | 'cash' | 'split', on: boolean) => {
            setPayError(null);
            try {
              await merchant.updateSettings({ paymentMethods: { ...shopSettings.paymentMethods, [way]: on } });
            } catch (e) {
              setPayError(errorSentence(e));
            }
            reloadSettings();
          },
  };

  const meta = current ? (current === 'you' ? YOU : SECTIONS.find((s) => s.key === current)!) : null;
  const paneMessage = current === 'payments' ? payError : current === 'payouts' && statementError ? statementError : !edit && open !== 'code' ? saveError : null;
  const paneError = paneMessage ? (
    <p className="c-det" role="alert" style={{ color: 'var(--absent)', marginBottom: 'var(--s2)' }}>
      {paneMessage}
    </p>
  ) : null;
  const body = hours ? (
    preview ? (
      hoursBody(d)
    ) : shopHours.data ? (
      <LiveHours initial={shopHours.data} onSave={(h) => merchant.saveHours(h).then(() => shopHours.reload())} />
    ) : null
  ) : current ? (
    <>
      {paneError}
      {paneBody(current, d, actions)}
    </>
  ) : null;
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
      {textEdit && (
        <ShopTextSheet
          what={textEdit}
          shop={shopRecord.data}
          settings={shopSettings ?? null}
          deviceLabel={device?.label ?? ''}
          deviceId={device?.id ?? ''}
          kybEmail={kyb.data?.email}
          busy={editBusy}
          error={editError}
          onClose={() => setTextEdit(null)}
          onSave={(fn) => void change(fn, () => (setTextEdit(null), textEdit === 'device' ? void refresh() : undefined))}
          merchant={merchant}
        />
      )}
      {open === 'code' &&
        (preview ? (
          <NewCodeSheet onDone={close} onClose={close} />
        ) : (
          <NewCodeSheet
            categories={[...new Set((catalog.data ?? []).filter((i) => !i.archivedAt).map((i) => i.category))]}
            busy={saveBusy}
            error={saveError}
            onCreate={async (c) => {
              setSaveBusy(true);
              setSaveError(null);
              try {
                await merchant.createDiscountCode(c);
                codes.reload();
                close();
              } catch (e) {
                setSaveError(errorSentence(e));
              } finally {
                setSaveBusy(false);
              }
            }}
            onClose={close}
          />
        ))}
      {edit && shopSettings && <AmountEditSheet edit={edit} s={shopSettings} busy={saveBusy} error={saveError} onSave={(patch) => void saveSettings(patch, () => setEdit(null))} onClose={() => setEdit(null)} />}
      {open === 'reader' && (
        <AddReaderSheet
          app={platform !== 'web'}
          onAdd={
            preview
              ? async () => undefined
              : async ({ code, label }) => {
                  await merchant.registerSmartReader({ registrationCode: code, label });
                  reloadReaders();
                }
          }
          onClose={close}
        />
      )}
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

/** The Shop pane's listing, contact and hours, from a live shop's record. */
function liveShopFields(shop: Shop | null, hours: ShopHours | null): Partial<SettingsData> {
  const out: Partial<SettingsData> = {};
  if (shop) {
    out.shop = shop.name;
    out.category = shop.listing.category ?? '—';
    out.oneLine = shop.listing.oneLine ?? '—';
    out.address = shop.address ? `${shop.address.line1}, ${shop.address.city}, ${shop.address.region} ${shop.address.postalCode}` : 'Not set yet';
    out.phone = shop.listing.phone ?? '—';
    out.email = shop.listing.email ?? '—';
  }
  if (hours) {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    out.hours = hours.week.map((w) => ({ dn: names[w.day]!, open: w.open ? [clock12(w.open.from), clock12(w.open.to)] : null }));
    out.closedDates = hours.dates.map((d) => [
      d.label,
      `${new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.open ? `${clock12(d.open.from)} – ${clock12(d.open.to)}` : 'closed'}`,
    ]);
  }
  return out;
}

/** Settings › Shop › Shop hours on a live shop: the week and the dates, saved together. */
function LiveHours({ initial, onSave }: { initial: ShopHours; onSave: (h: ShopHours) => Promise<unknown> }) {
  const [h, setH] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = JSON.stringify(h) !== JSON.stringify(initial);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSave(h);
      setMsg('Saved.');
    } catch (e) {
      setMsg(errorSentence(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Cell label="Each week" det="">
        <Main>
          <WeekHoursEdit week={h.week} onChange={(week) => (setMsg(null), setH({ ...h, week }))} />
        </Main>
      </Cell>
      <Cell
        label="Closed on a date"
        det="A week’s notice"
        foot={
          <FootLine det={msg ?? 'Shifts booked on Staff sit inside these hours.'}>
            <Pair>
              <Btn onClick={() => setAdding(true)}>Add a date</Btn>
              <Btn primary onClick={() => void save()} disabled={!dirty || busy}>
                {busy ? 'Saving…' : 'Save hours'}
              </Btn>
            </Pair>
          </FootLine>
        }
      >
        <Main>
          {h.dates.length ? (
            <Rows>
              {h.dates.map((d) => (
                <Kv
                  key={d.date}
                  k={d.label}
                  v={
                    <>
                      {new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {d.open ? `${clock12(d.open.from)} – ${clock12(d.open.to)}` : 'closed'}{' '}
                      <button type="button" className="c-ci-link" aria-label={`Remove ${d.label}`} onClick={() => (setMsg(null), setH({ ...h, dates: h.dates.filter((x) => x.date !== d.date) }))}>
                        Remove
                      </button>
                    </>
                  }
                  ink
                />
              ))}
            </Rows>
          ) : (
            <p className="c-det">No dates yet.</p>
          )}
        </Main>
      </Cell>
      {adding && (
        <DateHoursSheet
          onClose={() => setAdding(false)}
          onAdd={(d) => {
            setH({ ...h, dates: [...h.dates.filter((x) => x.date !== d.date), d].sort((a, b) => a.date.localeCompare(b.date)) });
            setAdding(false);
            setMsg(null);
          }}
        />
      )}
    </>
  );
}

/** The sheet for a field of the shop, the breaks, or this tablet's name. */
function ShopTextSheet({
  what,
  shop,
  settings,
  deviceLabel,
  deviceId,
  kybEmail,
  busy,
  error,
  onSave,
  onClose,
  merchant,
}: {
  what: ShopField | 'breaks' | 'device' | 'notifyEmail' | 'kyb' | 'statementsEmail';
  kybEmail?: string | null;
  shop: Shop | null;
  settings: ShopSettings | null;
  deviceLabel: string;
  deviceId: string;
  busy: boolean;
  error: string | null;
  onSave: (fn: () => Promise<unknown>) => void;
  onClose: () => void;
  merchant: MerchantApi;
}) {
  const common = { busy, error, onClose };
  if (what === 'breaks') {
    const b = settings?.breaks ?? { minutes: 30, afterMinutes: 300 };
    return (
      <TextSheet
        {...common}
        title="Breaks"
        det="How long a break is, and after how many hours on shift one is due. Home shows who is due one."
        fields={[
          { key: 'minutes', label: 'Break, in minutes', value: String(b.minutes), max: 3, required: true, inputMode: 'tel' },
          { key: 'after', label: 'Due after, in hours', value: String(b.afterMinutes / 60), max: 4, required: true, inputMode: 'tel' },
        ]}
        onSave={(v) => onSave(() => merchant.updateSettings({ breaks: { minutes: Math.round(Number(v.minutes)), afterMinutes: Math.round(Number(v.after) * 60) } }))}
      />
    );
  }
  if (what === 'kyb') {
    return (
      <TextSheet
        {...common}
        title="Verify the business"
        det="Bridge, which moves the shop’s money to its bank, checks the business first. You’ll go to Bridge’s own pages: its terms, then the business’s details, its owners, and a document or two. They stay with Bridge."
        fields={[
          { key: 'legalName', label: 'Legal business name', value: shop?.name ?? '', max: 160, required: true },
          { key: 'email', label: 'Business email', value: kybEmail ?? shop?.listing.email ?? '', max: 200, required: true, inputMode: 'email' },
        ]}
        onSave={(v) =>
          onSave(async () => {
            const { url } = await merchant.startKyb({ legalName: v.legalName!.trim(), email: v.email!.trim() });
            window.location.assign(url);
          })
        }
      />
    );
  }
  if (what === 'statementsEmail') {
    return (
      <TextSheet
        {...common}
        title="Email each statement to"
        det="Each month’s statement goes here on the 2nd, usually your accountant. Leave it empty to stop."
        fields={[{ key: 'email', label: 'Email', value: settings?.statementsEmail ?? '', max: 200, inputMode: 'email' }]}
        onSave={(v) => onSave(() => merchant.updateSettings({ statementsEmail: v.email!.trim() || null }))}
      />
    );
  }
  if (what === 'notifyEmail') {
    const n = settings?.notifications ?? { endOfDay: true, email: null };
    return (
      <TextSheet
        {...common}
        title="Send the summary to"
        det="The end-of-day summary goes here when the day is closed. Leave it empty to stop it."
        fields={[{ key: 'email', label: 'Email', value: n.email ?? '', max: 200, inputMode: 'email' }]}
        onSave={(v) => onSave(() => merchant.updateSettings({ notifications: { ...n, email: v.email!.trim() || null } }))}
      />
    );
  }
  if (what === 'device')
    return <TextSheet {...common} title="This tablet’s name" fields={[{ key: 'label', label: 'Name', value: deviceLabel, max: 40, required: true }]} onSave={(v) => onSave(() => api.renameDevice(deviceId, v.label!.trim()))} />;
  if (what === 'address') {
    const a = shop?.address;
    return (
      <TextSheet
        {...common}
        title="Address"
        det="Where the shop is. It sets the sales tax, and where the card readers are registered."
        fields={[
          { key: 'line1', label: 'Street', value: a?.line1 ?? '', max: 120, required: true },
          { key: 'line2', label: 'Unit or suite', value: a?.line2 ?? '', max: 60 },
          { key: 'city', label: 'City', value: a?.city ?? '', max: 60, required: true },
          { key: 'region', label: 'State', value: a?.region ?? '', max: 2, required: true },
          { key: 'postalCode', label: 'ZIP', value: a?.postalCode ?? '', max: 10, required: true, inputMode: 'tel' },
        ]}
        onSave={(v) =>
          onSave(() =>
            merchant.updateShop({ address: { line1: v.line1!.trim(), line2: v.line2!.trim() || null, city: v.city!.trim(), region: v.region!.trim().toUpperCase(), postalCode: v.postalCode!.trim(), country: 'US' } }),
          )
        }
      />
    );
  }
  const FIELD: Record<Exclude<ShopField, 'address'>, { title: string; label: string; max: number; inputMode?: 'tel' | 'email'; value: string | null; required?: boolean }> = {
    name: { title: 'Name', label: 'The shop’s name', max: 60, value: shop?.name ?? '', required: true },
    category: { title: 'What you do', label: 'What you do', max: 60, value: shop?.listing.category ?? null },
    oneLine: { title: 'One line', label: 'A line about the shop', max: 140, value: shop?.listing.oneLine ?? null },
    phone: { title: 'Phone', label: 'Phone', max: 40, inputMode: 'tel', value: shop?.listing.phone ?? null },
    email: { title: 'Email', label: 'Email', max: 200, inputMode: 'email', value: shop?.listing.email ?? null },
  };
  const f = FIELD[what];
  return (
    <TextSheet
      {...common}
      title={f.title}
      det={what === 'name' ? undefined : 'On your listing in Clear Partners. Leave it empty to leave it off.'}
      fields={[{ key: 'v', label: f.label, value: f.value ?? '', max: f.max, inputMode: f.inputMode, required: f.required }]}
      onSave={(v) => onSave(() => merchant.updateShop(what === 'name' ? { name: v.v!.trim() } : { listing: { [what]: v.v!.trim() || null } }))}
    />
  );
}

/** The sheet for an amount a setting holds: starting cash, a discount limit, a tip preset. */
function AmountEditSheet({
  edit,
  s,
  busy,
  error,
  onSave,
  onClose,
}: {
  edit: AmountEdit;
  s: ShopSettings;
  busy: boolean;
  error: string | null;
  onSave: (patch: ShopSettingsPatch) => void;
  onClose: () => void;
}) {
  if (edit.kind === 'startingCash')
    return (
      <AmountSheet
        title="Starting cash"
        det="What goes in the drawer each morning, and what's left in it at close for tomorrow."
        unit="$"
        initial={s.startingCashCents}
        max={1_000_000}
        busy={busy}
        error={error}
        onSave={(cents) => onSave({ startingCashCents: cents })}
        onClose={onClose}
      />
    );
  if (edit.kind === 'limit') {
    const who = edit.role === 'counter' ? 'Counter' : 'Manager';
    return (
      <AmountSheet
        title={`${who} discount limit`}
        det={`The most off a charge ${edit.role === 'counter' ? 'counter staff' : 'a manager'} can give without a PIN. Above it, an owner or manager enters theirs.`}
        unit="%"
        initial={s.discountLimits[edit.role]}
        max={100}
        busy={busy}
        error={error}
        onSave={(pct) => onSave({ discountLimits: { ...s.discountLimits, [edit.role]: pct } })}
        onClose={onClose}
      />
    );
  }
  const t = s.tips;
  const amounts = t.mode === 'amounts';
  const presets = [...t.presets];
  return (
    <AmountSheet
      title={edit.index === null ? 'Add a tip' : 'Change a tip'}
      det={amounts ? 'A tip the customer can tap, in dollars.' : 'A tip the customer can tap, as a percent of the charge.'}
      unit={amounts ? '$' : '%'}
      initial={edit.index === null ? null : (presets[edit.index] ?? null)}
      max={amounts ? 100_000 : 100}
      busy={busy}
      error={error}
      onSave={(v) => {
        if (v <= 0) return;
        if (edit.index === null) presets.push(v);
        else presets[edit.index] = v;
        onSave({ tips: { ...t, presets: [...new Set(presets)].sort((a, b) => a - b) } });
      }}
      onRemove={edit.index !== null && presets.length > 1 ? () => onSave({ tips: { ...t, presets: presets.filter((_, i) => i !== edit.index) } }) : undefined}
      onClose={onClose}
    />
  );
}
