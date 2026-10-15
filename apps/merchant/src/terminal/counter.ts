import { useEffect, useRef, useState } from 'react';
import type { Device, MerchantApi, Order, Receipt } from '@clear/merchant-contracts';
import { useMerchantApi } from '@/data/merchantApi';
import { useApi } from '@/data/useApi';
import { drawerService, setDrawerKick, DRAWER_ANSWER_MS, type DrawerTarget } from '@/hardware/drawer';
import { indexedDbStore, syncQueue } from '@/hardware/queue';
import { printerService } from '@/hardware/printer';
import { logDrawer } from './noSale';

/**
 * The counter's hardware for a sale (terminal reference, section 5): the drawer, which opens on a
 * cash sale and says whether it did; the printers, by what prints by itself; and the queue that
 * catches up when the connection is back. A sale never waits on any of it.
 */

type Point = Extract<Device, { kind: 'point' }>;
type Drawer = Extract<Device, { kind: 'drawer' }>;
type Printer = Extract<Device, { kind: 'printer' }>;

export type DrawerState = 'none' | 'opening' | 'open' | 'stuck';

export interface PrintRow {
  t: string;
  det: string;
  state: 'printing' | 'printed' | 'failed';
}

const PAPER = {
  label4x6: '4 × 6',
  label4x3: '4 × 3',
  receipt80: '80mm',
} as const;

export const drawerTargetOf = (d: Drawer): DrawerTarget => ({
  id: d.id,
  bluetoothId: d.settings.bluetoothId,
  cabledToPrinter: d.settings.cabledToPrinter,
  printerId: d.settings.printerId,
});

/**
 * Which drawer this tablet opens, and its key kept while online (terminal reference, the one rule:
 * the tablet opens it with or without a connection). Mounted by the shell, so No sale and every
 * sale find it. A drawer cabled to a printer opens with the printer's pulse.
 */
export function useDrawerSetup(input: { api: Pick<MerchantApi, 'drawerKey' | 'saveDrawerEvents'>; devices: Device[] | null; preview: boolean; staffId: string | null }) {
  const drawer = input.devices?.find((d): d is Drawer => d.kind === 'drawer') ?? null;
  const printers = (input.devices ?? []).filter((d): d is Printer => d.kind === 'printer');
  const sig = drawer ? JSON.stringify(drawerTargetOf(drawer)) : '';
  const printerSig = printers.map((p) => `${p.id}:${p.settings.address}`).join(',');
  useEffect(() => {
    if (input.preview) return;
    const svc = drawerService();
    const target = drawer ? drawerTargetOf(drawer) : null;
    svc.use(target);
    setDrawerKick(async (printerId) => {
      const p = printers.find((x) => x.id === printerId);
      if (!p) throw new Error('That printer isn’t set up');
      await printerService().kickDrawer(p.settings);
    });
    if (target && target.bluetoothId && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      input.api
        .drawerKey(target.id)
        .then((k) => svc.rememberKey(target, k.key))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, printerSig, input.preview]);

  // The drawer says when it's pushed shut (docs/hardware/drawer-protocol.md); the log keeps it, so
  // Settings › Devices and Close the day know it's shut. Queued like any drawer event when offline.
  const staffRef = useRef(input.staffId);
  staffRef.current = input.staffId;
  const drawerId = drawer?.id ?? null;
  useEffect(() => {
    if (input.preview || !drawerId) return;
    return drawerService().events((s) => {
      if (s.kind !== 'shut' || !staffRef.current) return;
      void logDrawer(input.api, { kind: 'shut', drawerId, staffId: staffRef.current, at: s.at }).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerId, input.preview]);
}

export function useCounterHardware(opts: { preview: boolean }) {
  const api = useMerchantApi();
  const hw = useApi(() => api.hardware().catch(() => [] as Device[]), []);
  const devices = hw.data ?? [];
  const drawer = devices.find((d): d is Drawer => d.kind === 'drawer') ?? null;
  const printers = devices.filter((d): d is Printer => d.kind === 'printer');
  const points = devices.filter((d): d is Point => d.kind === 'point');
  const stuck = opts.preview && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('drawerHw') === 'stuck';
  const service = drawerService({ preview: opts.preview, stuck });
  return { api, drawer, printers, points, service, reload: hw.reload };
}

/**
 * Open the drawer for a sale and follow what it says: open within two seconds, or stuck. The open is
 * logged against the sale either way; "I used the key" logs a key open.
 */
export function useDrawerForSale(input: { api: MerchantApi; drawer: Drawer | null; service: ReturnType<typeof drawerService>; staffId: string }) {
  const [state, setState] = useState<DrawerState>(input.drawer ? 'opening' : 'none');
  useEffect(() => {
    if (!input.drawer) return;
    let answered = false;
    const stop = input.service.events((s) => {
      if (s.kind === 'opened') {
        answered = true;
        setState('open');
      }
      if (s.kind === 'unreachable') setState('stuck');
    });
    const timer = setTimeout(() => !answered && setState('stuck'), DRAWER_ANSWER_MS);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [input.drawer, input.service]);
  return {
    state,
    /** Open it for this sale: the command, then the log. */
    open: async (orderId: string | null, orderKey?: string | null) => {
      if (!input.drawer) return;
      setState('opening');
      await input.service.open('sale');
      if (input.drawer.settings.cabledToPrinter) setState('open');
      await logDrawer(
        input.api,
        {
          kind: 'opened',
          drawerId: input.drawer.id,
          staffId: input.staffId,
          reason: 'sale',
          orderId: orderKey ? null : orderId,
          noSale: null,
          approvalId: null,
        },
        { orderKey },
      ).catch(() => undefined);
    },
    usedKey: async (orderId: string | null, orderKey?: string | null) => {
      if (!input.drawer) return;
      await logDrawer(
        input.api,
        {
          kind: 'opened',
          drawerId: input.drawer.id,
          staffId: input.staffId,
          reason: 'key',
          orderId: orderKey ? null : orderId,
          noSale: null,
          approvalId: null,
        },
        { orderKey },
      ).catch(() => undefined);
      setState('open');
    },
  };
}

/** What prints by itself after a cash sale, on which printer, as rows for the Paid cell. */
export async function printAfterCash(input: {
  printers: Printer[];
  preview: boolean;
  receipt: () => Promise<Receipt>;
  order: Pick<Order, 'number' | 'serviceType' | 'deliveryPartner'>;
  /** Print the receipt even if it would only ask (the Print button). */
  receiptNow?: boolean;
  onRow: (key: string, row: PrintRow) => void;
}): Promise<void> {
  const svc = printerService({ preview: input.preview });
  const receiptPrinter = input.printers.find((p) => p.settings.prints.receipt !== null && p.settings.prints.receipt !== 'never');
  const wantReceipt = receiptPrinter && (input.receiptNow || receiptPrinter.settings.prints.receipt === 'always');
  if (receiptPrinter && wantReceipt) {
    const row = (state: PrintRow['state']) =>
      input.onRow('receipt', {
        t: 'Receipt',
        det: `${state === 'failed' ? 'Couldn’t print on' : 'Printing on'} ${receiptPrinter.name} · ${PAPER[receiptPrinter.settings.paper]}`,
        state,
      });
    row('printing');
    try {
      await svc.print({ kind: 'receipt', receipt: await input.receipt() }, receiptPrinter.settings);
      row('printed');
    } catch {
      row('failed');
    }
  }
  const leaves = input.order.serviceType === 'to_go' || input.order.serviceType === 'delivery';
  const bagPrinter = input.printers.find((p) => p.settings.prints.bagLabel === 'always');
  if (leaves && bagPrinter && input.order.number !== null) {
    const det = `Order ${input.order.number} · ${input.order.serviceType === 'delivery' ? (input.order.deliveryPartner ?? 'Delivery') : 'To go'}`;
    input.onRow('bag', { t: 'Bag label', det, state: 'printing' });
    try {
      const r = await input.receipt();
      await svc.print(
        {
          kind: 'bagLabel',
          label: {
            shop: r.shop.name,
            partner: input.order.deliveryPartner ?? undefined,
            orderNumber: String(input.order.number),
            items: r.lines.reduce((s, l) => s + l.quantity, 0),
            bags: 1,
            lines: r.lines.map((l) => ({
              quantity: l.quantity,
              name: l.name,
              note: l.note ?? undefined,
            })),
          },
        },
        bagPrinter.settings,
      );
      input.onRow('bag', { t: 'Bag label', det, state: 'printed' });
    } catch {
      input.onRow('bag', { t: 'Bag label', det, state: 'failed' });
    }
  }
}

/** Send what the tablet queued while offline, whenever the connection comes back. */
export function useQueueSync(api: MerchantApi, online: boolean, enabled: boolean) {
  useEffect(() => {
    if (!online || !enabled) return;
    void syncQueue(indexedDbStore(), api).catch(() => undefined);
  }, [api, online, enabled]);
}
