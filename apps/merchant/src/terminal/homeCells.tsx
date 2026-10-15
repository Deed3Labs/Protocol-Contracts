import { useMerchantApi } from '@/data/merchantApi';
import { useApi } from '@/data/useApi';
import { useLive } from '@/data/useLive';
import { CallsStrip, OrderReadyCell } from './tables';

/**
 * Clear Terminal on Home (terminal reference, sections 9 and 13b): Order ready for a shop with a
 * counter Point (counter service, or a restaurant's to-go orders), and Calls and bills for a shop with
 * tables. Neither shows without the hardware. Both follow every 4 seconds while Home is open.
 */
export function TerminalHomeCells() {
  const api = useMerchantApi();
  const settings = useApi(() => api.settings().catch(() => null), []);
  const hw = useApi(() => api.hardware().catch(() => []), []);
  const tables = settings.data?.tableService === true;
  const counterPoint = (hw.data ?? []).some((d) => d.kind === 'point' && d.settings.placement === 'counter');
  const pickups = useApi(() => (counterPoint ? api.pickups().catch(() => null) : Promise.resolve(null)), [counterPoint]);
  const floor = useApi(() => (tables ? api.floor().catch(() => null) : Promise.resolve(null)), [tables]);
  const staff = useApi(() => api.staff().catch(() => []), []);
  useLive(() => void Promise.all([tables ? floor.refresh() : null, counterPoint ? pickups.refresh() : null]), tables || counterPoint ? 4_000 : null);
  const now = Date.now();
  const recent = floor.data?.requests.filter((r) => r.state === 'open' || now - Date.parse(r.at) < 60 * 60_000) ?? [];
  return (
    <>
      {tables && floor.data && recent.some((r) => r.state === 'open') && (
        <CallsStrip
          requests={recent}
          tables={floor.data.tables}
          nameOf={(id) => staff.data?.find((s) => s.id === id)?.name ?? '—'}
          now={now}
          onAnswer={(id) => void api.answerTableRequest(id).then(() => floor.reload())}
        />
      )}
      {counterPoint && !!pickups.data?.length && (
        <OrderReadyCell
          orders={pickups.data}
          onCall={(orderId) => void api.createAlert({ kind: 'order_ready', orderId, pointId: null }).then(() => pickups.reload())}
          onPickedUp={(orderId) => void api.markPickedUp(orderId).then(() => pickups.reload())}
        />
      )}
    </>
  );
}
