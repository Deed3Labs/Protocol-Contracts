import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { seesMoney } from '@clear/domain';
import type { Device, TableView, WaitlistParty } from '@clear/merchant-contracts';
import { useAuth } from '@/auth/authContext';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { useLive } from '@/data/useLive';
import { useLayout } from '@/lib/useBreakpoint';
import { usePage } from '@/lib/usePage';
import { miCasa } from '@/terminal/reference';
import {
  AddPartySheet,
  EditTablesSheet,
  FloorView,
  MoveSheet,
  PartySheet,
  PhoneTables,
  pointLine,
  seatAssignments,
  SetUpTablesSheet,
  TableSheet,
  waitingOf,
  type EditRow,
} from '@/terminal/tables';

/**
 * Tables (terminal reference, sections 8–8d, Tables v2): for shops that serve at tables. The floor
 * and the wait list side by side, Asking along the top, one sheet per table whose main button is the
 * next step, and on a phone the same floor as a list.
 *
 * It follows the floor every 4 seconds, the rate the waiting screens already use: a Call should show
 * within seconds (the Pay case addendum).
 */

type Open =
  | { kind: 'table'; tableId: string }
  | { kind: 'move'; tableId: string }
  | { kind: 'party'; partyId: string; tableId?: string }
  | { kind: 'add' }
  | { kind: 'setup' }
  | { kind: 'edit' }
  | null;

type Point = Extract<Device, { kind: 'point' }>;

export default function TablesPage() {
  usePage('terminal');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const api = useMerchantApi();
  const layout = useLayout();
  const { session } = useAuth();
  const preview = import.meta.env.DEV && params.get('preview') === '1';
  const q = preview ? `?preview=1${miCasa() ? '&shop=micasa' : ''}` : '';
  const floor = useApi(() => api.floor(), []);
  const settings = useApi(() => api.settings().catch(() => null), []);
  const hardware = useApi(() => api.hardware().catch(() => [] as Device[]), []);
  useLive(() => floor.refresh(), 4_000);
  const [open, setOpen] = useState<Open>(() => previewOpen(params));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const openTable = open && (open.kind === 'table' || open.kind === 'move') ? floor.data?.tables.find((t) => t.id === open.tableId) : undefined;
  const orderId = openTable?.orderId ?? null;
  const order = useApi(() => (orderId ? api.order(orderId) : Promise.resolve(null)), [orderId]);
  const tenders = useApi(() => (orderId && openTable?.status === 'paid' ? api.tenders(orderId) : Promise.resolve([])), [orderId, openTable?.status]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      floor.reload();
    } catch (e) {
      setError(errorSentence(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => (setOpen(null), setError(null));
  if (!floor.data) return null;

  // `&floor=empty`: the first time, before any tables (preview only).
  const empty = preview && params.get('floor') === 'empty';
  const tables = empty ? [] : floor.data.tables;
  const waitlist = empty ? { parties: [], quotedMinutes: floor.data.waitlist.quotedMinutes } : floor.data.waitlist;
  const requests = empty ? [] : floor.data.requests;
  const points = (hardware.data ?? []).filter((d): d is Point => d.kind === 'point');
  const manages = seesMoney(session?.staff.role ?? 'counter');
  const texts = settings.data?.textWaitlist ?? true;
  const battery = (t: TableView) => {
    const p = points.find((x) => x.id === t.point?.id);
    return p?.health ? { percent: p.health.batteryPercent, pluggedIn: p.health.pluggedIn } : null;
  };
  const party = (id: string) => waitlist.parties.find((p) => p.id === id);
  const waiting = waitingOf(waitlist);
  const nextId = (() => {
    const fit = seatAssignments(waiting, tables);
    return waiting.find((p) => fit.has(p.id))?.id;
  })();
  const toNew = (t: TableView, items: boolean) => navigate(`/new${q ? `${q}&` : '?'}${items ? 'items=1&' : ''}table=${t.id}${t.orderId ? `&order=${t.orderId}` : ''}`);
  const seatParty = (p: WaitlistParty, tableId: string, showName = true, text = texts && !!p.phone && p.textConsent) => run(() => api.seatParty(p.id, { tableId, showName, text }), close);

  const floorProps = {
    tables,
    waitlist,
    now,
    onTable: (t: TableView) => setOpen({ kind: 'table', tableId: t.id }),
    onParty: (p: WaitlistParty, tableId?: string) => setOpen({ kind: 'party', partyId: p.id, tableId }),
    onAddParty: () => setOpen({ kind: 'add' }),
  };

  return (
    <>
      {layout === 'phone' ? (
        <PhoneTables {...floorProps} />
      ) : (
        <FloorView
          {...floorProps}
          requests={requests}
          onClear={(t) => void run(() => api.clearTable(t.id))}
          onAnswer={(id) => void run(() => api.answerTableRequest(id))}
          onEdit={manages ? () => setOpen({ kind: 'edit' }) : undefined}
          onSetUp={manages ? () => setOpen({ kind: 'setup' }) : undefined}
        />
      )}
      {open?.kind === 'table' && openTable && (
        <TableSheet
          t={openTable}
          order={order.data ?? null}
          tenders={tenders.data ?? []}
          waitlist={waitlist}
          now={now}
          point={pointLine(openTable, battery(openTable))}
          busy={busy}
          error={error}
          a={{
            onClose: close,
            onSeatWalkIn: (input) => void run(() => api.seatTable(openTable.id, input), close),
            onSeatParty: (p) => void seatParty(p, openTable.id),
            onAddItems: () => toNew(openTable, true),
            onSendBill: () => openTable.point && openTable.orderId && void run(() => api.showOnPoint(openTable.point!.id, { kind: 'order', orderId: openTable.orderId! })),
            onTakeBack: () => openTable.point && void run(() => api.showOnPoint(openTable.point!.id, { kind: 'clear' })),
            onMove: () => setOpen({ kind: 'move', tableId: openTable.id }),
            // Card and cash open Checkout for this bill; Clear and Split are Checkout's own.
            onPay: () => toNew(openTable, false),
            onTakePayment: () => toNew(openTable, false),
            onClear: () => void run(() => api.clearTable(openTable.id), close),
            onAnswer: (id) => void run(() => api.answerTableRequest(id), close),
          }}
        />
      )}
      {open?.kind === 'move' && openTable && (
        <MoveSheet t={openTable} tables={tables} busy={busy} error={error} onClose={close} onMove={(toTableId) => void run(() => api.moveTable(openTable.id, { toTableId }), close)} />
      )}
      {open?.kind === 'party' && party(open.partyId) && (
        <PartySheet
          party={party(open.partyId)!}
          next={open.partyId === nextId}
          tables={tables}
          now={now}
          texts={texts}
          initialTable={open.tableId}
          busy={busy}
          error={error}
          onClose={close}
          onSeat={(input) => void seatParty(party(open.partyId)!, input.tableId, input.showName, input.text)}
          onNotify={() => void run(() => api.notifyParty(open.partyId))}
          onNoShow={() => void run(() => api.noShowParty(open.partyId), close)}
          onRemove={() => void run(() => api.updateParty(open.partyId, { state: 'removed' }), close)}
        />
      )}
      {open?.kind === 'add' && (
        <AddPartySheet
          estimate={waitlist.quotedMinutes}
          ahead={waiting.length}
          texts={texts}
          busy={busy}
          error={error}
          onClose={close}
          onAdd={(p) => void run(() => api.addParty(p), close)}
        />
      )}
      {open?.kind === 'setup' && (
        <SetUpTablesSheet
          busy={busy}
          error={error}
          onClose={close}
          onMake={(count, seats) =>
            void run(
              () => api.saveTables({ tables: Array.from({ length: count }, (_, i) => ({ number: i + 1, label: null, area: null, seats })) }),
              () => setOpen({ kind: 'edit' }),
            )
          }
        />
      )}
      {open?.kind === 'edit' && (
        <EditTablesSheet
          tables={tables}
          points={points.map((p) => ({ id: p.id, code: p.code, payCase: !!p.health?.case || !!p.settings.readerId }))}
          busy={busy}
          error={error}
          onClose={close}
          onSave={(rows: EditRow[]) =>
            void run(
              () => api.saveTables({ tables: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), number: r.number, label: r.label, area: r.area, seats: r.seats, pointId: r.pointId })) }),
              close,
            )
          }
        />
      )}
    </>
  );
}

/**
 * The preview opens a sheet by name, so every frame of 8–8c is a link: `&screen=table&table=2`,
 * `&screen=move&table=2`, `&screen=party&party=lee`, `&screen=add`, `&screen=setup`, `&screen=edit`;
 * `&floor=empty` is the first time.
 */
function previewOpen(params: URLSearchParams): Open {
  if (!import.meta.env.DEV || params.get('preview') !== '1') return null;
  const screen = params.get('screen');
  const table = `tbl_${params.get('table') ?? '2'}`;
  if (screen === 'table') return { kind: 'table', tableId: table };
  if (screen === 'move') return { kind: 'move', tableId: table };
  if (screen === 'party') return { kind: 'party', partyId: `pty_${params.get('party') ?? 'lee'}`, tableId: params.get('table') ? table : undefined };
  if (screen === 'add') return { kind: 'add' };
  if (screen === 'setup') return { kind: 'setup' };
  if (screen === 'edit') return { kind: 'edit' };
  return null;
}
