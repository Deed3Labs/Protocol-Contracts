import type { ReactNode } from 'react';
import type { AutoPrint, BillButton, Device, PointIdleMode, PointSettings, Reader, ShopSettings, TableView } from '@clear/merchant-contracts';
import { Chip, Segmented, type ChipTone } from '@/brand/controls';
import { IconBack } from '@/brand/icons';
import { cx, Sheet } from '@/brand/ui';
import { Btn, Cell, FootLine, Kv, Main, Pair, R2, Rows, Tg } from '@/settings/views';
import { BagLabel, KitchenTicket, PointBill, PointNumber, PointShowcase, type ShowcaseItem } from './drawings';
import { MI_CASA } from './reference';

/**
 * Settings › Devices and each device's pane (terminal reference, sections 1–4 and 13b). Every new
 * thing is a device, and devices live in one pane: Points, card readers, the drawer, printers and
 * this tablet, each with its state at a glance. Tapping a row opens its pane.
 */

type Point = Extract<Device, { kind: 'point' }>;
type Drawer = Extract<Device, { kind: 'drawer' }>;
type Printer = Extract<Device, { kind: 'printer' }>;

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

// ---- Icons, as the reference draws them --------------------------------------------------------

const Ic = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const IconPointLarge = () => (
  <Ic>
    <rect x="2" y="5" width="20" height="12" />
    <path d="M8 21h8" />
  </Ic>
);
export const IconPoint = () => (
  <Ic>
    <rect x="4" y="5" width="16" height="12" />
    <path d="M8 21h8M10 17l-1 4M14 17l1 4" />
  </Ic>
);
export const IconReader = () => (
  <Ic>
    <rect x="6" y="3" width="12" height="18" rx="2" />
    <path d="M10 9a3 3 0 0 1 0 5M13 7.5a6 6 0 0 1 0 8" />
  </Ic>
);
export const IconTabletDev = () => (
  <Ic>
    <rect x="4" y="3" width="16" height="18" />
    <path d="M11 18h2" />
  </Ic>
);
export const IconDrawer = () => (
  <Ic>
    <rect x="3" y="7" width="18" height="10" />
    <path d="M3 12h18M10 14.5h4" />
  </Ic>
);
export const IconPrinter = () => (
  <Ic>
    <path d="M6 9V3h12v6" />
    <rect x="3" y="9" width="18" height="8" />
    <path d="M7 14h10v7H7z" />
  </Ic>
);
const IconGo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

// ---- A device row ------------------------------------------------------------------------------------

export function DevRow({ icon, name, det, chip, onTap }: { icon: ReactNode; name: string; det: string; chip: { tone: ChipTone; dot?: boolean; text: string }; onTap?: () => void }) {
  return (
    <div>
      <div
        className="c-line"
        style={{ alignItems: 'center', cursor: onTap ? 'pointer' : undefined }}
        role={onTap ? 'button' : undefined}
        tabIndex={onTap ? 0 : undefined}
        aria-label={onTap ? name : undefined}
        onClick={onTap}
        onKeyDown={(e) => onTap && (e.key === 'Enter' || e.key === ' ') && onTap()}
      >
        <span className="c-st-dev">
          <span className="c-ic">{icon}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--t-sec)' }}>{name}</span>
            <span className="c-det" style={{ display: 'block', marginTop: 2 }}>
              {det}
            </span>
          </span>
        </span>
        <Chip tone={chip.tone} dot={chip.dot}>
          {chip.text}
        </Chip>
      </div>
    </div>
  );
}

// ---- What a Point is doing, in a few words -----------------------------------------------------------

const IDLE_WORD: Record<PointIdleMode, string> = {
  number: 'Number',
  menu: 'Menu',
  showcase: 'Showcase',
  pay: 'Pay here',
  waitlist: 'wait list',
};

/** "Point · battery 82% · showing the bill, $48.20" (section 1). */
export function pointDet(p: Point, billCents: (orderId: string) => number | null): string {
  const model = p.model === 'point_large' ? 'Point Large' : 'Point';
  const h = p.health;
  const power = !h ? 'not heard from yet' : h.pluggedIn ? 'plugged in' : `battery ${h.batteryPercent}%`;
  const s = p.showing;
  let doing: string;
  if (h && !h.pluggedIn && h.batteryPercent < 20) doing = 'charge tonight';
  else if (s.kind === 'bill') {
    const c = billCents(s.orderId);
    doing = c === null ? 'showing the bill' : `showing the bill, ${usd(c)}`;
  } else if (s.kind === 'paid') doing = 'showing paid';
  else if (s.kind === 'held') doing = 'held for a party';
  else if (s.kind === 'called') doing = 'called';
  else if (s.kind === 'bill_asked') doing = 'asked for the bill';
  else if (s.kind === 'alert') doing = 'showing an alert';
  else if (s.kind === 'test') doing = 'the test screen';
  else if (s.mode === 'waitlist') doing = 'wait list';
  else doing = `showing ${IDLE_WORD[s.mode]}`;
  return `${model} · ${power} · ${doing}`;
}

/** Online while heard from in the last ten minutes; Low under 20% on battery. */
export function pointChip(p: Point, now = Date.now()): { tone: ChipTone; dot: boolean; text: string } {
  const h = p.health;
  if (!h || now - Date.parse(h.lastSeenAt) > 10 * 60_000) return { tone: 'absent', dot: true, text: 'Offline' };
  if (!h.pluggedIn && h.batteryPercent < 20) return { tone: 'underway', dot: true, text: 'Low' };
  return { tone: 'settled', dot: true, text: 'Online' };
}

const PAPER: Record<Printer['settings']['paper'], string> = {
  receipt80: '80mm receipts',
  label4x6: '4 × 6 receipts',
  label4x3: '4 × 3 labels',
};
const CONN: Record<Printer['settings']['connection'], string> = {
  wifi: 'Wi‑Fi',
  bluetooth: 'Bluetooth',
  os: 'The print dialog',
};

/** "Wi‑Fi · 4 × 6 receipts, 4 × 3 bag labels" */
export function printerDet(p: Printer): string {
  const s = p.settings;
  const what =
    s.prints.kitchenTicket && !s.prints.receipt
      ? `${s.paper === 'label4x6' ? '4 × 6' : '4 × 3'} tickets`
      : s.paper === 'label4x6' && s.prints.bagLabel
        ? '4 × 6 receipts, 4 × 3 bag labels'
        : PAPER[s.paper];
  return `${CONN[s.connection]} · ${what}`;
}

// ---- 1 · Settings › Devices ------------------------------------------------------------------------------

export interface DevicesData {
  devices: Device[];
  readers: Reader[];
  /** This tablet: its name, and what it is. */
  tablet: { name: string; model: string };
  cardsConnected: boolean;
  billCents: (orderId: string) => number | null;
}

export function DevicesList({ d, onOpen, onAddPoint, onAdd, onTablet }: { d: DevicesData; onOpen: (id: string) => void; onAddPoint: () => void; onAdd: () => void; onTablet?: () => void }) {
  const points = d.devices.filter((x): x is Point => x.kind === 'point');
  const drawers = d.devices.filter((x): x is Drawer => x.kind === 'drawer');
  const printers = d.devices.filter((x): x is Printer => x.kind === 'printer');
  const atTables = points.filter((p) => p.settings.placement !== 'counter').length;
  const atCounter = points.length - atTables;
  return (
    <>
      <Cell
        label="Points"
        det={points.length ? `${points.length} · ${atTables} at tables, ${atCounter} at the counter` : '—'}
        foot={
          <FootLine det="A Point at a table shows its table’s bill. The counter one shows whatever you send it.">
            <Btn onClick={onAddPoint}>Add a Point</Btn>
          </FootLine>
        }
      >
        <Main>
          {points.length ? (
            <Rows link>
              {points.map((p) => (
                <DevRow key={p.id} icon={p.model === 'point_large' ? <IconPointLarge /> : <IconPoint />} name={p.name} det={pointDet(p, d.billCents)} chip={pointChip(p)} onTap={() => onOpen(p.id)} />
              ))}
            </Rows>
          ) : (
            <p className="c-det">No Points yet.</p>
          )}
        </Main>
      </Cell>
      <Cell label="Card readers" det={d.cardsConnected ? 'Card payments connected' : 'Card payments not connected'}>
        <Main>
          <Rows link>
            {/* The M2 inside a Pay case is its Point's: it shows on that Point's pane. */}
            {d.readers
              .filter((r) => !points.some((p) => p.settings.readerId === r.id))
              .map((r) => (
                <DevRow
                  key={r.id}
                  icon={r.type === 'tap_to_pay' ? <IconTabletDev /> : <IconReader />}
                  name={r.label}
                  det={r.type === 'tap_to_pay' ? 'The backup if the M2 is flat' : r.type === 'smart' ? 'Smart reader · on the shop’s network' : 'Stripe Reader M2 in its dock'}
                  chip={r.type === 'tap_to_pay' ? { tone: 'neutral', text: 'Ready' } : { tone: 'settled', dot: true, text: 'Connected' }}
                />
              ))}
          </Rows>
        </Main>
      </Cell>
      <Cell label="Cash drawer" det={drawers.length ? 'Opens on a cash sale' : '—'}>
        <Main>
          {drawers.length ? (
            <Rows link>
              {drawers.map((x) => (
                <DevRow
                  key={x.id}
                  icon={<IconDrawer />}
                  name={x.name}
                  det={`${x.settings.cabledToPrinter ? 'cabled to the printer' : `${(x.settings.bluetoothId ?? '').replace(/:/g, '').slice(-4)} · paired to this tablet`} · ${x.status.open ? 'open' : 'shut'}`}
                  chip={x.status.open ? { tone: 'underway', dot: true, text: 'Open' } : { tone: 'settled', dot: true, text: 'Shut' }}
                  onTap={() => onOpen(x.id)}
                />
              ))}
            </Rows>
          ) : (
            <p className="c-det">No drawer paired.</p>
          )}
        </Main>
      </Cell>
      <Cell label="Printers" det={String(printers.length)}>
        <Main>
          {printers.length ? (
            <Rows link>
              {printers.map((x) => (
                <DevRow key={x.id} icon={<IconPrinter />} name={x.name} det={printerDet(x)} chip={{ tone: 'settled', dot: true, text: 'Ready' }} onTap={() => onOpen('printers')} />
              ))}
            </Rows>
          ) : (
            <p className="c-det">No printer yet. Receipts use this tablet’s print dialog.</p>
          )}
        </Main>
      </Cell>
      <Cell
        label="This tablet"
        det="Rename it here"
        foot={
          <FootLine det="Points, readers, the drawer and printers all pair from here.">
            <Btn primary onClick={onAdd}>
              Add a device
            </Btn>
          </FootLine>
        }
      >
        <Main>
          <Rows link>
            <DevRow icon={<IconTabletDev />} name={d.tablet.name} det={`${d.tablet.model} · this one`} chip={{ tone: 'settled', dot: true, text: 'This device' }} onTap={onTablet} />
          </Rows>
        </Main>
      </Cell>
    </>
  );
}

// ---- 3 and 13b · A Point's pane --------------------------------------------------------------------------

export interface PointPaneData {
  point: Point;
  shop: string;
  table: TableView | null;
  categories: string[];
  /** Items on the menu, by category, for the showcase preview. */
  menu: Record<string, ShowcaseItem[]>;
  reader: Reader | null;
  /** The reader's battery, when the reader service knows it. */
  readerBattery: number | null;
  /** The table's tab, for the Pay case preview. */
  tab: {
    lines: { qty: number; name: string; cents: number }[];
    taxCents: number;
    totalCents: number;
    sentAt: string;
  } | null;
}

const MODES: { value: PointIdleMode; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'menu', label: 'Menu' },
  { value: 'showcase', label: 'Showcase' },
  { value: 'pay', label: 'Pay here' },
];

const weeksLeft = (pct: number) => Math.max(1, Math.round(pct / 27));
const signal = (rssi: number) => (rssi >= -67 ? 'Good' : rssi >= -75 ? 'Fair' : 'Weak');
const heard = (iso: string, now = Date.now()) => {
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  return m < 2 ? 'Just now' : m < 60 ? `${m} min ago` : new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
};

export function pointPaneDet(p: Point): string {
  if (p.settings.placement === 'counter') return 'The Point at the counter. It shows whatever you send it.';
  if (p.settings.placement === 'door') return 'The Point at the door. It takes names for the wait list.';
  return p.health?.case ? 'A Point at a table, in a Pay case.' : 'A Point at a table. Its bill comes from the table’s tab.';
}

export function PointPane({
  d,
  onChange,
  onTest,
  onUnpair,
  onChangeReader,
  onTestButtons,
}: {
  d: PointPaneData;
  onChange: (patch: Partial<Omit<PointSettings, 'suggestBeforePaying' | 'oneMoreRound'>>) => void;
  onTest: () => void;
  onUnpair: () => void;
  onChangeReader: () => void;
  onTestButtons: () => void;
}) {
  const p = d.point;
  const s = p.settings;
  const tableNo = d.table?.number ?? null;
  const where = d.table ? (d.table.label ?? `Table ${d.table.number}`) : p.name;
  const h = p.health;
  const firstGroup = s.showcaseCategories[0] ?? d.categories[0] ?? null;
  const preview =
    s.idleMode === 'showcase' && firstGroup ? (
      <PointShowcase
        shop={d.shop}
        table={tableNo ?? 0}
        group={firstGroup}
        page={Math.max(1, d.categories.indexOf(firstGroup) + 1)}
        of={Math.max(1, d.categories.length)}
        items={d.menu[firstGroup] ?? []}
      />
    ) : tableNo !== null ? (
      <PointNumber table={tableNo} shop={d.shop} code={p.code} />
    ) : null;
  return (
    <>
      <Cell
        label="Showing"
        det={where}
        foot={
          <FootLine det="Prices come from Inventory. Change one there and the Point follows.">
            <Btn onClick={onTest}>Show a test screen</Btn>
          </FootLine>
        }
      >
        <Main>
          <div className="c-tm-split">
            <div>
              <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
                {s.placement === 'door' ? 'When nobody is waiting' : s.placement === 'counter' ? 'When nothing is sent' : 'When the table is free'}
              </p>
              {s.placement === 'door' ? (
                <p className="c-det">The wait list: names, and how long.</p>
              ) : (
                <Segmented kind="sheet" className="c-tm-seg" label="When the table is free" value={s.idleMode} options={MODES} onChange={(v) => onChange({ idleMode: v })} />
              )}
              {s.idleMode === 'showcase' && (
                <>
                  <p className="c-label c-st-fl">Showcase these</p>
                  <div className="c-st-chips">
                    {d.categories.map((c) => {
                      const on = s.showcaseCategories.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          className={cx('c-btn', on && 'c-on')}
                          aria-pressed={on}
                          onClick={() =>
                            onChange({
                              showcaseCategories: on ? s.showcaseCategories.filter((x) => x !== c) : [...s.showcaseCategories, c],
                            })
                          }
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {s.placement !== 'door' && (
                <Rows style={{ marginTop: 'var(--s2)' }}>
                  {s.idleMode === 'showcase' && (
                    <R2 t="Mix them up" det="A random few from those groups, every few minutes" end={<Tg on={s.mixUp} label="Mix them up" onChange={(v) => onChange({ mixUp: v })} />} />
                  )}
                  <R2 t="By time of day" det="Menu at lunch, Pay here after 9pm" end={<Tg on={s.byTimeOfDay} label="By time of day" onChange={(v) => onChange({ byTimeOfDay: v })} />} />
                </Rows>
              )}
            </div>
            {preview && (
              <div className="c-tm-mini" style={{ width: 240 }}>
                {preview}
              </div>
            )}
          </div>
        </Main>
      </Cell>
      {h?.case && (
        <PayCaseCell
          where={where}
          ok={h.case.buttons === 'ok'}
          reader={d.reader}
          readerBattery={d.readerBattery}
          buttons={s.buttons}
          preview={
            tableNo !== null && d.tab ? <PointBill shop={d.shop} table={tableNo} lines={d.tab.lines} taxCents={d.tab.taxCents} totalCents={d.tab.totalCents} sentAt={d.tab.sentAt} reader /> : null
          }
          onCall={(v) => onChange({ buttons: { ...s.buttons, call: v } })}
          onBill={(v) => onChange({ buttons: { ...s.buttons, bill: v } })}
          onChangeReader={onChangeReader}
          onTest={onTestButtons}
        />
      )}
      <Cell label="Selling more" det={<Chip tone="neutral">Coming later</Chip>}>
        <Main>
          <Rows>
            <R2 off t="Suggest one thing before paying" det="Coming later: needs ordering from the phone" end={<Tg on={false} label="Suggest one thing before paying" />} />
            <R2 off t="One more round" det="Coming later: drinks and dessert after a table pays" end={<Tg on={false} label="One more round" />} />
          </Rows>
        </Main>
      </Cell>
      <Cell
        label="Health"
        det={`Point ${p.code}`}
        foot={
          <FootLine det="Unpairing wipes its Wi‑Fi and it goes back to its setup screen.">
            <button type="button" className="c-btn c-btn-danger" onClick={onUnpair}>
              Unpair
            </button>
          </FootLine>
        }
      >
        <Main>
          <Rows>
            <Kv k="Battery" v={!h ? '—' : h.pluggedIn ? 'Plugged in' : `${h.batteryPercent}% · about ${weeksLeft(h.batteryPercent)} week${weeksLeft(h.batteryPercent) === 1 ? '' : 's'} left`} ink />
            <Kv k="Signal" v={h ? `${signal(h.rssi)}${h.ssid ? ` · ${h.ssid}` : ''}` : '—'} ink />
            <Kv k="Last heard from" v={h ? heard(h.lastSeenAt) : 'Not yet'} ink />
            <Kv k="Firmware" v={h ? `${h.firmware} · ${h.firmwareCurrent ? 'up to date' : 'an update is ready'}` : '—'} ink />
          </Rows>
        </Main>
      </Cell>
    </>
  );
}

const BILL_OPTIONS: { value: BillButton; label: string }[] = [
  { value: 'send_bill', label: 'Send the bill to the Point' },
  { value: 'notify', label: 'Just tell staff' },
];

/** 13b: the Pay case — fitted or not, the reader inside, and what its two buttons do. */
function PayCaseCell({
  where,
  ok,
  reader,
  readerBattery,
  buttons,
  preview,
  onCall,
  onBill,
  onChangeReader,
  onTest,
}: {
  where: string;
  ok: boolean;
  reader: Reader | null;
  readerBattery: number | null;
  buttons: PointSettings['buttons'];
  preview: ReactNode;
  onCall: (on: boolean) => void;
  onBill: (v: BillButton) => void;
  onChangeReader: () => void;
  onTest: () => void;
}) {
  return (
    <Cell
      label="Pay case"
      det={where}
      foot={
        <FootLine det={`The reader connects to this tablet when ${where}’s bill is sent here.`}>
          <Btn onClick={onTest}>Test the buttons</Btn>
        </FootLine>
      }
    >
      <Main>
        <div className="c-tm-split">
          <div>
            <Rows>
              <R2
                t="Pay case"
                det={ok ? 'Detected · both buttons working' : 'Detected · a button isn’t answering'}
                end={
                  ok ? (
                    <Chip tone="settled" dot>
                      Fitted
                    </Chip>
                  ) : (
                    <Chip tone="underway" dot>
                      Check it
                    </Chip>
                  )
                }
              />
              <R2
                t="Reader inside"
                det={reader ? `Stripe Reader ${reader.label}${readerBattery !== null ? ` · battery ${readerBattery}%` : ''}` : 'None linked yet'}
                end={<Btn onClick={onChangeReader}>Change</Btn>}
              />
              <R2 t="Call button" det="Pages whoever is on shift; the ring light stays on until answered" end={<Tg on={buttons.call} label="Call button" onChange={onCall} />} />
            </Rows>
            <p className="c-label c-st-fl">Bill button</p>
            <Segmented kind="sheet" className="c-tm-seg" label="Bill button" value={buttons.bill} options={BILL_OPTIONS} onChange={onBill} />
          </div>
          {preview && (
            <div className="c-tm-mini" style={{ width: 240 }}>
              {preview}
            </div>
          )}
        </div>
      </Main>
    </Cell>
  );
}

// ---- 4 · The drawer's pane ------------------------------------------------------------------------------

export function DrawerPane({
  drawer,
  settings,
  tablet,
  onNoSalePin,
  onWho,
  onCabled,
  onTestOpen,
  onUnpair,
}: {
  drawer: Drawer;
  settings: Pick<ShopSettings, 'noSaleNeedsPin' | 'drawerNoSaleRoles'>;
  tablet: string;
  onNoSalePin: (on: boolean) => void;
  onWho: (v: 'managers' | 'anyone') => void;
  onCabled: (on: boolean) => void;
  onTestOpen: () => void;
  onUnpair: () => void;
}) {
  const id = drawer.settings.bluetoothId ? drawer.settings.bluetoothId.replace(/:/g, '').slice(-4) : '';
  const opened = drawer.status.opensToday;
  return (
    <>
      <Cell label="Rules" det="Cash drawer">
        <Main>
          <Rows>
            <R2 t="Opens on a cash sale" det="And when a cash refund is given" end={<span className="c-st-fixed">Always</span>} />
            <R2 t="No sale needs a PIN" det="Plus a reason. It shows at Close the day" end={<Tg on={settings.noSaleNeedsPin !== false} label="No sale needs a PIN" onChange={onNoSalePin} />} />
          </Rows>
          <p className="c-label c-st-fl">Who can open it without a sale</p>
          <Segmented
            kind="sheet"
            className="c-tm-seg"
            label="Who can open it without a sale"
            value={settings.drawerNoSaleRoles ?? 'managers'}
            options={[
              { value: 'managers', label: 'Owners and managers' },
              { value: 'anyone', label: 'Everyone on shift' },
            ]}
            onChange={onWho}
          />
          <Rows style={{ marginTop: 'var(--s2)' }}>
            <R2
              t="Cabled to the printer instead"
              det="For a drawer plugged into a receipt printer"
              end={<Tg on={drawer.settings.cabledToPrinter} label="Cabled to the printer instead" onChange={onCabled} />}
            />
          </Rows>
        </Main>
      </Cell>
      <Cell
        label="This drawer"
        det={
          drawer.status.open ? (
            <Chip tone="underway" dot>
              Open
            </Chip>
          ) : (
            <Chip tone="settled" dot>
              Shut
            </Chip>
          )
        }
        foot={
          <FootLine det="Opening it here is a No sale, and logged.">
            <Pair>
              <Btn onClick={onTestOpen}>Test open</Btn>
              <button type="button" className="c-btn c-btn-danger" onClick={onUnpair}>
                Unpair
              </button>
            </Pair>
          </FootLine>
        }
      >
        <Main>
          <Rows>
            <Kv k="Drawer" v={`${drawer.name}${id ? ` ${id}` : ''}`} ink />
            <Kv k="Paired to" v={drawer.settings.cabledToPrinter ? 'The receipt printer' : tablet} ink />
            <Kv k="Right now" v={`${drawer.status.open ? 'Open' : 'Shut'} · opened ${opened} time${opened === 1 ? '' : 's'} today`} ink />
          </Rows>
        </Main>
      </Cell>
    </>
  );
}

// ---- 4 · Printers -------------------------------------------------------------------------------------------

const ASK: { value: AutoPrint; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' },
];

export function PrintersPane({ printers, onPrints, onTest }: { printers: Printer[]; onPrints: (printerId: string, patch: Partial<Printer['settings']['prints']>) => void; onTest: () => void }) {
  const receipt = printers.find((p) => p.settings.prints.receipt !== null) ?? printers.find((p) => p.settings.paper !== 'label4x3');
  const bag = printers.find((p) => p.settings.prints.bagLabel !== null) ?? receipt;
  const kitchen = printers.find((p) => p.settings.prints.kitchenTicket !== null);
  return (
    <>
      <Cell label="Prints by itself" det={printers.map((p) => p.name).join(' and ') || '—'}>
        <Main>
          <Rows>
            {receipt && (
              <R2
                t="Receipt after a cash sale"
                det={`On the ${receipt.name.toLowerCase()}`}
                end={
                  <Segmented
                    kind="sheet"
                    className="c-tm-seg"
                    label="Receipt after a cash sale"
                    value={receipt.settings.prints.receipt ?? 'never'}
                    options={ASK}
                    onChange={(v) => onPrints(receipt.id, { receipt: v })}
                  />
                }
              />
            )}
            {bag && (
              <R2
                t="Bag label"
                det="For orders marked To go or Delivery"
                end={
                  <Segmented kind="sheet" className="c-tm-seg" label="Bag label" value={bag.settings.prints.bagLabel ?? 'never'} options={ASK} onChange={(v) => onPrints(bag.id, { bagLabel: v })} />
                }
              />
            )}
            {kitchen && (
              <R2
                t="Kitchen ticket"
                det={`On ${kitchen.name}, when an order is sent`}
                end={
                  <Segmented
                    kind="sheet"
                    className="c-tm-seg"
                    label="Kitchen ticket"
                    value={kitchen.settings.prints.kitchenTicket ?? 'never'}
                    options={[
                      { value: 'always', label: 'Always' },
                      { value: 'never', label: 'Never' },
                    ]}
                    onChange={(v) => onPrints(kitchen.id, { kitchenTicket: v })}
                  />
                }
              />
            )}
          </Rows>
        </Main>
      </Cell>
      <Cell
        label="What they look like"
        det="At size, 203 dots an inch"
        foot={
          <FootLine det="Any 4-inch label printer works. Receipt printers get the 80mm receipt.">
            <Btn onClick={onTest}>Print a test label</Btn>
          </FootLine>
        }
      >
        <Main>
          <div className="c-tm-labs">
            <div>
              <p className="c-label">Bag label · 4 × 3</p>
              <BagLabel
                shop={MI_CASA.shop}
                partner="DoorDash"
                order="27"
                name="Ana R."
                items={4}
                bags={2}
                bag={1}
                ready="7:42 PM"
                sealed="7:44 PM"
                lines={[
                  { qty: 2, name: 'Al pastor', note: 'no onion' },
                  { qty: 1, name: 'Nachos grande', note: null },
                  { qty: 1, name: 'Churros', note: 'chocolate on the side' },
                ]}
              />
            </div>
            <div>
              <p className="c-label">Kitchen ticket · 4 × 3</p>
              <KitchenTicket
                where="Table 12"
                service="DINE IN"
                at="7:51 PM"
                ticket={3}
                sentBy="Jen"
                lines={[
                  { qty: 2, name: 'Al pastor', note: 'no onion' },
                  { qty: 1, name: 'Carne asada', note: null },
                  { qty: 1, name: 'Churros', note: 'choc on side' },
                ]}
              />
            </div>
          </div>
        </Main>
      </Cell>
    </>
  );
}

// ---- 2 · Add a device ---------------------------------------------------------------------------------------

export type AddKind = 'point' | 'reader' | 'drawer' | 'printer';

const KINDS: { kind: AddKind; t: string; det: string }[] = [
  {
    kind: 'point',
    t: 'Clear Point',
    det: 'A screen for a table, the counter or the door',
  },
  {
    kind: 'reader',
    t: 'Card reader',
    det: 'Stripe Reader M2, or Tap to Pay on this tablet',
  },
  {
    kind: 'drawer',
    t: 'Cash drawer',
    det: 'Clear Drawer, or a drawer cabled to your printer',
  },
  {
    kind: 'printer',
    t: 'Printer',
    det: 'Any 4-inch label printer or receipt printer',
  },
];

export function AddDeviceKindSheet({ onPick, onClose }: { onPick: (k: AddKind) => void; onClose: () => void }) {
  return (
    <Sheet className="c-st-sheet c-tm-sheet" title="Add a device" onClose={onClose} foot={<p className="c-det">Signing in another tablet is in Security.</p>}>
      <Rows link>
        {KINDS.map((k) => (
          <div key={k.kind}>
            <div className="c-r2" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onPick(k.kind)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(k.kind)}>
              <div>
                <p className="c-t">{k.t}</p>
                <p className="c-det">{k.det}</p>
              </div>
              <span className="c-end">
                <IconGo />
              </span>
            </div>
          </div>
        ))}
      </Rows>
    </Sheet>
  );
}

/** The step sheets' head: back, the title, close. */
function StepHead({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose: () => void }) {
  return (
    <div className="c-line" style={{ alignItems: 'center' }}>
      {onBack && (
        <button type="button" className="c-mclose" aria-label="Back" onClick={onBack}>
          <IconBack />
        </button>
      )}
      <span className="c-mtitle">{title}</span>
      <button type="button" className="c-mclose" aria-label="Close" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

export type PointStep =
  | { step: 'scan' }
  | { step: 'type'; code: string }
  | {
      step: 'wifi';
      code: string;
      found: { firmware: string; battery: number };
      networks: { ssid: string; det: string; usable: boolean }[];
      ssid: string | null;
      password: string;
    }
  | {
      step: 'place';
      code: string;
      placement: 'counter' | 'table' | 'door';
      table: string;
    };

/** Add a Point, in three steps: scan, Wi‑Fi over Bluetooth, name and place (section 2). */
export function AddPointSheet({
  state,
  shop,
  busy,
  error,
  scanner,
  onBack,
  onClose,
  onType,
  onTyped,
  onCode,
  onWifi,
  onConnect,
  onPlace,
  onDone,
}: {
  state: PointStep;
  shop: string;
  busy?: boolean;
  error?: string | null;
  /** The camera, when it can show one. */
  scanner?: ReactNode;
  onBack?: () => void;
  onClose: () => void;
  onType: () => void;
  /** A code typed so far. */
  onTyped: (code: string) => void;
  /** A whole code, scanned or typed: find that Point. */
  onCode: (code: string) => void;
  onWifi: (patch: { ssid?: string; password?: string }) => void;
  onConnect: () => void;
  onPlace: (patch: { placement?: 'counter' | 'table' | 'door'; table?: string }) => void;
  onDone: () => void;
}) {
  const head = <StepHead title="Add a Point" onBack={onBack} onClose={onClose} />;
  const err = error ? (
    <p className="c-det" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
      {error}
    </p>
  ) : null;
  if (state.step === 'scan' || state.step === 'type') {
    return (
      <Sheet
        className="c-st-sheet c-tm-sheet"
        head={head}
        onClose={onClose}
        label="Add a Point"
        foot={
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">Step 1 of 3 · Scan</p>
            {state.step === 'scan' ? (
              <Btn onClick={onType}>Type it instead</Btn>
            ) : (
              <Btn primary disabled={busy || state.code.length !== 4} onClick={() => onCode(state.code)}>
                Next
              </Btn>
            )}
          </div>
        }
      >
        {state.step === 'scan' ? (
          (scanner ?? (
            <div className="c-tm-vf">
              <div className="c-tm-vfbox" />
              <p>Point the camera at the code on the back of the Point</p>
            </div>
          ))
        ) : (
          <input
            className="c-field c-st-in"
            aria-label="The four letters under the code"
            autoFocus
            maxLength={4}
            value={state.code}
            onChange={(e) => onTyped(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
            style={{ textTransform: 'uppercase', letterSpacing: '.2em' }}
          />
        )}
        <p className="c-det" style={{ marginTop: 'var(--s2)' }}>
          Or type the four letters under the code: <b>A7K2</b>
        </p>
        {err}
      </Sheet>
    );
  }
  if (state.step === 'wifi') {
    return (
      <Sheet
        className="c-st-sheet c-tm-sheet"
        head={head}
        onClose={onClose}
        label="Add a Point"
        foot={
          <div className="c-line" style={{ alignItems: 'center' }}>
            <p className="c-det">Step 2 of 3 · Sent over Bluetooth, never shown on the Point</p>
            <Btn primary disabled={busy || !state.ssid || !state.password} onClick={onConnect}>
              Connect
            </Btn>
          </div>
        }
      >
        <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
          Found it
        </p>
        <DevRow icon={<IconPoint />} name={`Point ${state.code}`} det={`New · firmware ${state.found.firmware} · battery ${state.found.battery}%`} chip={{ tone: 'neutral', text: 'Nearby' }} />
        <p className="c-label c-st-fl">Its Wi‑Fi</p>
        <Rows link>
          {state.networks.map((n) => (
            <div key={n.ssid}>
              <div
                className={cx('c-r2', !n.usable && 'c-st-off')}
                role={n.usable ? 'button' : undefined}
                tabIndex={n.usable ? 0 : undefined}
                onClick={() => n.usable && onWifi({ ssid: n.ssid })}
                style={{ cursor: n.usable ? 'pointer' : undefined }}
              >
                <div>
                  <p className="c-t">{n.ssid}</p>
                  <p className="c-det">{n.det}</p>
                </div>
                <span className="c-end">{n.usable ? <Chip tone={state.ssid === n.ssid ? 'settled' : 'neutral'}>Use this</Chip> : <span className="c-det">Won’t work</span>}</span>
              </div>
            </div>
          ))}
        </Rows>
        <p className="c-label c-st-fl">Password</p>
        <input className="c-field c-st-in" type="password" aria-label="Password" value={state.password} onChange={(e) => onWifi({ password: e.target.value })} />
        {err}
      </Sheet>
    );
  }
  const table = Number(state.table);
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet"
      head={head}
      onClose={onClose}
      label="Add a Point"
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">Step 3 of 3</p>
          <Btn primary disabled={busy || (state.placement === 'table' && !table)} onClick={onDone}>
            Done
          </Btn>
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        Where it goes
      </p>
      <Segmented
        kind="sheet"
        className="c-tm-seg"
        label="Where it goes"
        value={state.placement}
        options={[
          { value: 'counter', label: 'Counter' },
          { value: 'table', label: 'Table' },
          { value: 'door', label: 'Door' },
        ]}
        onChange={(v) => onPlace({ placement: v })}
      />
      {state.placement === 'table' && (
        <>
          <p className="c-label c-st-fl">Table</p>
          <input className="c-field c-st-in" inputMode="numeric" aria-label="Table" value={state.table} onChange={(e) => onPlace({ table: e.target.value.replace(/\D/g, '') })} />
        </>
      )}
      <p className="c-label c-st-fl">It will show</p>
      {state.placement === 'table' && table ? (
        <>
          <div className="c-tm-mini" style={{ width: 250 }}>
            <PointNumber table={table} shop={shop} code={state.code} />
          </div>
          <p className="c-det" style={{ marginTop: 'var(--s1)' }}>
            Its number and the menu code when the table is free, and Table {table}’s bills. Change that on its pane.
          </p>
        </>
      ) : (
        <p className="c-det">{state.placement === 'door' ? 'The wait list, and Table ready when a table is.' : 'Pay here, and whatever you send it.'}</p>
      )}
      {err}
    </Sheet>
  );
}

/** Adding a drawer or a printer: find it, then test it (not drawn; the Point's steps, in two). */
export function FindSheet({
  kind,
  found,
  picked,
  busy,
  error,
  tested,
  onPick,
  onTest,
  onDone,
  onBack,
  onClose,
}: {
  kind: 'drawer' | 'printer';
  found: { id: string; t: string; det: string }[] | null;
  picked: string | null;
  busy?: boolean;
  error?: string | null;
  tested: boolean;
  onPick: (id: string) => void;
  onTest: () => void;
  onDone: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const title = kind === 'drawer' ? 'Add a cash drawer' : 'Add a printer';
  return (
    <Sheet
      className="c-st-sheet c-tm-sheet"
      head={<StepHead title={title} onBack={onBack} onClose={onClose} />}
      onClose={onClose}
      label={title}
      foot={
        <div className="c-line" style={{ alignItems: 'center' }}>
          <p className="c-det">{kind === 'drawer' ? 'Step 2 of 2 · Test open' : 'Step 2 of 2 · Print a test label'}</p>
          {tested ? (
            <Btn primary disabled={busy} onClick={onDone}>
              Done
            </Btn>
          ) : (
            <Btn disabled={busy || !picked} onClick={onTest}>
              {kind === 'drawer' ? 'Test open' : 'Print a test label'}
            </Btn>
          )}
        </div>
      }
    >
      <p className="c-label c-st-fl" style={{ marginTop: 0 }}>
        {found === null ? 'Looking…' : found.length ? 'Found' : 'Nothing nearby'}
      </p>
      {found && (
        <Rows link>
          {found.map((f) => (
            <div key={f.id}>
              <div className="c-r2" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onPick(f.id)}>
                <div>
                  <p className="c-t">{f.t}</p>
                  <p className="c-det">{f.det}</p>
                </div>
                <span className="c-end">{picked === f.id ? <Chip tone="settled">Use this</Chip> : <Chip tone="neutral">Nearby</Chip>}</span>
              </div>
            </div>
          ))}
        </Rows>
      )}
      {error && (
        <p className="c-det" style={{ color: 'var(--absent)', marginTop: 'var(--s1)' }}>
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** "Change" on a Pay case: the shop's M2s, one reader to one Point. */
export function ReaderPickSheet({
  readers,
  linked,
  onPick,
  onClose,
}: {
  readers: { id: string; t: string; det: string; taken: boolean }[];
  linked: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet className="c-st-sheet c-tm-sheet" title="Reader inside" onClose={onClose} foot={<p className="c-det">One reader links to one Point.</p>}>
      <Rows link>
        {readers.map((r) => (
          <div key={r.id}>
            <div
              className={cx('c-r2', r.taken && 'c-st-off')}
              role={r.taken ? undefined : 'button'}
              tabIndex={r.taken ? undefined : 0}
              style={{ cursor: r.taken ? undefined : 'pointer' }}
              onClick={() => !r.taken && onPick(r.id)}
            >
              <div>
                <p className="c-t">{r.t}</p>
                <p className="c-det">{r.det}</p>
              </div>
              <span className="c-end">{linked === r.id ? <Chip tone="settled">Linked</Chip> : r.taken ? <span className="c-det">On another Point</span> : null}</span>
            </div>
          </div>
        ))}
      </Rows>
    </Sheet>
  );
}

export { usd };
