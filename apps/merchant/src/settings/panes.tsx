import type { ReactNode } from 'react';
import type { CardAvailability, DiscountCode, KybStatus, Reader, ShopSettings, ShopSettingsPatch, TaxKind, TaxStatus } from '@clear/merchant-contracts';
import {
  Account,
  Btn,
  Cell,
  Chips,
  Conseq,
  CounterCard,
  Device,
  Fixed,
  FootDet,
  FootLine,
  Kv,
  Locked,
  Main,
  Pair,
  R2,
  Rows,
  Switch,
  WeekHours,
  type DayHours,
} from '@/settings/views';
import { kindsFor, offlineFor, type Platform, type ReaderKind } from '@/reader';
import { clickOnKey } from '@/brand/ui';

/**
 * Settings' sections, in the rail's order, and what each pane holds. `Shop` opens first, because
 * what members see is what a shop was sold. A live shop gets the sections the API can fill (the
 * listing, payouts, the partnership, security and help); the rest are the preview's until their
 * backends land. Figures are the reference's where a live shop has nothing.
 */

export type Section =
  | 'shop'
  | 'payouts'
  | 'partnership'
  | 'counter'
  | 'payments'
  | 'tax'
  | 'tips'
  | 'discounts'
  | 'devices'
  | 'closing'
  | 'security'
  | 'notifications'
  | 'advanced'
  | 'help'
  | 'you';

export const SECTIONS: { key: Section; label: string; det: string; desc: string; live?: boolean }[] = [
  { key: 'shop', label: 'Shop', det: 'What members see in Clear Partners, and when you are open.', desc: 'Listing, hours, contact', live: true },
  { key: 'payouts', label: 'Payouts', det: 'Where your money goes, when, and the record of it.', desc: 'Bank, schedule, statements', live: true },
  { key: 'partnership', label: 'Partnership', det: 'Your terms, your agreement, and your record in the co-op.', desc: 'Terms, agreement, co-op record', live: true },
  { key: 'counter', label: 'Counter', det: 'The printed cards, and how a shift runs on the tablet.', desc: 'Counter cards, breaks, idle lock', live: true },
  { key: 'payments', label: 'Payments', det: 'How customers can pay you, and what happens when the connection drops.', desc: 'Ways to pay, cards, offline', live: true },
  { key: 'tax', label: 'Tax', det: 'Sales tax, worked out from where the shop is.', desc: 'Where you collect, how prices show', live: true },
  { key: 'tips', label: 'Tips', det: 'Whether Checkout asks, what it offers, and who gets it.', desc: 'Asking, amounts, who gets them', live: true },
  { key: 'discounts', label: 'Discounts', det: 'Codes you create, and how much each role can give without asking.', desc: 'Codes, limits by role', live: true },
  { key: 'devices', label: 'Devices', det: 'What is paired with this tablet.', desc: 'Reader, printer, this tablet', live: true },
  { key: 'closing', label: 'Closing', det: 'How the drawer is opened, counted and signed off.', desc: 'The drawer, and who closes', live: true },
  { key: 'security', label: 'Security', det: 'How you sign in, and what is signed in as the shop.', desc: 'Sign-in, owner PIN, devices', live: true },
  { key: 'notifications', label: 'Notifications', det: 'What reaches you, and where.', desc: 'What reaches you and how', live: true },
  { key: 'advanced', label: 'Advanced', det: 'Business details, your data, and leaving.', desc: 'Business details, your data, leaving', live: true },
  { key: 'help', label: 'Help', det: 'A person first, then the guides.', desc: 'A person, then the guides', live: true },
];

export const YOU = { key: 'you' as const, label: 'You', det: 'Your own PIN, and how this tablet is set.', desc: 'Your PIN and this tablet' };

export interface ReaderRow {
  kind: ReaderKind;
  t: string;
  sub: string;
  chip: string;
}

/** The reference shop's paired readers. The preview lists those this platform can use. */
const PAIRED: ReaderRow[] = [
  { kind: 'bluetooth', t: 'Stripe Reader M2', sub: 'Chip, tap and swipe · Bluetooth to this tablet', chip: 'Connected' },
  { kind: 'tapToPay', t: 'Tap to Pay on Jen’s iPhone', sub: 'Tap only · +10¢ a tap', chip: 'Ready' },
];

export const HOURS_DET = 'Open and close for each day. Staff’s hours and members’ “open now” both read from here.';

/** Everything a pane shows. The preview fills it from the reference; a live shop from the API. */
export interface SettingsData {
  preview: boolean;
  shop: string;
  owner: string;
  category: string;
  oneLine: string;
  photo: string;
  hours: DayHours[] | null;
  closedDates: [string, string][];
  address: string;
  phone: string;
  email: string;
  account: { bank: string; det: string } | null;
  nextPayout: string;
  payoutWhen: string;
  ratesNow: string;
  ratesOver: string;
  cap: string;
  signed: string;
  memberSince: string;
  joinedWith: string;
  signIn: string;
  devices: { id: string; name: string; det: string; kind: 'tablet' | 'pc'; current?: boolean }[];
  tablet: { name: string; enrolled: string };
  idle: string;
  me: { name: string; role: string; hours: string };
  closers: string;
  legalName: string;
  taxId: string;
  counterUrl: string;
  stripe: boolean;
  /** Why cards are locked, for a live shop; null in the preview (which reads `stripe`). */
  cards: CardAvailability | null;
  /** The shop's readers from the API; null in the preview (which lists the reference's). */
  readers: ReaderRow[] | null;
  /** The ways to pay the shop has on; null in the preview. */
  ways: { card: boolean; cash: boolean; split: boolean } | null;
  /** Which readers this device can drive: a browser lists smart readers only. */
  platform: Platform;
  /** A live shop's Counter and Devices panes; null in the preview and until read. */
  liveShop?: LiveShop | null;
  /**
   * A live shop's selling settings, for Tax, Tips, Discounts and Closing; null in the preview (which
   * draws the reference) and until they're read.
   */
  live?: LiveSelling | null;
  /** A live shop's business verification with Bridge; null in the preview and until read. */
  kyb?: KybStatus | null;
  /** A live shop's statement months, newest first: this month (in progress) and the two before. */
  statementMonths?: StatementMonth[];
}

export interface LiveShop {
  settings: ShopSettings | null;
  readers: Reader[] | null;
  /** This tablet, as enrolled. Null in a browser that isn't one. */
  device: { label: string; enrolledAt: string; idleLockSeconds: number } | null;
}

/** A field of the shop an owner changes in Settings › Shop. */
export type ShopField = 'name' | 'category' | 'oneLine' | 'phone' | 'email' | 'address';

const IDLE = [60, 120, 300, 600, 900, 1800];
const minutes = (s: number) => (s < 120 ? `${s / 60} minute` : `${s / 60} minutes`);

export interface LiveSelling {
  settings: ShopSettings;
  tax: TaxStatus | null;
  codes: DiscountCode[] | null;
  /** How many items the catalogue has of each tax kind. */
  kinds: Record<TaxKind, number> | null;
  /** "412 Colton Ave, Redlands, CA" */
  address: string | null;
  region: string | null;
  /** Who can close the day: owners and managers, by name. */
  closers: string;
}

/** A month on Settings › Payouts › Statements. */
export interface StatementMonth {
  label: string;
  from: string;
  to: string;
  inProgress: boolean;
}

/** An amount a setting holds, opened in a sheet to change. */
export type AmountEdit = { kind: 'startingCash' } | { kind: 'limit'; role: 'counter' | 'manager' } | { kind: 'preset'; index: number | null };

export const REFERENCE: SettingsData = {
  preview: true,
  shop: 'Mike’s Tire',
  owner: 'Mike R.',
  category: 'Auto repair, Tires',
  oneLine: 'Tires, brakes and alignment…',
  photo: 'Your initials for now',
  hours: [
    { dn: 'Mon', open: ['8:00am', '6:00pm'] },
    { dn: 'Tue', open: ['8:00am', '6:00pm'] },
    { dn: 'Wed', open: ['8:00am', '6:00pm'] },
    { dn: 'Thu', open: ['8:00am', '6:00pm'] },
    { dn: 'Fri', open: ['8:00am', '4:00pm'] },
    { dn: 'Sat', open: ['9:00am', '2:00pm'] },
    { dn: 'Sun', open: null },
  ],
  closedDates: [
    ['Thanksgiving', 'Nov 26 · closed'],
    ['Christmas Eve', 'Dec 24 · until noon'],
  ],
  address: '412 Colton Ave',
  phone: '555-0142',
  email: 'hello@mikestire.com',
  account: { bank: 'Chase business checking', det: '••4417 · verified Aug 12' },
  nextPayout: 'Oct 14 · $4,218.91',
  payoutWhen: 'Monthly, on the 14th',
  ratesNow: '1.25%',
  ratesOver: '2.0%',
  cap: '$2,500.00',
  signed: 'Signed Aug 12',
  memberSince: 'Aug 12, 2026',
  joinedWith: 'Code FOUNDING',
  signIn: 'mike@mikestire.com',
  devices: [
    { id: 'tab', name: 'Counter tablet', det: 'This one · active now', kind: 'tablet', current: true },
    { id: 'pc', name: 'Back office PC', det: 'Browser · last used Monday', kind: 'pc' },
  ],
  tablet: { name: 'Counter tablet', enrolled: 'Aug 14 by Mike' },
  idle: '5 minutes idle',
  me: { name: 'Jen R.', role: 'Counter', hours: 'Mon – Fri, 8:00am – 4:00pm' },
  closers: 'Luis M., Mike R.',
  legalName: 'Mike’s Tire LLC',
  taxId: '••-•••4829',
  counterUrl: 'https://useclear.org/c/8QK2',
  stripe: false,
  cards: null,
  readers: null,
  ways: null,
  platform: 'ios',
};

/** "Mon – Thu" rows from a week: runs of days with the same hours. */
function hoursRows(days: DayHours[]): [string, string, boolean][] {
  const long: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  const out: [string, string, boolean][] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    const same = (a: DayHours, b: DayHours) => JSON.stringify(a.open) === JSON.stringify(b.open);
    while (j + 1 < days.length && same(days[j + 1], days[i])) j++;
    const label = i === j ? long[days[i].dn] : `${days[i].dn} – ${days[j].dn}`;
    out.push([label, days[i].open ? `${days[i].open![0]} – ${days[i].open![1]}` : 'Closed', !!days[i].open]);
    i = j + 1;
  }
  return out;
}

export interface Actions {
  onHours: () => void;
  onAccount: () => void;
  onPayouts: () => void;
  onDevice: () => void;
  onLeave: () => void;
  onNewCode: () => void;
  onSignOutDevice?: (id: string) => void;
  /** Owners: to Stripe's onboarding (or its dashboard, once connected). */
  onConnectStripe?: () => void;
  onAddReader?: () => void;
  /** Owners: a way to pay switched on or off. */
  onWay?: (way: 'card' | 'cash' | 'split', on: boolean) => void;
  /** Owners, live: change a field of the shop. */
  onEditShop?: (field: ShopField) => void;
  /** Owners, live: the break length and when it's due. */
  onBreaks?: () => void;
  /** Owners, live: how long this tablet waits before asking for a PIN. */
  onIdle?: (seconds: number) => void;
  /** Owners, live: rename this tablet. */
  onRenameDevice?: () => void;
  /** Owners: a selling setting changed (saved as it changes). */
  onSettings?: (patch: ShopSettingsPatch) => void;
  /** Owners: an amount to change, in a sheet. */
  onAmount?: (edit: AmountEdit) => void;
  /** Owners, live: where the end-of-day summary is emailed. */
  onNotifyEmail?: () => void;
  /** Owners, live: start or carry on the business's verification with Bridge. */
  onVerifyBusiness?: () => void;
  /** Owners, live: a month's statement, printed (Save as PDF) or as a spreadsheet. */
  onStatementPdf?: (m: StatementMonth) => void;
  onStatementCsv?: (m: StatementMonth) => void;
  /** Owners, live: where each month's statement is emailed on the 2nd. */
  onStatementsEmail?: () => void;
}

/** Counter and Devices on a live shop. */
function liveCounterDevices(key: 'counter' | 'devices', l: LiveShop, a: Actions): ReactNode {
  if (key === 'counter') {
    const b = l.settings?.breaks;
    return (
      <Cell label="Shifts" det="Shop-wide" foot={<FootDet>Home shows who is due a break from this. It is not a timesheet.</FootDet>}>
        <Main>
          <Rows link>
            <Kv k="Break" v={b ? `${b.minutes} minutes, over ${b.afterMinutes % 60 ? `${b.afterMinutes} minutes` : `${b.afterMinutes / 60} hours`}` : '—'} go onTap={a.onBreaks} />
          </Rows>
          {l.device && (
            <>
              <p className="c-label c-st-fl">This tablet asks for a PIN after</p>
              <Chips
                options={IDLE.map((s) => minutes(s))}
                value={Math.max(0, IDLE.indexOf(l.device.idleLockSeconds))}
                onPick={(i) => a.onIdle?.(IDLE[i]!)}
              />
            </>
          )}
        </Main>
      </Cell>
    );
  }
  const readers = l.readers ?? [];
  return (
    <>
      <Cell
        label="Paired"
        det={String(readers.length)}
        foot={
          <FootLine det="Printing uses this tablet’s print dialog: AirPrint, or a printer it can reach.">
            <Btn onClick={a.onAddReader}>Pair a reader</Btn>
          </FootLine>
        }
      >
        <Main>
          {readers.length ? (
            <Rows>
              {readers.map((r) => (
                <Kv key={r.id} k={r.label} v={r.type === 'smart' ? 'Smart reader' : r.type === 'm2' ? 'Stripe Reader M2' : 'Tap to Pay'} ink />
              ))}
            </Rows>
          ) : (
            <p className="c-det">No card reader yet.</p>
          )}
        </Main>
      </Cell>
      {l.device && (
        <Cell label="This tablet" det="Enrolled">
          <Main>
            <Rows link>
              <Kv k="Name" v={l.device.label} go onTap={a.onRenameDevice} />
              <Kv k="Enrolled" v={l.device.enrolledAt ? new Date(l.device.enrolledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} ink />
            </Rows>
          </Main>
        </Cell>
      )}
    </>
  );
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const ago = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** A discount code's line: what it takes off, and on what. */
function codeLine(c: DiscountCode): string {
  const off = c.percent !== null ? `${c.percent}% off` : `${money(c.amountCents ?? 0)} off`;
  return 'all' in c.appliesTo ? `${off} the whole charge` : `${off} ${c.appliesTo.categories.join(', ').toLowerCase()}`;
}
/** Until when, or that it ended: a chip. */
function codeChip(c: DiscountCode, now = Date.now()) {
  if (c.endsAt && Date.parse(c.endsAt) < now) return <span className="c-chip c-neutral">Ended {ago(c.endsAt)}</span>;
  if (c.startsAt && Date.parse(c.startsAt) > now) return <span className="c-chip c-neutral">From {ago(c.startsAt)}</span>;
  return (
    <span className="c-chip c-settled">
      <span className="c-core" />
      {c.endsAt ? `Until ${ago(c.endsAt)}` : 'Running'}
    </span>
  );
}

/** Tax, Tips, Discounts and Closing on a live shop: the shop's own settings, changed as they're set. */
function liveSelling(key: Section, l: LiveSelling, a: Actions): ReactNode {
  const s = l.settings;
  const set = (patch: ShopSettingsPatch) => a.onSettings?.(patch);
  switch (key) {
    case 'tax': {
      const t = l.tax;
      const source = !t ? '—' : t.source === 'stripe' ? 'Worked out by Stripe Tax' : t.source === 'address_rate' ? 'The rate for the shop’s address' : 'No tax added yet';
      const rate = (r: string | null | undefined) => (r ? `${r}%` : '—');
      const k = l.kinds;
      return (
        <>
          <Cell
            label="Where you collect"
            det={source}
            foot={
              <FootDet>
                {t?.stripe === 'active'
                  ? 'The rate follows the address. You never type a percentage.'
                  : 'Until Stripe Tax is on in the shop’s own Stripe account, the rate for its address is used. Turn it on in Stripe to have it worked out per sale.'}
              </FootDet>
            }
          >
            <Main>
              <Rows>
                <Kv k="Shop address" v={l.address ?? '—'} ink />
                <Kv k="Registered in" v={l.region ?? '—'} ink />
                <Kv k="Rate at the shop" v={rate(t?.rates.goods)} ink />
              </Rows>
            </Main>
          </Cell>
          <Cell label="How prices show" det="At the counter" foot={<FootDet>Food trucks often choose tax included, so a $9.00 taco costs $9.00.</FootDet>}>
            <Main>
              <Chips options={['Before tax, added at checkout', 'Tax included']} value={s.tax.pricesIncludeTax ? 1 : 0} onPick={(i) => set({ tax: { pricesIncludeTax: i === 1 } })} />
            </Main>
          </Cell>
          <Cell label="Kinds of item" det="Set on each item in Inventory">
            <Main>
              <Rows>
                <Kv k="Taxable goods" v={`${rate(t?.rates.goods)} · ${k?.goods ?? 0} items`} ink />
                <Kv k="Labour" v={`${rate(t?.rates.labour)} · ${k?.labour ?? 0} items`} ink />
                <Kv k="Prepared food" v={`${rate(t?.rates.food)} · ${k?.food ?? 0} items`} ink />
                <Kv k="Exempt" v={`— · ${k?.exempt ?? 0} items`} ink />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    }
    case 'tips': {
      const tips = s.tips;
      const label = (p: number) => (tips.mode === 'amounts' ? `$${p % 100 ? (p / 100).toFixed(2) : p / 100}` : `${p}%`);
      return (
        <>
          <Cell
            label="Asking for a tip"
            det="On the customer’s side of the screen"
            foot={<FootDet>Amounts suit large tickets like tires. A food truck would offer 15, 18 and 20%.</FootDet>}
          >
            <Main>
              <Rows>
                <Switch t="Ask before they pay" det="Once, for any way to pay" on={tips.enabled} onChange={(on) => set({ tips: { ...tips, enabled: on } })} />
              </Rows>
              <p className="c-label c-st-fl">Offer</p>
              <Chips
                options={['Amounts', 'Percentages']}
                value={tips.mode === 'amounts' ? 0 : 1}
                // Changing what's offered starts from that kind's usual three.
                onPick={(i) => set({ tips: { ...tips, mode: i === 0 ? 'amounts' : 'percentages', presets: i === 0 ? [500, 1000, 2000] : [15, 18, 20] } })}
              />
              <div className="c-st-presets">
                {tips.presets.map((p, i) => (
                  <div key={i} role="button" tabIndex={0} onKeyDown={clickOnKey} onClick={() => a.onAmount?.({ kind: 'preset', index: i })} aria-label={`Change ${label(p)}`}>
                    {label(p)}
                  </div>
                ))}
                {tips.presets.length < 4 && (
                  <div className="c-add" role="button" tabIndex={0} onKeyDown={clickOnKey} onClick={() => a.onAmount?.({ kind: 'preset', index: null })}>
                    + Add
                  </div>
                )}
              </div>
            </Main>
          </Cell>
          <Cell
            label="Who gets them"
            det="Shared at close"
            foot={
              <FootDet>
                {tips.goTo === 'hours'
                  ? 'The day’s tips are pooled and shared at close by each person’s time on shift that day, from their PIN to End shift, less breaks. Card and cash are shared apart. A day nobody clocked in for goes to whoever raised each charge.'
                  : 'Card tips are paid with payroll. Cash tips come out of the drawer at close.'}
              </FootDet>
            }
          >
            <Main>
              <Chips options={['Whoever raised the charge', 'Split by hours on shift']} value={tips.goTo === 'raiser' ? 0 : 1} onPick={(i) => set({ tips: { ...tips, goTo: i === 0 ? 'raiser' : 'hours' } })} />
            </Main>
          </Cell>
        </>
      );
    }
    case 'discounts': {
      const codes = l.codes ?? [];
      const top = [...codes].sort((x, y) => y.uses - x.uses)[0];
      const lim = s.discountLimits;
      return (
        <>
          <Cell
            label="Codes"
            det={String(codes.length)}
            foot={
              <FootLine det={top && top.uses ? `${top.code} has been used ${top.uses} ${top.uses === 1 ? 'time' : 'times'}.` : 'A code works at checkout, typed or scanned.'}>
                <Btn primary onClick={a.onNewCode}>
                  New code
                </Btn>
              </FootLine>
            }
          >
            <Main>
              {codes.length ? (
                <Rows>
                  {codes.map((c) => (
                    <Kv
                      key={c.id}
                      k={
                        <>
                          <b className="c-st-dcode">{c.code}</b> {codeLine(c)}
                        </>
                      }
                      v={codeChip(c)}
                    />
                  ))}
                </Rows>
              ) : (
                <p className="c-det">No codes yet.</p>
              )}
            </Main>
          </Cell>
          <Cell label="Limits by role" det="Without a PIN" foot={<FootDet>Above a limit, an owner or manager enters their PIN at the counter.</FootDet>}>
            <Main>
              <Rows link>
                <Kv k="Counter" v={`Up to ${lim.counter}%`} go onTap={() => a.onAmount?.({ kind: 'limit', role: 'counter' })} />
                <Kv k="Manager" v={`Up to ${lim.manager}%`} go onTap={() => a.onAmount?.({ kind: 'limit', role: 'manager' })} />
                <Kv k="Owner" v={lim.owner === null ? 'No limit' : `Up to ${lim.owner}%`} ink />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    }
    case 'notifications': {
      const n = s.notifications;
      return (
        <>
          <Cell
            label="By email"
            det={n.email ?? 'No address yet'}
            foot={<FootDet>Sent when the day is closed, so the figures are the final ones. Changes save as you make them.</FootDet>}
          >
            <Main>
              <Rows link>
                <Switch t="End-of-day summary" det="What was taken and how, the drawer, and tips by person" on={n.endOfDay} onChange={(on) => set({ notifications: { ...n, endOfDay: on } })} />
                <Kv k="Send to" v={n.email ?? 'Add an address'} go onTap={a.onNotifyEmail} />
              </Rows>
            </Main>
          </Cell>
          <Cell label="On the way" det="Not yet" foot={<FootDet>A refund that needs you, a charge still waiting, stock running low and a payout sent come next. Home shows them today.</FootDet>}>
            <Main>
              <p className="c-det" style={{ margin: 0 }}>
                The summary is the one notification by email for now.
              </p>
            </Main>
          </Cell>
        </>
      );
    }
    case 'closing':
      return (
        <>
          <Cell label="The drawer" det="Every day">
            <Main>
              <Rows link>
                <Kv k="Starting cash" v={money(s.startingCashCents)} go onTap={() => a.onAmount?.({ kind: 'startingCash' })} />
                <Switch t="Two counts at close" det="By two people, neither seeing the other’s figure" on={s.twoCounts} onChange={(on) => set({ twoCounts: on })} />
                <R2 t="Any difference needs a sign-off" det="By an owner or manager who did not count first" end={<span className="c-det">Always</span>} />
              </Rows>
            </Main>
          </Cell>
          <Cell label="When only one person is on" det="For late closes" foot={<FootDet>The owner sees it on Home in the morning, with the count and the note.</FootDet>}>
            <Main>
              <Chips
                options={['One count, signed off by the owner next morning', 'Wait for a second person']}
                value={s.onePersonClose === 'owner_next_morning' ? 0 : 1}
                onPick={(i) => set({ onePersonClose: i === 0 ? 'owner_next_morning' : 'wait_for_second' })}
              />
            </Main>
          </Cell>
          <Cell label="Who can close" det="Close the day">
            <Main>
              <Rows>
                <Kv k="Owners and managers" v={l.closers} ink />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    default:
      return null;
  }
}

/** What the locked card cell says, by why cards are locked. */
const LOCKED: Record<Exclude<CardAvailability, { available: true }>['reason'], { chip: string; t: string; det: string; cta: string; foot: string }> = {
  not_connected: {
    chip: 'Not connected',
    t: 'Connect your Stripe account to take cards',
    det: 'Cards run through your own Stripe account, in your business’s name, and land in your bank the next business day. Clear adds its part of the fee to each sale; you never pay for hardware you do not want.',
    cta: 'Connect Stripe',
    foot: 'Takes about five minutes. You can use an existing Stripe account.',
  },
  details_pending: {
    chip: 'Almost there',
    t: 'Finish Stripe’s questions to take cards',
    det: 'Stripe still needs a few details about the business before cards can be taken. Pick up where you left off.',
    cta: 'Continue with Stripe',
    foot: 'Your answers so far are saved.',
  },
  charges_disabled: {
    chip: 'Paused by Stripe',
    t: 'Stripe has paused card payments',
    det: 'Stripe needs something from you before cards can be taken again. Their dashboard says what. Cash and Clear work as normal meanwhile.',
    cta: 'Open Stripe',
    foot: 'Usually a document or a detail that changed.',
  },
  disconnected: {
    chip: 'Disconnected',
    t: 'Stripe was disconnected from Clear',
    det: 'Cards are off until you connect again. Anything taken before stays in your Stripe account.',
    cta: 'Connect again',
    foot: 'You can use the same Stripe account.',
  },
};

const KYB: Record<KybStatus['state'], { chip: string; tone: string; t: string; cta: string | null }> = {
  not_started: { chip: 'Not verified', tone: 'c-neutral', t: 'Bridge verifies the business before it pays out to a bank. It takes about ten minutes: the business’s details, its owners, and a document or two.', cta: 'Verify the business' },
  needs_info: { chip: 'Started', tone: 'c-underway', t: 'Bridge needs a little more before it can check the business. Pick up where you left off.', cta: 'Carry on' },
  in_review: { chip: 'In review', tone: 'c-underway', t: 'Bridge is checking the business. It usually takes a day or two; there’s nothing to do meanwhile.', cta: null },
  verified: { chip: 'Verified', tone: 'c-settled', t: 'Bridge has verified the business.', cta: null },
  rejected: { chip: 'Not approved', tone: 'c-absent', t: 'Bridge couldn’t verify the business.', cta: 'See what Bridge needs' },
  paused: { chip: 'Paused', tone: 'c-underway', t: 'Bridge has paused the business’s account. Contact Clear and we’ll find out why.', cta: null },
};

/** Settings › Advanced on a live shop: the business's verification with Bridge, then leaving. */
function liveAdvanced(d: SettingsData, a: Actions): ReactNode {
  const k = d.kyb;
  const v = k ? KYB[k.state] : null;
  return (
    <>
      {k && v && (
        <Cell
          label="Business verification"
          det="By Bridge"
          foot={
            k.available ? (
              <FootLine det={k.email ? `Under ${k.email}` : 'The business’s documents stay with Bridge.'}>
                {v.cta && a.onVerifyBusiness && <Btn primary={k.state === 'not_started'} onClick={a.onVerifyBusiness}>{v.cta}</Btn>}
              </FootLine>
            ) : (
              <FootDet>Business verification isn’t available yet.</FootDet>
            )
          }
        >
          <Main>
            <div className="c-line" style={{ alignItems: 'flex-start' }}>
              <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>
                {v.t}
                {k.state === 'rejected' && k.reason ? ` Bridge says: ${k.reason}.` : ''}
              </p>
              <span className={`c-chip ${v.tone}`} style={{ flex: 'none' }}>
                {v.chip}
              </span>
            </div>
            <div style={{ marginTop: 'var(--s2)' }}>
              <Rows>
                <Kv k="Withdraw to a bank" v={k.withdrawToBank ? 'Ready' : k.state === 'verified' ? 'Bridge is setting it up' : 'After verification'} ink />
              </Rows>
            </div>
          </Main>
        </Cell>
      )}
      <Cell
        label="Leaving"
        det="Any time, no fee"
        foot={
          <FootLine det="You can talk to someone before anything happens.">
            <Btn onClick={a.onLeave}>Leave Clear</Btn>
          </FootLine>
        }
      >
        <Main>
          <p className="c-sub" style={{ margin: 0 }}>
            There is no exclusivity and no fee. Charges already approved still settle, and what you are owed is still paid on the 14th.
          </p>
        </Main>
      </Cell>
    </>
  );
}

/** A pane's cells. */
export function paneBody(key: Section, d: SettingsData, a: Actions): ReactNode {
  if (!d.preview && (key === 'counter' || key === 'devices')) return d.liveShop ? liveCounterDevices(key, d.liveShop, a) : null;
  if (!d.preview && key === 'advanced') return liveAdvanced(d, a);
  // A live shop's own settings, never the reference's example figures, even while they load.
  if (!d.preview && (key === 'tax' || key === 'tips' || key === 'discounts' || key === 'closing' || key === 'notifications')) return d.live ? liveSelling(key, d.live, a) : null;
  switch (key) {
    case 'shop':
      return (
        <>
          <Cell
            label="Your listing"
            det="In Clear Partners"
            foot={
              d.preview ? (
                <FootLine det="Members see it with a Credit tag.">
                  <Btn>Preview as a member</Btn>
                </FootLine>
              ) : (
                <FootDet>Members see it with a Credit tag.</FootDet>
              )
            }
          >
            <Main>
              <Rows link>
                <Kv k="Name" v={d.shop} go onTap={a.onEditShop && (() => a.onEditShop!('name'))} />
                <Kv k="What you do" v={d.category} go onTap={a.onEditShop && (() => a.onEditShop!('category'))} />
                <Kv k="One line" v={d.oneLine} go onTap={a.onEditShop && (() => a.onEditShop!('oneLine'))} />
                <Kv k="Photo" v={d.photo} go={d.preview} />
              </Rows>
            </Main>
          </Cell>
          {d.hours && (
            <Cell
              label="Shop hours"
              det="Staff’s hours sit inside these"
              foot={
                <FootLine det="Members see “open now” from these.">
                  <Btn onClick={a.onHours}>Change hours</Btn>
                </FootLine>
              }
            >
              <Main>
                <Rows>
                  {hoursRows(d.hours).map(([k, v, open]) => (
                    <Kv key={k} k={k} v={v} ink={open} />
                  ))}
                  <Kv k="Closed on a date" v={`${d.closedDates.length} coming up`} go onTap={a.onHours} />
                </Rows>
              </Main>
            </Cell>
          )}
          {(d.preview || a.onEditShop) && (
            <Cell label="Contact" det="On your listing">
              <Main>
                <Rows link>
                  <Kv k="Address" v={d.address} go onTap={a.onEditShop && (() => a.onEditShop!('address'))} />
                  <Kv k="Phone" v={d.phone} go onTap={a.onEditShop && (() => a.onEditShop!('phone'))} />
                  <Kv k="Email" v={d.email} go onTap={a.onEditShop && (() => a.onEditShop!('email'))} />
                </Rows>
              </Main>
            </Cell>
          )}
        </>
      );
    case 'payouts':
      return (
        <>
          <Cell
            label="Where payouts go"
            det="Owner only"
            foot={
              <FootLine det="Changed by secure link. Clear never sees your login.">
                <Btn onClick={a.onAccount}>Change account</Btn>
              </FootLine>
            }
          >
            <Main>
              <Account bank={d.account?.bank ?? 'No account yet'} det={d.account?.det ?? 'Add one to be paid out'} ready={!!d.account} />
            </Main>
          </Cell>
          <Cell
            label="Schedule"
            det="From your terms"
            foot={
              <FootLine det="Every payout traces back to its charges.">
                <Btn onClick={a.onPayouts}>See payouts</Btn>
              </FootLine>
            }
          >
            <Main>
              <Rows>
                <Kv k="Next payout" v={d.nextPayout} ink />
                <Kv k="Paid" v={d.payoutWhen} />
                <Kv k="Managers" v="Send, not redirect" />
              </Rows>
            </Main>
          </Cell>
          {!d.preview && d.live && d.statementMonths && (
            <Cell label="Statements" det="Monthly" foot={<FootDet>Each lists what was taken and how, what came off it, and the card deposits. PDF opens the print dialog.</FootDet>}>
              <Main>
                <Rows>
                  {d.statementMonths.map((m) => (
                    <R2
                      key={m.from}
                      t={m.label}
                      det={m.inProgress ? 'Still being written' : 'The whole month'}
                      endClass="c-ink"
                      end={
                        <>
                          <Btn sm onClick={a.onStatementPdf && (() => a.onStatementPdf!(m))}>
                            PDF
                          </Btn>
                          <Btn sm onClick={a.onStatementCsv && (() => a.onStatementCsv!(m))}>
                            CSV
                          </Btn>
                        </>
                      }
                    />
                  ))}
                </Rows>
              </Main>
              <Main>
                <Rows link>
                  <Switch
                    t="Email each statement"
                    det={d.live.settings.statementsEmail ? `On the 2nd, to ${d.live.settings.statementsEmail}` : 'On the 2nd, once there’s an address'}
                    on={!!d.live.settings.statementsEmail}
                    onChange={(on) => (on ? a.onStatementsEmail?.() : a.onSettings?.({ statementsEmail: null }))}
                  />
                  {d.live.settings.statementsEmail && <Kv k="Send to" v={d.live.settings.statementsEmail} go onTap={a.onStatementsEmail} />}
                </Rows>
              </Main>
            </Cell>
          )}
          {d.preview && (
            <Cell label="Statements" det="Monthly">
              <Main>
                <Rows>
                  <R2 t="September" det="Still being written" end="In progress" />
                  <R2
                    t="August"
                    det="$3,118.40 paid out Sep 14"
                    endClass="c-ink"
                    end={
                      <>
                        <Btn sm>PDF</Btn>
                        <Btn sm>CSV</Btn>
                      </>
                    }
                  />
                </Rows>
              </Main>
              <Main>
                <Rows>
                  <Switch t="Email each statement" det="On the 2nd, to books@mikestire.com" />
                </Rows>
              </Main>
            </Cell>
          )}
        </>
      );
    case 'partnership':
      return (
        <>
          <Cell
            label="Your terms"
            det={d.signed}
            foot={
              <FootLine det="Terms change only by a new agreement, never here.">
                <Btn disabled={!d.preview}>Download agreement</Btn>
              </FootLine>
            }
          >
            <Main>
              <p className="c-label" style={{ margin: '0 0 6px' }}>
                What you pay
              </p>
              <Conseq
                rows={[
                  ['Paid now', d.ratesNow, true],
                  ['Over time', d.ratesOver, true],
                  ['Standard, after founding', '1.5% now · 2.5% over time'],
                  ...(d.preview ? ([['First 20 charges', 'No fee · 3 left']] as [string, string][]) : []),
                ]}
              />
            </Main>
            <Main>
              <p className="c-label" style={{ margin: '0 0 6px' }}>
                What you get
              </p>
              <Conseq
                rows={[
                  ['Payouts', d.payoutWhen],
                  ['If a member does not pay', 'Clear carries it'],
                  ['Largest charge', d.cap],
                ]}
              />
            </Main>
            <Main>
              <Conseq
                rows={[
                  ['Exclusivity', 'None'],
                  ['Leaving', 'Any time, no fee'],
                ]}
              />
            </Main>
          </Cell>
          <Cell label="Co-op record" det="Partner member">
            <Main>
              <Rows>
                <Kv k="Member since" v={d.memberSince} ink />
                <Kv k="Joined with" v={d.joinedWith} />
                <Kv k="Membership certificate" v="PDF" go />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    case 'counter':
      return (
        <>
          <Cell
            label="Counter cards"
            det="40 printed Aug 14"
            foot={
              <FootLine det="More are free and arrive in about five days.">
                <Pair>
                  <Btn>Print at home</Btn>
                  <Btn primary>Send 40 more</Btn>
                </Pair>
              </FootLine>
            }
          >
            <Main>
              <div className="c-st-cardrow">
                <CounterCard shop={d.shop} url={d.counterUrl} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--t-sec)' }}>About 12 left</p>
                  <p className="c-det" style={{ marginTop: 6 }}>
                    The same code the tablet shows. It goes home with an estimate, so a customer can sign up and decide in their own time.
                  </p>
                </div>
              </div>
            </Main>
          </Cell>
          <Cell label="Shifts" det="Shop-wide" foot={<FootDet>Home shows who is due a break from this. It is not a timesheet.</FootDet>}>
            <Main>
              <Rows link>
                <Kv k="Break" v="30 minutes, over 5 hours" go />
                <Kv k="Ask for a PIN after" v={d.idle} go />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    case 'payments': {
      const kinds = kindsFor(d.platform);
      const readers = (d.readers ?? PAIRED).filter((r) => kinds.includes(r.kind));
      const locked = d.cards && !d.cards.available ? LOCKED[d.cards.reason] : LOCKED.not_connected;
      const way = (k: 'card' | 'cash' | 'split') => (d.ways && a.onWay ? { on: d.ways[k], onChange: (on: boolean) => a.onWay!(k, on) } : {});
      return (
        <>
          <Cell label="Ways to pay" det="What Checkout offers" foot={<FootDet>Clear is always on: it is what you are a partner for.</FootDet>}>
            <Main>
              <Rows>
                <Fixed t="Clear" det="Pay now or over time, approved on their phone" />
                {d.stripe ? <Switch t="Card" det="On the counter reader" {...way('card')} /> : <Locked t="Card" det="Needs Stripe connected first" />}
                <Switch t="Cash" det="Change worked out, counted at close" {...way('cash')} />
                <Switch t="Split between methods" det="Part one way, part another" {...way('split')} />
              </Rows>
            </Main>
          </Cell>
          {d.stripe ? (
            <>
              <Cell
                label="Card payments"
                det={
                  <span className="c-chip c-settled">
                    <span className="c-core" />
                    Stripe connected
                  </span>
                }
                foot={<FootDet>One figure for card processing. Each deposit in Payouts shows how it splits between Stripe and Clear.</FootDet>}
              >
                <Main>
                  <Rows link>
                    <Kv k="Stripe account" v={d.legalName} go onTap={a.onConnectStripe} />
                    <Kv k="Card processing" v="2.7% + 35¢ a sale · 2.7% + 5¢ under $10" go />
                  </Rows>
                </Main>
              </Cell>
              <Cell
                label="Readers"
                det={String(readers.length)}
                foot={
                  <FootLine
                    det={
                      d.platform === 'web'
                        ? 'In a browser, smart readers on your network. The M2 and Tap to Pay work in the Clear app.'
                        : 'An M2, a smart reader, or any phone running the Clear app.'
                    }
                  >
                    <Btn onClick={a.onAddReader}>Add a reader</Btn>
                  </FootLine>
                }
              >
                <Main>
                  <Rows link>
                    {readers.length ? (
                      readers.map((r) => (
                        <Kv
                          key={r.t}
                          k={
                            <>
                              {r.t}
                              <span className="c-det c-st-sub">{r.sub}</span>
                            </>
                          }
                          v={
                            <span className="c-chip c-settled">
                              <span className="c-core" />
                              {r.chip}
                            </span>
                          }
                          go
                        />
                      ))
                    ) : (
                      <Kv k="No readers on this device yet" v="—" />
                    )}
                  </Rows>
                </Main>
              </Cell>
            </>
          ) : (
            <div className="c-slab c-one">
              <div className="c-cell c-full c-st-lockcell">
                <div className="c-chead">
                  <div className="c-sechead">
                    <p className="c-label">Card payments</p>
                    <span className="c-chip c-neutral">{locked.chip}</span>
                  </div>
                </div>
                <Main>
                  <p className="c-st-lk-t">{locked.t}</p>
                  <p className="c-det" style={{ marginTop: 6, lineHeight: 1.5 }}>
                    {locked.det}
                  </p>
                  <Rows style={{ marginTop: 'var(--s2)' }}>
                    <Kv k="Card processing" v="2.7% + 35¢ a sale, 2.7% + 5¢ under $10" ink />
                    <Kv k="Readers" v="Stripe Reader M2, smart readers, or Tap to Pay on a phone" ink />
                  </Rows>
                </Main>
                <FootLine det={locked.foot}>
                  <Btn primary onClick={a.onConnectStripe} disabled={!a.onConnectStripe && !d.preview}>
                    {locked.cta}
                  </Btn>
                </FootLine>
              </div>
            </div>
          )}
          <Cell label="Paying with Clear" det="Your founding rates">
            <Main>
              <Rows>
                <Kv k="Paid now" v={`${d.ratesNow} of the charge`} ink />
                <Kv k="Over time" v={`${d.ratesOver} of the charge`} ink />
                <Kv k="Over time is offered on" v="Charges of $50.00 or more" ink />
                <Kv k="Below that" v="Pay now, from their Clear balance" ink />
              </Rows>
            </Main>
          </Cell>
          <Cell
            label="When the connection drops"
            det="Offline"
            foot={<FootDet>{d.stripe && d.platform !== 'web' ? 'Cash works as normal offline. Tap to Pay needs a connection.' : 'Cash works as normal offline.'}</FootDet>}
          >
            <Main>
              <Rows>
                {!d.stripe ? (
                  <Locked t="Store card payments" det="Needs Stripe connected first" />
                ) : d.platform === 'web' ? (
                  <Locked t="Store card payments" det="On the M2, in the Clear app" />
                ) : offlineFor('bluetooth') ? (
                  <Switch t="Store card payments" det="Sent when the connection is back, up to $500.00 each" />
                ) : (
                  <Locked t="Store card payments" det="Coming to the M2 in an app update" />
                )}
                <Fixed t="Clear" det="Needs a connection, always. There is no offline queue." />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    }
    case 'tax':
      return (
        <>
          <Cell label="Where you collect" det="Worked out by Stripe Tax" foot={<FootDet>The rate follows the address. You never type a percentage.</FootDet>}>
            <Main>
              <Rows link>
                <Kv k="Shop address" v="412 Colton Ave, Redlands, CA" go />
                <Kv k="Registered in" v="California" go />
                <Kv k="Rate at the shop" v="7.75%" ink />
              </Rows>
            </Main>
          </Cell>
          <Cell label="How prices show" det="At the counter" foot={<FootDet>Food trucks often choose tax included, so a $9.00 taco costs $9.00.</FootDet>}>
            <Main>
              <Chips options={['Before tax, added at checkout', 'Tax included']} initial={[0]} />
            </Main>
          </Cell>
          <Cell label="Kinds of item" det="Set on each item in Inventory">
            <Main>
              <Rows>
                <Kv k="Taxable goods" v="7.75% · 8 items" ink />
                <Kv k="Labour, not taxed" v="— · 3 items" ink />
                <Kv k="Prepared food" v="7.75% · 0 items" ink />
                <Kv k="Exempt" v="— · 0 items" ink />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    case 'tips':
      return (
        <>
          <Cell
            label="Asking for a tip"
            det="On the customer’s side of the screen"
            foot={<FootDet>Amounts suit large tickets like tires. A food truck would offer 15, 18 and 20%.</FootDet>}
          >
            <Main>
              <Rows>
                <Switch t="Ask before they pay" det="Once, for any way to pay" />
              </Rows>
              <p className="c-label c-st-fl">Offer</p>
              <Chips options={['Amounts', 'Percentages']} initial={[0]} />
              <div className="c-st-presets">
                <div>$5</div>
                <div>$10</div>
                <div>$20</div>
                <div className="c-add">+ Add</div>
              </div>
            </Main>
          </Cell>
          <Cell label="Who gets them" det="Shared at close" foot={<FootDet>Card tips are paid with payroll. Cash tips come out of the drawer at close.</FootDet>}>
            <Main>
              <Chips options={['Whoever raised the charge', 'Split by hours on shift']} initial={[0]} />
            </Main>
          </Cell>
        </>
      );
    case 'discounts':
      return (
        <>
          <Cell
            label="Codes"
            det="2"
            foot={
              <FootLine det="FALL10 has been used 4 times.">
                <Btn primary onClick={a.onNewCode}>
                  New code
                </Btn>
              </FootLine>
            }
          >
            <Main>
              <Rows link>
                <Kv
                  k={
                    <>
                      <b className="c-st-dcode">FALL10</b> 10% off the whole charge
                    </>
                  }
                  v={
                    <span className="c-chip c-settled">
                      <span className="c-core" />
                      Until Oct 31
                    </span>
                  }
                  go
                />
                <Kv
                  k={
                    <>
                      <b className="c-st-dcode">SUMMER25</b> 25% off tires
                    </>
                  }
                  v={<span className="c-chip c-neutral">Ended Sep 1</span>}
                  go
                />
              </Rows>
            </Main>
          </Cell>
          <Cell label="Limits by role" det="Without a PIN" foot={<FootDet>Above a limit, an owner or manager enters their PIN at the counter.</FootDet>}>
            <Main>
              <Rows link>
                <Kv k="Counter" v="Up to 10%" go />
                <Kv k="Manager" v="Up to 25%" go />
                <Kv k="Owner" v="No limit" ink />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    case 'devices':
      return (
        <>
          <Cell
            label="Paired"
            det="3"
            foot={
              <FootLine det="The M2 pairs over Bluetooth with the Clear app.">
                <Btn>Pair a device</Btn>
              </FootLine>
            }
          >
            <Main>
              <Rows link>
                <Kv
                  k="Stripe Reader M2"
                  v={
                    <span className="c-chip c-settled">
                      <span className="c-core" />
                      Connected
                    </span>
                  }
                  go
                />
                <Kv
                  k="Receipt printer"
                  v={
                    <span className="c-chip c-settled">
                      <span className="c-core" />
                      Ready
                    </span>
                  }
                  go
                />
                <Kv k="Cash drawer" v="Opens with the printer" go />
              </Rows>
            </Main>
          </Cell>
          <Cell label="This tablet" det="Enrolled">
            <Main>
              <Rows>
                <Kv k="Name" v={d.tablet.name} ink />
                <Kv k="Enrolled" v={d.tablet.enrolled} ink />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    case 'closing':
      return (
        <>
          <Cell label="The drawer" det="Every day">
            <Main>
              <Rows link>
                <Kv k="Starting cash" v="$150.00" go />
                <Switch t="Two counts at close" det="By two people, neither seeing the other’s figure" />
                <Switch t="Any difference needs a sign-off" det="By an owner or manager who did not count first" />
              </Rows>
            </Main>
          </Cell>
          <Cell label="When only one person is on" det="For late closes" foot={<FootDet>The owner sees it on Home in the morning, with the count and the note.</FootDet>}>
            <Main>
              <Chips options={['One count, signed off by the owner next morning', 'Wait for a second person']} initial={[0]} />
            </Main>
          </Cell>
          <Cell label="Who can close" det="Close the day">
            <Main>
              <Rows>
                <Kv k="Owners and managers" v={d.closers} ink />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    case 'security':
      return (
        <>
          <Cell label="You" det="Owner" foot={<FootDet>Your PIN approves refunds and leaving. Staff never see it.</FootDet>}>
            <Main>
              <Rows link>
                <Kv k="Sign-in" v={d.signIn} go />
                <Kv k="Owner PIN" v="Change" go />
              </Rows>
            </Main>
          </Cell>
          <Cell
            label="Devices"
            det={`${d.devices.length} signed in`}
            foot={
              <FootLine det="A device charges with a PIN. Money needs you.">
                <Btn onClick={a.onDevice}>Add a device</Btn>
              </FootLine>
            }
          >
            <Main>
              <Rows>
                {d.devices.map((v) => (
                  <Device key={v.id} name={v.name} det={v.det} kind={v.kind} current={v.current} onSignOut={a.onSignOutDevice && (() => a.onSignOutDevice!(v.id))} />
                ))}
              </Rows>
            </Main>
          </Cell>
        </>
      );
    case 'notifications':
      return (
        <>
          <Cell label="To you" det={d.owner} foot={<FootDet>Changes save as you make them.</FootDet>}>
            <Main>
              <Rows>
                <Switch t="End-of-day summary" det="9:00pm, every charge and who raised it" />
                <Switch t="A refund needs you" det="Right away, so nobody waits at the counter" />
                <Switch t="A charge is still waiting" det="After an hour, once, so you can follow up" />
                <Switch t="Stock running low" det="When an item drops under its reorder line" />
                <Switch t="Payout sent" det="When the money leaves Clear" />
                <Switch t="Every charge" det="Forty a day is noise; the summary has them" initial={false} />
              </Rows>
            </Main>
          </Cell>
          <Cell label="Send to" det="">
            <Main>
              <Chips options={[`${d.owner.split(' ')[0]}’s phone`, d.signIn, 'Text message']} initial={[0, 1]} multi />
            </Main>
          </Cell>
        </>
      );
    case 'advanced':
      return (
        <>
          <Cell label="Business details" det="Verified" foot={<FootDet>Locked after verification. Contact Clear to correct them.</FootDet>}>
            <Main>
              <Rows>
                <Kv k="Legal name" v={d.legalName} />
                <Kv k="Tax ID" v={d.taxId} />
                <Kv k="Registered address" v={d.address} />
              </Rows>
            </Main>
          </Cell>
          <Cell label="Your data" det="">
            <Main>
              <Rows>
                <R2 t="Every charge" det="Since you joined, as CSV" end={<Btn sm>Download</Btn>} />
                <R2 t="Every payout" det="With the charges in each, as CSV" end={<Btn sm>Download</Btn>} />
              </Rows>
            </Main>
          </Cell>
          <Cell
            label="Leaving"
            det="Any time, no fee"
            foot={
              <FootLine det="You can talk to someone before anything happens.">
                <Btn onClick={a.onLeave}>Leave Clear</Btn>
              </FootLine>
            }
          >
            <Main>
              <p className="c-sub" style={{ margin: 0 }}>
                There is no exclusivity and no fee. Charges already approved still settle, and what you are owed is still paid on the 14th.
              </p>
            </Main>
          </Cell>
        </>
      );
    case 'help':
      return (
        <>
          <Cell
            label="Your contact"
            det="Founding partners"
            foot={<FootDet>For the first five shops, a person answers. That will not last forever, and the guides below are how it scales.</FootDet>}
          >
            <Main>
              <Rows>
                <R2
                  t="Clear partner support"
                  det="Weekdays, 8:00am – 6:00pm"
                  end={
                    <>
                      <Btn sm>Call</Btn>
                      <Btn sm>Message</Btn>
                    </>
                  }
                />
              </Rows>
            </Main>
          </Cell>
          <Cell label="Guides" det="">
            <Main>
              <Rows link>
                <Kv k="Raising a charge" go />
                <Kv k="Refunds, and who approves them" go />
                <Kv k="Training the counter" go />
                <Kv k="Reading a statement" go />
              </Rows>
            </Main>
          </Cell>
        </>
      );
    case 'you':
      return (
        <>
          <Cell label="You" det={`${d.me.name} · ${d.me.role}`}>
            <Main>
              <Rows>
                <Kv k="Your PIN" v="Change" go />
                <Kv k="Your hours" v={d.me.hours} ink />
              </Rows>
            </Main>
          </Cell>
          <Cell label="This tablet" det="Set by the owner">
            <Main>
              <Rows>
                <Kv k="Shop hours" v={d.hours ? 'Mon – Sat, closed Sunday' : '—'} ink />
                <Kv k="Asks for a PIN after" v={d.idle} ink />
                <Kv k="Counter cards running low" v={`Tell ${d.owner.split(' ')[0]}`} />
              </Rows>
            </Main>
          </Cell>
        </>
      );
  }
}

/** Shop › Shop hours, the one pushed page inside a pane. */
export function hoursBody(d: SettingsData, onSave?: () => void): ReactNode {
  return (
    <>
      <Cell label="Each week" det="">
        <Main>
          <WeekHours days={d.hours ?? REFERENCE.hours!} />
        </Main>
      </Cell>
      <Cell
        label="Closed on a date"
        det="A week’s notice"
        foot={
          <FootLine det="Shifts booked on Staff sit inside these hours.">
            <Pair>
              <Btn>Add a date</Btn>
              <Btn primary onClick={onSave} disabled={!onSave}>
                Save hours
              </Btn>
            </Pair>
          </FootLine>
        }
      >
        <Main>
          <Rows link>
            {d.closedDates.map(([k, v]) => (
              <Kv key={k} k={k} v={v} go />
            ))}
          </Rows>
        </Main>
      </Cell>
    </>
  );
}
