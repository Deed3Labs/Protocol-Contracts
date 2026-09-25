import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { CloseDayResult } from '@clear/merchant-contracts';
import { useAuth } from '@/auth/authContext';
import { useMerchantApi } from '@/data/merchantApi';
import { errorSentence, useApi } from '@/data/useApi';
import { CloseDayView } from '@/home/drawer';
import { closeDayFrom, closedSummary } from '@/home/liveClose';
import { DAY, DRAWERS } from '@/home/seed';
import { useLayout } from '@/lib/useBreakpoint';
import { FlowTop } from '@/shell/chrome';

/**
 * Close the day — the Home reference's closing screen, for the last owner or manager out.
 *
 * A live shop's day comes from the merchant API (UI Phase 6, step 7): what was taken and how, tips,
 * tax and discounts (Overview), what's still waiting (the day's orders), and the drawer as the two
 * counts left it. Closing captures the day's cards and locks the report; a card that couldn't be
 * captured is named, with what to do. In development `?drawer=short|signed|balanced` shows the
 * reference scenario; `?preview=1&live=1` runs this against the mock.
 */
export default function CloseDayPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const layout = useLayout();
  const [params] = useSearchParams();
  const which = import.meta.env.DEV ? (params.get('drawer') as keyof typeof DRAWERS | null) : null;
  const reference = !!which && which in DRAWERS && params.get('live') !== '1';
  const keep = params.get('preview') === '1' ? `?${params.toString()}` : '';

  const api = useMerchantApi();
  const drawer = useApi(() => (reference ? Promise.resolve(null) : api.drawer()), [reference]);
  const s = drawer.data;
  const day = s?.businessDate ?? null;
  const counts = useApi(() => (s ? api.counts(s.id) : Promise.resolve(null)), [s?.id]);
  const overview = useApi(() => (day ? api.overview({ from: day, to: day }) : Promise.resolve(null)), [day]);
  const orders = useApi(() => (day ? api.orders({ date: day }) : Promise.resolve(null)), [day]);
  const settings = useApi(() => (reference ? Promise.resolve(null) : api.settings()), [reference]);
  const staff = useApi(() => (reference ? Promise.resolve(null) : api.staff()), [reference]);
  // Who signed a difference off: on the audit trail, which only an owner reads.
  const owner = session?.staff.role === 'owner';
  const audit = useApi(() => (day && owner ? api.audit({ from: day, to: day }) : Promise.resolve(null)), [day, owner]);
  const [closed, setClosed] = useState<CloseDayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const home = () => navigate(`/${keep}`);
  const me = session?.staff.name ?? '';

  if (reference) {
    return (
      <CloseDayView
        day={DAY}
        drawer={DRAWERS[which!]}
        onShift={me}
        twoColumn={layout === 'two-column'}
        onExit={() => navigate('/')}
        onSignOff={() => navigate('/close?drawer=signed')}
        onClose={() => navigate('/')}
      />
    );
  }

  // ---- Closed: the report, and any card that needs the owner --------------------------------------
  if (closed) {
    const c = closedSummary(closed);
    return (
      <div className="c-app c-mc-tablet c-mc-page">
        <FlowTop title="The day is closed" onExit={home} onShift={me} />
        <div className="c-slab c-one">
          <div className="c-cell">
            <div className="c-chead">
              <div className="c-sechead">
                <p className="c-label">Locked</p>
                <span className="c-det">{c.date}</span>
              </div>
            </div>
            <div className="c-cmain">
              <div className="c-rows">
                {c.rows.map(([k, v]) => (
                  <div key={k}>
                    <div className="c-kv">
                      <span>{k}</span>
                      <span className="c-v">{v}</span>
                    </div>
                  </div>
                ))}
              </div>
              {closed.captureFailures.length > 0 && (
                <div role="alert" style={{ marginTop: 'var(--s2)' }}>
                  <p className="c-t">{closed.captureFailures.length === 1 ? 'One card needs you' : `${closed.captureFailures.length} cards need you`}</p>
                  {closed.captureFailures.map((f) => (
                    <p key={f.tenderId} className="c-det" style={{ marginTop: 4 }}>
                      {f.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="c-cfoot">
              <div className="c-line" style={{ alignItems: 'center' }}>
                <span className="c-det">The report is kept in Overview.</span>
                <button type="button" className="c-btn c-btn-primary" onClick={home}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (drawer.loading || counts.loading || overview.loading || orders.loading) return null;
  // No drawer open: nothing to close (it was closed already, or never opened today).
  if (!s) return <Navigate to={`/${keep}`} replace />;

  const view = counts.data;
  const built = view && overview.data && orders.data ? closeDayFrom({ session: s, view, overview: overview.data, orders: orders.data, settings: settings.data, staff: staff.data ?? [], audit: audit.data ?? [] }) : null;
  if (!built) {
    return (
      <div className="c-app c-mc-tablet c-mc-page">
        <FlowTop title="Close the day" onExit={home} onShift={me} />
        <p className="c-det" role="alert" style={{ padding: 'var(--s3) 0' }}>
          {overview.error ?? orders.error ?? counts.error ?? (view && view.state !== 'compared' ? 'Count the drawer first: two counts, blind, from Home.' : 'The day couldn’t be read. Try again.')}
        </p>
      </div>
    );
  }

  return (
    <>
      <CloseDayView
        day={built.day}
        drawer={built.drawer}
        onShift={me}
        twoColumn={layout === 'two-column'}
        onExit={home}
        // A difference nobody signed off: the sign-off is on Home, with the counts.
        onSignOff={home}
        onClose={
          busy
            ? undefined
            : () => {
                setBusy(true);
                setError(null);
                api
                  .closeDay(s.id)
                  .then(setClosed)
                  .catch((e: unknown) => setError(errorSentence(e)))
                  .finally(() => setBusy(false));
              }
        }
      />
      {error && (
        <p className="c-det" role="alert" style={{ position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 60, color: 'var(--absent)', background: 'var(--paper)', padding: 'var(--s2)', border: '1px solid var(--absent)' }}>
          {error}
        </p>
      )}
    </>
  );
}
