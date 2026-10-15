import { useState, type ReactNode } from 'react';
import type { Device, DrawerSettings, PrinterSettings } from '@clear/merchant-contracts';
import { useAuth } from '@/auth/authContext';
import { PaneHead } from '@/settings/views';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { drawerService } from '@/hardware/drawer';
import { pointService } from '@/hardware/point';
import { printerService } from '@/hardware/printer';
import { AddDeviceKindSheet, AddPointSheet, DevicesList, DrawerPane, FindSheet, PointPane, pointPaneDet, PrintersPane, ReaderPickSheet, type AddKind, type PointStep } from './devices';
import { NoSaleSheet, noSalePin, runNoSale } from './noSale';
import { MI_CASA, miCasa, TAB_12 } from './reference';

/**
 * Settings › Devices for the settings page: the list, or one device's pane, with the sheets that add
 * and pair them. Its head (title, line, back) changes with the pane, so it hands the page all three.
 * It reads the shop's devices from the API in the preview too: the mock holds the reference's.
 */

type Point = Extract<Device, { kind: 'point' }>;
type Drawer = Extract<Device, { kind: 'drawer' }>;
type Printer = Extract<Device, { kind: 'printer' }>;
type Open = { kind: 'add' } | { kind: 'point'; s: PointStep } | { kind: 'find'; what: 'drawer' | 'printer' } | { kind: 'reader'; pointId: string } | { kind: 'nosale'; drawerId: string } | null;

function previewSheet(preview: boolean, sub: string | undefined): Open {
  if (!preview || typeof window === 'undefined') return null;
  const screen = new URLSearchParams(window.location.search).get('screen');
  const wifi = MI_CASA.wifi.map((w) => ({
    ssid: w.ssid,
    det: w.det,
    usable: w.ok,
  }));
  switch (screen) {
    case 'add':
      return { kind: 'add' };
    case 'add-point':
      return { kind: 'point', s: { step: 'scan' } };
    case 'add-point-wifi':
      return {
        kind: 'point',
        s: {
          step: 'wifi',
          code: 'A7K2',
          found: { firmware: '1.0.3', battery: 100 },
          networks: wifi,
          ssid: 'MiCasa-Staff',
          password: 'tacos-2026',
        },
      };
    case 'add-point-place':
      return {
        kind: 'point',
        s: { step: 'place', code: 'A7K2', placement: 'table', table: '12' },
      };
    case 'nosale':
      return { kind: 'nosale', drawerId: 'hw_drawer' };
    case 'reader':
      return sub ? { kind: 'reader', pointId: sub } : null;
    default:
      return null;
  }
}

export interface DevicesPane {
  title: string;
  det: string;
  /** Back to the list, from a device's pane. */
  back: (() => void) | null;
  body: ReactNode;
  sheets: ReactNode;
}

export function useDevicesPane({
  sub,
  preview,
  navigate,
  q,
  onRenameTablet,
}: {
  sub: string | undefined;
  preview: boolean;
  navigate: (to: string) => void;
  q: string;
  onRenameTablet?: () => void;
}): DevicesPane {
  const api = useMerchantApi();
  const { session, device } = useAuth();
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  const hw = useApi(() => api.hardware(), [nonce]);
  const readers = useApi(() => api.readers(), [nonce]);
  const cards = useApi(() => api.cardAvailability(), []);
  const settings = useApi(() => api.settings(), [nonce]);
  const floor = useApi(() => (settings.data?.tableService ? api.floor() : Promise.resolve(null)), [settings.data?.tableService, nonce]);
  const catalog = useApi(() => api.catalog(), []);
  const order = useApi(() => api.categoryOrder(), []);
  const staff = useApi(() => api.staff(), []);
  const orders = useApi(() => api.orders({ date: new Date().toISOString().slice(0, 10) }), [nonce]);
  // The preview opens a sheet by name (`&screen=`), so every step of section 2 is a link.
  const [open, setOpen] = useState<Open>(() => previewSheet(preview, sub));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ id: string; t: string; det: string; raw: unknown }[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [tested, setTested] = useState(false);

  const shop = miCasa() ? MI_CASA.shop : 'Your shop';
  const devices = hw.data ?? [];
  const tablet = {
    name: device?.label ?? 'Counter tablet',
    model: miCasa() ? 'Clear Counter Large' : 'This tablet',
  };
  const billCents = (orderId: string) => orders.data?.find((o) => o.id === orderId)?.totalCents ?? floor.data?.tables.find((t) => t.orderId === orderId)?.tabCents ?? null;
  const go = (id: string) => navigate(`/settings/devices/${id}${q}`);
  const toList = () => navigate(`/settings/devices${q}`);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      reload();
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : errorSentence(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setOpen(null);
    setError(null);
    setFound(null);
    setPicked(null);
    setTested(false);
  };

  // ---- The pane ----------------------------------------------------------------------------------
  const target = sub && sub !== 'printers' ? devices.find((x) => x.id === sub) : undefined;
  let title = 'Devices';
  let det = 'Everything on the counter and the tables, and what each is doing now.';
  let body: ReactNode = null;
  if (sub === 'printers') {
    title = 'Printers';
    det = 'What prints where, and what it looks like.';
    body = (
      <PrintersPane
        printers={devices.filter((x): x is Printer => x.kind === 'printer')}
        onPrints={(id, patch) => {
          const p = devices.find((x): x is Printer => x.id === id && x.kind === 'printer');
          if (p)
            void run(() =>
              api.updateDevice(id, {
                printer: { prints: { ...p.settings.prints, ...patch } },
              }),
            );
        }}
        onTest={() => {
          const p = devices.find((x): x is Printer => x.kind === 'printer');
          if (p) void run(() => printerService({ preview }).print({ kind: 'test', shop, printer: p.name }, p.settings));
        }}
      />
    );
  } else if (target?.kind === 'point') {
    const p = target as Point;
    const table = floor.data?.tables.find((t) => t.id === p.settings.tableId) ?? null;
    const items = catalog.data ?? [];
    const cats = [...new Set(items.filter((i) => i.onMenu !== false && !i.archivedAt).map((i) => i.category))];
    const ordered = [...(order.data?.names ?? []).filter((c) => cats.includes(c)), ...cats.filter((c) => !(order.data?.names ?? []).includes(c)).sort()];
    // Inventory's categories, and the reference's Specials that it draws before there are any.
    const categories = miCasa() ? [...ordered, ...['Specials'].filter((c) => !ordered.includes(c))] : ordered;
    const menu = Object.fromEntries(
      categories.map((c) => [
        c,
        items
          .filter((i) => i.category === c && i.onMenu !== false)
          .map((i) => ({
            name: i.name,
            detail: i.detail,
            cents: i.priceCents,
          })),
      ]),
    );
    const tabOrder = table?.orderId ? orders.data?.find((o) => o.id === table.orderId) : undefined;
    title = p.name;
    det = pointPaneDet(p);
    body = (
      <PointPane
        d={{
          point: p,
          shop,
          table,
          categories,
          menu,
          reader: readers.data?.find((r) => r.id === p.settings.readerId) ?? null,
          readerBattery: miCasa() && p.settings.readerId ? 64 : null,
          tab: tabOrder
            ? {
                lines: tabOrder.lines.map((l) => ({
                  qty: l.quantity,
                  name: l.name,
                  cents: l.lineCents,
                })),
                taxCents: tabOrder.taxCents,
                totalCents: tabOrder.totalCents,
                sentAt: miCasa() ? TAB_12.sentAt : '',
              }
            : null,
        }}
        onChange={(patch) => void run(() => api.updateDevice(p.id, { point: patch }))}
        onTest={() => void run(() => api.showOnPoint(p.id, { kind: 'test' }))}
        onUnpair={() => void run(() => api.removeDevice(p.id), toList)}
        onChangeReader={() => setOpen({ kind: 'reader', pointId: p.id })}
        onTestButtons={() => void run(() => api.showOnPoint(p.id, { kind: 'test' }))}
      />
    );
  } else if (target?.kind === 'drawer') {
    const d = target as Drawer;
    title = 'Cash drawer';
    det = 'When it opens, and who can open it without a sale.';
    body = (
      <DrawerPane
        drawer={d}
        settings={
          settings.data ?? {
            noSaleNeedsPin: true,
            drawerNoSaleRoles: 'managers',
          }
        }
        tablet={tablet.name}
        onNoSalePin={(v) => void run(() => api.updateSettings({ noSaleNeedsPin: v }))}
        onWho={(v) => void run(() => api.updateSettings({ drawerNoSaleRoles: v }))}
        onCabled={(v) =>
          void run(() =>
            api.updateDevice(d.id, {
              drawer: {
                cabledToPrinter: v,
                printerId: v ? (devices.find((x) => x.kind === 'printer')?.id ?? null) : null,
              },
            }),
          )
        }
        onTestOpen={() => setOpen({ kind: 'nosale', drawerId: d.id })}
        onUnpair={() => void run(() => api.removeDevice(d.id), toList)}
      />
    );
  } else {
    body = (
      <DevicesList
        d={{
          devices,
          readers: readers.data ?? [],
          tablet,
          cardsConnected: cards.data?.available ?? false,
          billCents,
        }}
        onOpen={go}
        onAddPoint={() => setOpen({ kind: 'point', s: { step: 'scan' } })}
        onAdd={() => setOpen({ kind: 'add' })}
        onTablet={onRenameTablet}
      />
    );
  }

  // ---- The sheets --------------------------------------------------------------------------------
  const points = pointService({ preview });
  const pick = (k: AddKind) => {
    setError(null);
    if (k === 'point') return setOpen({ kind: 'point', s: { step: 'scan' } });
    // A reader keeps the pairing it already has (section 2).
    if (k === 'reader') return (close(), navigate(`/settings/payments${q}`));
    setOpen({ kind: 'find', what: k });
    setFound(null);
    if (k === 'drawer') {
      void drawerService({ preview })
        .pair()
        .then(
          (d) =>
            setFound([
              {
                id: d.bluetoothId,
                t: d.name,
                det: `${d.bluetoothId.replace(/:/g, '').slice(-4)} · nearby`,
                raw: d,
              },
            ]),
          (e) => (setFound([]), setError(e instanceof Error ? e.message : 'No drawer found')),
        );
    } else {
      void printerService({ preview })
        .discover()
        .then(
          (list) =>
            setFound(
              list.map((p, i) => ({
                id: String(i),
                t: p.model,
                det: `${p.connection === 'wifi' ? 'Wi‑Fi' : p.connection === 'bluetooth' ? 'Bluetooth' : 'The print dialog'}${p.address ? ` · ${p.address}` : ''}`,
                raw: p,
              })),
            ),
          (e) => (setFound([]), setError(e instanceof Error ? e.message : 'No printer found')),
        );
    }
  };
  const pointSheet = (s: PointStep) => (
    <AddPointSheet
      state={s}
      shop={shop}
      busy={busy}
      error={error}
      onBack={s.step === 'scan' ? () => setOpen({ kind: 'add' }) : s.step === 'type' ? () => setOpen({ kind: 'point', s: { step: 'scan' } }) : undefined}
      onClose={close}
      onType={() => setOpen({ kind: 'point', s: { step: 'type', code: '' } })}
      onTyped={(code) => setOpen({ kind: 'point', s: { step: 'type', code } })}
      onCode={(code) =>
        void run(async () => {
          const found = await points.find(code);
          const networks = await points.networks(code);
          setOpen({
            kind: 'point',
            s: {
              step: 'wifi',
              code,
              found,
              networks,
              ssid: networks.find((n) => n.usable)?.ssid ?? null,
              password: '',
            },
          });
        })
      }
      onWifi={(patch) => s.step === 'wifi' && setOpen({ kind: 'point', s: { ...s, ...patch } })}
      onConnect={() =>
        s.step === 'wifi' &&
        void run(async () => {
          const claimed = await api.claimPoint({ code: s.code });
          await points.provision(s.code, {
            ssid: s.ssid!,
            password: s.password,
            claimed,
          });
          setOpen({
            kind: 'point',
            s: { step: 'place', code: s.code, placement: 'table', table: '' },
          });
        })
      }
      onPlace={(patch) => s.step === 'place' && setOpen({ kind: 'point', s: { ...s, ...patch } })}
      onDone={() =>
        s.step === 'place' &&
        void run(async () => {
          const p = (await api.hardware()).find((x) => x.kind === 'point' && x.code === s.code);
          if (!p) throw new Error('That Point isn’t paired');
          const tables = s.placement === 'table' ? (await api.floor()).tables : [];
          const t = tables.find((x) => x.number === Number(s.table));
          if (s.placement === 'table' && !t) throw new Error(`There’s no table ${s.table}. Add it in Tables › Edit tables first`);
          await api.updateDevice(p.id, {
            name: s.placement === 'table' ? `Table ${s.table}` : s.placement === 'door' ? 'Door' : 'Counter',
            point: { placement: s.placement, tableId: t?.id ?? null },
          });
        }, close)
      }
    />
  );

  const sheets = (
    <>
      {open?.kind === 'add' && <AddDeviceKindSheet onPick={pick} onClose={close} />}
      {open?.kind === 'point' && pointSheet(open.s)}
      {open?.kind === 'find' && (
        <FindSheet
          kind={open.what}
          found={found}
          picked={picked}
          busy={busy}
          error={error}
          tested={tested}
          onPick={setPicked}
          onBack={() => setOpen({ kind: 'add' })}
          onClose={close}
          onTest={() =>
            void run(async () => {
              const f = found?.find((x) => x.id === picked);
              if (!f) return;
              if (open.what === 'drawer') await drawerService({ preview }).open('test');
              else {
                const p = f.raw as {
                  address: string | null;
                  connection: PrinterSettings['connection'];
                  model: string;
                };
                await printerService({ preview }).print(
                  { kind: 'test', shop, printer: p.model },
                  {
                    connection: p.connection,
                    address: p.address,
                    language: p.connection === 'os' ? 'os' : 'tspl',
                    paper: 'label4x6',
                    prints: {
                      receipt: 'ask',
                      bagLabel: null,
                      kitchenTicket: null,
                    },
                  },
                );
              }
              setTested(true);
            })
          }
          onDone={() =>
            void run(async () => {
              const f = found?.find((x) => x.id === picked);
              if (!f) return;
              if (open.what === 'drawer') {
                const d = f.raw as { bluetoothId: string; name: string };
                const settings: DrawerSettings = {
                  bluetoothId: d.bluetoothId,
                  pairedTabletId: device?.id ?? null,
                  cabledToPrinter: false,
                  printerId: null,
                };
                await api.addDevice({ kind: 'drawer', name: d.name, settings });
              } else {
                const p = f.raw as {
                  address: string | null;
                  connection: PrinterSettings['connection'];
                  model: string;
                };
                await api.addDevice({
                  kind: 'printer',
                  name: devices.some((x) => x.kind === 'printer') ? p.model : 'Counter printer',
                  settings: {
                    connection: p.connection,
                    address: p.address,
                    language: p.connection === 'os' ? 'os' : 'tspl',
                    paper: p.connection === 'os' ? 'receipt80' : 'label4x6',
                    prints: {
                      receipt: 'ask',
                      bagLabel: null,
                      kitchenTicket: null,
                    },
                  },
                });
              }
            }, close)
          }
        />
      )}
      {open?.kind === 'reader' && (
        <ReaderPickSheet
          readers={(readers.data ?? [])
            .filter((r) => r.type === 'm2')
            .map((r) => ({
              id: r.id,
              t: r.label,
              det: 'Stripe Reader M2',
              taken: devices.some((x) => x.kind === 'point' && x.id !== open.pointId && x.settings.readerId === r.id),
            }))}
          linked={(devices.find((x) => x.id === open.pointId) as Point | undefined)?.settings.readerId ?? null}
          onPick={(id) => void run(() => api.updateDevice(open.pointId, { point: { readerId: id } }), close)}
          onClose={close}
        />
      )}
      {open?.kind === 'nosale' && (
        <NoSaleSheet
          asker={(session?.staff.name ?? '').split(' ')[0] ?? ''}
          approvers={(staff.data ?? []).filter((x) => x.role !== 'counter' && x.active).map((x) => x.name)}
          pinFrom={noSalePin(settings.data ?? {}, session?.staff.role ?? 'counter')}
          busy={busy}
          error={error}
          onClose={close}
          onOpen={(input) =>
            void run(
              () =>
                runNoSale(api, {
                  drawerId: open.drawerId,
                  staffId: session?.staff.id ?? '',
                  preview,
                  ...input,
                }),
              close,
            )
          }
        />
      )}
    </>
  );

  return { title, det, back: sub ? toList : null, body, sheets };
}

/** The Devices section of Settings: its head, its pane and its sheets. */
export function DevicesSection(props: { sub: string | undefined; preview: boolean; navigate: (to: string) => void; q: string; phone: boolean; one: boolean; onRenameTablet?: () => void }) {
  const pane = useDevicesPane(props);
  const back = pane.back ?? (props.one ? () => props.navigate(`/settings${props.q}`) : undefined);
  return (
    <>
      <PaneHead title={pane.title} det={pane.det} back={back} small={props.phone} />
      <div className="c-panebody">{pane.body}</div>
      {pane.sheets}
    </>
  );
}
