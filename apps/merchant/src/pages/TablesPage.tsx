import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { TableView, WaitlistParty } from '@clear/merchant-contracts';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { useLive } from '@/data/useLive';
import { usePage } from '@/lib/usePage';
import { miCasa } from '@/terminal/reference';
import { AddPartySheet, CallsStrip, EditTablesSheet, FloorView, SeatSheet, TabSheet } from '@/terminal/tables';

/**
 * Tables (terminal reference, sections 8, 8b and 13b): for shops that serve at tables, the floor and
 * the wait list side by side. A tile is a table: its number, how long it's been seated, its tab and
 * its Point. Calls and bills from the Pay case sit above, and turn their tables amber.
 *
 * It follows the floor every 4 seconds, the rate the waiting screens already use: a Call should show
 * within seconds (the Pay case addendum).
 */

type Open = { kind: 'tab'; tableId: string } | { kind: 'seat'; partyId: string; tableId?: string } | { kind: 'party' } | { kind: 'edit' } | null;

export default function TablesPage() {
  usePage('terminal');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const api = useMerchantApi();
  const preview = import.meta.env.DEV && params.get('preview') === '1';
  const q = preview ? `?preview=1${miCasa() ? '&shop=micasa' : ''}` : '';
  const floor = useApi(() => api.floor(), []);
  const staff = useApi(() => api.staff(), []);
  useLive(() => floor.refresh(), 4_000);
  const [open, setOpen] = useState<Open>(() => previewOpen(params));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabOrderId = open?.kind === 'tab' ? floor.data?.tables.find((t) => t.id === open.tableId)?.orderId : null;
  const tab = useApi(() => (tabOrderId ? api.order(tabOrderId) : Promise.resolve(null)), [tabOrderId]);
  const now = Date.now();

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
  const { tables, waitlist, requests } = floor.data;
  const table = (id: string) => tables.find((t) => t.id === id)!;
  const party = (id: string) => waitlist.parties.find((p) => p.id === id)!;
  const nameOf = (id: string) => staff.data?.find((s) => s.id === id)?.name ?? '—';
  const recent = requests.filter((r) => r.state === 'open' || now - Date.parse(r.at) < 60 * 60_000);

  return (
    <>
      <FloorView
        tables={tables}
        waitlist={waitlist}
        now={now}
        onTable={(t: TableView) => setOpen({ kind: 'tab', tableId: t.id })}
        onEdit={() => setOpen({ kind: 'edit' })}
        onAddParty={() => setOpen({ kind: 'party' })}
        onSeat={(p: WaitlistParty) => setOpen({ kind: 'seat', partyId: p.id })}
        strip={recent.some((r) => r.state === 'open') ? <CallsStrip requests={recent} tables={tables} nameOf={nameOf} now={now} onAnswer={(id) => void run(() => api.answerTableRequest(id))} /> : null}
      />
      {open?.kind === 'tab' && (
        <TabSheet
          t={table(open.tableId)}
          order={tab.data}
          now={now}
          onClose={close}
          onSeat={() => void run(() => api.seatTable(open.tableId), close)}
          onClear={() => void run(() => api.clearTable(open.tableId), close)}
          onAddItems={() => navigate(`/new${q ? `${q}&` : '?'}items=1&table=${open.tableId}${tabOrderId ? `&order=${tabOrderId}` : ''}`)}
          onPay={() => tabOrderId && navigate(`/new${q ? `${q}&` : '?'}order=${tabOrderId}&table=${open.tableId}`)}
        />
      )}
      {open?.kind === 'seat' && party(open.partyId) && (
        <SeatSheet
          party={party(open.partyId)}
          tables={tables}
          now={now}
          busy={busy}
          error={error}
          initialTable={open.tableId}
          onClose={close}
          onSeat={(input) => void run(() => api.seatParty(open.partyId, input), close)}
        />
      )}
      {open?.kind === 'party' && <AddPartySheet busy={busy} error={error} onClose={close} onAdd={(p) => void run(() => api.addParty(p), close)} />}
      {open?.kind === 'edit' && <EditTablesSheet tables={tables} busy={busy} error={error} onClose={close} onSave={(rows) => void run(() => api.saveTables({ tables: rows }), close)} />}
    </>
  );
}

/** The preview opens a sheet by name: `&screen=tab&table=12`, `&screen=seat&party=ana`. */
function previewOpen(params: URLSearchParams): Open {
  if (!import.meta.env.DEV || params.get('preview') !== '1') return null;
  const screen = params.get('screen');
  if (screen === 'tab') return { kind: 'tab', tableId: `tbl_${params.get('table') ?? '12'}` };
  if (screen === 'seat') return { kind: 'seat', partyId: `pty_${params.get('party') ?? 'lee'}`, tableId: params.get('table') ? `tbl_${params.get('table')}` : undefined };
  if (screen === 'party') return { kind: 'party' };
  if (screen === 'edit') return { kind: 'edit' };
  return null;
}
